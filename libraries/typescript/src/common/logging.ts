import { signal } from '@preact/signals-core';
import type { ReadonlySignal } from '@preact/signals-core';

export enum LogType {
  Tx = 'tx',
  Rx = 'rx',
  Info = 'info',
  Warn = 'warn',
  Error = 'error',
}

export interface LogEntry {
  readonly id: string;
  readonly type: LogType;
  readonly bytes: Uint8Array;
  readonly label: string;
  readonly timestamp: number;
}

export class LogBuffer {
  private _nextLogId = 0;
  private readonly _entries = signal<LogEntry[]>([]);

  readonly entries: ReadonlySignal<LogEntry[]> = this._entries;

  write(type: LogType, bytes: Uint8Array, label?: string, id?: string): string {
    const entryId = id ?? String(this._nextLogId++);
    const entry: LogEntry = {
      id: entryId,
      type,
      bytes,
      label: label ?? '',
      timestamp: Date.now(),
    };
    const idx = this._entries.value.findIndex(existing => existing.id === entryId);
    if (idx >= 0) {
      const updated = [...this._entries.value];
      updated[idx] = entry;
      this._entries.value = updated;
    } else {
      this._entries.value = [...this._entries.value, entry];
    }
    return entryId;
  }
}
