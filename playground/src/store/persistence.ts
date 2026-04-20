import { signal } from '@preact/signals';
import type { Signal } from '@preact/signals';
import type { KnownDevice } from '@ainote/protocols';

// ── File cache ────────────────────────────────────────────────────────────────

const CACHE_PREFIX = 'ble-cache:';

export class FileCacheStore {
  save(key: string, bytes: Uint8Array): void {
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    try { localStorage.setItem(`${CACHE_PREFIX}${key}`, btoa(binary)); } catch { /* quota */ }
  }

  load(key: string): Uint8Array | null {
    const b64 = localStorage.getItem(`${CACHE_PREFIX}${key}`);
    if (!b64) return null;
    try {
      const binary = atob(b64);
      const buf    = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) buf[i] = binary.charCodeAt(i);
      return buf.length > 0 ? buf : null;
    } catch { return null; }
  }

  delete(key: string): void {
    localStorage.removeItem(`${CACHE_PREFIX}${key}`);
  }
}

// ── Known devices ─────────────────────────────────────────────────────────────

const KNOWN_KEY = 'ai-note-known-devices';

function loadKnown(): KnownDevice[] {
  try { return JSON.parse(localStorage.getItem(KNOWN_KEY) ?? '[]') as KnownDevice[]; }
  catch { return []; }
}

export class PersistenceStore {
  readonly knownDevices: Signal<KnownDevice[]> = signal(loadKnown());
  readonly cache = new FileCacheStore();

  saveKnown(id: string, name: string, protocolId: string): void {
    if (!id) return;
    const list = loadKnown().filter(d => d.id !== id);
    list.unshift({ id, name, protocolId });
    localStorage.setItem(KNOWN_KEY, JSON.stringify(list.slice(0, 10)));
    this.knownDevices.value = loadKnown();
  }

  removeKnown(id: string): void {
    const list = loadKnown().filter(d => d.id !== id);
    localStorage.setItem(KNOWN_KEY, JSON.stringify(list));
    this.knownDevices.value = loadKnown();
  }
}
