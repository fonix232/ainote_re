/**
 * Whisper Web Worker — loads an ASR model and runs transcription off the main thread.
 *
 * Protocol (all messages use { id, type, payload }):
 *   Main → Worker:
 *     { id, type: 'load',      payload: { model: string } }
 *     { id, type: 'transcribe', payload: { pcm: Float32Array, sampleRate: number } }
 *   Worker → Main:
 *     { id, type: 'done',     payload?: <result> }
 *     { id, type: 'error',    payload: string }
 *     {    type: 'progress',  payload: ProgressInfo }
 */

import { pipeline, env } from '@huggingface/transformers';

// Injected by Vite at build time (true when model files live in public/models/).
declare const __WHISPER_LOCAL__: boolean;

if (__WHISPER_LOCAL__) {
  // Redirect model fetches to self-hosted files in /models/ to avoid a
  // runtime CDN download.  Files are downloaded during `npm run build` via
  // the prebuild script (scripts/fetch-whisper-model.mjs).
  env.remoteHost         = self.location.origin;
  env.remotePathTemplate = '/models/{model}/';
} else {
  // Fall back to HuggingFace Hub; cache in browser IndexedDB.
  env.useBrowserCache = true;
}

interface Req {
  id: number;
  type: 'load' | 'transcribe';
  payload: unknown;
}

type AsrResult = {
  text: string;
  chunks?: { text: string; timestamp: [number | null, number | null] }[];
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPipeline = (input: unknown, options?: unknown) => Promise<any>;

let pipe: AnyPipeline | null = null;

(self as unknown as Worker).addEventListener('message', async (e: MessageEvent<Req>) => {
  const { id, type, payload } = e.data;
  const post = (t: string, p?: unknown) =>
    (self as unknown as Worker).postMessage({ id, type: t, payload: p });

  // ── Load model ──────────────────────────────────────────────────────────────
  if (type === 'load') {
    const { model } = payload as { model: string };
    try {
      pipe = (await pipeline('automatic-speech-recognition', model, {
        dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' } as Parameters<typeof pipeline>[2] extends { dtype?: infer D } ? D : never,
        device: 'wasm',
        progress_callback: (p: unknown) =>
          (self as unknown as Worker).postMessage({ type: 'progress', payload: p }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      })) as AnyPipeline;
      post('done');
    } catch (err) {
      post('error', (err as Error).message);
    }
    return;
  }

  // ── Transcribe ──────────────────────────────────────────────────────────────
  if (type === 'transcribe') {
    if (!pipe) { post('error', 'Model not loaded'); return; }
    const { pcm, sampleRate } = payload as { pcm: Float32Array; sampleRate: number };
    try {
      const result = (await pipe(pcm, {
        sampling_rate:   sampleRate,
        return_timestamps: true,
        chunk_length_s:  30,
        stride_length_s: 5,
      })) as AsrResult;
      post('done', result);
    } catch (err) {
      post('error', (err as Error).message);
    }
  }
});
