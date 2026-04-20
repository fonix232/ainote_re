/**
 * AudioPlayer — single entry point for all audio I/O.
 */
import { OpusCodec } from './codec/opus.js';
import { SbcCodec } from './codec/sbc.js';
import { SpeexCodec } from './codec/speex.js';
import type { AudioCodec } from './codec/types.js';
import type { AudioFormat, FileDownload } from '@ainote/protocols';
import { store } from '../store/index.js';
import { whisper } from './whisper.js';

// ── AudioContext + AnalyserNode ──────────────────────────────────────────────

let _ctx:       AudioContext | null = null;
let _analyser:  AnalyserNode | null = null;
let _sources:   AudioBufferSourceNode[] = [];
let _animFrame: number | null = null;
let _nextTime   = 0;
let _endTimer:         ReturnType<typeof setTimeout> | null = null;
let _lastPlayed: FileDownload | null = null;
let _lastBuffer: AudioBuffer | null = null;
let _lastPcm: { data: Float32Array; sampleRate: number } | null = null;
let _playStartCtxTime = 0;
const LOOKAHEAD = 0.05;

export function ensureAudioCtx(_sampleRate = 48000): AudioContext {
  if (!_ctx || _ctx.state === 'closed') {
    _ctx      = new AudioContext({ sampleRate: 48000 });
    _analyser = _ctx.createAnalyser();
    _analyser.fftSize = 256;
    _analyser.smoothingTimeConstant = 0.75;
    _analyser.connect(_ctx.destination);
  }
  if (_ctx.state === 'suspended') void _ctx.resume();
  return _ctx;
}

function resetClock(): void { _nextTime = 0; _sources = []; }

export function scheduleF32(f32: Float32Array, sampleRate = 48000): void {
  const ctx = ensureAudioCtx();
  const buf = ctx.createBuffer(1, f32.length, sampleRate);
  buf.copyToChannel(f32 as unknown as Float32Array<ArrayBuffer>, 0);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(_analyser ?? ctx.destination);
  src.onended = () => { _sources = _sources.filter(s => s !== src); };
  _sources.push(src);
  const when = Math.max(ctx.currentTime + LOOKAHEAD, _nextTime);
  src.start(when);
  _nextTime = when + buf.duration;
}

// ── Frequency-band visualizer ─────────────────────────────────────────────────

const BAND_RANGES: readonly [number, number][] = [
  [1, 1], [2, 2], [3, 3], [4, 4], [5, 5], [6, 6],
  [7, 8], [9, 10], [11, 13], [14, 16], [17, 20], [21, 25],
  [26, 30], [31, 35], [36, 39], [40, 42],
];
const _smoothed = new Float32Array(16);

export function startVisualizer(): void {
  if (_animFrame !== null) cancelAnimationFrame(_animFrame);
  if (!_analyser) return;
  _analyser.smoothingTimeConstant = 0.85;
  const analyser = _analyser;
  const freqData = new Uint8Array(analyser.frequencyBinCount);

  const loop = () => {
    _animFrame = requestAnimationFrame(loop);
    analyser.getByteFrequencyData(freqData);

    if (_ctx) {
      const elapsed = Math.max(0, _ctx.currentTime - _playStartCtxTime);
      const dur = store.audio.duration.value;
      store.audio.currentTime.value = dur != null ? Math.min(elapsed, dur) : elapsed;
    }

    const canvas = (window as unknown as { __waveformCanvas?: HTMLCanvasElement }).__waveformCanvas
      ?? document.getElementById('waveform') as HTMLCanvasElement | null;
    if (!canvas) return;
    const ctx2d = canvas.getContext('2d')!;
    const W = canvas.width, H = canvas.height;

    ctx2d.fillStyle = '#0d1117';
    ctx2d.fillRect(0, 0, W, H);

    const barW  = W / 16;
    const PAD   = 2;
    const innerW = barW - PAD * 2;
    const r      = innerW / 2;
    const halfH  = H / 2;

    for (let b = 0; b < 16; b++) {
      const range = BAND_RANGES[b];
      if (!range) continue;
      const [lo, hi] = range;
      let sum = 0;
      for (let k = lo; k <= hi; k++) sum += freqData[k] ?? 0;
      const avg = sum / (hi - lo + 1) / 255;
      _smoothed[b] = avg > (_smoothed[b] ?? 0)
        ? avg * 0.5 + (_smoothed[b] ?? 0) * 0.5
        : (_smoothed[b] ?? 0) * 0.78;

      const level = _smoothed[b] ?? 0;
      const barH  = Math.max(r, level * halfH);
      const x     = b * barW + PAD;
      const alpha = 0.4 + level * 0.6;
      ctx2d.fillStyle = `rgba(59,130,246,${alpha.toFixed(2)})`;
      ctx2d.beginPath();
      ctx2d.roundRect(x, halfH - barH, innerW, barH, [r, r, 0, 0]);
      ctx2d.fill();
      ctx2d.beginPath();
      ctx2d.roundRect(x, halfH, innerW, barH, [0, 0, r, r]);
      ctx2d.fill();
    }

    ctx2d.fillStyle = 'rgba(59,130,246,0.10)';
    ctx2d.fillRect(0, halfH, W, 1);
  };

  loop();
}

export function stopVisualizer(): void {
  if (_animFrame !== null) { cancelAnimationFrame(_animFrame); _animFrame = null; }
  _smoothed.fill(0);
}

export async function pausePlayback(): Promise<void> {
  await _ctx?.suspend();
  store.audio.playbackState.value = 'paused';
}

export async function resumePlayback(): Promise<void> {
  await _ctx?.resume();
  store.audio.playbackState.value = 'playing';
}

export function isPlaybackPaused(): boolean {
  return _ctx?.state === 'suspended';
}

// ── SBC frame-size calculator ─────────────────────────────────────────────────

function sbcFrameSize(data: Uint8Array): number | null {
  if (data.length < 4 || data[0] !== 0x9C) return null;
  const b     = data[1]!;
  const nblks = ([4, 8, 12, 16] as const)[(b >> 4) & 0x3]!;
  const mode  = (b >> 2) & 0x3;
  const ch    = mode === 0 ? 1 : 2;
  const nsb   = ([4, 8] as const)[b & 0x1]!;
  const bp    = data[2]!;
  if (mode === 3) return 4 + Math.floor(4 * nsb * ch / 8) + Math.ceil((nblks * bp + nsb) / 8);
  return 4 + Math.floor(4 * nsb * ch / 8) + Math.ceil(nblks * ch * bp / 8);
}

// ── Codec factory ─────────────────────────────────────────────────────────────

/**
 * Streaming MP3 decoder for live BLE audio (MPEG V2 L3, 32kbps 16kHz mono).
 *
 * Strategy:
 *  1. Buffer incoming BLE notification bytes.
 *  2. Find the first MPEG sync word (FF F2/F3) to align the stream.
 *  3. Collect BATCH_FRAMES complete 288-byte frames at a time.
 *  4. Decode via decodeAudioData on a serialised promise chain so batches
 *     are always scheduled in arrival order, even though decode is async.
 */
class Mp3StreamCodec implements AudioCodec {
  readonly sampleRate = 16000;
  readonly streaming  = true;

  // MPEG V2 Layer III, 32kbps, 16kHz, mono: frame = 288 bytes ≈ 72 ms
  private static readonly FRAME_BYTES  = 288;
  private static readonly BATCH_FRAMES = 14; // ~1 s per batch

  private _onPcm: ((f32: Float32Array, sr: number) => void) | null = null;
  private _buf   = new Uint8Array(0);
  private _ctx:  AudioContext | null = null;
  private _synced = false;
  private _decodeChain = Promise.resolve(); // serialised: keeps batches in order

  open(onPcm?: (f32: Float32Array, sr: number) => void): void {
    this._onPcm   = onPcm ?? null;
    this._ctx     = ensureAudioCtx();
    this._buf     = new Uint8Array(0);
    this._synced  = false;
    this._decodeChain = Promise.resolve();
    console.log('[Mp3Stream] opened');
  }

  decode(bytes: Uint8Array): Float32Array | null {
    const tmp = new Uint8Array(this._buf.length + bytes.length);
    tmp.set(this._buf);
    tmp.set(bytes, this._buf.length);
    this._buf = tmp;

    // Align to first MPEG sync word (FF F2 / FF F3)
    if (!this._synced) {
      const idx = this._findSync(this._buf);
      if (idx < 0) {
        // Retain last byte in case it's the start of a split sync word
        this._buf = this._buf.length > 0 ? this._buf.slice(-1) : new Uint8Array(0);
        return null;
      }
      if (idx > 0) console.log(`[Mp3Stream] sync word found at offset ${idx}, discarding ${idx}B of preamble`);
      this._buf   = this._buf.slice(idx);
      this._synced = true;
    }

    const BATCH = Mp3StreamCodec.FRAME_BYTES * Mp3StreamCodec.BATCH_FRAMES;
    while (this._buf.length >= BATCH) {
      const batch = this._buf.slice(0, BATCH); // slice → own buffer
      this._buf   = this._buf.slice(BATCH);
      this._decodeChain = this._decodeChain.then(() => this._decodeAudio(batch));
    }
    return null;
  }

  private _findSync(buf: Uint8Array): number {
    // Accept FF F2 and FF F3 (MPEG V2 Layer III, with/without CRC)
    for (let i = 0; i < buf.length - 1; i++) {
      if (buf[i] === 0xFF && (buf[i + 1]! === 0xF2 || buf[i + 1]! === 0xF3)) return i;
    }
    return -1;
  }

  private async _decodeAudio(data: Uint8Array): Promise<void> {
    const ctx   = this._ctx;
    const onPcm = this._onPcm;
    if (!ctx || !onPcm) return;
    try {
      const decoded = await ctx.decodeAudioData(data.buffer.slice(0, data.byteLength) as ArrayBuffer);
      console.log(`[Mp3Stream] decoded ${data.length}B → ${decoded.duration.toFixed(2)}s @ ${decoded.sampleRate}Hz`);
      onPcm(decoded.getChannelData(0), decoded.sampleRate);
    } catch (e) {
      const head = Array.from(data.slice(0, 4)).map(b => b.toString(16).padStart(2, '0')).join(' ');
      console.warn(`[Mp3Stream] decodeAudioData failed (${data.length}B, head=[${head}]):`, e);
      // Re-sync on next decode() call
      this._synced = false;
      this._buf    = new Uint8Array(0);
    }
  }

  close(): void {
    console.log('[Mp3Stream] closed');
    this._buf   = new Uint8Array(0);
    this._onPcm = null;
    this._ctx   = null;
    this._synced = false;
    this._decodeChain = Promise.resolve();
  }
}

function makeCodec(format: AudioFormat): AudioCodec {
  const { type, sampleRate = 48000 } = format.codec;
  switch (type) {
    case 'sbc':         return new SbcCodec(sampleRate);
    case 'speex':       return new SpeexCodec() as unknown as AudioCodec;
    case 'passthrough': return new Mp3StreamCodec();
    default:            return new OpusCodec();
  }
}

// ── Active codec session (live BLE streaming) ─────────────────────────────────

let _codec: AudioCodec | null = null;
let _pushFrameCount = 0;

export function startStreaming(format: AudioFormat): void {
  console.log(`[player] startStreaming: format=${format.slug}, codec=${format.codec.type}`);
  stop();
  _codec = makeCodec(format);
  const ctx = ensureAudioCtx();
  resetClock();
  _playStartCtxTime = ctx.currentTime;
  _pushFrameCount = 0;
  store.audio.duration.value = null;
  whisper.resetLive(format.codec.sampleRate ?? 16000);
  _codec.open((f32, sr) => {
    scheduleF32(f32, sr);
    whisper.pushLivePcm(f32, sr);
  });
  startVisualizer();
  store.audio.playbackState.value = 'playing';
}

export function pushFrame(bytes: Uint8Array): void {
  if (!_codec) {
    if (_pushFrameCount === 0) console.warn('[player] pushFrame: no active codec — startStreaming was not called');
    _pushFrameCount++;
    return;
  }
  _pushFrameCount++;
  if (_pushFrameCount === 1) console.log(`[player] pushFrame: first frame (${bytes.length}B)`);
  else if (_pushFrameCount % 100 === 0) console.log(`[player] pushFrame #${_pushFrameCount} (${bytes.length}B)`);
  const pcm = _codec.decode(bytes);
  if (pcm) {
    scheduleF32(pcm, _codec.sampleRate);
    whisper.pushLivePcm(pcm, _codec.sampleRate);
  }
}

export function stop(): void {
  if (_endTimer !== null) { clearTimeout(_endTimer); _endTimer = null; }
  _codec?.close();
  _codec = null;
  for (const src of _sources) { try { src.stop(); } catch { /* already ended */ } }
  _sources = [];
  stopVisualizer();
  store.audio.playbackState.value = 'idle';
  store.audio.currentTime.value   = 0;
  store.audio.duration.value      = null;
  _playStartCtxTime               = 0;
  _lastPcm                        = null;
}

// ── File playback ─────────────────────────────────────────────────────────────

function playPcmChunks(chunks: Float32Array[], sampleRate: number): number {
  if (chunks.length === 0) return 0;
  const totalLen = chunks.reduce((s, c) => s + c.length, 0);
  const merged = new Float32Array(totalLen);
  let pos = 0;
  for (const c of chunks) { merged.set(c, pos); pos += c.length; }
  _lastPcm = { data: merged, sampleRate };

  const ctx = ensureAudioCtx();
  const buf = ctx.createBuffer(1, merged.length, sampleRate);
  buf.copyToChannel(merged as unknown as Float32Array<ArrayBuffer>, 0);
  _lastBuffer = buf;
  return _startBuffer(buf);
}

function _startBuffer(buf: AudioBuffer, offsetSec = 0): number {
  const ctx = ensureAudioCtx();
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(_analyser ?? ctx.destination);
  src.onended = () => { _sources = _sources.filter(s => s !== src); };
  _sources.push(src);
  src.start(ctx.currentTime + LOOKAHEAD, offsetSec);
  return buf.duration;
}

export async function playFileDownload(fd: FileDownload): Promise<void> {
  const { data, format } = fd;
  const { type, sampleRate = 16000, frameBytes } = format.codec;
  if (data.length === 0) { console.warn('[playFileDownload] empty payload'); return; }
  if (type === 'sbc' && data.length < 40) { console.warn(`[playFileDownload] SBC payload too short: ${data.length}B — clear browser cache and re-download`); return; }

  stop();
  _lastPlayed = fd;
  const ctx = ensureAudioCtx();
  if (ctx.state !== 'running') await ctx.resume();

  const pcmChunks: Float32Array[] = [];
  let playDuration = 0;

  if (type === 'speex') {
    const codec = new SpeexCodec();
    await codec.decodeAll(data, (f32) => { pcmChunks.push(new Float32Array(f32)); });
    if (pcmChunks.length === 0) {
      console.warn('[playFileDownload] Speex produced 0 PCM frames');
      store.audio.playbackState.value = 'idle';
      return;
    }
    playDuration = playPcmChunks(pcmChunks, sampleRate);
  } else if (type === 'sbc') {
    const fb = sbcFrameSize(data) ?? frameBytes ?? 40;
    console.log('[player] SBC data[0..7]:', Array.from(data.slice(0, 8)).map(b => b.toString(16).padStart(2,'0')).join(' '), `frame_size=${fb}`);
    const codec = new SbcCodec(sampleRate);
    codec.open();
    let i = 0;
    while (i + fb <= data.length) {
      if (data[i] !== 0x9C) { i += fb; continue; }
      const pcm = codec.decode(data.subarray(i, i + fb));
      if (pcm) pcmChunks.push(new Float32Array(pcm));
      i += fb;
    }
    codec.close();
    console.log(`[playFileDownload] SBC: data=${data.length}B fb=${fb} frames=${pcmChunks.length}`);
    playDuration = playPcmChunks(pcmChunks, sampleRate);
  } else if (type === 'passthrough') {
    const arrayBuf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    const decoded = await ctx.decodeAudioData(arrayBuf as ArrayBuffer);
    _lastBuffer = decoded;
    _startBuffer(decoded);
    playDuration = decoded.duration;
  } else {
    const fb = frameBytes ?? 160;
    const codec = new OpusCodec();
    codec.open((f32) => { pcmChunks.push(new Float32Array(f32)); });
    for (let i = 0; i + fb <= data.length; i += fb)
      codec.decode(data.subarray(i, i + fb));
    await codec.flush?.();
    codec.close();
    playDuration = playPcmChunks(pcmChunks, sampleRate);
  }

  _playStartCtxTime = ctx.currentTime + LOOKAHEAD;
  store.audio.duration.value = playDuration > 0 ? playDuration : null;
  startVisualizer();
  store.audio.playbackState.value = 'playing';
  _endTimer = setTimeout(() => {
    _endTimer = null;
    store.audio.playbackState.value = 'idle';
  }, playDuration * 1000 + 300);

  // Auto-transcribe file when whisper is enabled
  if (whisper.enabled.value && _lastPcm) {
    void whisper.transcribeFile(_lastPcm.data, _lastPcm.sampleRate);
  }
}

export async function replay(): Promise<void> {
  if (_lastPlayed) await playFileDownload(_lastPlayed);
}

export function seekTo(seconds: number): void {
  if (!_lastBuffer) return;
  const offset = Math.max(0, Math.min(seconds, _lastBuffer.duration - 0.05));
  const remaining = _lastBuffer.duration - offset;

  // Stop current sources without clearing _lastBuffer
  if (_endTimer !== null) { clearTimeout(_endTimer); _endTimer = null; }
  for (const src of _sources) { try { src.stop(); } catch { /* already ended */ } }
  _sources = [];

  const ctx = ensureAudioCtx();
  _startBuffer(_lastBuffer, offset);
  _playStartCtxTime = ctx.currentTime + LOOKAHEAD - offset;
  store.audio.currentTime.value   = offset;
  store.audio.playbackState.value = 'playing';

  _endTimer = setTimeout(() => {
    _endTimer = null;
    store.audio.playbackState.value = 'idle';
  }, remaining * 1000 + 300);
}
