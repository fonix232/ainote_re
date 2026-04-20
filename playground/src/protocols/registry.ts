import { computed } from '@preact/signals';
import type { Protocol } from '@ainote/protocols';
import { store } from '../store/index.js';

export const PROTOCOLS: Record<string, Protocol> = {};

export const activeProto = computed(() => PROTOCOLS[store.connection.activeProtoId.value]);
