/**
 * XLX 3085s Protocol
 *
 * GATT profile:  B0B0 service family
 * Frame format:  [A0 0A 01 cmd len payload... crc_lo crc_hi]  (CRC-16/ARC)
 * Source app:    com.doway.record v3.6.0 (Dart AOT — blutter decompiled)
 * Test device:   Doway NanoRec, serial IA3HA05586, BLE name xink_test
 * Reference:     ainote_re/re/protocols/xlx/xlx_3085.md
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
} from './types.js';

// ── GATT UUIDs ────────────────────────────────────────────────────────────────

function u(short: string): string {
  return `0000${short}-0000-1000-8000-00805f9b34fb`;
}

const SVC     = u('b0b0');
const C_WRITE = u('b0b1'); // CTRL TX write
const C_CTRL  = u('b0b2'); // CTRL RX notify
const C_AUDIO = u('b0b3'); // live SBC audio notify
const C_FILE  = u('b0b4'); // file data notify
const OTA_SVC = u('c0c0');
const OTA_TX  = 'e49a25e0-f69a-11e8-8eb2-f2801f1b9fd1';
const OTA_RX  = 'e49a28e1-f69a-11e8-8eb2-f2801f1b9fd1';

// ── CRC-16/ARC ────────────────────────────────────────────────────────────────
// Reflected, polynomial 0xA001, init 0x0000.

function crc16arc(data: Uint8Array): number {
  let crc = 0;
  for (const b of data) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = (crc & 1) ? ((crc >>> 1) ^ 0xA001) : (crc >>> 1);
  }
  return crc & 0xFFFF;
}

// ── Transfer state ─────────────────────────────────────────────────────────────

interface Xlx3085Transfer extends ActiveTransfer {
  chunks: Uint8Array[];
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtBytes(b: number): string {
  if (b >= 1_048_576) return `${(b / 1_048_576).toFixed(1)} MB`;
  if (b >= 1_024)     return `${(b / 1_024).toFixed(1)} KB`;
  return `${b} B`;
}

// ── Protocol class ─────────────────────────────────────────────────────────────

export class Xlx3085Protocol
  extends Protocol
  implements FilesFeature, BatteryFeature, StorageFeature, RecordFeature,
             TimeFeature, DeviceInfoFeature
{
  readonly label        = 'XLX 3085s';
  readonly desc         = 'Doway NanoRec (XLX 3085s, B0B0 service, CRC-16/ARC)';
  readonly audioFormat  = AUDIO_FORMATS.mp3;

  readonly nameFilters      = ['NanoRec', 'xink'];
  readonly filterServices   = [SVC];
  readonly optionalServices = [SVC, C_WRITE, C_CTRL, C_AUDIO, C_FILE, OTA_SVC, OTA_TX, OTA_RX];
  readonly connectInitDelay = 200;

  // ── Feature signals ─────────────────────────────────────────────────────────

  private readonly _files    = signal<FileInfo[]>([]);
  private readonly _battery  = signal<number | null>(null);
  private readonly _storage  = signal<{ totalMb: number; freeMb: number } | null>(null);
  private readonly _tiles    = signal<Record<string, string>>({});
  private readonly _dlProg   = signal<{ fileId: string; pct: number } | null>(null);

  readonly files:            ReadonlySignal<FileInfo[]>                                 = this._files;
  readonly battery:          ReadonlySignal<number | null>                              = this._battery;
  readonly storage:          ReadonlySignal<{ totalMb: number; freeMb: number } | null> = this._storage;
  readonly stateTiles:       ReadonlySignal<Record<string, string>>                     = this._tiles;
  readonly downloadProgress: ReadonlySignal<{ fileId: string; pct: number } | null>    = this._dlProg;

  // ── Settings signals ─────────────────────────────────────────────────────────

  private readonly _settingLed    = signal<boolean | null>(null);
  private readonly _settingMotor  = signal<boolean | null>(null);
  private readonly _settingVox    = signal<boolean | null>(null);
  private readonly _settingUsb    = signal<number | null>(null);
  private readonly _settingNoise  = signal<number | null>(null);
  private readonly _settingScreen = signal<boolean | null>(null);
  private readonly _settingSegRec = signal<number | null>(null);
  private readonly _recMode       = signal<number | null>(null); // 1=note, 2=call (hardware, read-only)

  // Factory defaults based on Doway app initial state
  private static readonly _DEFAULTS = {
    led: true, motor: false, vox: false,
    usb: 1, noise: 9, screen: false, segRec: 3,
  } as const;

  // ── Internal state ───────────────────────────────────────────────────────────

  private _settingsKey  = '';
  private _t: BleTransport | null = null;
  private _dl: Xlx3085Transfer | null = null;
  private _fileLogId: number | null = null;
  private _collectingList = false;
  private _fileListBuf: FileInfo[] = [];
  private _streaming = false;
  private _bindResolve:   ((payload: Uint8Array) => void) | null = null;
  private _serialResolve: ((serial: string) => void) | null = null;

  // ── Settings persistence ──────────────────────────────────────────────────────

  private _lsKey(k: string): string { return `xlx3085s:${k}`; }

  private _loadSettings(key: string): void {
    let saved: Partial<typeof Xlx3085Protocol._DEFAULTS> = {};
    try {
      const raw = localStorage.getItem(this._lsKey(key));
      if (raw) saved = JSON.parse(raw) as typeof saved;
    } catch { /* ignore */ }
    const d = Xlx3085Protocol._DEFAULTS;
    this._settingLed.value    = typeof saved.led    === 'boolean' ? saved.led    : d.led;
    this._settingMotor.value  = typeof saved.motor  === 'boolean' ? saved.motor  : d.motor;
    this._settingVox.value    = typeof saved.vox    === 'boolean' ? saved.vox    : d.vox;
    this._settingUsb.value    = typeof saved.usb    === 'number'  ? saved.usb    : d.usb;
    this._settingNoise.value  = typeof saved.noise  === 'number'  ? saved.noise  : d.noise;
    this._settingScreen.value = typeof saved.screen === 'boolean' ? saved.screen : d.screen;
    this._settingSegRec.value = typeof saved.segRec === 'number'  ? saved.segRec : d.segRec;
  }

  private _saveSettings(key: string): void {
    try {
      const d = Xlx3085Protocol._DEFAULTS;
      localStorage.setItem(this._lsKey(key), JSON.stringify({
        led:    this._settingLed.value    ?? d.led,
        motor:  this._settingMotor.value  ?? d.motor,
        vox:    this._settingVox.value    ?? d.vox,
        usb:    this._settingUsb.value    ?? d.usb,
        noise:  this._settingNoise.value  ?? d.noise,
        screen: this._settingScreen.value ?? d.screen,
        segRec: this._settingSegRec.value ?? d.segRec,
      }));
    } catch { /* quota / unavailable */ }
  }

  // ── Identification ───────────────────────────────────────────────────────────

  override identify(_name: string, uuids: readonly string[]): boolean {
    // B0B0 service marks a 3085s; "0011200a" UUID exclusively marks a 2837 device.
    if (uuids.some(id => id.toLowerCase().includes('0011200a'))) return false;
    return uuids.some(id => id.toLowerCase().includes('b0b0') || id.toLowerCase().includes('e8a0'));
  }

  // ── Handshake ────────────────────────────────────────────────────────────────

  async onConnectHandshake(transport: BleTransport): Promise<void> {
    this._t = transport;
    await transport.subscribeChar(SVC, C_CTRL,  d => this._onCtrl(d));
    await transport.subscribeChar(SVC, C_FILE,  d => this._onFile(d));
    await transport.subscribeChar(SVC, C_AUDIO, d => this._onAudio(d));

    // Step 1: getBindInfo (0x02) — await response.
    // Unbound: payload=[0x00]. Bound: payload=17-byte token.
    const bindPayload = await new Promise<Uint8Array>(resolve => {
      this._bindResolve = resolve;
      setTimeout(() => { this._bindResolve = null; resolve(new Uint8Array(1)); }, 4_000);
      void this._write(this._buildCommand(0x02));
    });
    this._bindResolve = null;

    // Step 2: bindDevice (0x03) — echo token if bound, else 17 zero bytes.
    const bindToken = new Uint8Array(17);
    if (bindPayload.length > 1) bindToken.set(bindPayload.slice(0, 17));
    void this._write(this._buildCommand(0x03, bindToken));

    // Step 3: getSerial (0x01) — stable alphanumeric ID (e.g. "IA3HA05586").
    const serial = await new Promise<string>(resolve => {
      this._serialResolve = resolve;
      setTimeout(() => { this._serialResolve = null; resolve(transport.deviceName); }, 2_000);
      void this._write(this._buildCommand(0x01));
    });
    this._serialResolve = null;
    this._settingsKey = serial;
    this._loadSettings(serial);
  }

  // ── Disconnect ───────────────────────────────────────────────────────────────

  disconnect(): void {
    if (this._dl) { this._dl.reject(new Error('Disconnected')); this._dl = null; }
    this._bindResolve = null; this._serialResolve = null; this._fileLogId = null;
    this._streaming = false; this._audioFrameCount = 0;
    this._t = null; this._settingsKey = '';
    this._fileListBuf = []; this._collectingList = false;
    this._files.value = []; this._battery.value = null; this._storage.value = null;
    this._tiles.value = {}; this._dlProg.value = null;
    this._settingLed.value = null; this._settingMotor.value = null;
    this._settingVox.value = null; this._settingUsb.value = null;
    this._settingNoise.value = null; this._settingScreen.value = null;
    this._settingSegRec.value = null; this._recMode.value = null;
  }

  // ── TimeFeature ──────────────────────────────────────────────────────────────

  async syncTime(): Promise<void> {
    const n = new Date();
    await this._write(this._buildCommand(0x04, new Uint8Array([
      n.getFullYear() - 2000, n.getMonth() + 1, n.getDate(),
      n.getHours(), n.getMinutes(), n.getSeconds(),
    ])));
  }

  // ── DeviceInfoFeature ────────────────────────────────────────────────────────

  async refreshDeviceInfo(): Promise<void> {
    await this._write(this._buildCommand(0x05));
    await this._write(this._buildCommand(0x18, new Uint8Array([0x00]))); // platformSet = Android
  }

  // ── BatteryFeature / StorageFeature ──────────────────────────────────────────
  // No dedicated opcodes — data arrives in the 0x05 response and 0x0F status push.

  async refreshBattery(): Promise<void> { await this._write(this._buildCommand(0x05)); }
  async refreshStorage(): Promise<void> { await this._write(this._buildCommand(0x05)); }

  // ── FilesFeature ─────────────────────────────────────────────────────────────

  async refreshFiles(): Promise<void> {
    this._fileListBuf = []; this._collectingList = true;
    await this._write(this._buildCommand(0x0A));
  }

  downloadFile(fileId: string): Promise<FileDownload> {
    return new Promise<FileDownload>((resolve, reject) => {
      const timer = setTimeout(() => { this._dl = null; reject(new Error('Download timeout')); }, 120_000);
      this._dl = {
        fileId, sizeBytes: null, totalReceived: 0,
        chunks: [], onProgress: null,
        resolve: (data, raw) => { clearTimeout(timer); this._dlProg.value = null; resolve({ data, raw, format: AUDIO_FORMATS.mp3 }); },
        reject:  (e)         => { clearTimeout(timer); this._dlProg.value = null; reject(e); },
      };
      this._dlProg.value = { fileId, pct: 0 };
      void this._write(this._syncFileFrame(fileId, 0)).catch(e => reject(e as Error));
    });
  }

  async deleteFile(fileId: string): Promise<void> {
    await this._write(this._buildCommand(0x0D, new TextEncoder().encode(fileId)));
    this._files.value = this._files.value.filter(f => f.id !== fileId);
  }

  // ── RecordFeature ────────────────────────────────────────────────────────────

  async startRecord():  Promise<void> { await this._write(this._buildCommand(0x06)); }
  async stopRecord():   Promise<void> { await this._write(this._buildCommand(0x07)); }
  async pauseRecord():  Promise<void> { await this._write(this._buildCommand(0x08)); }
  async resumeRecord(): Promise<void> { await this._write(this._buildCommand(0x09)); }

  // ── Commands ──────────────────────────────────────────────────────────────────

  override get commands(): AnyDebugCommand[] {
    return [
      // info
      { category: 'info',      label: 'Device Info',        fn: () => this._write(this._buildCommand(0x05)) },
      { category: 'info',      label: 'Rec Info',           fn: () => this._write(this._buildCommand(0x15)) },
      { category: 'info',      label: 'File List',          fn: () => this.refreshFiles() },
      { category: 'info',      label: 'Sync Time',          fn: () => this.syncTime() },
      // recording
      { category: 'recording', label: 'Start Record',       fn: () => this.startRecord() },
      { category: 'recording', label: 'Stop Record',        fn: () => this.stopRecord() },
      { category: 'recording', label: 'Pause Record',       fn: () => this._write(this._buildCommand(0x08)) },
      { category: 'recording', label: 'Resume Record',      fn: () => this._write(this._buildCommand(0x09)) },
      // settings
      {
        category: 'settings', label: 'LED', kind: 'toggle' as const,
        get: () => this._settingLed.value,
        set: async (on: boolean) => { await this._write(this._buildCommand(0x11, new Uint8Array([on ? 1 : 0]))); this._settingLed.value = on; this._saveSettings(this._settingsKey); },
      },
      {
        category: 'settings', label: 'Motor / Vibration', kind: 'toggle' as const,
        get: () => this._settingMotor.value,
        set: async (on: boolean) => { await this._write(this._buildCommand(0x2A, new Uint8Array([on ? 1 : 0]))); this._settingMotor.value = on; this._saveSettings(this._settingsKey); },
      },
      {
        category: 'settings', label: 'VOX', kind: 'toggle' as const,
        get: () => this._settingVox.value,
        set: async (on: boolean) => { await this._write(this._buildCommand(0x14, new Uint8Array([on ? 1 : 0]))); this._settingVox.value = on; this._saveSettings(this._settingsKey); },
      },
      {
        category: 'settings', label: 'Screen always-on', kind: 'toggle' as const,
        get: () => this._settingScreen.value,
        set: async (on: boolean) => { await this._write(this._buildCommand(0x1A, new Uint8Array([on ? 1 : 0]))); this._settingScreen.value = on; this._saveSettings(this._settingsKey); },
      },
      {
        category: 'settings', label: 'USB mode', kind: 'select' as const,
        get: () => this._settingUsb.value,
        set: async (v: number | string) => { await this._write(this._buildCommand(0x13, new Uint8Array([Number(v)]))); this._settingUsb.value = Number(v); this._saveSettings(this._settingsKey); },
        options: { 0: 'Charge only', 1: 'Disk / OTG' },
      },
      {
        category: 'settings', label: 'Noise reduction', kind: 'select' as const,
        get: () => this._settingNoise.value,
        set: async (v: number | string) => { await this._write(this._buildCommand(0x17, new Uint8Array([Number(v)]))); this._settingNoise.value = Number(v); this._saveSettings(this._settingsKey); },
        options: { 0: 'Off', 5: 'Low', 9: 'Medium', 15: 'High' },
      },
      {
        category: 'settings', label: 'Max rec duration', kind: 'select' as const,
        get: () => this._settingSegRec.value,
        set: async (v: number | string) => { await this._write(this._buildCommand(0x16, new Uint8Array([Number(v)]))); this._settingSegRec.value = Number(v); this._saveSettings(this._settingsKey); },
        options: { 0: '30 min', 1: '1 hr', 2: '2 hr', 3: '3 hr' },
      },
      // debug
      { category: 'debug', label: 'Get Bind Info',      fn: () => this._write(this._buildCommand(0x02)) },
      { category: 'debug', label: 'Get Serial',         fn: () => this._write(this._buildCommand(0x01)) },
      { category: 'debug', label: 'Platform (Android)', fn: () => this._write(this._buildCommand(0x18, new Uint8Array([0x00]))) },
      // dangerous
      { category: 'dangerous', label: 'Restore Factory', confirm: true, fn: () => this._write(this._buildCommand(0x12)) },
      { category: 'dangerous', label: 'Format Device',   confirm: true, fn: () => this._write(this._buildCommand(0x10)) },
    ];
  }

  // ── RX: control channel (B0B2) ───────────────────────────────────────────────

  private _onCtrl(data: Uint8Array): void {
    if (data.length < 4) { this._log('RX', data, 'ctrl(short)'); return; }
    const b0 = data[0]!, b1 = data[1]!;
    const ok = (b0 === 0xA0 && b1 === 0x0A) || (b0 === 0x5E && b1 === 0xE5) || (b0 === 0xE5 && b1 === 0x5E);
    if (!ok) { this._log('RX', data, 'ctrl(bad preamble)'); return; }

    const op          = data[3]!;
    const declaredLen = data[4] ?? 0;
    const payload     = declaredLen > 0 ? data.slice(5, 5 + declaredLen) : new Uint8Array(0);
    this._log('RX', data, this._descOp(op, payload));

    const patch = (k: string, v: string) => { this._tiles.value = { ...this._tiles.value, [k]: v }; };

    switch (op) {

      case 0x01: // getSerial
        if (payload.length > 0) {
          const serial = new TextDecoder().decode(payload).replace(/\0/g, '').trim();
          patch('Serial', serial);
          if (this._serialResolve) { this._serialResolve(serial); this._serialResolve = null; }
        }
        break;

      case 0x02: // getBindInfo — [0x00]=unbound, 17-byte token=bound
        patch('Bind', payload.length === 1 && payload[0] === 0 ? 'Not bound' : `Bound (${payload.length}B)`);
        this._bindResolve?.(payload);
        this._bindResolve = null;
        break;

      case 0x03: patch('Bind', 'Bound');   break;
      case 0x04: patch('Time', 'Synced');  break;

      case 0x05: { // getDeviceInfo — 49-byte struct
        if (payload.length >= 17) {
          const view       = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
          const totalSec   = view.getUint32(0, false); // 512-byte sectors
          const freeSec    = view.getUint32(4, false);
          const charging   = payload[8];
          const batPct     = payload[9]!;
          const recSt      = payload[10];
          const fw         = payload.length > 13 ? `${payload[11]}.${payload[12]}.${payload[13]}` : '?';

          let ne = 17;
          while (ne < Math.min(38, payload.length) && payload[ne] !== 0) ne++;
          const devName = new TextDecoder().decode(payload.slice(17, ne)).trim();

          // Storage: raw uint32 value is already in MiB (divide by 1024 for GiB display).
          const totalMb = totalSec;
          const freeMb  = freeSec;
          this._storage.value = { totalMb, freeMb };

          const usedMb  = totalMb - freeMb;
          const usedStr = usedMb < 1024 ? `${usedMb} MB` : `${(usedMb / 1024).toFixed(1)} GB`;
          const totStr  = totalMb < 1024 ? `${totalMb} MB` : `${(totalMb / 1024).toFixed(1)} GB`;

          this._tiles.value = {
            ...(devName ? { Name: devName } : {}),
            Firmware:  fw,
            Battery:   `${batPct}%${charging ? ' ⚡' : ''}`,
            Storage:   `${usedStr} / ${totStr}`,
            Recording: recSt ? 'Active' : 'Idle',
          };

          // Settings (Frida-confirmed payload indices — see Frida Byte Indices in xlx_3085.md):
          // [14]=usb, [39]=noise, [40]=vox, [41]=segRec, [42]=screen, [43]=motor.
          // LED is not present in 0x05 payload; it arrives via 0x0F statusPush.
          if (payload.length > 14) this._settingUsb.value    = payload[14]!;
          if (payload.length > 39) this._settingNoise.value  = payload[39]!;
          if (payload.length > 40) this._settingVox.value    = payload[40] !== 0;
          if (payload.length > 41) this._settingSegRec.value = payload[41]!;
          if (payload.length > 42) this._settingScreen.value = payload[42] !== 0;
          if (payload.length > 43) this._settingMotor.value  = payload[43] !== 0;
        }
        break;
      }

      case 0x06: // startRecord
        if (payload.length >= 15) {
          const fn = new TextDecoder('ascii').decode(payload.slice(1, 15));
          const rm = payload[15] === 1 ? 'Note' : payload[15] === 2 ? 'Call' : `${payload[15]}`;
          patch('Recording', `Started ${fn} (${rm})`);
        } else { patch('Recording', 'Started'); }
        break;

      case 0x07: // stopRecord
        if (payload.length >= 19) {
          const fn = new TextDecoder('ascii').decode(payload.slice(1, 15));
          patch('Recording', `Stopped ${fn}`);
        } else { patch('Recording', 'Stopped'); }
        // Stop live audio and refresh file list to pick up the new recording.
        if (this._streaming) {
          console.log('[XLX3085] REC_STOPPED: stopping audio stream');
          this._cb.stopStreaming();
          this._streaming = false;
        }
        console.log('[XLX3085] REC_STOPPED: requesting file list refresh');
        void this.refreshFiles();
        break;

      case 0x08: patch('Recording', 'Paused');  break;
      case 0x09: patch('Recording', 'Resumed'); break;

      case 0x0A: { // getFiles — one entry per frame, sentinel = 1-byte payload
        if (payload.length === 1) {
          this._collectingList = false;
          this._files.value = [...this._fileListBuf];
          console.log(`[XLX3085] file list complete: ${this._files.value.length} file(s)`);
          this._fileListBuf = [];
        } else {
          const entry = this._parseFileEntry(payload);
          if (entry) {
            if (!this._collectingList) { this._fileListBuf = []; this._collectingList = true; }
            this._fileListBuf.push(entry);
            console.log(`[XLX3085] file entry: ${entry.id} (${entry.size ?? '?'}B)`);
          } else {
            console.warn('[XLX3085] 0x0A: failed to parse file entry, payload=', Array.from(payload).map(b=>b.toString(16).padStart(2,'0')).join(' '));
          }
        }
        break;
      }

      case 0x0B: // startSyncFile ACK
        if (payload.length >= 1 && payload[0] === 0) {
          if (this._dl && payload.length >= 5) {
            this._dl.sizeBytes = new DataView(payload.buffer, payload.byteOffset + 1, 4).getUint32(0, false);
            this._dlProg.value = { fileId: this._dl.fileId, pct: 0 };
          }
          patch('Sync', 'Started');
        } else {
          if (this._dl) this._onSyncComplete();
          patch('Sync', 'Complete');
        }
        break;

      case 0x0C: // endSyncFile
        this._onSyncComplete();
        patch('Sync', 'Complete');
        break;

      case 0x0D: patch('Delete', payload[0] === 0 ? 'OK' : 'Failed'); break;

      case 0x0F: { // statusPush — 20-byte periodic snapshot
        if (payload.length >= 11) {
          const charging = payload[0];
          const batPct   = payload[1]!;
          this._battery.value       = batPct;
          this._recMode.value       = payload[3]!;
          this._settingVox.value    = payload[4] !== 0;
          this._settingNoise.value  = payload[5]!;
          this._settingScreen.value = payload[7] !== 0;
          this._settingSegRec.value = payload[8]!;
          this._settingLed.value    = payload[9] !== 0;
          this._settingMotor.value  = payload[10] !== 0;
          const recMode = payload[3] === 1 ? 'Note' : payload[3] === 2 ? 'Call' : `${payload[3]}`;
          patch('Battery', `${batPct}%${charging ? ' ⚡' : ''}`);
          patch('RecMode', recMode);
        }
        break;
      }

      case 0x10: patch('Init',      'OK');    break;
      case 0x11: patch('LED',       'Set');   break;
      case 0x12: patch('Factory',   'Reset'); break;
      case 0x13: patch('USB',       'Set');   break;
      case 0x14: patch('VOX',       'Set');   break;

      case 0x15: // getRecordInfo
        if (payload.length >= 19) {
          const fn = new TextDecoder('ascii').decode(payload.slice(1, 15));
          patch('RecInfo', `${fn} (${fmtBytes((payload[17]! << 8) | payload[18]!)})`);
        }
        break;

      case 0x16: patch('MaxRecDur', 'Set');     break;
      case 0x17: patch('Noise',     'Set');     break;
      case 0x18: patch('Platform',  'Set');     break;

      case 0x19: // voiceState
        if (payload.length >= 5) {
          const ts = new DataView(payload.buffer, payload.byteOffset + 1, 4).getInt32(0, false);
          patch('Voice', `state=${payload[0]} ts=${ts}`);
        }
        break;

      case 0x1A: patch('Screen',    'Set');       break;
      case 0x1B: patch('WiFi',      'Opening');   break;
      case 0x1C: patch('Bookmark',  'Removed');   break;
      case 0x1D: patch('Bookmark',  'Added');     break;

      case 0x1E: // reportBmk
        if (payload.length >= 2) patch('Bookmark', `t=${((payload[0]! << 8) | payload[1]!) >>> 0}`);
        break;

      case 0x20: patch('WiFi', 'Socket');     break;
      case 0x21: patch('WiFi', 'Closed');     break;
      case 0x2A: patch('Motor', payload[0] === 0 ? 'OK' : 'Failed'); break;

      case 0x30:
        patch('Translator', `Dev→App: ${Array.from(payload).map(b => b.toString(16).padStart(2,'0')).join(' ')}`);
        break;
      case 0x31: patch('Translator', 'App→Dev ACK'); break;
      case 0x35: patch('WiFi',       'Heartbeat');   break;

      default: break;
    }
  }

  // ── RX: live audio channel (B0B3) ────────────────────────────────────────────
  // Raw MP3 stream (MPEG V2 L3, 32kbps 16kHz mono, sync word FF F3).
  // Frames span BLE MTU boundaries so FF F3 may appear mid-notification.

  private _audioFrameCount = 0;

  private _onAudio(data: Uint8Array): void {
    this._audioFrameCount++;
    if (!this._streaming) {
      console.log(`[XLX3085] _onAudio: first frame (${data.length}B) — calling startStreaming(${this.audioFormat.slug})`);
      this._streaming = true;
      this._cb.showAudio();
      this._cb.startStreaming(this.audioFormat);
    } else if (this._audioFrameCount % 100 === 0) {
      console.log(`[XLX3085] _onAudio: frame #${this._audioFrameCount}, ${data.length}B`);
    }
    this._cb.audioFrame(data);
  }

  // ── RX: file data channel (B0B4) ─────────────────────────────────────────────

  private _onFile(data: Uint8Array): void {
    if (!this._dl) return;
    this._dl.chunks.push(new Uint8Array(data));
    this._dl.totalReceived += data.byteLength;
    const rx    = fmtBytes(this._dl.totalReceived);
    const total = this._dl.sizeBytes ? ` / ${fmtBytes(this._dl.sizeBytes)} (${Math.round(this._dl.totalReceived / this._dl.sizeBytes * 100)}%)` : '';
    const label = `File transfer: ${rx}${total}`;
    if (this._fileLogId === null) {
      this._fileLogId = this._log('RX', new Uint8Array(0), label);
    } else {
      this._updateLog(this._fileLogId, label);
    }
    if (this._dl.sizeBytes) {
      this._dlProg.value = {
        fileId: this._dl.fileId,
        pct: Math.min(100, Math.round(this._dl.totalReceived / this._dl.sizeBytes * 100)),
      };
    }
  }

  // ── Sync-complete ─────────────────────────────────────────────────────────────

  private _onSyncComplete(): void {
    const dl = this._dl;
    if (!dl) return;
    this._dl = null;
    const total = dl.chunks.reduce((s, c) => s + c.byteLength, 0);
    const raw   = new Uint8Array(total);
    let pos = 0;
    for (const c of dl.chunks) { raw.set(c, pos); pos += c.byteLength; }
    if (this._fileLogId !== null) {
      this._updateLog(this._fileLogId, `File transfer complete: ${fmtBytes(total)}`);
      this._fileLogId = null;
    }
    this._files.value = this._files.value.map(f =>
      f.id === dl.fileId ? { ...f, size: total, label: this._label(f.id, total) } : f
    );
    dl.resolve(raw, raw);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  private async _write(pkt: Uint8Array): Promise<void> {
    if (!this._t) throw new Error('Not connected');
    const txLabel = pkt.length >= 4
      ? this._descTx(pkt[3]!, pkt.length >= 5 ? pkt.slice(5, 5 + (pkt[4] ?? 0)) : new Uint8Array(0))
      : '';
    this._log('TX', pkt, txLabel);
    await this._t.writeChar(SVC, C_WRITE, pkt);
  }

  /**
   * Build XLX 3085 command frame with CRC-16/ARC.
   * Format: [A0 0A 01 cmd len payload... crc_lo crc_hi]
   */
  protected override _buildCommand(cmd: number, payload?: Uint8Array): Uint8Array {
    const len = payload?.length ?? 0;
    const body = new Uint8Array(5 + len);
    body.set([0xA0, 0x0A, 0x01, cmd, len & 0xFF], 0);
    if (payload && payload.length > 0) body.set(payload, 5);
    const crc = crc16arc(body);
    const frameWithCrc = new Uint8Array(body.length + 2);
    frameWithCrc.set(body, 0);
    frameWithCrc[body.length] = crc & 0xFF;
    frameWithCrc[body.length + 1] = (crc >> 8) & 0xFF;
    return frameWithCrc;
  }

  private _syncFileFrame(filename: string, offset: number): Uint8Array {
    const nameBytes = new TextEncoder().encode(filename);
    const payload   = new Uint8Array(nameBytes.length + 4);
    payload.set(nameBytes, 0);
    new DataView(payload.buffer).setInt32(nameBytes.length, offset, false);
    return this._buildCommand(0x0B, payload);
  }

  private _parseFileEntry(payload: Uint8Array): FileInfo | null {
    if (payload.length < 2) return null;
    let ne = 1;
    while (ne < Math.min(16, payload.length) && payload[ne] !== 0) ne++;
    const name = new TextDecoder('ascii').decode(payload.slice(1, ne)).trim();
    if (!name) return null;
    // bytes [16..18] = 3-byte BE file size; [19] = format flag
    const size = payload.length >= 19
      ? ((payload[16]! << 16) | (payload[17]! << 8) | payload[18]!)
      : 0;
    return { id: name, label: this._label(name, size), size };
  }

  private _label(name: string, size: number): string {
    const s = size > 0 ? ` (${fmtBytes(size)})` : '';
    if (/^\d{14}$/.test(name)) {
      return `${name.slice(0,4)}-${name.slice(4,6)}-${name.slice(6,8)} ` +
             `${name.slice(8,10)}:${name.slice(10,12)}:${name.slice(12,14)}${s}`;
    }
    return `${name}${s}`;
  }

  // ── Log labels ────────────────────────────────────────────────────────────────

  private _descTx(op: number, pl: Uint8Array): string {
    switch (op) {
      case 0x01: return 'GET_SERIAL';
      case 0x02: return 'GET_BIND_INFO';
      case 0x03: return `BIND(token=${new TextDecoder().decode(pl).replace(/\0/g,'').trim()})`;
      case 0x04:
        if (pl.length >= 6)
          return `SYNC_TIME(20${String(pl[0]).padStart(2,'0')}-${String(pl[1]).padStart(2,'0')}-${String(pl[2]).padStart(2,'0')} ${String(pl[3]).padStart(2,'0')}:${String(pl[4]).padStart(2,'0')}:${String(pl[5]).padStart(2,'0')})`;
        return 'SYNC_TIME';
      case 0x05: return 'GET_DEVICE_INFO';
      case 0x06: return 'START_REC';
      case 0x07: return 'STOP_REC';
      case 0x08: return 'PAUSE_REC';
      case 0x09: return 'RESUME_REC';
      case 0x0A: return 'GET_FILES';
      case 0x0B: {
        const n = new TextDecoder().decode(pl.slice(0, pl.length - 4)).replace(/\0/g,'').trim();
        const o = pl.length >= 4 ? new DataView(pl.buffer, pl.byteOffset + pl.length - 4, 4).getUint32(0, false) : 0;
        return `SYNC_FILE(${n}@${o})`;
      }
      case 0x0C: return 'END_SYNC';
      case 0x0D: return `DELETE(${new TextDecoder().decode(pl).replace(/\0/g,'').trim()})`;
      case 0x10: return 'FORMAT_DEVICE';
      case 0x11: return `LED(${pl[0] ? 'on' : 'off'})`;
      case 0x12: return 'RESTORE_FACTORY';
      case 0x13: return `USB(${pl[0] === 0 ? 'charge' : 'disk'})`;
      case 0x14: return `VOX(${pl[0] ? 'on' : 'off'})`;
      case 0x15: return 'GET_REC_INFO';
      case 0x16: return `REC_TIME(${pl[0]})`;
      case 0x17: return `NOISE(${pl[0]})`;
      case 0x18: return `PLATFORM(${pl[0] === 0 ? 'Android' : 'iOS'})`;
      case 0x1A: return `SCREEN(${pl[0] ? 'always-on' : 'auto-off'})`;
      case 0x1B: return 'OPEN_WIFI';
      case 0x1C: return 'REMOVE_BMK';
      case 0x1D: return 'ADD_BMK';
      case 0x20: return 'WIFI_SOCKET';
      case 0x21: return 'CLOSE_WIFI';
      case 0x2A: return `MOTOR(${pl[0] ? 'on' : 'off'})`;
      case 0x30: return 'TRANSLATOR_DEV';
      case 0x31: return 'TRANSLATOR_APP';
      case 0x35: return 'WIFI_HEART';
      default:   return `TX(0x${op.toString(16).padStart(2,'0')})`;
    }
  }

  private _descOp(op: number, pl: Uint8Array): string {
    switch (op) {
      case 0x01: return `GET_SERIAL(${pl.length > 0 ? new TextDecoder().decode(pl).trim() : '?'})`;
      case 0x02: return `GET_BIND_INFO(${pl.length === 1 && pl[0] === 0 ? 'unbound' : `bound ${pl.length}B`})`;
      case 0x03: return `BIND(${pl[0] === 0 ? 'OK' : `err=${pl[0]}`})`;
      case 0x04: return 'SYNC_TIME_ACK';
      case 0x05: {
        if (pl.length >= 14) {
          const bat = pl[9]!;
          const fw  = `${pl[11]}.${pl[12]}.${pl[13]}`;
          let ne = 17; while (ne < Math.min(38, pl.length) && pl[ne] !== 0) ne++;
          const name = new TextDecoder().decode(pl.slice(17, ne)).trim();
          return `GET_DEVICE_INFO(name=${name} fw=${fw} bat=${bat}%)`;
        }
        return `GET_DEVICE_INFO(len=${pl.length})`;
      }
      case 0x06: return 'REC_STARTED';
      case 0x07: return 'REC_STOPPED';
      case 0x08: return 'REC_PAUSED';
      case 0x09: return 'REC_RESUMED';
      case 0x0A: {
        if (pl.length === 1) return `GET_FILES(end)`;
        if (pl.length >= 19) {
          let ne = 1; while (ne < 16 && pl[ne] !== 0) ne++;
          const name = new TextDecoder().decode(pl.slice(1, ne)).trim();
          const size = (pl[16]! << 16) | (pl[17]! << 8) | pl[18]!;
          return `GET_FILES(${name} ${fmtBytes(size)})`;
        }
        return `GET_FILES(len=${pl.length})`;
      }
      case 0x0B: return `SYNC_FILE_ACK(${pl[0] === 0 ? `OK size=${pl.length >= 5 ? fmtBytes(new DataView(pl.buffer, pl.byteOffset+1, 4).getUint32(0,false)) : '?'}` : `end err=${pl[0]}`})`;
      case 0x0C: return 'SYNC_COMPLETE';
      case 0x0D: return `DELETE(${pl[0] === 0 ? 'OK' : 'FAIL'})`;
      case 0x0F: return `STATUS_PUSH(bat=${pl[1]}% rec=${pl[2]} mode=${pl[3]})`;
      case 0x10: return 'FORMAT_DEVICE';
      case 0x11: return `LED(${pl[0] === 0 ? 'OK' : `err=${pl[0]}`})`;
      case 0x12: return 'RESTORE_FACTORY';
      case 0x13: return `USB(${pl[0] === 0 ? 'OK' : `err=${pl[0]}`})`;
      case 0x14: return `VOX(${pl[0] === 0 ? 'OK' : `err=${pl[0]}`})`;
      case 0x15: return 'GET_REC_INFO';
      case 0x16: return `REC_TIME(${pl[0] === 0 ? 'OK' : `err=${pl[0]}`})`;
      case 0x17: return `NOISE(${pl[0] === 0 ? 'OK' : `err=${pl[0]}`})`;
      case 0x18: return 'PLATFORM_ACK';
      case 0x19: return `VOICE_STATE(len=${pl.length})`;
      case 0x1A: return `SCREEN(${pl[0] === 0 ? 'OK' : `err=${pl[0]}`})`;
      case 0x1B: return 'OPEN_WIFI';
      case 0x1C: return 'REMOVE_BMK';
      case 0x1D: return 'ADD_BMK';
      case 0x1E: return `BMK_TIME(${((pl[0]! << 8) | pl[1]!) >>> 0})`;
      case 0x20: return 'WIFI_SOCKET';
      case 0x21: return 'CLOSE_WIFI';
      case 0x2A: return `MOTOR(${pl[0] === 0 ? 'OK' : 'FAIL'})`;
      case 0x30: return `TRANSLATOR_DEV(len=${pl.length})`;
      case 0x31: return 'TRANSLATOR_APP_ACK';
      case 0x35: return 'WIFI_HEARTBEAT';
      default:   return `RX(0x${op.toString(16).padStart(2,'0')} len=${pl.length})`;
    }
  }
}

export const xlx3085 = new Xlx3085Protocol();
