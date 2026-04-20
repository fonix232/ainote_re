import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import tailwindcss from '@tailwindcss/vite';
import { generateHtmlPlugin } from './plugins/html.js';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// True when model files have already been downloaded to public/models/
const whisperLocal = existsSync(
  join(__dirname, 'public/models/onnx-community/whisper-tiny/config.json'),
);

export default defineConfig({
  plugins: [
    tailwindcss(),
    preact(),
    generateHtmlPlugin({
      title:      'AI Note Workshop',
      entry:      'src/app.tsx',
      appMountId: 'app',
      externalScripts: [
        // Speex WASM decoder — libspeex 1.2.1 compiled with emscripten
        // Place speex-wasm.js in playground/public/ to enable Speex playback.
        { src: '/speex-wasm.js' },
      ],
    }),
  ],
  server: {
    port: 3000,
    open: true,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util', '@huggingface/transformers'],
  },
  define: {
    // Injected at build time: true when model files are present in public/models/
    __WHISPER_LOCAL__: JSON.stringify(whisperLocal),
  },
  build: {
    target: 'es2022',
  },
});
