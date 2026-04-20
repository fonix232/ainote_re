import { useRef, useEffect, useState } from 'preact/hooks';
import { useSignal } from '@preact/signals';
import { store } from '../store/index.js';
import { activeProto } from '../protocols/registry.js';
import { FileList } from './FileList.js';
import type { FileEntry } from './FileList.js';
import type { FileDownload } from '@ainote/protocols';
import {
  stop, replay, scheduleF32,
  playFileDownload,
  pausePlayback, resumePlayback,
  ensureAudioCtx,
} from '../audio/player.js';
import { ffmpeg } from '../audio/ffmpeg.js';

export function RightPanel() {
  const s      = store.connection.state.value;
  const isConn = s === 'connected';
  const proto  = activeProto.value;
  const collapsed = useSignal(false);

  const [cachedFiles, setCachedFiles]   = useState<Record<string, FileDownload>>({});
  const [ffmpegStatus, setFfmpegStatus] = useState<Record<string, string>>({});

  const fileList = proto?.hasFiles() ? proto.files.value : [];
  useEffect(() => {
    if (!isConn || !proto?.hasFiles()) { setCachedFiles({}); return; }
    const loaded: Record<string, FileDownload> = {};
    for (const f of proto.files.value) {
      const bytes = store.persistence.cache.load(cacheKey(f.id));
      if (bytes) loaded[f.id] = { data: bytes, raw: bytes, format: proto.audioFormat };
    }
    setCachedFiles(loaded);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConn, fileList.length]);

  function cacheKey(id: string): string {
    return `${store.connection.activeProtoId.value}:${store.connection.label.value}:${id}:v2`;
  }

  async function onDownload(id: string): Promise<void> {
    const dl = proto?.hasFiles() ? proto.downloadProgress.value : null;
    if (dl) return;
    const cached = cachedFiles[id];
    if (cached) { offerFileDownload(id, cached.data, cached.format.extension); return; }
    if (!proto?.hasFiles()) return;
    try {
      const result = await proto.downloadFile(id);
      setCachedFiles(prev => ({ ...prev, [id]: result }));
      store.persistence.cache.save(cacheKey(id), result.data);
    } catch (err) {
      store.log.error((err as Error).message);
    }
  }

  async function onPlay(id: string): Promise<void> {
    const fd = cachedFiles[id];
    if (!fd) return;
    stop();
    store.audio.visible.value = true;
    store.audio.codec.value   = fd.format;
    await playFileDownload(fd);
  }

  async function onPlayFfmpeg(id: string): Promise<void> {
    const fd = cachedFiles[id];
    if (!fd || fd.format.codec.type !== 'sbc') return;
    stop();
    setFfmpegStatus(prev => ({ ...prev, [id]: 'Loading ffmpeg...' }));
    try {
      const sampleRate = fd.format.codec.sampleRate ?? 16000;
      const f32 = await ffmpeg.sbcToFloat32(fd.data, sampleRate,
        msg => { setFfmpegStatus(prev => ({ ...prev, [id]: msg })); },
      );
      store.audio.visible.value = true;
      store.audio.codec.value   = fd.format;
      const ctx = ensureAudioCtx(sampleRate);
      if (ctx.state !== 'running') await ctx.resume();
      scheduleF32(f32, sampleRate);
      store.audio.playbackState.value = 'playing';
    } catch (err) {
      store.log.error('FFmpeg: ' + (err as Error).message);
    } finally {
      setFfmpegStatus(prev => ({ ...prev, [id]: '' }));
    }
  }

  function onRemoveLocal(id: string): void {
    store.persistence.cache.delete(cacheKey(id));
    setCachedFiles(prev => { const n = { ...prev }; delete n[id]; return n; });
  }

  async function onDeviceDelete(id: string): Promise<void> {
    if (!proto?.hasFiles()) return;
    try {
      await proto.deleteFile(id);
      store.persistence.cache.delete(cacheKey(id));
      setCachedFiles(prev => { const n = { ...prev }; delete n[id]; return n; });
    } catch (err) {
      store.log.error((err as Error).message);
    }
  }

  function offerFileDownload(id: string, bytes: Uint8Array, ext?: string): void {
    const filename = ext ? `${id}.${ext}` : id;
    const url = URL.createObjectURL(new Blob([bytes as unknown as Uint8Array<ArrayBuffer>], { type: 'application/octet-stream' }));
    const a   = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }

  const supportsDeviceDelete = isConn && !!proto?.hasFiles();
  const showFfmpegBtn        = proto?.audioFormat.codec.type === 'sbc';
  const dl = proto?.hasFiles() ? proto.downloadProgress.value : null;

  const fileEntries: FileEntry[] = proto?.hasFiles()
    ? proto.files.value.map(f => {
        const cached = cachedFiles[f.id];
        return {
          id:               f.id,
          label:            f.label,
          sizeLabel:        f.size != null
            ? f.size >= 1_048_576
              ? `${(f.size / 1_048_576).toFixed(1)} MB`
              : `${(f.size / 1024).toFixed(1)} kB`
            : '',
          progress:         dl?.fileId === f.id ? dl.pct : undefined,
          downloadDisabled: dl !== null && dl.fileId !== f.id,
          canPlay:          !!cached,
          onDownload:       () => onDownload(f.id),
          onPlay:           cached ? () => { void onPlay(f.id); } : undefined,
          onPlayFfmpeg:     (cached && showFfmpegBtn) ? () => { void onPlayFfmpeg(f.id); } : undefined,
          ffmpegStatus:     ffmpegStatus[f.id],
          onDelete:         cached ? () => onRemoveLocal(f.id) : undefined,
          onDeviceDelete:   supportsDeviceDelete ? () => { void onDeviceDelete(f.id); } : undefined,
        };
      })
    : [];

  return (
    <aside class={`${collapsed.value ? 'w-8' : 'w-72'} shrink-0 flex flex-col overflow-y-auto bg-base-200 border-l border-base-content/10 transition-[width] duration-200`}>

      {/* Header row */}
      <div class="px-1 h-10 flex items-center border-b border-base-content/10 shrink-0 gap-1">
        <button
          class="btn btn-ghost btn-xs"
          title={collapsed.value ? 'Expand panel' : 'Collapse panel'}
          onClick={() => { collapsed.value = !collapsed.value; }}
        >{collapsed.value ? '‹' : '›'}</button>
        {!collapsed.value && (
          <span class="text-xs font-semibold uppercase tracking-wider text-base-content/50 flex-1">Audio &amp; Files</span>
        )}
      </div>

      {!collapsed.value && store.audio.visible.value && <AudioSection />}

      {!collapsed.value && isConn && proto?.hasFiles() && (
        <div class="flex-1 flex flex-col p-3 gap-2">
          <div class="flex items-center gap-2">
            <span class="text-xs font-semibold uppercase tracking-wider text-base-content/50 flex-1">
              Recordings
            </span>
            <button
              class="btn btn-xs btn-ghost"
              title="Refresh file list"
              onClick={() => void proto.refreshFiles().catch(e => store.log.error((e as Error).message))}
            >
              ↺
            </button>
          </div>
          <FileList entries={fileEntries} />
        </div>
      )}
    </aside>
  );
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function AudioSection() {
  const codec       = store.audio.codec.value;
  const pState      = store.audio.playbackState.value;
  const curTime     = store.audio.currentTime.value;
  const duration    = store.audio.duration.value;
  const canvasRef   = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    (window as Window & { __waveformCanvas?: HTMLCanvasElement | null }).__waveformCanvas =
      canvasRef.current ?? null;
  });

  const isIdle   = pState === 'idle';
  const isPaused = pState === 'paused';
  const isLive   = duration === null;

  function onClose() {
    stop();
    store.audio.visible.value = false;
    store.audio.codec.value   = undefined;
  }

  function onStop() { stop(); }

  function onPlayPause() {
    if (isIdle)        void replay();
    else if (isPaused) void resumePlayback();
    else               void pausePlayback();
  }

  const playIcon    = isPaused || isIdle ? '▶' : '⏸';
  const playTitle   = isPaused || isIdle ? 'Play' : 'Pause';
  const codecLabel  = typeof codec === 'object' ? codec.name : codec != null ? String(codec) : null;

  return (
    <div class="p-3 border-b border-base-content/10 shrink-0">
      {/* Header */}
      <div class="flex items-center gap-2 mb-2">
        <span class="text-xs font-semibold uppercase tracking-wider text-base-content/50 flex-1">
          {isLive ? 'Live' : 'Audio'}
        </span>
        {codecLabel && (
          <span class="badge badge-sm badge-outline">{codecLabel}</span>
        )}
        <button class="btn btn-xs btn-ghost" onClick={onClose} title="Close player">✕</button>
      </div>

      {/* Waveform */}
      <canvas
        ref={canvasRef}
        id="waveform"
        width={256}
        height={60}
        class="w-full rounded bg-base-300"
      />

      {/* Time row — always shown; progress bar only when duration is known */}
      <div class="mt-2 mb-2">
        <div class="flex justify-between text-xs text-base-content/50 mb-1">
          <span>{formatTime(curTime)}</span>
          {duration != null && <span>{formatTime(duration)}</span>}
        </div>
        {duration != null && (
          <progress
            class="progress progress-primary w-full h-1.5"
            value={curTime}
            max={duration}
          />
        )}
      </div>

      {/* Controls */}
      <div class="flex gap-1">
        <button
          class="btn btn-sm btn-ghost"
          disabled={isIdle || isLive}
          onClick={() => void replay()}
          title="Restart"
        >◀◀</button>
        <button
          class="btn btn-sm btn-primary flex-1"
          onClick={onPlayPause}
          title={playTitle}
        >{playIcon}</button>
        <button
          class="btn btn-sm btn-ghost"
          disabled={isIdle}
          onClick={onStop}
          title="Stop"
        >⏹</button>
      </div>
    </div>
  );
}
