import type { AudioCodec } from './types.js';

/**
 * Streaming MP3 decoder for live BLE audio (MPEG V2 L3, 32kbps 16kHz mono).
 *
 * Strategy:
 *  1. Buffer incoming BLE notification bytes.
 *  2. Find the first MPEG sync word (FF F2/F3) to align the stream.
 *  3. Collect batches of complete 288-byte frames.
 *  4. Decode via decodeAudioData on a serialised promise chain so batches
 *     are always scheduled in arrival order, even though decode is async.
 */
export class Mp3StreamCodec implements AudioCodec {
  readonly sampleRate = 16000;
  readonly streaming = true;

  private static readonly FRAME_BYTES = 288;
  private static readonly BATCH_FRAMES = 14;

  private _onPcm: ((f32: Float32Array, sr: number) => void) | null = null;
  private _buf = new Uint8Array(0);
  private _ctx: AudioContext | null = null;
  private _synced = false;
  private _decodeChain = Promise.resolve();

  constructor(private readonly _getAudioContext: () => AudioContext) {}

  open(onPcm?: (f32: Float32Array, sr: number) => void): void {
    this._onPcm = onPcm ?? null;
    this._ctx = this._getAudioContext();
    this._buf = new Uint8Array(0);
    this._synced = false;
    this._decodeChain = Promise.resolve();
    console.log('[Mp3Stream] opened');
  }

  decode(bytes: Uint8Array): Float32Array | null {
    const tmp = new Uint8Array(this._buf.length + bytes.length);
    tmp.set(this._buf);
    tmp.set(bytes, this._buf.length);
    this._buf = tmp;

    if (!this._synced) {
      const idx = this._findSync(this._buf);
      if (idx < 0) {
        this._buf = this._buf.length > 0 ? this._buf.slice(-1) : new Uint8Array(0);
        return null;
      }
      if (idx > 0) console.log(`[Mp3Stream] sync word found at offset ${idx}, discarding ${idx}B of preamble`);
      this._buf = this._buf.slice(idx);
      this._synced = true;
    }

    const batchSize = Mp3StreamCodec.FRAME_BYTES * Mp3StreamCodec.BATCH_FRAMES;
    while (this._buf.length >= batchSize) {
      const batch = this._buf.slice(0, batchSize);
      this._buf = this._buf.slice(batchSize);
      this._decodeChain = this._decodeChain.then(() => this._decodeAudio(batch));
    }
    return null;
  }

  close(): void {
    console.log('[Mp3Stream] closed');
    this._buf = new Uint8Array(0);
    this._onPcm = null;
    this._ctx = null;
    this._synced = false;
    this._decodeChain = Promise.resolve();
  }

  private _findSync(buf: Uint8Array): number {
    for (let i = 0; i < buf.length - 1; i++) {
      if (buf[i] === 0xFF && (buf[i + 1] === 0xF2 || buf[i + 1] === 0xF3)) return i;
    }
    return -1;
  }

  private async _decodeAudio(data: Uint8Array): Promise<void> {
    const ctx = this._ctx;
    const onPcm = this._onPcm;
    if (!ctx || !onPcm) return;
    try {
      const decoded = await ctx.decodeAudioData(data.buffer.slice(0, data.byteLength) as ArrayBuffer);
      console.log(`[Mp3Stream] decoded ${data.length}B -> ${decoded.duration.toFixed(2)}s @ ${decoded.sampleRate}Hz`);
      onPcm(decoded.getChannelData(0), decoded.sampleRate);
    } catch (error) {
      const head = Array.from(data.slice(0, 4)).map(byte => byte.toString(16).padStart(2, '0')).join(' ');
      console.warn(`[Mp3Stream] decodeAudioData failed (${data.length}B, head=[${head}]):`, error);
      this._synced = false;
      this._buf = new Uint8Array(0);
    }
  }
}
