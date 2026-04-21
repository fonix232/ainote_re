/**
 * Recolx Protocol 01
 *
 * Spec reference: re/protocols/recolx/recolx_01.md
 * TX: 55 AA <cmd> <sub> [payload...]
 * RX(ctrl): AA 55 <len> <op> [payload...]
 * RX(audio): 204a  (0x9C live SBC frame OR file-sync packet with 10-byte transport header)
 */
import { signal } from '@preact/signals-core';
import type { ReadonlySignal } from '@preact/signals-core';
import {
  AUDIO_FORMATS,
  Protocol,
  type BleTransport,
  type AnyDebugCommand,
  type ActiveTransfer,
  type FileInfo,
  type FileDownload,
  type FilesFeature,
  type BatteryFeature,
  type StorageFeature,
  type RecordFeature,
  type TimeFeature,
  type DeviceInfoFeature,
  type DeviceSettingsFeature,
  type DeviceSettings,
} from './types.js';

function u(short: string): string {
  return `0000${short}-0000-1000-8000-00805f9b34fb`;
}

const SVC       = u('200a');
const C_WRITE   = u('202a');
const C_CTRL    = u('203a');
const C_AUDIO   = u('204a');
const OTA_SVC   = u('ff12');
const OTA_WRITE = u('ff15');
const OTA_NTFY  = u('ff14');

const SBC_SYNC = 0x9C;
const FILE_HEADER_LEN = 10;    // "recolx.ai\x01"
const XOR_SEGMENT_LEN = 512;   // bytes [10..521] XOR 0x55

interface Recolx01Transfer extends ActiveTransfer {
  chunks: Uint8Array[];
}

function frame(...bytes: number[]): Uint8Array {
  return new Uint8Array(bytes);
}

function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function fmtBytes(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(2)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${bytes} B`;
}

export class Recolx01Protocol
  extends Protocol
  implements FilesFeature, BatteryFeature, StorageFeature,
             RecordFeature, TimeFeature, DeviceInfoFeature, DeviceSettingsFeature
{
  readonly label = 'Recolx 01';
  readonly desc  = 'Recolx pen model 01 (55AA framing, 200a service)';
  readonly audioFormat = AUDIO_FORMATS.recolxSbc;

  readonly nameFilters      = ['Recolx'];
  readonly filterServices   = [SVC];
  readonly optionalServices = [SVC, C_WRITE, C_CTRL, C_AUDIO, OTA_SVC, OTA_WRITE, OTA_NTFY];
  readonly connectInitDelay = 120;

  private readonly _files    = signal<FileInfo[]>([]);
  private readonly _battery  = signal<number | null>(null);
  private readonly _storage  = signal<{ totalMb: number; freeMb: number } | null>(null);
  private readonly _tiles    = signal<Record<string, string>>({});
  private readonly _dlProg   = signal<{ fileId: string; pct: number } | null>(null);
  private readonly _settings = signal<DeviceSettings>({ led: null, motor: null, wav: null, usb: null });

  readonly files:            ReadonlySignal<FileInfo[]>                                 = this._files;
  readonly battery:          ReadonlySignal<number | null>                              = this._battery;
  readonly storage:          ReadonlySignal<{ totalMb: number; freeMb: number } | null> = this._storage;
  readonly stateTiles:       ReadonlySignal<Record<string, string>>                     = this._tiles;
  readonly downloadProgress: ReadonlySignal<{ fileId: string; pct: number } | null>    = this._dlProg;
  readonly deviceSettings:   ReadonlySignal<DeviceSettings>                             = this._settings;

  private _t: BleTransport | null = null;
  private _dl: Recolx01Transfer | null = null;
  private _collectingList = false;
  private _fileListBuf: FileInfo[] = [];
  private _streamActive = false;

  override identify(_name: string, uuids: readonly string[]): boolean {
    return uuids.some(id => id.toLowerCase() === SVC);
  }

  async onConnectHandshake(transport: BleTransport): Promise<void> {
    this._t = transport;
    await transport.subscribeChar(SVC, C_CTRL, d => this._onCtrl(d));
    await transport.subscribeChar(SVC, C_AUDIO, d => this._onAudio(d));
  }

  disconnect(): void {
    if (this._dl) { this._dl.reject(new Error('Disconnected')); this._dl = null; }
    this._t = null;
    this._collectingList = false;
    this._fileListBuf = [];
    this._streamActive = false;
    this._cb.stopStreaming();
    this._files.value = [];
    this._battery.value = null;
    this._storage.value = null;
    this._tiles.value = {};
    this._dlProg.value = null;
    this._settings.value = { led: null, motor: null, wav: null, usb: null };
  }

  async syncTime(): Promise<void> {
    await this._write(this._timeSyncFrame());
  }

  async refreshDeviceInfo(): Promise<void> {
    await this._write(frame(0x55, 0xAA, 0x01, 0x0E)); // battery
    await delay(80);
    await this._write(frame(0x55, 0xAA, 0x01, 0x12)); // fw
    await delay(80);
    await this._write(frame(0x55, 0xAA, 0x01, 0x0B)); // storage free+total
    await delay(80);
    await this._write(frame(0x55, 0xAA, 0x01, 0x17)); // settings dump
  }

  async refreshBattery(): Promise<void> {
    await this._write(frame(0x55, 0xAA, 0x01, 0x0E));
  }

  async refreshStorage(): Promise<void> {
    await this._write(frame(0x55, 0xAA, 0x01, 0x0B));
  }

  async refreshFiles(): Promise<void> {
    this._fileListBuf = [];
    this._collectingList = true;
    await this._write(frame(0x55, 0xAA, 0x01, 0x05));
  }

  downloadFile(fileId: string): Promise<FileDownload> {
    const f = this._files.value.find(x => x.id === fileId);

    return new Promise<FileDownload>((resolve, reject) => {
      const timer = setTimeout(() => {
        this._dl = null;
        reject(new Error('Download timeout'));
      }, 120_000);

      this._dl = {
        fileId,
        sizeBytes: f?.size ?? null,
        totalReceived: 0,
        chunks: [],
        onProgress: null,
        resolve: (data, raw) => {
          clearTimeout(timer);
          this._dlProg.value = null;
          resolve({ data, raw, format: AUDIO_FORMATS.recolxSbc });
        },
        reject: (e) => {
          clearTimeout(timer);
          this._dlProg.value = null;
          reject(e);
        },
      };

      this._dlProg.value = { fileId, pct: 0 };
      void this._write(this._syncFileFrame(fileId)).catch(e => reject(e as Error));
    });
  }

  async deleteFile(fileId: string): Promise<void> {
    await this._write(this._deleteFileFrame(fileId));
    this._files.value = this._files.value.filter(f => f.id !== fileId);
  }

  async startRecord(): Promise<void> {
    await this._write(frame(0x55, 0xAA, 0x01, 0x03));
    await this._write(frame(0x55, 0xAA, 0x01, 0x21));
  }

  async stopRecord(): Promise<void> {
    await this._write(frame(0x55, 0xAA, 0x01, 0x04));
  }

  async setLed(on: boolean): Promise<void> {
    await this._write(frame(0x55, 0xAA, 0x02, 0x13, on ? 0x01 : 0x02));
  }

  async setMotor(on: boolean): Promise<void> {
    await this._write(frame(0x55, 0xAA, 0x02, 0x18, on ? 0x01 : 0x02));
  }

  async setWav(on: boolean): Promise<void> {
    await this._write(frame(0x55, 0xAA, 0x02, 0x16, on ? 0x01 : 0x02));
  }

  async setUsb(on: boolean): Promise<void> {
    await this._write(frame(0x55, 0xAA, 0x02, 0x14, on ? 0x01 : 0x02));
  }

  override get commands(): AnyDebugCommand[] {
    return [
      { category: 'info', label: 'Device Info', fn: () => this.refreshDeviceInfo() },
      { category: 'info', label: 'Battery', fn: () => this.refreshBattery() },
      { category: 'info', label: 'Storage', fn: () => this.refreshStorage() },
      { category: 'info', label: 'File List', fn: () => this.refreshFiles() },
      { category: 'info', label: 'Sync Time', fn: () => this.syncTime() },
      { category: 'recording', label: 'Start Record', fn: () => this.startRecord() },
      { category: 'recording', label: 'Stop Record', fn: () => this.stopRecord() },
      {
        category: 'settings', label: 'LED', kind: 'toggle',
        get: () => this._settings.value.led,
        set: (on) => this.setLed(on),
      },
      {
        category: 'settings', label: 'Motor', kind: 'toggle',
        get: () => this._settings.value.motor,
        set: (on) => this.setMotor(on),
      },
      {
        category: 'settings', label: 'WAV', kind: 'toggle',
        get: () => this._settings.value.wav,
        set: (on) => this.setWav(on),
      },
      {
        category: 'settings', label: 'USB', kind: 'toggle',
        get: () => this._settings.value.usb,
        set: (on) => this.setUsb(on),
      },
      { category: 'dangerous', label: 'Format Device', confirm: true, fn: () => this._write(frame(0x55, 0xAA, 0x01, 0x1E)) },
    ];
  }

  private _onCtrl(data: Uint8Array): void {
    if (data.length < 4 || data[0] !== 0xAA || data[1] !== 0x55) {
      this._log('RX', data, 'ctrl(invalid)');
      return;
    }

    const declared = data[2] ?? 0;
    const op = data[3] ?? 0;
    const payload = declared > 1 ? data.slice(4, 3 + declared) : new Uint8Array(0);
    this._log('RX', data, this._describeCtrl(op, payload));

    const patch = (k: string, v: string) => { this._tiles.value = { ...this._tiles.value, [k]: v }; };

    switch (op) {
      case 0x01:
      case 0x20:
      case 0x2B:
      case 0xFA:
        patch('State', 'Disconnected by device');
        break;

      case 0x02:
        patch('Time', 'Synced');
        break;

      case 0x03:
        patch('Recording', 'Started');
        this._streamActive = true;
        this._cb.showAudio();
        this._cb.startStreaming(this.audioFormat);
        break;

      case 0x04:
        patch('Recording', 'Stopped');
        this._streamActive = false;
        this._cb.stopStreaming();
        void this._write(frame(0x55, 0xAA, 0x01, 0x22));
        void this.refreshFiles();
        break;

      case 0x05: {
        const entry = this._parseFileEntry(payload);
        if (entry) {
          if (!this._collectingList) {
            this._collectingList = true;
            this._fileListBuf = [];
          }
          this._fileListBuf.push(entry);
        }
        break;
      }

      case 0x06:
        this._collectingList = false;
        this._files.value = [...this._fileListBuf];
        this._fileListBuf = [];
        patch('FileList', `${this._files.value.length} file(s)`);
        break;

      case 0x07: {
        if (this._dl && payload.length >= 18) {
          const size = new DataView(payload.buffer, payload.byteOffset + 14, 4).getUint32(0, false);
          this._dl.sizeBytes = size;
          this._dlProg.value = { fileId: this._dl.fileId, pct: 0 };
        }
        patch('Sync', 'ACK');
        break;
      }

      case 0x08:
      case 0x09:
        this._onSyncComplete();
        patch('Sync', 'Complete');
        break;

      case 0x0A:
        patch('Delete', payload.length > 0 && payload[0] === 0x02 ? 'OK' : 'Failed');
        break;

      case 0x0C: {
        if (payload.length >= 4) {
          const freeMb = new DataView(payload.buffer, payload.byteOffset, 4).getUint32(0, false);
          const cur = this._storage.value;
          this._storage.value = { totalMb: cur?.totalMb ?? 0, freeMb };
          const totalMb = cur?.totalMb ?? 0;
          patch('Storage', `${Math.max(0, totalMb - freeMb)} MB / ${totalMb} MB`);
        }
        break;
      }

      case 0x0D: {
        if (payload.length >= 4) {
          const totalMb = new DataView(payload.buffer, payload.byteOffset, 4).getUint32(0, false);
          const cur = this._storage.value;
          this._storage.value = { totalMb, freeMb: cur?.freeMb ?? 0 };
          const freeMb = cur?.freeMb ?? 0;
          patch('Storage', `${Math.max(0, totalMb - freeMb)} MB / ${totalMb} MB`);
        }
        break;
      }

      case 0x0E: {
        if (payload.length > 0) {
          const pct = payload[0] === 0xFF ? 0 : payload[0]!;
          this._battery.value = pct;
          patch('Battery', `${pct}%`);
        }
        break;
      }

      case 0x10:
        if (payload.length > 0) {
          patch('Recording', payload[0] === 0x02 ? 'Paused' : payload[0] === 0x04 ? 'Resumed' : `Status ${payload[0]}`);
        }
        break;

      case 0x12:
        if (payload.length > 0) patch('Version', new TextDecoder('ascii').decode(payload).trim());
        break;

      case 0x13:
        if (payload.length > 0) {
          const on = payload[0] === 0x01;
          this._settings.value = { ...this._settings.value, led: on };
          patch('LED', on ? 'On' : 'Off');
        }
        break;

      case 0x14:
        if (payload.length > 0) {
          const on = payload[0] === 0x01;
          this._settings.value = { ...this._settings.value, usb: on };
          patch('USB', on ? 'On' : 'Off');
        }
        break;

      case 0x16:
        if (payload.length > 0) {
          const on = payload[0] === 0x01;
          this._settings.value = { ...this._settings.value, wav: on };
          patch('WAV', on ? 'On' : 'Off');
        }
        break;

      case 0x18:
        if (payload.length > 0) {
          const on = payload[0] === 0x01;
          this._settings.value = { ...this._settings.value, motor: on };
          patch('Motor', on ? 'On' : 'Off');
        }
        break;

      case 0x1E:
        patch('Format', payload.length > 0 && payload[0] === 0x04 ? 'OK' : 'Failed');
        break;

      case 0x2C:
        if (payload.length >= 3) {
          const sec = ((payload[2]! << 8) | payload[0]!) >>> 0;
          patch('Rec Time', `${Math.floor(sec / 60)}m ${sec % 60}s`);
        }
        break;

      case 0x30:
        if (payload.length > 0) patch('Charging', payload[0] === 0x04 ? 'Yes' : 'No');
        break;

      case 0xFE:
        this._collectingList = false;
        this._fileListBuf = [];
        patch('FileList', 'Failed');
        break;

      default:
        break;
    }
  }

  private _onAudio(data: Uint8Array): void {
    if (data.length === 0) return;

    // Live stream: raw SBC frame
    if (data[0] === SBC_SYNC) {
      if (this._streamActive) this._cb.audioFrame(data);
      return;
    }

    // File-sync transport packet: [10-byte hdr][audioData]
    if (data.length < 10) {
      this._log('RX', data, 'audio(short)');
      return;
    }

    const dLen = data[6] ?? 0;
    const end  = Math.min(10 + dLen, data.length);
    const audioData = data.slice(10, end);

    if (!this._dl || audioData.length === 0) return;

    this._dl.chunks.push(audioData);
    this._dl.totalReceived += audioData.byteLength;

    if (this._dl.sizeBytes) {
      this._dlProg.value = {
        fileId: this._dl.fileId,
        pct: Math.min(100, Math.round((this._dl.totalReceived / this._dl.sizeBytes) * 100)),
      };
    }
  }

  private _onSyncComplete(): void {
    const dl = this._dl;
    if (!dl) return;
    this._dl = null;

    const total = dl.chunks.reduce((s, c) => s + c.byteLength, 0);
    const raw = new Uint8Array(total);
    let p = 0;
    for (const c of dl.chunks) { raw.set(c, p); p += c.byteLength; }

    if (raw.length <= FILE_HEADER_LEN) {
      dl.reject(new Error('Sync complete but payload too short'));
      return;
    }

    const bodyLen = raw.length - FILE_HEADER_LEN;
    const data = new Uint8Array(bodyLen);
    const xorLen = Math.min(XOR_SEGMENT_LEN, bodyLen);

    for (let i = 0; i < xorLen; i++) data[i] = raw[FILE_HEADER_LEN + i]! ^ 0x55;
    for (let i = xorLen; i < bodyLen; i++) data[i] = raw[FILE_HEADER_LEN + i]!;

    dl.resolve(data, raw);
  }

  private async _write(pkt: Uint8Array): Promise<void> {
    if (!this._t) throw new Error('Not connected');
    this._log('TX', pkt, this._describeTx(pkt));
    await this._t.writeChar(SVC, C_WRITE, pkt);
  }

  private _timeSyncFrame(): Uint8Array {
    const n = new Date();
    const pad = (v: number) => String(v).padStart(2, '0');
    const ts = `${n.getFullYear()}${pad(n.getMonth() + 1)}${pad(n.getDate())}${pad(n.getHours())}${pad(n.getMinutes())}${pad(n.getSeconds())}`;
    const b = new TextEncoder().encode(ts);
    const pkt = new Uint8Array(4 + b.length);
    pkt[0] = 0x55; pkt[1] = 0xAA; pkt[2] = 0x0F; pkt[3] = 0x02;
    pkt.set(b, 4);
    return pkt;
  }

  private _syncFileFrame(filename: string): Uint8Array {
    const name = new TextEncoder().encode(filename);
    const pkt = new Uint8Array(8 + name.length);
    pkt.set([0x55, 0xAA, 0x13, 0x07, 0x00, 0x00, 0x00, 0x00], 0);
    pkt.set(name, 8);
    return pkt;
  }

  private _deleteFileFrame(filename: string): Uint8Array {
    const name = new TextEncoder().encode(filename);
    const pkt = new Uint8Array(8 + name.length);
    pkt.set([0x55, 0xAA, 0x0F, 0x0A, 0x00, 0x00, 0x00, 0x00], 0);
    pkt.set(name, 8);
    return pkt;
  }

  private _parseFileEntry(payload: Uint8Array): FileInfo | null {
    if (payload.length < 18) return null;
    const name = new TextDecoder('ascii').decode(payload.slice(0, 14));
    if (!/^\d{14}$/.test(name)) return null;

    const size = new DataView(payload.buffer, payload.byteOffset + 14, 4).getUint32(0, false);
    const label = `${name.slice(0, 4)}-${name.slice(4, 6)}-${name.slice(6, 8)} ${name.slice(8, 10)}:${name.slice(10, 12)}:${name.slice(12, 14)} (${fmtBytes(size)})`;
    return { id: name, label, size };
  }

  private _describeTx(pkt: Uint8Array): string {
    if (pkt.length < 4) return 'TX(short)';
    const cmd = pkt[2]!;
    const sub = pkt[3]!;
    return `TX cmd=0x${cmd.toString(16).padStart(2, '0')} sub=0x${sub.toString(16).padStart(2, '0')} len=${pkt.length}`;
  }

  private _describeCtrl(op: number, payload: Uint8Array): string {
    switch (op) {
      case 0x01:
      case 0x20:
      case 0x2B:
      case 0xFA: return 'DISCONNECT';
      case 0x02: return 'TIME_SYNC_ACK';
      case 0x03: return 'REC_STARTED';
      case 0x04: return 'REC_STOPPED';
      case 0x05: {
        const entry = this._parseFileEntry(payload);
        return entry ? `FILE_ENTRY(${entry.id}, ${fmtBytes(entry.size ?? 0)})` : 'FILE_ENTRY(invalid)';
      }
      case 0x06: return 'FILE_LIST_END';
      case 0x07: return 'SYNC_ACK';
      case 0x08:
      case 0x09: return 'SYNC_COMPLETE';
      case 0x0A: return payload.length > 0 && payload[0] === 0x02 ? 'DELETE(OK)' : 'DELETE(FAIL)';
      case 0x0C: return 'STORAGE_FREE';
      case 0x0D: return 'STORAGE_TOTAL';
      case 0x0E: return payload.length > 0 ? `BATTERY(${payload[0] === 0xFF ? 0 : payload[0]}%)` : 'BATTERY(?)';
      case 0x10: return 'REC_PAUSE_STATE';
      case 0x12: return 'FIRMWARE_VERSION';
      case 0x13: return 'LED_STATE';
      case 0x14: return 'USB_STATE';
      case 0x16: return 'WAV_STATE';
      case 0x18: return 'MOTOR_STATE';
      case 0x1E: return 'FORMAT_RESULT';
      case 0x2C: return 'REC_TIME';
      case 0x30: return 'CHARGING_STATE';
      case 0xFE: return 'FILE_LIST_FAIL';
      default: return `CTRL op=0x${op.toString(16).padStart(2, '0')} len=${payload.length}`;
    }
  }
}

export const recolx01 = new Recolx01Protocol();
