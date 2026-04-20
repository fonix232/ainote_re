/**
 * Opus codec adapter (WebCodecs AudioDecoder — Chrome 94+).
 * Output is delivered asynchronously via the onPcm callback passed to open().
 */
import type { AudioCodec } from './types.js';

// OpusHead binary descriptor required by Chrome's AudioDecoder for raw Opus.
// https://wiki.xiph.org/OggOpus#ID_Header
const OPUS_HEAD = new Uint8Array([
  0x4F, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64, // "OpusHead"
  0x01,             // version
  0x01,             // channels = 1 (mono)
  0x00, 0x00,       // pre-skip = 0
  0x80, 0x3E, 0x00, 0x00, // input sample rate = 16000 LE
  0x00, 0x00,       // output gain = 0
  0x00,             // channel mapping = RTP
]);

export class OpusCodec implements AudioCodec {
  readonly sampleRate = 16000;
  readonly streaming  = true;

  #decoder:   AudioDecoder | null = null;
  #onPcm:     ((f32: Float32Array, sampleRate: number) => void) | null = null;
  #timestamp  = 0;

  open(onPcm?: (f32: Float32Array, sampleRate: number) => void): void {
    if (typeof AudioDecoder === 'undefined') {
      console.warn('[OpusCodec] WebCodecs AudioDecoder not available (Chrome 94+ required)');
      return;
    }
    this.close();
    this.#timestamp = 0;
    this.#onPcm = onPcm ?? null;
    this.#decoder = new AudioDecoder({
      output: (audioData) => {
        const n   = audioData.numberOfFrames;
        const f32 = new Float32Array(n);
        audioData.copyTo(f32, { planeIndex: 0, format: 'f32' });
        audioData.close();
        // Opus WebCodecs always outputs at 48 kHz internally; audioData.sampleRate
        // may be 0 in some Chrome builds but is typically 48000 for raw Opus.
        // Fall back to 48000, NOT the configured 16000, to avoid 3× slowdown.
        this.#onPcm?.(f32, audioData.sampleRate || 48000);
      },
      error: (e) => { console.error('[OpusCodec] decode error:', e); },
    });
    // Raw Opus packets — no container description needed for WebCodecs
    this.#decoder.configure({ codec: 'opus', sampleRate: 16000, numberOfChannels: 1 });
    console.log('[OpusCodec] configured, state:', this.#decoder.state);
  }

  close(): void {
    try { this.#decoder?.close(); } catch { /* ignore */ }
    this.#decoder = null;
    this.#onPcm   = null;
  }

  decode(bytes: Uint8Array): null {
    if (!this.#decoder) return null;
    // Copy to avoid byteOffset issues with subarray views
    const packet = bytes.byteOffset !== 0 ? bytes.slice() : bytes;
    this.#decoder.decode(new EncodedAudioChunk({ type: 'key', timestamp: this.#timestamp, data: packet }));
    this.#timestamp += 20_000; // 20 ms in µs
    return null; // async output via onPcm
  }

  async flush(): Promise<void> {
    try { await this.#decoder?.flush(); } catch { /* ignore */ }
  }
}
