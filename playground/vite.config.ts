import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import tailwindcss from '@tailwindcss/vite';
import { generateHtmlPlugin } from './plugins/html.js';

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
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
  },
  build: {
    target: 'es2022',
  },
});
