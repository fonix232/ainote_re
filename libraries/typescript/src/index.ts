/**
 * @ainote/protocols — public entry point.
 *
 * Individual protocol implementations are not exported here — the playground
 * imports them directly and registers them with a PROTOCOLS map.
 */
export type { AudioFormat, AudioFormatSlug, CodecParams } from './common/audio.js';
export { AUDIO_FORMATS } from './common/audio.js';
export { LogBuffer, LogType } from './common/logging.js';
export type { LogEntry } from './common/logging.js';
export type { ActiveTransfer } from './common/transfers.js';
export type { Feature } from './common/features.js';
export type { BleTransport, DeviceInfo, FileInfo } from './common/models.js';
export type {
  CommandCategory,
  Command,
  CommandAction,
  CommandToggle,
  CommandSelect,
  AnyCommand,
  DebugCommand,
  DebugToggle,
  DebugSelect,
  AnyDebugCommand,
} from './common/commands.js';
export { Protocol } from './common/protocol.js';
export { ProtocolRegistry } from './common/registry.js';
