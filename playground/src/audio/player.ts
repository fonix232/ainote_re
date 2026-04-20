/**
 * AudioPlayer — single entry point for all audio I/O.
 */
import { OpusCodec } from './codec/opus.js';
import { SbcCodec } from './codec/sbc.js';
import { SpeexCodec } from './codec/speex.js';
import type { AudioCodec } from './codec/types.js';
import type { AudioFormat, FileDownload } from '@ainote/protocols';
import { store } from '../store/index.js';

// ── AudioContext + AnalyserNode ──────────────────────────────────────────────

let _ctx:       AudioContext | null = null;
let _analyser:  AnalyserNode | null = null;
let _sources:   AudioBufferSourceNode[] = [];
let _animFrame: number | null = null;
let _nextTime   = 0;
let _endTimer:         ReturnType<typeof setTimeout> | null = null;
let _lastPlayed: FileDownload | null = null;
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

function makeCodec(format: AudioFormat): AudioCodec {
  const { type, sampleRate = 48000 } = format.codec;
  switch (type) {
    case 'sbc':   return new SbcCodec(sampleRate);
    case 'speex': return new SpeexCodec() as unknown as AudioCodec;
    default:      return new OpusCodec();
  }
}

// ── Active codec session (live BLE streaming) ─────────────────────────────────

let _codec: AudioCodec | null = null;

export function startStreaming(format: AudioFormat): void {
  stop();
  _codec = makeCodec(format);
  const ctx = ensureAudioCtx();
  resetClock();
  _playStartCtxTime = ctx.currentTime;
  store.audio.duration.value = null;
  _codec.open((f32, sr) => scheduleF32(f32, sr));
  startVisualizer();
  store.audio.playbackState.value = 'playing';
}

export function pushFrame(bytes: Uint8Array): void {
  if (!_codec) return;
  const pcm = _codec.decode(bytes);
  if (pcm) scheduleF32(pcm, _codec.sampleRate);
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
}

// ── File playback ─────────────────────────────────────────────────────────────

function playPcmChunks(chunks: Float32Array[], sampleRate: number): number {
  if (chunks.length === 0) return 0;
  const totalLen = chunks.reduce((s, c) => s + c.length, 0);
  const merged = new Float32Array(totalLen);
  let pos = 0;
  for (const c of chunks) { merged.set(c, pos); pos += c.length; }

  const ctx = ensureAudioCtx();
  const buf = ctx.createBuffer(1, merged.length, sampleRate);
  buf.copyToChannel(merged as unknown as Float32Array<ArrayBuffer>, 0);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(_analyser ?? ctx.destination);
  src.onended = () => { _sources = _sources.filter(s => s !== src); };
  _sources.push(src);
  src.start(ctx.currentTime + LOOKAHEAD);
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
    const src = ctx.createBufferSource();
    src.buffer = decoded;
    src.connect(_analyser ?? ctx.destination);
    src.onended = () => { _sources = _sources.filter(s => s !== src); };
    _sources.push(src);
    src.start(ctx.currentTime + LOOKAHEAD);
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
}

export async function replay(): Promise<void> {
  if (_lastPlayed) await playFileDownload(_lastPlayed);
}
