/**
 * Mobvoi Link Protocol (TicNote Card)
 *
 * Reference:
 *   RE: /Users/jkiraly/Workspace/ai_voice_note/protocols/mobvoi_link/RE_MobvoiLink.md
 *   Status: Verified from live Frida captures and Dart source (TicNote Card v3.1.1)
 *
 * GATT:
 *   Service: 00001910-0000-1000-8000-00805f9b34fb
 *   Write:   00002bb1-0000-1000-8000-00805f9b34fb
 *   Notify:  00002bb0-0000-1000-8000-00805f9b34fb
 *
 * Frame format:
 *   TX (app → device): 01 01 00 [CMD] [payload...]
 *   RX (device → app): 01 01 00 [CMD] [payload...]
 *
 * Audio:
 *   Format: AVO (raw Opus packets, no container)
 *   Frame size: 160 bytes
 *   Duration per frame: 20 ms
 *   Sample rate: 16 kHz mono
 *
 * Recording flow:
 *   CMD 20 (0x14) → start recording
 *   CMD 22 (0x16) → pause recording
 *   CMD 23 (0x17) → resume/stop recording
 *   CMD 26 (0x1A) → get session list
 *   CMD 30 (0x1E) → sync file (raw audio data)
 */

import { signal } from '@preact/signals-core';
import type { ReadonlySignal } from '@preact/signals-core';
import {
  AUDIO_FORMATS,
  Protocol,
  type BleTransport,
  type DebugCommand,
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
  type ActiveTransfer,
} from './types.js';

// ── UUID helpers ─────────────────────────────────────────────────────────────

function u(short: string): string {
  return `0000${short}-0000-1000-8000-00805f9b34fb`;
}

// ── GATT layout ──────────────────────────────────────────────────────────────

const SVC    = u('1910');
const C_WRITE = u('2bb1');
const C_NOTIFY = u('2bb0');

// ── Command bytes ────────────────────────────────────────────────────────────

const CMD_HANDSHAKE_STEP0  = 0x02;
const CMD_HANDSHAKE_STEP1  = 0x02;
const CMD_READ_STATUS      = 0x03;
const CMD_SYNC_TIME        = 0x04;
const CMD_GET_STORAGE      = 0x06;
const CMD_GENERAL_SETTING  = 0x08;
const CMD_GET_BATTERY      = 0x09;
const CMD_REC_START        = 0x14;
const CMD_REC_PAUSE        = 0x16;
const CMD_REC_RESUME_STOP  = 0x17;
const CMD_GET_SESSION_LIST = 0x1A;
const CMD_SYNC_FILE        = 0x1E;

// ── Fixed handshake values ────────────────────────────────────────────────────

const HANDSHAKE_PREAMBLE = new Uint8Array([0x01, 0x01, 0x00]);
const HANDSHAKE_TOKEN = '1234567890000000'; // Fixed 16-byte ASCII token

// ── In-progress file transfer ────────────────────────────────────────────────

interface MobvoiTransfer extends ActiveTransfer {
  sessionId: number;
  chunks: Uint8Array[];
}

// ── Protocol class ───────────────────────────────────────────────────────────

export class MobvoiLinkProtocol
  extends Protocol
  implements FilesFeature, BatteryFeature, StorageFeature, RecordFeature, 
             TimeFeature, DeviceInfoFeature, DeviceSettingsFeature
{
  override readonly label = 'Mobvoi Link (TicNote Card)';
  override readonly desc = 'TicNote Card';
  override readonly nameFilters = ['TicNote'];
  override readonly optionalServices = [SVC];

  override readonly audioFormat = AUDIO_FORMATS.avo;

  // ── Features: Files ────────────────────────────────────────────────────────

  readonly files = signal<FileInfo[]>([]);
  readonly downloadProgress = signal<{ fileId: string; pct: number } | null>(null);

  async refreshFiles(): Promise<void> {
    const data = this._buildCommand(CMD_GET_SESSION_LIST);
    await this._write(data, 'GET_SESSION_LIST');
  }

  async downloadFile(id: string): Promise<FileDownload> {
    const sessionId = parseInt(id);
    const transfer: MobvoiTransfer = {
      fileId: id,
      sizeBytes: null,
      totalReceived: 0,
      onProgress: null,
      sessionId,
      chunks: [],
      resolve: () => {},
      reject: () => {},
    };
    this._activeTransfer = transfer;

    // Request file sync for this session
    const sessionIdBytes = new Uint8Array(4);
    new DataView(sessionIdBytes.buffer).setUint32(0, sessionId, true); // LE
    const data = this._buildCommand(CMD_SYNC_FILE, sessionIdBytes);
    await this._write(data, `SYNC_FILE ${id}`);

    return new Promise((resolve, reject) => {
      transfer.resolve = (data: Uint8Array, raw: Uint8Array) => {
        resolve({ data, raw, format: AUDIO_FORMATS.avo });
      };
      transfer.reject = reject;
    });
  }

  async deleteFile(id: string): Promise<void> {
    // Note: Mobvoi Link doesn't have a documented delete command yet
    this._log('--', new Uint8Array(0), `DELETE not implemented for ${id}`);
  }

  // ── Features: Battery ──────────────────────────────────────────────────────

  readonly battery = signal<number | null>(null);

  async refreshBattery(): Promise<void> {
    const data = this._buildCommand(CMD_GET_BATTERY);
    await this._write(data, 'GET_BATTERY');
  }

  // ── Features: Storage ──────────────────────────────────────────────────────

  readonly storage = signal<{ totalMb: number; freeMb: number } | null>(null);

  async refreshStorage(): Promise<void> {
    const data = this._buildCommand(CMD_GET_STORAGE);
    await this._write(data, 'GET_STORAGE');
  }

  // ── Features: Recording ────────────────────────────────────────────────────

  async startRecord(): Promise<void> {
    const data = this._buildCommand(CMD_REC_START);
    await this._write(data, 'REC_START');
  }

  async pauseRecord(): Promise<void> {
    const data = this._buildCommand(CMD_REC_PAUSE);
    await this._write(data, 'REC_PAUSE');
  }

  async resumeRecord(): Promise<void> {
    const data = this._buildCommand(CMD_REC_RESUME_STOP);
    await this._write(data, 'REC_RESUME');
  }

  async stopRecord(): Promise<void> {
    const data = this._buildCommand(CMD_REC_RESUME_STOP);
    await this._write(data, 'REC_STOP');
  }

  // ── Features: Time ────────────────────────────────────────────────────────

  async syncTime(): Promise<void> {
    const now = Math.floor(Date.now() / 1000); // Unix timestamp in seconds
    const timeBytes = new Uint8Array(4);
    new DataView(timeBytes.buffer).setUint32(0, now, true); // LE
    const data = this._buildCommand(CMD_SYNC_TIME, timeBytes);
    await this._write(data, 'SYNC_TIME');
  }

  // ── Features: DeviceInfo ───────────────────────────────────────────────────

  readonly deviceInfo = signal<{
    deviceId: string;
    ssn: number;
    version: [number, number, number];
    protocolVersion: number;
  } | null>(null);

  async refreshDeviceInfo(): Promise<void> {
    // First, query device status (CMD 3)
    const data = this._buildCommand(CMD_READ_STATUS);
    await this._write(data, 'READ_STATUS');
  }

  // ── Features: DeviceSettings ──────────────────────────────────────────────

  readonly deviceSettings = signal<DeviceSettings>({
    led: null,
    motor: null,
    wav: null,
    usb: null,
  });

  async setLed(on: boolean): Promise<void> {
    // CMD 8 general setting: byte[0] = rec_led_status
    const payload = new Uint8Array([on ? 1 : 0, 0, 0, 0, 0]); // All zero except rec_led_status
    const data = this._buildCommand(CMD_GENERAL_SETTING, payload);
    await this._write(data, `SET_LED ${on ? 'ON' : 'OFF'}`);
  }

  async setMotor(on: boolean): Promise<void> {
    this._log('--', new Uint8Array(0), 'Motor control not implemented');
  }

  async setWav(on: boolean): Promise<void> {
    // CMD 8 general setting: byte[2] = row_data (raw PCM flag)
    const payload = new Uint8Array([0, 0, on ? 1 : 0, 0, 0]);
    const data = this._buildCommand(CMD_GENERAL_SETTING, payload);
    await this._write(data, `SET_WAV ${on ? 'ON' : 'OFF'}`);
  }

  async setUsb(on: boolean): Promise<void> {
    this._log('--', new Uint8Array(0), 'USB control not implemented');
  }

  // ── State tiles ────────────────────────────────────────────────────────────

  override readonly stateTiles = signal<Record<string, string>>({});

  // ── Connection lifecycle ───────────────────────────────────────────────────

  private _transport: BleTransport | null = null;
  private _activeTransfer: MobvoiTransfer | null = null;
  private _handshakeComplete = false;

  override async onConnectHandshake(transport: BleTransport): Promise<void> {
    this._transport = transport;
    this._handshakeComplete = false;

    // Subscribe to notifications
    await transport.subscribeChar(SVC, C_NOTIFY, (data) => this._onNotify(data));

    // Handshake step 1: Hello
    const step0 = this._buildCommand(CMD_HANDSHAKE_STEP0, new Uint8Array([0x01, 0x00]));
    await this._write(step0, 'HANDSHAKE_STEP0');

    // Wait for handshake response
    await new Promise<void>((resolve) => {
      const checkInterval = setInterval(() => {
        if (this._handshakeComplete) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 100);
      setTimeout(() => {
        clearInterval(checkInterval);
        resolve();
      }, 5000); // 5 second timeout
    });

    // Handshake step 2: Send token
    const tokenBytes = new TextEncoder().encode(HANDSHAKE_TOKEN);
    const padding = new Uint8Array(9); // 9 zero bytes
    const deviceModel = new TextEncoder().encode('TicNote'); // Device model placeholder
    const step1Payload = new Uint8Array([0x01, 0x01, ...tokenBytes, ...padding, ...deviceModel]);
    const step1 = this._buildCommand(CMD_HANDSHAKE_STEP1, step1Payload);
    await this._write(step1, 'HANDSHAKE_STEP1');
  }

  override disconnect(): void {
    this._transport = null;
    this._handshakeComplete = false;
  }

  // ── Protocol identification ────────────────────────────────────────────────

  override identify(name: string, discoveredServiceUuids: readonly string[]): boolean {
    return name.startsWith('TicNote') && discoveredServiceUuids.includes(SVC);
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private async _write(data: Uint8Array, label?: string): Promise<void> {
    if (!this._transport) throw new Error('Not connected');
    const id = this._log('TX', data, label);
    try {
      await this._transport.writeChar(SVC, C_WRITE, data);
      this._updateLog(id, `${label ?? 'TX'} → OK`);
    } catch (err) {
      this._error(`write ${label}: ${(err as Error).message}`);
      throw err;
    }
  }

  /**
   * Build a Mobvoi Link command frame: [preamble][cmd][payload...]
   * Preamble is always 01 01 00.
   */
  protected override _buildCommand(cmd: number, payload?: Uint8Array): Uint8Array {
    if (!payload || payload.length === 0) {
      return new Uint8Array([...HANDSHAKE_PREAMBLE, cmd]);
    }
    const result = new Uint8Array(3 + 1 + payload.length);
    result.set(HANDSHAKE_PREAMBLE, 0);
    result[3] = cmd;
    result.set(payload, 4);
    return result;
  }

  private _onNotify(data: Uint8Array): void {
    if (data.length < 4) return;
    const id = this._log('RX', data);

    const cmd = data[3];

    // Decode preamble
    if (data[0] !== 0x01 || data[1] !== 0x01 || data[2] !== 0x00) {
      this._updateLog(id, 'Invalid preamble');
      return;
    }

    this._updateLog(id, `CMD ${cmd}`);

    switch (cmd) {
      case 0x01: // Handshake step 0 response
        this._onHandshakeStep0(data);
        break;
      case 0x02: // Handshake complete
        this._onHandshakeComplete(data);
        break;
      case 0x03: // Read status response
        this._onReadStatus(data);
        break;
      case 0x06: // Storage response
        this._onGetStorage(data);
        break;
      case 0x09: // Battery response
        this._onGetBattery(data);
        break;
      case 0x14: // Recording started
        this._onRecordingStarted(data);
        break;
      case 0x16: // Recording paused
        this._onRecordingPaused(data);
        break;
      case 0x17: // Recording resumed/stopped
        this._onRecordingResumedOrStopped(data);
        break;
      case 0x1A: // Session list response
        this._onSessionList(data);
        break;
      case 0x1E: // File sync data
        this._onFileSyncData(data);
        break;
      case 0x21: // CMD_ERROR
        this._log('!!', data, 'Command rejected');
        break;
      case 0x22: // CMD_ACK
        this._log('--', data, 'Command acknowledged');
        break;
      default:
        this._log('--', data, `Unknown CMD ${cmd}`);
    }
  }

  private _onHandshakeStep0(data: Uint8Array): void {
    if (data.length < 12) return;
    this._log('--', data, 'Handshake step 0 response received');
  }

  private _onHandshakeComplete(data: Uint8Array): void {
    if (data.length < 10) return;
    const status = data[3];
    const protVersion = data[4];
    const channels = data[7];
    this._log('--', data, `Handshake complete (proto v${protVersion}, ${channels}ch, status=${status})`);
    this._handshakeComplete = true;
  }

  private _onReadStatus(data: Uint8Array): void {
    if (data.length < 12) return;
    const state = data[3];
    this._log('--', data, `Device state: ${state}`);
  }

  private _onGetStorage(data: Uint8Array): void {
    if (data.length < 11) return;
    const dv = new DataView(data.buffer);
    const totalBytes = dv.getUint32(3, true); // LE
    const freeBytes = dv.getUint32(7, true); // LE
    const totalMb = Math.ceil(totalBytes / (1024 * 1024));
    const freeMb = Math.ceil(freeBytes / (1024 * 1024));
    this.storage.value = { totalMb, freeMb };
    this._log('--', data, `Storage: ${freeMb}/${totalMb} MB free`);
  }

  private _onGetBattery(data: Uint8Array): void {
    if (data.length < 5) return;
    const charging = data[3];
    const level = data[4] ?? 0;
    this.battery.value = level;
    this._log('--', data, `Battery: ${level}% (charging: ${charging})`);
  }

  private _onRecordingStarted(data: Uint8Array): void {
    if (data.length < 13) return;
    const dv = new DataView(data.buffer);
    const sessionId = dv.getUint32(3, true); // LE
    const elapsedMs = dv.getUint32(8, true); // LE
    this._log('--', data, `Recording started (session ${sessionId}, elapsed ${elapsedMs}ms)`);
    this._cb.startStreaming(AUDIO_FORMATS.avo);
  }

  private _onRecordingPaused(data: Uint8Array): void {
    if (data.length < 13) return;
    const dv = new DataView(data.buffer);
    const sessionId = dv.getUint32(3, true); // LE
    const state = data[12];
    this._log('--', data, `Recording paused (session ${sessionId}, state=${state})`);
    this._cb.stopStreaming();
  }

  private _onRecordingResumedOrStopped(data: Uint8Array): void {
    if (data.length < 13) return;
    const dv = new DataView(data.buffer);
    const sessionId = dv.getUint32(3, true); // LE
    const elapsedMs = dv.getUint32(8, true); // LE

    if (sessionId === 0) {
      this._log('--', data, `Recording stopped (elapsed ${elapsedMs}ms)`);
      this._cb.stopStreaming();
      void this.refreshFiles(); // Auto-refresh file list
    } else {
      this._log('--', data, `Recording resumed (session ${sessionId}, elapsed ${elapsedMs}ms)`);
      this._cb.startStreaming(AUDIO_FORMATS.avo);
    }
  }

  private _onSessionList(data: Uint8Array): void {
    if (data.length < 6) return;
    const uid = data[3];
    const totals = data[4] ?? 0;
    const start = data[5];

    if (totals === 0) {
      this.files.value = [];
      this._log('--', data, `No recordings (uid=${uid})`);
      return;
    }

    // Parse file list items: [sessionId 4B][size 4B][...]
    const files: FileInfo[] = [];
    let offset = 6;
    for (let i = 0; i < totals && offset + 8 <= data.length; i++) {
      const dv = new DataView(data.buffer);
      const sessionId = dv.getUint32(offset, true);
      const sizeBytes = dv.getUint32(offset + 4, true);
      files.push({
        id: sessionId.toString(),
        label: new Date(sessionId * 1000).toISOString(),
        size: sizeBytes,
      });
      offset += 8;
    }

    this.files.value = files;
    this._log('--', data, `${totals} recording(s)`);
  }

  private _onFileSyncData(data: Uint8Array): void {
    if (!this._activeTransfer) return;
    if (data.length <= 3) {
      // Sync complete (empty or minimal payload)
      if (this._activeTransfer.chunks.length > 0) {
        const fullData = new Uint8Array(
          this._activeTransfer.chunks.reduce((sum, chunk) => sum + chunk.length, 0)
        );
        let offset = 0;
        for (const chunk of this._activeTransfer.chunks) {
          fullData.set(chunk, offset);
          offset += chunk.length;
        }
        this._activeTransfer.resolve(fullData, fullData); // For now, data and raw are same
      }
      this._log('--', data, 'File sync complete');
      this._activeTransfer = null;
      return;
    }

    // Raw audio data
    const audioData = new Uint8Array(data.buffer, 3);
    this._activeTransfer.chunks.push(audioData);
    this._activeTransfer.totalReceived += audioData.length;
    if (this._activeTransfer.onProgress && this._activeTransfer.sizeBytes) {
      this._activeTransfer.onProgress(
        this._activeTransfer.totalReceived,
        this._activeTransfer.sizeBytes
      );
    }
  }

  // ── Debug commands ─────────────────────────────────────────────────────────

  override get commands(): DebugCommand[] {
    return [
      {
        label: 'Refresh Device Info',
        fn: () => this.refreshDeviceInfo(),
        category: 'info',
      },
      {
        label: 'Refresh Battery',
        fn: () => this.refreshBattery(),
        category: 'info',
      },
      {
        label: 'Refresh Storage',
        fn: () => this.refreshStorage(),
        category: 'info',
      },
      {
        label: 'Sync Time',
        fn: () => this.syncTime(),
        category: 'info',
      },
    ];
  }
}

export const mobvoiLink = new MobvoiLinkProtocol();
