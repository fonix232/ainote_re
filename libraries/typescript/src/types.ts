/**
 * Shared BLE protocol types — @ainote/protocols
 *
 * Design:
 *  - Protocols receive a BleTransport in connect() and own all GATT setup.
 *  - Features are opt-in capabilities (FilesFeature, BatteryFeature, etc.).
 *  - App-level code checks proto.hasFiles() etc. and uses the narrowed typed object.
 *  - nameFilters holds device name prefixes used for BLE scan filtering.
 *  - Protocols do NOT import from any app-level store or audio layer — they
 *    receive injectable callbacks (log, audioFrame, etc.) via Protocol.init().
 */
import type { ReadonlySignal } from '@preact/signals-core';

// ── BLE Transport ─────────────────────────────────────────────────────────────

/**
 * Minimal BLE interface handed to a protocol's connect().
 * Protocol uses this to write frames and subscribe to characteristics.
 */
export interface BleTransport {
  /** Read the current value of a GATT characteristic. */
  readChar(serviceUuid: string, charUuid: string): Promise<Uint8Array>;
  /** Write data to a GATT characteristic. */
  writeChar(serviceUuid: string, charUuid: string, data: Uint8Array): Promise<void>;
  /**
   * Subscribe to GATT characteristic notifications.
   * Returns false if the characteristic is unavailable.
   */
  subscribeChar(serviceUuid: string, charUuid: string, handler: (value: Uint8Array) => void): Promise<boolean>;
  /** Service UUIDs enumerated during GATT discovery — used for sub-type detection. */
  readonly discoveredServiceUuids: readonly string[];
  /** Advertised device name as seen by the browser. */
  readonly deviceName: string;
}

// ── Injectable callbacks ──────────────────────────────────────────────────────

/**
 * Direction of a log entry: TX/RX (BLE frame), -- (info), !! (error).
 */
export type LogDir = 'TX' | 'RX' | '--' | '!!';

/**
 * Callbacks provided by the host application and injected into every protocol
 * via Protocol.init(). Protocols call these instead of importing store/audio.
 */
export interface ProtocolCallbacks {
  /**
   * Emit a log entry with a raw byte frame and a decoded label.
   * Returns an opaque id that can be passed to updateLog() to patch the label.
   */
  log(dir: LogDir, bytes: Uint8Array, label?: string): number;
  /** Update the label of an existing log entry (e.g. progress updates). */
  updateLog(id: number, label: string): void;
  /**
   * Push a live audio frame (PCM or codec chunk) to the audio player.
   * The host player decides how to handle it based on the current codec.
   */
  audioFrame(chunk: Uint8Array): void;
  /**
   * Notify the host that the protocol wants audio playback to start streaming.
   * Passes the audio format so the host can configure the decoder.
   */
  startStreaming(format: AudioFormat): void;
  /** Notify the host that streaming has ended. */
  stopStreaming(): void;
  /** Notify the host of the codec the protocol is using, so the UI updates. */
  setAudioFormat(format: AudioFormat): void;
  /** Show the audio player panel. */
  showAudio(): void;
}

// ── Features ──────────────────────────────────────────────────────────────────

/** A file stored on the device. */
export interface FileInfo {
  id: string;    // unique key (filename, path, etc.)
  label: string; // human-readable (e.g. formatted date/time)
  size?: number; // bytes if known from file-list metadata
}

/** Discriminant slug for an audio format. */
export type AudioFormatSlug = 'sbc' | 'opus' | 'speex' | 'avo' | 'pcm-s16le' | 'mp3' | 'aac' | 'unknown';

/** Codec-level parameters used to configure decoders/players. */
export interface CodecParams {
  type:        'opus' | 'speex' | 'sbc' | 'avo' | 'pcm' | 'passthrough';
  sampleRate?: number;   // Hz
  channels?:   number;   // 1 = mono, 2 = stereo
  frameBytes?: number;   // fixed frame size where applicable
}

/**
 * Full audio format descriptor — slug, file extension, human name, and codec params.
 * Protocols reference the pre-defined constants in AUDIO_FORMATS.
 */
export interface AudioFormat {
  readonly slug:      AudioFormatSlug;
  readonly extension: string;    // without leading dot
  readonly name:      string;    // human-readable label
  readonly codec:     CodecParams;
}

export const AUDIO_FORMATS = {
  opus:      { slug: 'opus',      extension: 'opus', name: 'Opus Mono 16\u202fkHz',           codec: { type: 'opus',        sampleRate: 16000, channels: 1 } },
  speex:     { slug: 'speex',     extension: 'spx',  name: 'JieLi Speex WB 16\u202fkHz',     codec: { type: 'speex',       sampleRate: 16000, channels: 1, frameBytes: 40 } },
  avo:       { slug: 'avo',       extension: 'avo',  name: 'Mobvoi AVO (Opus 48\u202fkHz)',   codec: { type: 'avo',         sampleRate: 48000, channels: 1, frameBytes: 160 } },
  sbc:       { slug: 'sbc',       extension: 'sbc',  name: 'Doway SBC',                       codec: { type: 'sbc',         sampleRate: 16000, channels: 1 } },
  recolxSbc: { slug: 'sbc',       extension: 'sbc',  name: 'Recolx SBC 16\u202fkHz Mono',    codec: { type: 'sbc',         sampleRate: 16000, channels: 1, frameBytes: 40 } },
  pcm:       { slug: 'pcm-s16le', extension: 'raw',  name: 'PCM S16LE',                       codec: { type: 'pcm',         sampleRate: 16000, channels: 1 } },
  mp3:       { slug: 'mp3',       extension: 'mp3',  name: 'MP3',                             codec: { type: 'passthrough' } },
  aac:       { slug: 'aac',       extension: 'aac',  name: 'AAC',                             codec: { type: 'passthrough' } },
  unknown:   { slug: 'unknown',   extension: 'bin',  name: 'Unknown',                         codec: { type: 'passthrough' } },
} as const satisfies Record<string, AudioFormat>;

export interface FileDownload {
  /** Stripped payload — all protocol/device headers removed. Use for playback and storage. */
  data: Uint8Array;
  /** As-received assembled buffer — includes all device headers. Use for debug/RE only. */
  raw:  Uint8Array;
  format: AudioFormat;
}

/**
 * Common state for an in-progress file transfer.
 * Protocols extend this locally with transport-specific fields.
 */
export interface ActiveTransfer {
  fileId:        string;
  sizeBytes:     number | null;
  totalReceived: number;
  onProgress:    ((rx: number, total: number) => void) | null;
  resolve:       (data: Uint8Array, raw: Uint8Array) => void;
  reject:        (e: Error) => void;
}

/** Protocol supports listing, downloading, and deleting stored recordings. */
export interface FilesFeature {
  readonly files: ReadonlySignal<FileInfo[]>;
  readonly downloadProgress: ReadonlySignal<{ fileId: string; pct: number } | null>;
  refreshFiles(): Promise<void>;
  downloadFile(id: string): Promise<FileDownload>;
  deleteFile(id: string): Promise<void>;
}

/** Protocol can report battery level. */
export interface BatteryFeature {
  readonly battery: ReadonlySignal<number | null>;
  refreshBattery(): Promise<void>;
}

/** Protocol can report storage usage. */
export interface StorageFeature {
  readonly storage: ReadonlySignal<{ totalMb: number; freeMb: number } | null>;
  refreshStorage(): Promise<void>;
}

/** Protocol can synchronise the device real-time clock. */
export interface TimeFeature {
  syncTime(): Promise<void>;
}

/**
 * Protocol exposes a single device-info query (firmware version, model, etc.).
 * When present, connect() calls refreshDeviceInfo() instead of refreshBattery/refreshStorage.
 */
export interface DeviceInfoFeature {
  refreshDeviceInfo(): Promise<void>;
}

/** Current on/off state of togglable device settings. null = not yet known. */
export interface DeviceSettings {
  led:   boolean | null;
  motor: boolean | null;
  wav:   boolean | null;
  usb:   boolean | null;
}

/** Protocol has togglable device settings (LED, motor, WAV, USB). */
export interface DeviceSettingsFeature {
  readonly deviceSettings: ReadonlySignal<DeviceSettings>;
  setLed(on: boolean):   Promise<void>;
  setMotor(on: boolean): Promise<void>;
  setWav(on: boolean):   Promise<void>;
  setUsb(on: boolean):   Promise<void>;
}

/** Protocol supports on-device recording control. */
export interface RecordFeature {
  startRecord(): Promise<void>;
  stopRecord(): Promise<void>;
}

// ── Protocol commands ───────────────────────────────────────────────────────────

/**
 * Category of a protocol command.
 *  - debug      — auto-executed internals (handshakes, keep-alive)
 *  - info        — periodic device queries (battery, storage, file list)
 *  - recording   — recording control (start, stop, pause)
 *  - transfer    — file-transfer operations (sync, download)
 *  - settings    — configuration writes (LEDs, vibration, etc.)
 *  - dangerous   — destructive / irreversible (format, factory reset)
 */
export type CommandCategory =
  | 'debug'
  | 'info'
  | 'recording'
  | 'transfer'
  | 'settings'
  | 'dangerous';

export interface DebugCommand {
  label: string;
  fn: () => Promise<void>;
  confirm?: boolean;
  category?: CommandCategory;
}

export interface DebugToggle {
  label: string;
  kind: 'toggle';
  get: () => boolean | null;
  set: (on: boolean) => Promise<void>;
  onLabel?:  string;
  offLabel?: string;
  category?: CommandCategory;
}

export interface DebugSelect {
  label: string;
  kind: 'select';
  get: () => number | string | null;
  set: (value: number | string) => Promise<void>;
  options: Record<string | number, string>;
  category?: CommandCategory;
}

export type AnyDebugCommand = DebugCommand | DebugToggle | DebugSelect;

// ── Known device ─────────────────────────────────────────────────────────────

export interface KnownDevice {
  id: string;
  name: string;
  protocolId: string;
}

// ── Protocol base class ───────────────────────────────────────────────────────

export abstract class Protocol {
  abstract readonly label: string;
  abstract readonly desc: string;
  abstract readonly nameFilters: string[];
  readonly filterServices: string[] = [];
  abstract readonly optionalServices: string[];

  abstract disconnect(): void;
  abstract readonly stateTiles: ReadonlySignal<Record<string, string>>;

  // ── Injectable callbacks ───────────────────────────────────────────────────

  /**
   * Provided by the host application. Protocols call these instead of importing
   * from a store or audio layer. Must be set via init() before connect().
   */
  protected _cb: ProtocolCallbacks = {
    log:           () => 0,
    updateLog:     () => undefined,
    audioFrame:    () => undefined,
    startStreaming: (_format: AudioFormat) => undefined,
    stopStreaming:  () => undefined,
    setAudioFormat: () => undefined,
    showAudio:     () => undefined,
  };

  /**
   * Inject host callbacks. Called once by the application before any connect().
   * Re-calling replaces all callbacks (useful for hot-reload / testing).
   */
  init(cb: Partial<ProtocolCallbacks>): void {
    this._cb = { ...this._cb, ...cb };
  }

  // ── Convenience shorthands ─────────────────────────────────────────────────

  protected _log(dir: LogDir, bytes: Uint8Array, label?: string): number {
    return this._cb.log(dir, bytes, label);
  }
  protected _updateLog(id: number, label: string): void {
    this._cb.updateLog(id, label);
  }
  protected _info(msg: string): void {
    this._cb.log('--', new Uint8Array(0), msg);
  }
  protected _error(msg: string): void {
    this._cb.log('!!', new Uint8Array(0), msg);
  }

  // ── Feature predicates ─────────────────────────────────────────────────────

  hasFiles():          this is FilesFeature          { return 'files'             in this; }
  hasBattery():        this is BatteryFeature        { return 'battery'           in this; }
  hasStorage():        this is StorageFeature        { return 'storage'           in this; }
  hasRecord():         this is RecordFeature         { return 'startRecord'       in this; }
  hasTime():           this is TimeFeature           { return 'syncTime'          in this; }
  hasDeviceInfo():     this is DeviceInfoFeature     { return 'refreshDeviceInfo' in this; }
  hasDeviceSettings(): this is DeviceSettingsFeature { return 'deviceSettings'    in this; }

  readonly connectInitDelay: number = 0;

  abstract onConnectHandshake(transport: BleTransport): Promise<void>;

  async connect(transport: BleTransport): Promise<void> {
    await this.onConnectHandshake(transport);
    const pause = this.connectInitDelay > 0
      ? () => new Promise<void>(r => setTimeout(r, this.connectInitDelay))
      : () => Promise.resolve<void>(undefined);
    if (this.hasTime())       { await this.syncTime();          await pause(); }
    if (this.hasDeviceInfo()) {
      await this.refreshDeviceInfo();                           await pause();
    } else {
      if (this.hasBattery()) { await this.refreshBattery();    await pause(); }
      if (this.hasStorage()) { await this.refreshStorage();    await pause(); }
    }
    if (this.hasFiles())      { await this.refreshFiles(); }
  }

  get commands(): AnyDebugCommand[] { return []; }

  readonly audioFormat: AudioFormat = AUDIO_FORMATS.opus;

  identify(_name: string, _discoveredServiceUuids: readonly string[]): boolean { return false; }
}
