import { computed } from '@preact/signals';
import type { Protocol } from '@ainote/protocols';
import { xlx3085 } from '@ainote/protocols';
import { store } from '../store/index.js';

export const PROTOCOLS: Record<string, Protocol> = {
  xlx3085,
};

export const activeProto = computed(() => PROTOCOLS[store.connection.activeProtoId.value]);
