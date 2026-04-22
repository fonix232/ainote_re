import { signal } from '@preact/signals';
import type { Signal } from '@preact/signals';
import type { AnyCommand, AudioFormat, DeviceInfo, FileInfo } from '@ainote/protocols';

export class DeviceStore {
  readonly protocolLabel: Signal<string> = signal('');
  readonly audioFormat: Signal<AudioFormat | undefined> = signal(undefined);
  readonly stateTiles: Signal<Record<string, string>> = signal({});
  readonly files: Signal<FileInfo[]> = signal([]);
  readonly downloadProgress: Signal<{ fileId: string; pct: number } | null> = signal(null);
  readonly battery: Signal<number | null> = signal(null);
  readonly storage: Signal<{ total: number; free: number } | null> = signal(null);
  readonly deviceInfo: Signal<DeviceInfo | null> = signal(null);
  readonly commands: Signal<AnyCommand[]> = signal([]);
  readonly supportsFiles: Signal<boolean> = signal(false);
  readonly supportsRecording: Signal<boolean> = signal(false);
  readonly supportsStreaming: Signal<boolean> = signal(false);

  reset(): void {
    this.protocolLabel.value = '';
    this.audioFormat.value = undefined;
    this.stateTiles.value = {};
    this.files.value = [];
    this.downloadProgress.value = null;
    this.battery.value = null;
    this.storage.value = null;
    this.deviceInfo.value = null;
    this.commands.value = [];
    this.supportsFiles.value = false;
    this.supportsRecording.value = false;
    this.supportsStreaming.value = false;
  }
}