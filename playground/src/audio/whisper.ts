/**
 * WhisperService — main-thread client for the whisper Web Worker.
 *
 * Usage:
 *   whisper.enable()                    // load model (lazy, one-time)
 *   whisper.transcribeFile(f32, sr)     // transcribe a decoded audio buffer
 *   whisper.pushLivePcm(f32, sr)        // called per-frame during live streaming
 *   whisper.resetLive()                 // call when streaming starts/stops
 */

import { signal } from '@preact/signals-core';

export type WhisperStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface TranscriptChunk {
  text:       string;
  startSec?:  number | null;
  endSec?:    number | null;
}

type WorkerMsg = { id?: number; type: string; payload?: unknown };
type ProgressInfo = { status: string; name?: string; file?: string; progress?: number };

const DEFAULT_MODEL = 'onnx-community/whisper-tiny';

// ── Resample to 16 kHz using OfflineAudioContext ──────────────────────────────
// Whisper expects mono float32 at 16 kHz.

async function resampleTo16k(f32: Float32Array, fromRate: number): Promise<Float32Array> {
  if (fromRate === 16000) return f32;
  const targetLen = Math.round(f32.length * 16000 / fromRate);
  const offCtx = new OfflineAudioContext(1, targetLen, 16000);
  const buf = offCtx.createBuffer(1, f32.length, fromRate);
  buf.copyToChannel(f32 as unknown as Float32Array<ArrayBuffer>, 0);
  const src = offCtx.createBufferSource();
  src.buffer = buf;
  src.connect(offCtx.destination);
  src.start();
  const rendered = await offCtx.startRendering();
  return new Float32Array(rendered.getChannelData(0));
}

// ── Service ───────────────────────────────────────────────────────────────────

class WhisperService {
  // ── Public signals ─────────────────────────────────────────────────────────
  readonly status       = signal<WhisperStatus>('idle');
  readonly loadProgress = signal<string>('');
  readonly transcript   = signal<TranscriptChunk[]>([]);
  readonly busy         = signal<boolean>(false);
  readonly enabled      = signal<boolean>(false);

  // ── Internals ──────────────────────────────────────────────────────────────
  private _worker:  Worker | null = null;
  private _nextId   = 1;
  private _pending  = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  // Live PCM accumulation
  private _liveBuf:    Float32Array[] = [];
  private _liveDurSec  = 0;
  private _liveSR      = 16000;
  private _liveRunning = false;
  private readonly LIVE_WINDOW_SEC  = 8;
  private readonly LIVE_OVERLAP_SEC = 2;

  // ── Worker lifecycle ───────────────────────────────────────────────────────

  private _getWorker(): Worker {
    if (this._worker) return this._worker;
    this._worker = new Worker(
      new URL('./whisper.worker.ts', import.meta.url),
      { type: 'module' },
    );
    this._worker.addEventListener('message', (e: MessageEvent<WorkerMsg>) => {
      const { id, type, payload } = e.data;

      if (type === 'progress') {
        const p = payload as ProgressInfo;
        if (p.status === 'download' || p.status === 'progress') {
          const pct  = p.progress != null ? ` ${Math.round(p.progress)}%` : '';
          const name = p.file ?? p.name ?? '';
          this.loadProgress.value = `Downloading ${name}${pct}`.trim();
        } else if (p.status === 'loading') {
          this.loadProgress.value = `Loading model…`;
        }
        return;
      }

      if (id == null) return;
      const cb = this._pending.get(id);
      if (!cb) return;
      this._pending.delete(id);
      if (type === 'done')  cb.resolve(payload);
      else                  cb.reject(new Error(String(payload ?? 'unknown error')));
    });
    return this._worker;
  }

  private _call(type: string, payload: unknown, transfer?: Transferable[]): Promise<unknown> {
    const id = this._nextId++;
    const w  = this._getWorker();
    const p  = new Promise<unknown>((resolve, reject) => {
      this._pending.set(id, { resolve, reject });
    });
    w.postMessage({ id, type, payload }, transfer ?? []);
    return p;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /** Toggle transcription on/off. Loads the model on first enable. */
  async toggle(model = DEFAULT_MODEL): Promise<void> {
    if (!this.enabled.value) {
      this.enabled.value = true;
      await this.load(model);
    } else {
      this.enabled.value = false;
    }
  }

  async load(model = DEFAULT_MODEL): Promise<void> {
    if (this.status.value === 'ready') return;
    if (this.status.value === 'loading') return;
    this.status.value    = 'loading';
    this.loadProgress.value = 'Initialising…';
    try {
      await this._call('load', { model });
      this.status.value       = 'ready';
      this.loadProgress.value = '';
    } catch (err) {
      this.status.value       = 'error';
      this.loadProgress.value = '';
      throw err;
    }
  }

  /** Transcribe a fully decoded file buffer. */
  async transcribeFile(f32: Float32Array, sampleRate: number): Promise<void> {
    if (this.status.value !== 'ready') return;
    this.busy.value = true;
    this.transcript.value = [];
    try {
      const pcm    = await resampleTo16k(f32, sampleRate);
      const result = await this._call(
        'transcribe',
        { pcm, sampleRate: 16000 },
        [pcm.buffer as ArrayBuffer],
      ) as { text: string; chunks?: { text: string; timestamp: [number | null, number | null] }[] };

      if (result.chunks?.length) {
        this.transcript.value = result.chunks.map(c => ({
          text:     c.text,
          startSec: c.timestamp[0],
          endSec:   c.timestamp[1],
        }));
      } else {
        this.transcript.value = [{ text: result.text }];
      }
    } catch (err) {
      this.transcript.value = [{ text: `[Error: ${(err as Error).message}]` }];
    } finally {
      this.busy.value = false;
    }
  }

  // ── Live streaming ─────────────────────────────────────────────────────────

  resetLive(sampleRate: number): void {
    this._liveBuf    = [];
    this._liveDurSec = 0;
    this._liveSR     = sampleRate;
    this._liveRunning = false;
    this.transcript.value = [];
  }

  pushLivePcm(f32: Float32Array, sampleRate: number): void {
    if (this.status.value !== 'ready' || !this.enabled.value) return;
    this._liveSR = sampleRate;
    this._liveBuf.push(new Float32Array(f32)); // copy — caller's buffer may be reused
    this._liveDurSec += f32.length / sampleRate;
    if (this._liveDurSec >= this.LIVE_WINDOW_SEC && !this._liveRunning) {
      void this._runLiveChunk();
    }
  }

  private async _runLiveChunk(): Promise<void> {
    if (this._liveRunning) return;
    this._liveRunning = true;
    try {
      // Merge accumulated frames
      const totalLen = this._liveBuf.reduce((s, c) => s + c.length, 0);
      const merged   = new Float32Array(totalLen);
      let pos = 0;
      for (const c of this._liveBuf) { merged.set(c, pos); pos += c.length; }

      // Keep a trailing overlap for next window
      const overlapSamples = Math.round(this.LIVE_OVERLAP_SEC * this._liveSR);
      if (merged.length > overlapSamples) {
        this._liveBuf    = [merged.slice(merged.length - overlapSamples)];
        this._liveDurSec = this.LIVE_OVERLAP_SEC;
      } else {
        this._liveBuf    = [];
        this._liveDurSec = 0;
      }

      const pcm    = await resampleTo16k(merged, this._liveSR);
      const result = await this._call(
        'transcribe',
        { pcm, sampleRate: 16000 },
        [pcm.buffer as ArrayBuffer],
      ) as { text: string };

      const text = result.text?.trim();
      if (text) this.transcript.value = [...this.transcript.value, { text }];
    } catch { /* swallow mid-stream errors silently */ }
    finally   { this._liveRunning = false; }
  }
}

export const whisper = new WhisperService();
