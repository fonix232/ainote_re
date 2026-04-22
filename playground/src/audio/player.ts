/**
 * AudioPlayer — single entry point for all audio I/O.
 */
import { OpusCodec } from './codec/opus.js';
import { SbcCodec } from './codec/sbc.js';
import { SpeexCodec } from './codec/speex.js';
import { Mp3StreamCodec } from './codec/mp3.js';
import type { AudioCodec } from './codec/types.js';
import type { AudioFormat } from '@ainote/protocols';
import { store } from '../store/index.js';
import { whisper } from './whisper.js';

export interface PlaybackFile {
  data: Uint8Array;
  raw: Uint8Array;
  format: AudioFormat;
}

const LOOKAHEAD = 0.05;
const BAND_RANGES: readonly [number, number][] = [
  [1, 1], [2, 2], [3, 3], [4, 4], [5, 5], [6, 6],
  [7, 8], [9, 10], [11, 13], [14, 16], [17, 20], [21, 25],
  [26, 30], [31, 35], [36, 39], [40, 42],
];

function sbcFrameSize(data: Uint8Array): number | null {
  if (data.length < 4 || data[0] !== 0x9C) return null;
  const b = data[1]!;
  const nblks = ([4, 8, 12, 16] as const)[(b >> 4) & 0x3]!;
  const mode = (b >> 2) & 0x3;
  const channels = mode === 0 ? 1 : 2;
  const subbands = ([4, 8] as const)[b & 0x1]!;
  const bitpool = data[2]!;
  if (mode === 3) return 4 + Math.floor(4 * subbands * channels / 8) + Math.ceil((nblks * bitpool + subbands) / 8);
  return 4 + Math.floor(4 * subbands * channels / 8) + Math.ceil(nblks * channels * bitpool / 8);
}

export class AudioPlayer {
  private _ctx: AudioContext | null = null;
  private _analyser: AnalyserNode | null = null;
  private _sources: AudioBufferSourceNode[] = [];
  private _animFrame: number | null = null;
  private _nextTime = 0;
  private _endTimer: ReturnType<typeof setTimeout> | null = null;
  private _lastPlayed: PlaybackFile | null = null;
  private _lastBuffer: AudioBuffer | null = null;
  private _lastPcm: { data: Float32Array; sampleRate: number } | null = null;
  private _playStartCtxTime = 0;
  private _codec: AudioCodec | null = null;
  private _pushFrameCount = 0;
  private readonly _smoothed = new Float32Array(16);

  ensureAudioCtx(_sampleRate = 48000): AudioContext {
    if (!this._ctx || this._ctx.state === 'closed') {
      this._ctx = new AudioContext({ sampleRate: 48000 });
      this._analyser = this._ctx.createAnalyser();
      this._analyser.fftSize = 256;
      this._analyser.smoothingTimeConstant = 0.75;
      this._analyser.connect(this._ctx.destination);
    }
    if (this._ctx.state === 'suspended') void this._ctx.resume();
    return this._ctx;
  }

  scheduleF32(f32: Float32Array, sampleRate = 48000): void {
    const ctx = this.ensureAudioCtx();
    const buf = ctx.createBuffer(1, f32.length, sampleRate);
    buf.copyToChannel(f32 as unknown as Float32Array<ArrayBuffer>, 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this._analyser ?? ctx.destination);
    src.onended = () => { this._sources = this._sources.filter(source => source !== src); };
    this._sources.push(src);
    const when = Math.max(ctx.currentTime + LOOKAHEAD, this._nextTime);
    src.start(when);
    this._nextTime = when + buf.duration;
  }

  startVisualizer(): void {
    if (this._animFrame !== null) cancelAnimationFrame(this._animFrame);
    if (!this._analyser) return;
    this._analyser.smoothingTimeConstant = 0.85;
    const analyser = this._analyser;
    const freqData = new Uint8Array(analyser.frequencyBinCount);

    const loop = () => {
      this._animFrame = requestAnimationFrame(loop);
      analyser.getByteFrequencyData(freqData);

      if (this._ctx) {
        const elapsed = Math.max(0, this._ctx.currentTime - this._playStartCtxTime);
        const duration = store.audio.duration.value;
        store.audio.currentTime.value = duration != null ? Math.min(elapsed, duration) : elapsed;
      }

      const canvas = (window as unknown as { __waveformCanvas?: HTMLCanvasElement }).__waveformCanvas
        ?? document.getElementById('waveform') as HTMLCanvasElement | null;
      if (!canvas) return;
      const ctx2d = canvas.getContext('2d');
      if (!ctx2d) return;
      const width = canvas.width;
      const height = canvas.height;

      ctx2d.fillStyle = '#0d1117';
      ctx2d.fillRect(0, 0, width, height);

      const barWidth = width / 16;
      const pad = 2;
      const innerWidth = barWidth - pad * 2;
      const radius = innerWidth / 2;
      const halfHeight = height / 2;

      for (let band = 0; band < 16; band++) {
        const range = BAND_RANGES[band];
        if (!range) continue;
        const [lo, hi] = range;
        let sum = 0;
        for (let k = lo; k <= hi; k++) sum += freqData[k] ?? 0;
        const avg = sum / (hi - lo + 1) / 255;
        this._smoothed[band] = avg > (this._smoothed[band] ?? 0)
          ? avg * 0.5 + (this._smoothed[band] ?? 0) * 0.5
          : (this._smoothed[band] ?? 0) * 0.78;

        const level = this._smoothed[band] ?? 0;
        const barHeight = Math.max(radius, level * halfHeight);
        const x = band * barWidth + pad;
        const alpha = 0.4 + level * 0.6;
        ctx2d.fillStyle = `rgba(59,130,246,${alpha.toFixed(2)})`;
        ctx2d.beginPath();
        ctx2d.roundRect(x, halfHeight - barHeight, innerWidth, barHeight, [radius, radius, 0, 0]);
        ctx2d.fill();
        ctx2d.beginPath();
        ctx2d.roundRect(x, halfHeight, innerWidth, barHeight, [0, 0, radius, radius]);
        ctx2d.fill();
      }

      ctx2d.fillStyle = 'rgba(59,130,246,0.10)';
      ctx2d.fillRect(0, halfHeight, width, 1);
    };

    loop();
  }

  stopVisualizer(): void {
    if (this._animFrame !== null) {
      cancelAnimationFrame(this._animFrame);
      this._animFrame = null;
    }
    this._smoothed.fill(0);
  }

  async pausePlayback(): Promise<void> {
    await this._ctx?.suspend();
    store.audio.playbackState.value = 'paused';
  }

  async resumePlayback(): Promise<void> {
    await this._ctx?.resume();
    store.audio.playbackState.value = 'playing';
  }

  isPlaybackPaused(): boolean {
    return this._ctx?.state === 'suspended';
  }

  startStreaming(format: AudioFormat): void {
    console.log(`[player] startStreaming: format=${format.slug}, codec=${format.codec.type}`);
    this.stop();
    this._codec = this._makeCodec(format);
    const ctx = this.ensureAudioCtx();
    this._resetClock();
    this._playStartCtxTime = ctx.currentTime;
    this._pushFrameCount = 0;
    store.audio.duration.value = null;
    whisper.resetLive(format.codec.sampleRate ?? 16000);
    this._codec.open((f32, sampleRate) => {
      this.scheduleF32(f32, sampleRate);
      whisper.pushLivePcm(f32, sampleRate);
    });
    this.startVisualizer();
    store.audio.playbackState.value = 'playing';
  }

  pushFrame(bytes: Uint8Array): void {
    if (!this._codec) {
      if (this._pushFrameCount === 0) console.warn('[player] pushFrame: no active codec - startStreaming was not called');
      this._pushFrameCount++;
      return;
    }
    this._pushFrameCount++;
    if (this._pushFrameCount === 1) console.log(`[player] pushFrame: first frame (${bytes.length}B)`);
    else if (this._pushFrameCount % 100 === 0) console.log(`[player] pushFrame #${this._pushFrameCount} (${bytes.length}B)`);
    const pcm = this._codec.decode(bytes);
    if (pcm) {
      this.scheduleF32(pcm, this._codec.sampleRate);
      whisper.pushLivePcm(pcm, this._codec.sampleRate);
    }
  }

  stop(): void {
    if (this._endTimer !== null) {
      clearTimeout(this._endTimer);
      this._endTimer = null;
    }
    this._codec?.close();
    this._codec = null;
    for (const source of this._sources) {
      try { source.stop(); } catch { }
    }
    this._sources = [];
    this.stopVisualizer();
    store.audio.playbackState.value = 'idle';
    store.audio.currentTime.value = 0;
    store.audio.duration.value = null;
    this._playStartCtxTime = 0;
    this._lastPcm = null;
  }

  async playFileDownload(fd: PlaybackFile): Promise<void> {
    const { data, format } = fd;
    const { type, sampleRate = 16000, frameBytes } = format.codec;
    if (data.length === 0) {
      console.warn('[playFileDownload] empty payload');
      return;
    }
    if (type === 'sbc' && data.length < 40) {
      console.warn(`[playFileDownload] SBC payload too short: ${data.length}B - clear browser cache and re-download`);
      return;
    }

    this.stop();
    this._lastPlayed = fd;
    const ctx = this.ensureAudioCtx();
    if (ctx.state !== 'running') await ctx.resume();

    const pcmChunks: Float32Array[] = [];
    let playDuration = 0;

    if (type === 'speex') {
      const codec = new SpeexCodec();
      await codec.decodeAll(data, f32 => { pcmChunks.push(new Float32Array(f32)); });
      if (pcmChunks.length === 0) {
        console.warn('[playFileDownload] Speex produced 0 PCM frames');
        store.audio.playbackState.value = 'idle';
        return;
      }
      playDuration = this._playPcmChunks(pcmChunks, sampleRate);
    } else if (type === 'sbc') {
      const frameSize = sbcFrameSize(data) ?? frameBytes ?? 40;
      console.log('[player] SBC data[0..7]:', Array.from(data.slice(0, 8)).map((byte: number) => byte.toString(16).padStart(2, '0')).join(' '), `frame_size=${frameSize}`);
      const codec = new SbcCodec(sampleRate);
      codec.open();
      let index = 0;
      while (index + frameSize <= data.length) {
        if (data[index] !== 0x9C) { index += frameSize; continue; }
        const pcm = codec.decode(data.subarray(index, index + frameSize));
        if (pcm) pcmChunks.push(new Float32Array(pcm));
        index += frameSize;
      }
      codec.close();
      console.log(`[playFileDownload] SBC: data=${data.length}B fb=${frameSize} frames=${pcmChunks.length}`);
      playDuration = this._playPcmChunks(pcmChunks, sampleRate);
    } else if (type === 'passthrough') {
      const arrayBuf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
      const decoded = await ctx.decodeAudioData(arrayBuf as ArrayBuffer);
      this._lastBuffer = decoded;
      this._startBuffer(decoded);
      playDuration = decoded.duration;
    } else {
      const frameSize = frameBytes ?? 160;
      const codec = new OpusCodec();
      codec.open(f32 => { pcmChunks.push(new Float32Array(f32)); });
      for (let index = 0; index + frameSize <= data.length; index += frameSize) {
        codec.decode(data.subarray(index, index + frameSize));
      }
      await codec.flush?.();
      codec.close();
      playDuration = this._playPcmChunks(pcmChunks, sampleRate);
    }

    this._playStartCtxTime = ctx.currentTime + LOOKAHEAD;
    store.audio.duration.value = playDuration > 0 ? playDuration : null;
    this.startVisualizer();
    store.audio.playbackState.value = 'playing';
    this._endTimer = setTimeout(() => {
      this._endTimer = null;
      store.audio.playbackState.value = 'idle';
    }, playDuration * 1000 + 300);

    if (whisper.enabled.value && this._lastPcm) {
      void whisper.transcribeFile(this._lastPcm.data, this._lastPcm.sampleRate);
    }
  }

  async replay(): Promise<void> {
    if (this._lastPlayed) await this.playFileDownload(this._lastPlayed);
  }

  seekTo(seconds: number): void {
    if (!this._lastBuffer) return;
    const offset = Math.max(0, Math.min(seconds, this._lastBuffer.duration - 0.05));
    const remaining = this._lastBuffer.duration - offset;

    if (this._endTimer !== null) {
      clearTimeout(this._endTimer);
      this._endTimer = null;
    }
    for (const source of this._sources) {
      try { source.stop(); } catch { }
    }
    this._sources = [];

    const ctx = this.ensureAudioCtx();
    this._startBuffer(this._lastBuffer, offset);
    this._playStartCtxTime = ctx.currentTime + LOOKAHEAD - offset;
    store.audio.currentTime.value = offset;
    store.audio.playbackState.value = 'playing';

    this._endTimer = setTimeout(() => {
      this._endTimer = null;
      store.audio.playbackState.value = 'idle';
    }, remaining * 1000 + 300);
  }

  private _resetClock(): void {
    this._nextTime = 0;
    this._sources = [];
  }

  private _makeCodec(format: AudioFormat): AudioCodec {
    const { type, sampleRate = 48000 } = format.codec;
    switch (type) {
      case 'sbc':
        return new SbcCodec(sampleRate);
      case 'speex':
        return new SpeexCodec() as unknown as AudioCodec;
      case 'passthrough':
        return new Mp3StreamCodec(() => this.ensureAudioCtx());
      default:
        return new OpusCodec();
    }
  }

  private _playPcmChunks(chunks: Float32Array[], sampleRate: number): number {
    if (chunks.length === 0) return 0;
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const merged = new Float32Array(totalLength);
    let position = 0;
    for (const chunk of chunks) {
      merged.set(chunk, position);
      position += chunk.length;
    }
    this._lastPcm = { data: merged, sampleRate };

    const ctx = this.ensureAudioCtx();
    const buf = ctx.createBuffer(1, merged.length, sampleRate);
    buf.copyToChannel(merged as unknown as Float32Array<ArrayBuffer>, 0);
    this._lastBuffer = buf;
    return this._startBuffer(buf);
  }

  private _startBuffer(buf: AudioBuffer, offsetSec = 0): number {
    const ctx = this.ensureAudioCtx();
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this._analyser ?? ctx.destination);
    src.onended = () => { this._sources = this._sources.filter(source => source !== src); };
    this._sources.push(src);
    src.start(ctx.currentTime + LOOKAHEAD, offsetSec);
    return buf.duration;
  }
}

export const audioPlayer = new AudioPlayer();

export function ensureAudioCtx(sampleRate = 48000): AudioContext {
  return audioPlayer.ensureAudioCtx(sampleRate);
}

export function scheduleF32(f32: Float32Array, sampleRate = 48000): void {
  audioPlayer.scheduleF32(f32, sampleRate);
}

export function startVisualizer(): void {
  audioPlayer.startVisualizer();
}

export function stopVisualizer(): void {
  audioPlayer.stopVisualizer();
}

export function pausePlayback(): Promise<void> {
  return audioPlayer.pausePlayback();
}

export function resumePlayback(): Promise<void> {
  return audioPlayer.resumePlayback();
}

export function isPlaybackPaused(): boolean {
  return audioPlayer.isPlaybackPaused();
}

export function startStreaming(format: AudioFormat): void {
  audioPlayer.startStreaming(format);
}

export function pushFrame(bytes: Uint8Array): void {
  audioPlayer.pushFrame(bytes);
}

export function stop(): void {
  audioPlayer.stop();
}

export function playFileDownload(fd: PlaybackFile): Promise<void> {
  return audioPlayer.playFileDownload(fd);
}

export function replay(): Promise<void> {
  return audioPlayer.replay();
}

export function seekTo(seconds: number): void {
  audioPlayer.seekTo(seconds);
}
