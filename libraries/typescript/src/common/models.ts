// ── BLE Transport ─────────────────────────────────────────────────────────────

export interface BleTransport {
  readChar(serviceUuid: string, charUuid: string): Promise<Uint8Array>;
  writeChar(serviceUuid: string, charUuid: string, data: Uint8Array): Promise<void>;
  subscribeChar(serviceUuid: string, charUuid: string, handler: (value: Uint8Array) => void): Promise<boolean>;
  readonly discoveredServiceUuids: readonly string[];
  readonly deviceName: string;
}

// ── Shared data models ────────────────────────────────────────────────────────

export interface FileInfo {
  id: string;
  label: string;
  size?: number;
}

export interface DeviceInfo {
  name?: string;
  firmwareVersion?: string;
}
