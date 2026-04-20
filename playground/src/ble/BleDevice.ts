/**
 * BleDevice — Web Bluetooth adapter.
 *
 * Implements BleTransport so protocols receive it directly in connect().
 */
import type { BleTransport } from '@ainote/protocols';

export interface DiscoveredChar {
  uuid: string;
  properties: string[];
}

export interface DiscoveredService {
  service: string;
  characteristics: DiscoveredChar[];
}

const PROP_NAMES = [
  'broadcast', 'read', 'writeWithoutResponse', 'write',
  'notify', 'indicate', 'authenticatedSignedWrites',
  'reliableWrite', 'writableAuxiliaries',
] as const;

export class BleDevice extends EventTarget implements BleTransport {
  private _device: BluetoothDevice | null = null;
  private _server: BluetoothRemoteGATTServer | null = null;
  private _svcCache  = new Map<string, BluetoothRemoteGATTService>();
  private _charCache = new Map<string, BluetoothRemoteGATTCharacteristic>();
  private _discoveredUuids: string[] = [];

  get connected(): boolean { return this._server?.connected ?? false; }
  get name(): string       { return this._device?.name ?? 'Unknown'; }
  get id(): string | null  { return this._device?.id ?? null; }
  get discoveredServiceUuids(): readonly string[] { return this._discoveredUuids; }
  get deviceName(): string { return this._device?.name ?? ''; }

  private _log(level: 'info' | 'warn' | 'error', msg: string): void {
    console[level]('[BLE]', msg);
    this.dispatchEvent(new CustomEvent('ble-log', { detail: { level, msg } }));
  }

  async scan(filters: BluetoothLEScanFilter[], optionalServices: string[]): Promise<void> {
    const optional = optionalServices.map(u => u.toLowerCase()) as BluetoothServiceUUID[];
    const opts: RequestDeviceOptions = filters.length
      ? { filters, optionalServices: optional }
      : { acceptAllDevices: true, optionalServices: optional };
    this._log('info', `requestDevice ${filters.length ? JSON.stringify(filters) : '(all)'}`);
    this._device = await navigator.bluetooth.requestDevice(opts);
    this._log('info', `Selected: "${this._device.name}"`);
    this._attachDisconnectListener();
    await this._gattConnect();
  }

  async reconnect(device: BluetoothDevice): Promise<void> {
    this._device = device;
    this._attachDisconnectListener();
    await this._gattConnect();
  }

  disconnect(): void {
    if (this._device?.gatt?.connected) this._device.gatt.disconnect();
  }

  async readChar(serviceUuid: string, charUuid: string): Promise<Uint8Array> {
    const char = await this._getChar(serviceUuid, charUuid);
    const value = await char.readValue();
    return new Uint8Array(value.buffer);
  }

  async writeChar(serviceUuid: string, charUuid: string, data: Uint8Array): Promise<void> {
    const char = await this._getChar(serviceUuid, charUuid);
    const buf = data as unknown as Uint8Array<ArrayBuffer>;
    if (char.properties.write) {
      await char.writeValueWithResponse(buf);
    } else {
      await char.writeValueWithoutResponse(buf);
    }
  }

  async subscribeChar(serviceUuid: string, charUuid: string, handler: (value: Uint8Array) => void): Promise<boolean> {
    try {
      const char = await this._getChar(serviceUuid, charUuid);
      await char.startNotifications();
      char.addEventListener('characteristicvaluechanged', (e: Event) => {
        const target = e.target as BluetoothRemoteGATTCharacteristic;
        handler(new Uint8Array(target.value!.buffer));
      });
      this._log('info', `Subscribed to ${charUuid}`);
      return true;
    } catch (err) {
      this._log('warn', `subscribeChar ${charUuid}: ${(err as Error).message}`);
      return false;
    }
  }

  private _attachDisconnectListener(): void {
    this._device?.addEventListener('gattserverdisconnected', () => {
      this._log('warn', 'gattserverdisconnected');
      this._server = null;
      this._svcCache.clear();
      this._charCache.clear();
      this._discoveredUuids = [];
      this.dispatchEvent(new CustomEvent('disconnected'));
    });
  }

  private async _gattConnect(): Promise<void> {
    if (!this._device) throw new Error('No device');
    this._log('info', 'GATT connecting…');
    this._server = await this._device.gatt!.connect();
    this._log('info', 'Connected — discovering services…');

    const services = await this._server.getPrimaryServices();
    this._discoveredUuids = services.map(s => s.uuid);
    this._svcCache.clear();
    this._charCache.clear();

    const discovered: DiscoveredService[] = [];
    for (const svc of services) {
      this._svcCache.set(svc.uuid.toLowerCase(), svc);
      const chars = await svc.getCharacteristics();
      for (const c of chars) this._charCache.set(c.uuid.toLowerCase(), c);
      discovered.push({
        service: svc.uuid,
        characteristics: chars.map(c => ({
          uuid: c.uuid,
          properties: PROP_NAMES.filter(p => c.properties[p]),
        })),
      });
    }

    this.dispatchEvent(new CustomEvent('discovery', { detail: { name: this.name, services: discovered } }));
    this.dispatchEvent(new CustomEvent('connected', { detail: { name: this.name } }));
  }

  private async _getChar(serviceUuid: string, charUuid: string): Promise<BluetoothRemoteGATTCharacteristic> {
    const cLower = charUuid.toLowerCase();
    const cached = this._charCache.get(cLower);
    if (cached) return cached;
    if (!this._server?.connected) throw new Error('GATT not connected');
    const svc  = await this._getService(serviceUuid);
    const char = await svc.getCharacteristic(cLower as BluetoothCharacteristicUUID);
    this._charCache.set(cLower, char);
    return char;
  }

  private async _getService(uuid: string): Promise<BluetoothRemoteGATTService> {
    const lower = uuid.toLowerCase();
    const cached = this._svcCache.get(lower);
    if (cached) return cached;
    if (!this._server?.connected) throw new Error('GATT not connected');
    const svc = await this._server.getPrimaryService(lower as BluetoothServiceUUID);
    this._svcCache.set(lower, svc);
    return svc;
  }
}
