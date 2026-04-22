import { computed } from '@preact/signals';
import { ProtocolRegistry } from '@ainote/protocols';
import { store } from '../store/index.js';

export const PROTOCOLS = new ProtocolRegistry();

export const activeProto = computed(() => PROTOCOLS.get(store.connection.activeProtoId.value));
