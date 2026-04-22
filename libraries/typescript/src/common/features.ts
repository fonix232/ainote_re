import type { ReadonlySignal } from '@preact/signals-core';
import type { DeviceInfo as DeviceInfoModel, FileInfo } from './models.js';

export namespace Feature {
  export interface Files {
    readonly files: ReadonlySignal<FileInfo[]>;
    readonly downloadProgress: ReadonlySignal<{ fileId: string; pct: number } | null>;
    refreshFiles(): Promise<void>;
    downloadFile(id: string): Promise<{ data: Uint8Array; raw: Uint8Array }>;
    deleteFile(id: string): Promise<void>;
  }

  export interface Battery {
    readonly battery: ReadonlySignal<number | null>;
    refreshBattery(): Promise<void>;
  }

  export interface Storage {
    readonly storage: ReadonlySignal<{ total: number; free: number } | null>;
    refreshStorage(): Promise<void>;
  }

  export interface Time {
    syncTime(): Promise<void>;
  }

  export interface DeviceInfo {
    readonly deviceInfo: ReadonlySignal<DeviceInfoModel | null>;
    refreshDeviceInfo(): Promise<void>;
  }

  export interface Settings {
    readonly settings: ReadonlySignal<Record<string, boolean | number | string | null>>;
  }

  export interface Recording {
    startRecord(): Promise<void>;
    stopRecord(): Promise<void>;
    pauseRecord?(): Promise<void>;
    resumeRecord?(): Promise<void>;
  }

  export interface Stream {
    readonly streamData: ReadonlySignal<Uint8Array | null>;
  }
}
