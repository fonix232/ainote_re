import { LogStore }         from './log.js';
import { ConnectionStore }  from './connection.js';
import { AudioStore }       from './audio.js';
import { DeviceStore }      from './device.js';
import { PersistenceStore } from './persistence.js';

export type { LogEntry, LogDir }  from './log.js';
export type { ConnState }         from './connection.js';
export type { PlaybackState }     from './audio.js';

class AppStore {
  readonly log         = new LogStore();
  readonly connection  = new ConnectionStore();
  readonly audio       = new AudioStore();
  readonly device      = new DeviceStore();
  readonly persistence = new PersistenceStore();
}

export const store = new AppStore();
