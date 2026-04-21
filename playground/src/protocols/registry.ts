import { computed } from '@preact/signals';
import type { Protocol } from '@ainote/protocols';
import { mobvoiLink } from '@ainote/protocols';
import { store } from '../store/index.js';

export const PROTOCOLS: Record<string, Protocol> = {
  'mobvoi-link': mobvoiLink,
};

export const activeProto = computed(() => PROTOCOLS[store.connection.activeProtoId.value]);
