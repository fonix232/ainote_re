import { signal } from '@preact/signals';
import type { Signal } from '@preact/signals';
import { LogType } from '@ainote/protocols';
import type { LogEntry as ProtocolLogEntry } from '@ainote/protocols';

// ─── Types ────────────────────────────────────────────────────────────────────

export type LogDir = 'TX' | 'RX';

export interface DiscoveredServiceInfo {
  uuid:            string;
  characteristics: { uuid: string; properties: string[] }[];
}

export type LogEvent =
  | { kind: 'frame';       dir: LogDir; bytes: Uint8Array; label: string }
  | { kind: 'connected';   name: string; protoLabel: string }
  | { kind: 'disconnected'; name: string }
  | { kind: 'discovery';   deviceName: string; services: DiscoveredServiceInfo[] }
  | { kind: 'info';        msg: string }
  | { kind: 'warn';        msg: string }
  | { kind: 'error';       msg: string };

export interface LogEntry {
  id: number;
  ts: string;
  event: LogEvent;
}

// ─── Store ───────────────────────────────────────────────────────────────────

export class LogStore {
  readonly entries: Signal<LogEntry[]> = signal([]);
  #id = 0;
  #protocolEntryIds = new Map<string, number>();

  #timestamp(): string {
    const d = new Date();
    return [d.getHours(), d.getMinutes(), d.getSeconds()]
      .map(n => String(n).padStart(2, '0')).join(':');
  }

  #push(event: LogEvent): number {
    const ts = this.#timestamp();
    const id = ++this.#id;
    this.entries.value = [...this.entries.value, { id, ts, event }];
    return id;
  }

  protocol(entry: ProtocolLogEntry): number {
    const existingId = this.#protocolEntryIds.get(entry.id);
    const nextEvent = this.#fromProtocol(entry);
    if (existingId == null) {
      const id = this.#push(nextEvent);
      this.#protocolEntryIds.set(entry.id, id);
      return id;
    }

    const ts = this.#timestamp();
    this.entries.value = this.entries.value.map(logEntry =>
      logEntry.id === existingId
        ? { ...logEntry, ts, event: nextEvent }
        : logEntry,
    );
    return existingId;
  }

  #fromProtocol(entry: ProtocolLogEntry): LogEvent {
    switch (entry.type) {
      case LogType.Tx:
        return { kind: 'frame', dir: 'TX', bytes: entry.bytes, label: entry.label };
      case LogType.Rx:
        return { kind: 'frame', dir: 'RX', bytes: entry.bytes, label: entry.label };
      case LogType.Warn:
        return { kind: 'warn', msg: entry.label };
      case LogType.Error:
        return { kind: 'error', msg: entry.label };
      case LogType.Info:
      default:
        return { kind: 'info', msg: entry.label };
    }
  }

  /** Raw TX/RX frame from the protocol. */
  frame(dir: LogDir, bytes: Uint8Array, label = ''): number {
    return this.#push({ kind: 'frame', dir, bytes, label });
  }

  /** Update the label of an existing frame entry (e.g. after decoding). */
  updateFrame(id: number, label: string): void {
    this.entries.value = this.entries.value.map(e =>
      e.id === id && e.event.kind === 'frame'
        ? { ...e, event: { ...e.event, label } }
        : e,
    );
  }

  /** Device successfully connected. */
  connected(name: string, protoLabel: string): void {
    this.#push({ kind: 'connected', name, protoLabel });
  }

  /** Device disconnected. */
  disconnected(name: string): void {
    this.#push({ kind: 'disconnected', name });
  }

  /** GATT service discovery result. */
  serviceDiscovery(deviceName: string, services: DiscoveredServiceInfo[]): void {
    this.#push({ kind: 'discovery', deviceName, services });
  }

  /** Generic informational message. */
  info(msg: string): number { return this.#push({ kind: 'info', msg }); }

  /** Warning message. */
  warn(msg: string): number { return this.#push({ kind: 'warn', msg }); }

  /** Error message. */
  error(msg: string): number { return this.#push({ kind: 'error', msg }); }

  clear(): void {
    this.entries.value = [];
    this.#protocolEntryIds.clear();
  }
}
