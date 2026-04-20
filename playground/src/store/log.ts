import { signal } from '@preact/signals';
import type { Signal } from '@preact/signals';

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

  #push(event: LogEvent): number {
    const d  = new Date();
    const ts = [d.getHours(), d.getMinutes(), d.getSeconds()]
      .map(n => String(n).padStart(2, '0')).join(':');
    const id = ++this.#id;
    this.entries.value = [...this.entries.value, { id, ts, event }];
    return id;
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

  /** Error message. */
  error(msg: string): number { return this.#push({ kind: 'error', msg }); }

  clear(): void { this.entries.value = []; }
}
