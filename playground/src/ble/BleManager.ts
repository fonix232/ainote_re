/**
 * BleManager — owns the BleDevice instance and connection lifecycle.
 */
import { effect } from '@preact/signals';
import { BleDevice } from './BleDevice.js';
import type { DiscoveredService } from './BleDevice.js';
import type { Protocol } from '@ainote/protocols';
import { ProtocolRegistry } from '@ainote/protocols';
import type { KnownDevice } from '../store/persistence.js';
import { store } from '../store/index.js';
import { pushFrame, startStreaming, stop, stopVisualizer } from '../audio/player.js';

export class BleManager {
  private _ble:       BleDevice;
  private _protocols: ProtocolRegistry;
  private _disposeProtoLog: (() => void) | null = null;
  private _disposeProtoStream: (() => void) | null = null;
  private _disposeProtoState: (() => void) | null = null;

  get device(): BleDevice { return this._ble; }

  constructor(protocols: ProtocolRegistry) {
    this._protocols = protocols;
    this._ble       = this._createDevice();
  }

  async scan(): Promise<void> {
    if (store.connection.state.value !== 'idle') return;
    store.connection.state.value = 'scanning';
    try {
      const allProtos  = this._protocols.all();
      const allOptional = [...new Set(allProtos.flatMap(p => p.optionalServices))];
      const prefixes   = [...new Set(allProtos.flatMap(p => p.nameFilters))];
      const svcUuids   = [...new Set(allProtos.flatMap(p => p.filterServices))];
      const filters: BluetoothLEScanFilter[] = [
        ...prefixes.map(p => ({ namePrefix: p })),
        ...svcUuids.map(s => ({ services: [s] as BluetoothServiceUUID[] })),
      ];
      store.log.info('Scanning for supported devices…');
      await this._ble.scan(filters, allOptional);
    } catch (err) {
      store.log.error((err as Error).message);
      store.connection.state.value = 'idle';
    }
  }

  async connectKnown(entry: KnownDevice): Promise<void> {
    if (store.connection.state.value !== 'idle') return;
    store.connection.activeProtoId.value = entry.protocolId;
    store.connection.state.value         = 'scanning';
    try {
      const granted = await this._getGrantedDevice(entry.id);
      if (granted) {
        store.log.info(`Reconnecting "${entry.name}"…`);
        await this._ble.reconnect(granted);
      } else {
        store.log.info(`"${entry.name}" not pre-granted — opening scanner…`);
        await this.scan();
      }
    } catch (err) {
      store.log.error((err as Error).message);
      store.connection.state.value = 'idle';
    }
  }

  disconnect(): void {
    this._ble.disconnect();
  }

  private _detachProtocolRuntime(): void {
    this._disposeProtoLog?.();
    this._disposeProtoLog = null;
    this._disposeProtoStream?.();
    this._disposeProtoStream = null;
    this._disposeProtoState?.();
    this._disposeProtoState = null;
    store.device.reset();
  }

  private _attachProtocolRuntime(proto: Protocol): void {
    this._detachProtocolRuntime();

    store.device.protocolLabel.value = proto.label;
    store.device.audioFormat.value = proto.audioFormat;
    store.device.commands.value = proto.commands;
    store.device.supportsFiles.value = proto.hasFiles();
    store.device.supportsRecording.value = proto.hasRecord();
    store.device.supportsStreaming.value = proto.hasStream();

    this._disposeProtoState = effect(() => {
      store.device.stateTiles.value = proto.stateTiles.value;
      store.device.battery.value = proto.hasBattery() ? proto.battery.value : null;
      store.device.storage.value = proto.hasStorage() ? proto.storage.value : null;
      store.device.deviceInfo.value = proto.hasDeviceInfo() ? proto.deviceInfo.value : null;
      store.device.files.value = proto.hasFiles() ? proto.files.value : [];
      store.device.downloadProgress.value = proto.hasFiles() ? proto.downloadProgress.value : null;
    });

    this._disposeProtoLog = effect(() => {
      for (const entry of proto.log.value) {
        store.log.protocol(entry);
      }
    });

    if (proto.hasStream()) {
      let streamStarted = false;
      this._disposeProtoStream = effect(() => {
        const chunk = proto.streamData.value;
        if (chunk) {
          if (!streamStarted) {
            store.audio.visible.value = true;
            store.audio.codec.value = proto.audioFormat;
            startStreaming(proto.audioFormat);
            streamStarted = true;
          }
          pushFrame(chunk);
          return;
        }
        if (streamStarted) {
          stop();
          streamStarted = false;
        }
      });
    }
  }

  private _activeProto(): Protocol | undefined {
    return this._protocols.get(store.connection.activeProtoId.value);
  }

  private async _getGrantedDevice(id: string): Promise<BluetoothDevice | null> {
    if (!navigator.bluetooth?.getDevices) return null;
    try {
      return (await navigator.bluetooth.getDevices()).find(d => d.id === id) ?? null;
    } catch { return null; }
  }

  private _createDevice(): BleDevice {
    const ble = new BleDevice();

    ble.addEventListener('connected', (e) => {
      const { name } = (e as CustomEvent<{ name: string }>).detail;
      store.connection.state.value = 'connected';
      store.connection.label.value = name;

      const uuids    = ble.discoveredServiceUuids;
      const detected = this._protocols.entries()
        .find(([, p]) => p.identify(name, uuids));
      if (detected) {
        store.connection.activeProtoId.value = detected[0];
        store.log.connected(name, detected[1].label);
      } else {
        store.log.connected(name, this._activeProto()?.label ?? store.connection.activeProtoId.value);
      }

      store.persistence.saveKnown(ble.id ?? '', name, store.connection.activeProtoId.value);
      const proto = this._activeProto();
      if (proto) {
        this._attachProtocolRuntime(proto);
        void proto.connect(ble).catch(err => store.log.error(`init: ${(err as Error).message}`));
      }
    });

    ble.addEventListener('ble-log', (e) => {
      const { level, msg } = (e as CustomEvent<{ level: string; msg: string }>).detail;
      (level === 'warn' || level === 'error')
        ? store.log.error(`[BLE] ${msg}`)
        : store.log.info(`[BLE] ${msg}`);
    });

    ble.addEventListener('discovery', (e) => {
      const { name, services } = (e as CustomEvent<{ name: string; services: DiscoveredService[] }>).detail;
      store.log.serviceDiscovery(name, services.map(svc => ({
        uuid:            svc.service,
        characteristics: svc.characteristics.map(ch => ({ uuid: ch.uuid, properties: ch.properties })),
      })));
    });

    ble.addEventListener('disconnected', () => {
      const proto = this._activeProto();
      const name  = store.connection.label.value || 'Device';
      this._detachProtocolRuntime();
      proto?.disconnect();
      store.connection.state.value   = 'idle';
      store.connection.label.value   = '';
      stop();
      stopVisualizer();
      store.audio.visible.value = false;
      store.log.disconnected(name);
      this._ble = this._createDevice();
    });

    return ble;
  }
}
