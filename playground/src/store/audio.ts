import { signal } from '@preact/signals';
import type { Signal } from '@preact/signals';
import type { AudioFormat } from '@ainote/protocols';

export type PlaybackState = 'idle' | 'playing' | 'paused';

export class AudioStore {
  readonly visible:        Signal<boolean>                = signal(false);
  readonly codec:          Signal<AudioFormat | undefined> = signal(undefined);
  readonly playbackState:  Signal<PlaybackState>          = signal('idle');
  readonly currentTime:    Signal<number>                 = signal(0);
  readonly duration:       Signal<number | null>          = signal(null);
}
