/**
 * BleManager — owns the BleDevice instance and connection lifecycle.
 */
import { BleDevice } from './BleDevice.js';
import type { DiscoveredService } from './BleDevice.js';
import type { Protocol, KnownDevice, AudioFormat } from '@ainote/protocols';
import type { LogDir } from '../store/log.js';
import { store } from '../store/index.js';
import { stop, stopVisualizer, startStreaming, pushFrame } from '../audio/player.js';

type ProtocolRegistry = Record<string, Protocol>;

export class BleManager {
  private _ble:       BleDevice;
  private _protocols: ProtocolRegistry;

  get device(): BleDevice { return this._ble; }

  constructor(protocols: ProtocolRegistry) {
    this._protocols = protocols;
    this._ble       = this._createDevice();
  }

  async scan(): Promise<void> {
    if (store.connection.state.value !== 'idle') return;
    store.connection.state.value = 'scanning';
    try {
      const allProtos  = Object.values(this._protocols);
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

  private _activeProto(): Protocol | undefined {
    return this._protocols[store.connection.activeProtoId.value];
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
      const detected = Object.entries(this._protocols)
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
        proto.init({
          log: (dir: string, bytes: Uint8Array, label = '') => {
            if (dir === 'TX' || dir === 'RX') return store.log.frame(dir as LogDir, bytes, label);
            if (dir === '!!') return store.log.error(label);
            return store.log.info(label);
          },
          updateLog: (id: number, label: string) => store.log.updateFrame(id, label),
          audioFrame:     (chunk: Uint8Array)                              => pushFrame(chunk),
          startStreaming: (fmt: AudioFormat)                               => startStreaming(fmt),
          stopStreaming:  ()                                               => stop(),
          setAudioFormat: (fmt: AudioFormat) => { store.audio.codec.value = fmt; },
          showAudio:      ()                 => { store.audio.visible.value = true; },
        });
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
