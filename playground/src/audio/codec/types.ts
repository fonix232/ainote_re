/** Codec interface implemented by SbcCodec and OpusCodec. */
export interface AudioCodec {
  readonly sampleRate: number;
  readonly streaming: boolean;
  /** SBC: synchronous — returns PCM. Opus: async via onPcm callback. */
  open(onPcm?: (f32: Float32Array, sampleRate: number) => void): void;
  close(): void;
  decode(bytes: Uint8Array): Float32Array | null;
  flush?(): Promise<void>;
}
