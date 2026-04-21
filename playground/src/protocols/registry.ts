import { computed } from '@preact/signals';
import { recolx01, type Protocol } from '@ainote/protocols';
import { store } from '../store/index.js';

export const PROTOCOLS: Record<string, Protocol> = {
	'recolx-01': recolx01,
};

export const activeProto = computed(() => PROTOCOLS[store.connection.activeProtoId.value]);
