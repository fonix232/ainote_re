import { signal } from '@preact/signals';
import type { Signal } from '@preact/signals';

export type ConnState = 'idle' | 'scanning' | 'connected';

export class ConnectionStore {
  readonly state:         Signal<ConnState> = signal('idle');
  readonly label:         Signal<string>    = signal('');
  readonly activeProtoId: Signal<string>    = signal('');
}
