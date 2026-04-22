/**
 * Protocol — abstract base class for all BLE recording pen protocols.
 *
 * Design:
 *  - Protocols receive a BleTransport in connect() and own all GATT setup.
 *  - Feature interfaces are grouped in the Feature namespace (like Kotlin sealed class subtypes).
 *  - App-level code checks proto.hasFiles() etc. and uses the narrowed typed object.
 *  - nameFilters holds device name prefixes used for BLE scan filtering.
 *  - Protocols own their log signal; the host subscribes to proto.log rather than
 *    injecting callbacks.
 */
import { LogBuffer, LogType } from './logging.js';
import type { LogEntry } from './logging.js';
import type { AudioFormat } from './audio.js';
import { AUDIO_FORMATS } from './audio.js';
import type { Feature } from './features.js';
import type { BleTransport } from './models.js';
import type { AnyCommand } from './commands.js';
import type { ReadonlySignal } from '@preact/signals-core';

export abstract class Protocol {
  abstract readonly label: string;
  abstract readonly desc: string;
  abstract readonly nameFilters: string[];
  readonly filterServices: string[] = [];
  abstract readonly optionalServices: string[];

  abstract disconnect(): void;
  abstract readonly stateTiles: ReadonlySignal<Record<string, string>>;

  private readonly _logs = new LogBuffer();

  readonly log: ReadonlySignal<LogEntry[]> = this._logs.entries;

  protected _log(type: LogType, bytes: Uint8Array, label?: string, id?: string): string {
    return this._logs.write(type, bytes, label, id);
  }

  protected _updateLog(id: string, label: string): void {
    this._logs.write(LogType.Info, new Uint8Array(0), label, id);
  }

  protected _info(msg: string): void {
    this._logs.write(LogType.Info, new Uint8Array(0), msg);
  }

  protected _error(msg: string): void {
    this._logs.write(LogType.Error, new Uint8Array(0), msg);
  }

  protected _buildCommand(cmd: number, payload?: Uint8Array): Uint8Array {
    if (!payload || payload.length === 0) return new Uint8Array([cmd]);
    const out = new Uint8Array(1 + payload.length);
    out[0] = cmd;
    out.set(payload, 1);
    return out;
  }

  hasFiles(): this is Feature.Files { return 'files' in this; }
  hasBattery(): this is Feature.Battery { return 'battery' in this; }
  hasStorage(): this is Feature.Storage { return 'storage' in this; }
  hasRecord(): this is Feature.Recording { return 'startRecord' in this; }
  hasTime(): this is Feature.Time { return 'syncTime' in this; }
  hasDeviceInfo(): this is Feature.DeviceInfo { return 'deviceInfo' in this; }
  hasSettings(): this is Feature.Settings { return 'settings' in this; }
  hasStream(): this is Feature.Stream { return 'streamData' in this; }

  readonly connectInitDelay: number = 0;

  abstract onConnectHandshake(transport: BleTransport): Promise<void>;

  async connect(transport: BleTransport): Promise<void> {
    await this.onConnectHandshake(transport);
    const pause = this.connectInitDelay > 0
      ? () => new Promise<void>(resolve => setTimeout(resolve, this.connectInitDelay))
      : () => Promise.resolve<void>(undefined);
    if (this.hasTime()) {
      await this.syncTime();
      await pause();
    }
    if (this.hasDeviceInfo()) {
      await this.refreshDeviceInfo();
      await pause();
    } else {
      if (this.hasBattery()) {
        await this.refreshBattery();
        await pause();
      }
      if (this.hasStorage()) {
        await this.refreshStorage();
        await pause();
      }
    }
    if (this.hasFiles()) {
      await this.refreshFiles();
    }
  }

  get commands(): AnyCommand[] { return []; }

  readonly audioFormat: AudioFormat = AUDIO_FORMATS.unknown;

  identify(_name: string, _discoveredServiceUuids: readonly string[]): boolean { return false; }
}
