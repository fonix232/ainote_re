import { useRef, useEffect, useState } from 'preact/hooks';
import { ChevronLeft, ChevronRight, RefreshCw, X, SkipBack, Play, Pause, Square, Mic, MicOff, Loader } from 'lucide-preact';
import { useSignal } from '@preact/signals';
import { store } from '../store/index.js';
import { activeProto } from '../protocols/registry.js';
import { FileList } from './FileList.js';
import type { FileEntry } from './FileList.js';
import {
  stop, replay, scheduleF32,
  playFileDownload,
  type PlaybackFile,
  pausePlayback, resumePlayback,
  ensureAudioCtx,
  seekTo,
} from '../audio/player.js';
import { ffmpeg } from '../audio/ffmpeg.js';
import { whisper } from '../audio/whisper.js';

export function RightPanel() {
  const s      = store.connection.state.value;
  const isConn = s === 'connected';
  const proto  = activeProto.value;
  const collapsed = useSignal(false);

  const [cachedFiles, setCachedFiles]   = useState<Record<string, PlaybackFile>>({});
  const [ffmpegStatus, setFfmpegStatus] = useState<Record<string, string>>({});

  const fileList = store.device.files.value;
  useEffect(() => {
    if (!isConn || !store.device.supportsFiles.value) { setCachedFiles({}); return; }
    const fmt = store.device.audioFormat.value;
    if (!fmt) return;
    const loaded: Record<string, PlaybackFile> = {};
    for (const f of fileList) {
      const bytes = store.persistence.cache.load(cacheKey(f.id));
      if (bytes) loaded[f.id] = { data: bytes, raw: bytes, format: fmt };
    }
    setCachedFiles(loaded);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConn, fileList.length, store.device.supportsFiles.value, store.device.audioFormat.value]);

  function cacheKey(id: string): string {
    return `${store.connection.activeProtoId.value}:${store.connection.label.value}:${id}:v2`;
  }

  async function onDownload(id: string): Promise<void> {
    const dl = store.device.downloadProgress.value;
    if (dl) return;
    const cached = cachedFiles[id];
    if (cached) { offerFileDownload(id, cached.data, cached.format.extension); return; }
    if (!proto?.hasFiles()) return;
    try {
      const result = await proto.downloadFile(id);
      const playbackFile: PlaybackFile = { ...result, format: store.device.audioFormat.value ?? proto.audioFormat };
      setCachedFiles(prev => ({ ...prev, [id]: playbackFile }));
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

  const supportsDeviceDelete = isConn && store.device.supportsFiles.value;
  const showFfmpegBtn        = store.device.audioFormat.value?.codec.type === 'sbc';
  const dl = store.device.downloadProgress.value;

  const fileEntries: FileEntry[] = store.device.supportsFiles.value && proto?.hasFiles()
    ? fileList.map(f => {
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
        >{collapsed.value ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}</button>
        {!collapsed.value && (
          <span class="text-xs font-semibold uppercase tracking-wider text-base-content/50 flex-1">Audio &amp; Files</span>
        )}
      </div>

      {!collapsed.value && store.audio.visible.value && <AudioSection />}

      {!collapsed.value && whisper.enabled.value && <TranscriptPanel />}

      {!collapsed.value && isConn && store.device.supportsFiles.value && (
        <div class="flex-1 flex flex-col p-3 gap-2">
          <div class="flex items-center gap-2">
            <span class="text-xs font-semibold uppercase tracking-wider text-base-content/50 flex-1">
              Recordings
            </span>
            <button
              class="btn btn-xs btn-ghost"
              title="Refresh file list"
              onClick={() => { const p = proto; if (p?.hasFiles()) void p.refreshFiles().catch((e: unknown) => store.log.error((e as Error).message)); }}
            >
              <RefreshCw size={13} />
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
  const proto       = activeProto.value;
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

  // When live-streaming, player buttons control the device recording instead
  // of local playback.
  const rec = isLive && store.device.supportsRecording.value && proto?.hasRecord() ? proto : null;

  function onClose() {
    stop();
    store.audio.visible.value = false;
    store.audio.codec.value   = undefined;
  }

  function onStop() {
    if (rec) void rec.stopRecord().catch((e: unknown) => store.log.error((e as Error).message));
    else stop();
  }

  function onPlayPause() {
    if (rec) {
      if (isPaused) void rec.resumeRecord?.().catch((e: unknown) => store.log.error((e as Error).message));
      else          void rec.pauseRecord?.().catch((e: unknown) => store.log.error((e as Error).message));
    } else {
      if (isIdle)        void replay();
      else if (isPaused) void resumePlayback();
      else               void pausePlayback();
    }
  }

  const PlayIcon  = isPaused || isIdle ? Play : Pause;
  // In live mode: show "Pause recording" / "Resume recording"
  // In file mode: show "Play" / "Pause"
  const playTitle = rec
    ? (isPaused ? 'Resume recording' : 'Pause recording')
    : (isPaused || isIdle ? 'Play' : 'Pause');
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
        <button class="btn btn-xs btn-ghost" onClick={onClose} title="Close player"><X size={13} /></button>
      </div>

      {/* Waveform */}
      <canvas
        ref={canvasRef}
        id="waveform"
        width={256}
        height={60}
        class="w-full rounded bg-base-300"
      />

      {/* Time + seek */}
      <div class="mt-2 mb-2">
        <div class="flex justify-between text-xs text-base-content/50 mb-1">
          <span>{formatTime(curTime)}</span>
          {duration != null && <span>{formatTime(duration)}</span>}
        </div>
        {duration != null && (
          <div
            class="relative w-full h-2 bg-base-300 rounded-full cursor-pointer group"
            onClick={(e) => {
              const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
              seekTo(((e.clientX - rect.left) / rect.width) * duration);
            }}
          >
            <div
              class="absolute left-0 top-0 h-full bg-primary rounded-full pointer-events-none group-hover:bg-primary/80"
              style={{ width: `${Math.min(100, (curTime / duration) * 100)}%` }}
            />
          </div>
        )}
      </div>

      {/* Controls */}
      <div class="flex gap-1">
        <button
          class="btn btn-sm btn-ghost"
          disabled={isIdle || isLive}
          onClick={() => void replay()}
          title="Restart"
        ><SkipBack size={15} /></button>
        <button
          class="btn btn-sm btn-primary flex-1"
          onClick={onPlayPause}
          title={playTitle}
          disabled={rec ? !rec.pauseRecord : (isIdle && !isPaused)} // rec is Feature.Recording when set
        ><PlayIcon size={15} /></button>
        <button
          class="btn btn-sm btn-ghost"
          disabled={isIdle && !rec}
          onClick={onStop}
          title={rec ? 'Stop recording' : 'Stop'}
        ><Square size={15} /></button>
        <WhisperToggle />
      </div>
    </div>
  );
}

function WhisperToggle() {
  const status   = whisper.status.value;
  const enabled  = whisper.enabled.value;
  const busy     = whisper.busy.value;
  const progress = whisper.loadProgress.value;

  const loading = status === 'loading';
  const Icon    = loading || busy ? Loader : enabled ? Mic : MicOff;
  const title   = loading  ? (progress || 'Loading model…')
                : busy     ? 'Transcribing…'
                : enabled  ? 'Transcription on — click to disable'
                           : 'Enable transcription';

  return (
    <button
      class={`btn btn-sm btn-ghost ${enabled ? 'text-primary' : 'text-base-content/40'}`}
      title={title}
      disabled={loading || busy}
      onClick={() => { void whisper.toggle().catch(e => store.log.error((e as Error).message)); }}
    >
      <Icon size={15} class={loading || busy ? 'animate-spin' : ''} />
    </button>
  );
}

function TranscriptPanel() {
  const chunks = whisper.transcript.value;
  const busy   = whisper.busy.value;
  if (chunks.length === 0 && !busy) return null;
  return (
    <div class="p-3 border-b border-base-content/10 shrink-0">
      <div class="flex items-center gap-2 mb-2">
        <span class="text-xs font-semibold uppercase tracking-wider text-base-content/50 flex-1">Transcript</span>
        {chunks.length > 0 && (
          <button
            class="btn btn-xs btn-ghost"
            title="Clear transcript"
            onClick={() => { whisper.transcript.value = []; }}
          ><X size={12} /></button>
        )}
      </div>
      {busy && chunks.length === 0 && (
        <p class="text-xs text-base-content/40 flex items-center gap-1">
          <Loader size={11} class="animate-spin" /> Transcribing…
        </p>
      )}
      <div class="flex flex-col gap-1 max-h-48 overflow-y-auto text-xs leading-relaxed">
        {chunks.map((c, i) => (
          <p key={i} class="text-base-content/80">
            {c.startSec != null && (
              <span class="text-base-content/30 mr-1.5 tabular-nums">{formatTime(c.startSec)}</span>
            )}
            {c.text}
          </p>
        ))}
        {busy && chunks.length > 0 && (
          <p class="text-base-content/30 flex items-center gap-1"><Loader size={10} class="animate-spin" /> …</p>
        )}
      </div>
    </div>
  );
}
