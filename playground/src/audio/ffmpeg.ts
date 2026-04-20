/**
 * FFmpegWrapper — lazy-loaded WASM FFmpeg with a high-level audio conversion API.
 *
 * Uses @ffmpeg/ffmpeg 0.12.x with the single-threaded core (no SharedArrayBuffer
 * / cross-origin isolation required).
 */
import { FFmpeg } from '@ffmpeg/ffmpeg';

const CORE_URL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.js';
const WASM_URL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.wasm';

export type ProgressCallback = (msg: string) => void;

export class FFmpegWrapper {
  private _ff: FFmpeg | null = null;
  private _loading: Promise<FFmpeg> | null = null;

  /** Lazily load the WASM core (safe to call multiple times). */
  async load(): Promise<void> {
    await this._get();
  }

  get isLoaded(): boolean {
    return this._ff !== null;
  }

  private async _get(): Promise<FFmpeg> {
    if (this._ff) return this._ff;
    if (this._loading) return this._loading;

    this._loading = (async () => {
      const ff = new FFmpeg();
      ff.on('log', ({ message }) => console.debug('[ffmpeg-wasm]', message));
      await ff.load({ coreURL: CORE_URL, wasmURL: WASM_URL });
      this._ff = ff;
      this._loading = null;
      return ff;
    })();

    return this._loading;
  }

  /**
   * Decode a raw SBC bitstream to Float32 PCM using FFmpeg WASM.
   *
   * The input must be a standard SBC bitstream (device header stripped and any
   * XOR decode already applied by the protocol layer).
   *
   * @param sbcBytes   Raw SBC bitstream
   * @param sampleRate Target sample rate (default 16000)
   * @param onProgress Optional status callback
   */
  async sbcToFloat32(
    sbcBytes: Uint8Array,
    sampleRate = 16000,
    onProgress?: ProgressCallback,
  ): Promise<Float32Array> {
    return this._convertToFloat32(
      sbcBytes,
      'input.sbc',
      ['-f', 'sbc', '-c:a', 'sbc', '-i', 'input.sbc'],
      sampleRate,
      onProgress,
    );
  }

  /**
   * Decode any audio format that FFmpeg supports (MP3, AAC, FLAC, …) to
   * Float32 PCM. FFmpeg auto-detects the format.
   *
   * @param bytes      Raw audio bytes
   * @param sampleRate Target sample rate
   * @param onProgress Optional status callback
   */
  async decodeToFloat32(
    bytes: Uint8Array,
    sampleRate = 48000,
    onProgress?: ProgressCallback,
  ): Promise<Float32Array> {
    return this._convertToFloat32(
      bytes,
      'input.bin',
      ['-i', 'input.bin'],
      sampleRate,
      onProgress,
    );
  }

  /**
   * Re-encode Float32 PCM to MP3 bytes.
   *
   * @param f32        Mono interleaved Float32 PCM
   * @param sampleRate Input sample rate
   * @param bitrate    Target bitrate in kbps (default 128)
   * @param onProgress Optional status callback
   */
  async float32ToMp3(
    f32: Float32Array,
    sampleRate = 48000,
    bitrate = 128,
    onProgress?: ProgressCallback,
  ): Promise<Uint8Array> {
    const ff = await this._get();
    const pcm = new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength);

    onProgress?.('Writing PCM…');
    await ff.writeFile('input.pcm', pcm);

    onProgress?.('Encoding MP3…');
    const ret = await ff.exec([
      '-f', 'f32le', '-ar', String(sampleRate), '-ac', '1',
      '-i', 'input.pcm',
      '-b:a', `${bitrate}k`,
      '-y', 'output.mp3',
    ]);
    if (ret !== 0) throw new Error(`FFmpeg exited with code ${ret}`);

    onProgress?.('Reading output…');
    const out = await ff.readFile('output.mp3') as Uint8Array;

    await ff.deleteFile('input.pcm').catch(() => undefined);
    await ff.deleteFile('output.mp3').catch(() => undefined);

    onProgress?.('Done.');
    return out;
  }

  /**
   * Re-encode Float32 PCM to WAV bytes.
   *
   * @param f32        Mono interleaved Float32 PCM
   * @param sampleRate Input sample rate
   * @param onProgress Optional status callback
   */
  async float32ToWav(
    f32: Float32Array,
    sampleRate = 48000,
    onProgress?: ProgressCallback,
  ): Promise<Uint8Array> {
    const ff = await this._get();
    const pcm = new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength);

    onProgress?.('Writing PCM…');
    await ff.writeFile('input.pcm', pcm);

    onProgress?.('Encoding WAV…');
    const ret = await ff.exec([
      '-f', 'f32le', '-ar', String(sampleRate), '-ac', '1',
      '-i', 'input.pcm',
      '-y', 'output.wav',
    ]);
    if (ret !== 0) throw new Error(`FFmpeg exited with code ${ret}`);

    onProgress?.('Reading output…');
    const out = await ff.readFile('output.wav') as Uint8Array;

    await ff.deleteFile('input.pcm').catch(() => undefined);
    await ff.deleteFile('output.wav').catch(() => undefined);

    onProgress?.('Done.');
    return out;
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  private async _convertToFloat32(
    input: Uint8Array,
    inputFilename: string,
    inputArgs: string[],
    sampleRate: number,
    onProgress?: ProgressCallback,
  ): Promise<Float32Array> {
    const ff = await this._get();

    onProgress?.('Writing input…');
    await ff.writeFile(inputFilename, input);

    onProgress?.('Decoding…');
    const ret = await ff.exec([
      ...inputArgs,
      '-f', 'f32le',
      '-ar', String(sampleRate),
      '-ac', '1',
      '-y', 'output.pcm',
    ]);
    if (ret !== 0) throw new Error(`FFmpeg exited with code ${ret}`);

    onProgress?.('Reading PCM…');
    const raw = await ff.readFile('output.pcm') as Uint8Array;

    await ff.deleteFile(inputFilename).catch(() => undefined);
    await ff.deleteFile('output.pcm').catch(() => undefined);

    onProgress?.('Done.');
    return new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
  }
}

/** Shared singleton — reuses the loaded WASM core across all callers. */
export const ffmpeg = new FFmpegWrapper();
