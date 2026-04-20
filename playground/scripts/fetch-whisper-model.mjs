#!/usr/bin/env node
/**
 * Downloads whisper-tiny (q8) ONNX model files from HuggingFace Hub into
 * public/models/ so the playground can serve them locally without any
 * runtime download.
 *
 * Usage:  node scripts/fetch-whisper-model.mjs
 * Called automatically as part of `npm run prebuild`.
 */

import { writeFile, mkdir, access, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT     = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR  = join(ROOT, 'public', 'models');
const MODEL_ID = 'onnx-community/whisper-tiny';
const REVISION = 'main';
const HF_BASE  = 'https://huggingface.co';

// Files required for q8 dtype (encoder + decoder_model_merged).
// "q8" maps to the "_quantized" ONNX filename suffix in @huggingface/transformers.
const FILES = [
  'config.json',
  'generation_config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'special_tokens_map.json',
  'preprocessor_config.json',
  'onnx/encoder_model_quantized.onnx',
  'onnx/decoder_model_merged_quantized.onnx',
];

async function fileExists(p) {
  try { await access(p); return true; } catch { return false; }
}

async function fetchFile(file) {
  const parts = [...MODEL_ID.split('/'), ...file.split('/')];
  const dest  = join(OUT_DIR, ...parts);

  if (await fileExists(dest)) {
    const { size } = await stat(dest);
    const kb = (size / 1024).toFixed(0).padStart(7);
    console.log(`  ✓  ${kb} KB  ${file}`);
    return;
  }

  const url = `${HF_BASE}/${MODEL_ID}/resolve/${REVISION}/${file}`;
  process.stdout.write(`  ↓  fetching  ${file} … `);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${url}`);

  await mkdir(dirname(dest), { recursive: true });
  const buf = await res.arrayBuffer();
  await writeFile(dest, new Uint8Array(buf));

  const kb = (buf.byteLength / 1024).toFixed(0);
  console.log(`${kb} KB`);
}

console.log(`\nWhisper model: ${MODEL_ID} (q8)\n`);
for (const f of FILES) {
  await fetchFile(f);
}
console.log(`\nDone — files in public/models/${MODEL_ID}/\n`);
