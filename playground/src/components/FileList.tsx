export interface FileEntry {
  id: string;
  label: string;
  sizeLabel: string;
  speed?: string | undefined;
  progress?: number | undefined;
  canPlay: boolean;
  onPlay?: (() => void) | undefined;
  onPlayFfmpeg?: (() => void) | undefined;
  ffmpegStatus?: string | undefined;
  onDownload?: (() => void | Promise<void>) | undefined;
  onDelete?: (() => void) | undefined;
  onDeviceDelete?: (() => void) | undefined;
  downloadDisabled?: boolean | undefined;
}

interface FileListProps {
  entries: FileEntry[];
}

export function FileList({ entries }: FileListProps) {
  if (!entries.length) return (
    <p class="text-xs text-base-content/30 px-1 py-2">No recordings on device.</p>
  );
  return (
    <div class="flex flex-col divide-y divide-base-content/5">
      {entries.map(e => <FileEntryRow key={e.id} entry={e} />)}
    </div>
  );
}

function FileEntryRow({ entry }: { entry: FileEntry }) {
  const { progress } = entry;
  const isActive = progress !== undefined;

  return (
    <div class="flex flex-col gap-1 py-2 px-1">
      <div class="flex items-center gap-1">
        <div class="flex-1 min-w-0">
          <div class="text-xs font-medium truncate">{entry.label}</div>
          <div class="text-xs text-base-content/40">
            {entry.sizeLabel}
            {entry.speed && <span class="ml-1">{entry.speed}</span>}
          </div>
        </div>
        <div class="flex gap-0.5 shrink-0">
          {entry.canPlay && (
            <button class="btn btn-xs btn-ghost px-1.5" title="Play" onClick={entry.onPlay}>▶</button>
          )}
          {entry.onPlayFfmpeg && (
            <button class="btn btn-xs btn-ghost px-1.5" title="Play via FFmpeg" onClick={entry.onPlayFfmpeg}>F▶</button>
          )}
          {entry.onDownload && (
            <button class="btn btn-xs btn-ghost px-1.5" title="Download" disabled={!!entry.downloadDisabled} onClick={entry.onDownload}>⬇</button>
          )}
          {entry.onDeviceDelete && (
            <button class="btn btn-xs btn-ghost px-1.5 text-error hover:bg-error/10" title="Delete from device" onClick={entry.onDeviceDelete}>🗑</button>
          )}
          {entry.onDelete && (
            <button class="btn btn-xs btn-ghost px-1.5 text-base-content/30" title="Remove from cache" onClick={entry.onDelete}>✕</button>
          )}
        </div>
      </div>
      {isActive && (
        <progress class="progress progress-primary w-full h-1" value={progress} max={100} />
      )}
      {entry.ffmpegStatus && (
        <span class="text-xs text-base-content/40">{entry.ffmpegStatus}</span>
      )}
    </div>
  );
}
