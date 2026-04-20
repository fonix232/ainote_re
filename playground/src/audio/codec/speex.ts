/**
 * Speex codec — Wideband (16 kHz mono), 40-byte JieLi frames.
 *
 * Wraps libspeex 1.2.1 compiled to WebAssembly by emscripten.
 * The WASM module is loaded lazily on first call to decodeAll().
 *
 * Prerequisites in index.html:
 *   <script src="/speex-wasm.js"></script>
 */

// ── Speex control constants (from speex/speex.h) ────────────────────────────
const SPEEX_SET_ENH           = 0;
const SPEEX_GET_FRAME_SIZE    = 3;
const SPEEX_SET_SAMPLING_RATE = 24;
const SPEEX_WIDEBAND_MODE_ID  = 1;   // _speex_lib_get_mode(1) → 16 kHz

export const SPEEX_SAMPLE_RATE = 16000;

// JieLi Speex group-frame format (confirmed via libjl_speex.so disassembly):
//   [0xAA][0xEA][0xBD][0xAC]  — 4-byte group magic
//   [size_lo][size_hi]         — uint16 LE: bytes per Speex frame (e.g. 40)
//   [size bytes] × 5           — 5 raw Speex bitstream frames
const JL_GROUP_MAGIC     = [0xAA, 0xEA, 0xBD, 0xAC] as const;
const JL_FRAMES_PER_GROUP = 5;
const JL_MAX_FRAME_BYTES  = 400;   // sanity ceiling (matches JieLi native)

// SpeexBits struct: 9 × 4-byte fields in 32-bit WASM address space = 36 bytes
const SPEEX_BITS_STRUCT_SIZE = 36;

// ── WASM module interface ────────────────────────────────────────────────────
interface SpeexWasmModule {
  // Memory management
  _malloc(size: number): number;
  _free(ptr: number): void;

  // Mode/decoder lifecycle
  _speex_lib_get_mode(modeId: number): number;
  _speex_decoder_init(mode: number): number;
  _speex_decoder_destroy(state: number): void;
  _speex_decoder_ctl(state: number, request: number, ptr: number): number;

  // Bit-stream operations
  _speex_bits_init(bitsPtr: number): void;
  _speex_bits_destroy(bitsPtr: number): void;
  _speex_bits_read_from(bitsPtr: number, charBuf: number, len: number): void;
  _speex_bits_reset(bitsPtr: number): void;

  // Decoding
  _speex_decode_int(state: number, bitsPtr: number, outPtr: number): number;

  // Typed-array views into WASM linear memory
  HEAPU8: Uint8Array;
  HEAP16: Int16Array;
  HEAP32: Int32Array;
}

// ── Module singleton — loaded once, shared across all SpeexCodec instances ──
let _modPromise: Promise<SpeexWasmModule> | null = null;

function loadModule(): Promise<SpeexWasmModule> {
  if (_modPromise) return _modPromise;

  const factory = (window as unknown as Record<string, unknown>)['createSpeexModule'];
  if (typeof factory !== 'function') {
    return Promise.reject(
      new Error(
        '[SpeexCodec] createSpeexModule not found — ' +
        'add <script src="/speex-wasm.js"></script> to index.html before the app module',
      ),
    );
  }

  _modPromise = (factory as () => Promise<SpeexWasmModule>)();
  return _modPromise;
}

// ── SpeexCodec ───────────────────────────────────────────────────────────────
export class SpeexCodec {
  readonly sampleRate = SPEEX_SAMPLE_RATE;

  /**
   * Decode all JieLi Speex frames from `payload` (raw audio data with the
   * 10-byte recolx.ai file header already stripped).
   *
   * File format (confirmed via libjl_speex.so disassembly):
   *   Groups of 5 frames, each group prefixed by:
   *     [0xAA][0xEA][0xBD][0xAC]  — 4-byte magic
   *     [size_lo][size_hi]          — uint16 LE frame byte count
   *   followed by 5 × size-byte raw Speex bitstreams.
   *
   * A 4-byte sliding window is used to sync to the first magic, so any
   * leading non-magic bytes (file header residue) are skipped automatically.
   *
   * Each decoded PCM frame (Float32Array, 16 kHz mono, 320 samples) is
   * delivered synchronously via `onPcm` as the WASM decoder produces it.
   */
  async decodeAll(
    payload: Uint8Array,
    onPcm: (f32: Float32Array, sampleRate: number) => void,
  ): Promise<void> {
    console.log(`[SpeexCodec] decodeAll payload=${payload.length}B`);
    let m: SpeexWasmModule;
    try {
      m = await loadModule();
      console.log('[SpeexCodec] WASM module ready');
    } catch (err) {
      console.error('[SpeexCodec] WASM load failed:', err);
      return;
    }

    // ── Initialise decoder ───────────────────────────────────────────────────
    const mode  = m._speex_lib_get_mode(SPEEX_WIDEBAND_MODE_ID);
    const state = m._speex_decoder_init(mode);
    if (state === 0) throw new Error('[SpeexCodec] decoder init failed');

    // Scratch i32 for ctl() in/out
    const ctlPtr = m._malloc(4);

    // Enable perceptual enhancement
    m.HEAP32[ctlPtr >> 2] = 1;
    m._speex_decoder_ctl(state, SPEEX_SET_ENH, ctlPtr);

    // Set sample rate (needed for proper gain/filtering)
    m.HEAP32[ctlPtr >> 2] = SPEEX_SAMPLE_RATE;
    m._speex_decoder_ctl(state, SPEEX_SET_SAMPLING_RATE, ctlPtr);

    // Query actual output frame size (wideband → 320 samples)
    m._speex_decoder_ctl(state, SPEEX_GET_FRAME_SIZE, ctlPtr);
    const frameSize = m.HEAP32[ctlPtr >> 2];
    if (!frameSize) throw new Error('[SpeexCodec] could not get frame size from decoder');

    // ── Allocate reusable WASM buffers ───────────────────────────────────────
    const bitsPtr = m._malloc(SPEEX_BITS_STRUCT_SIZE);
    m._speex_bits_init(bitsPtr);          // allocates internal bit buffer

    const inPtr  = m._malloc(JL_MAX_FRAME_BYTES);  // enough for any valid frame
    const outPtr = m._malloc(frameSize * 2);         // int16 × 2 bytes each
    const outH16 = outPtr >> 1;                      // HEAP16 element index

    // ── Decode loop — JieLi group-frame format ───────────────────────────────
    // Scan for magic [AA EA BD AC] with a sliding window, then decode 5 frames.
    let pos = 0;
    let groupsFound = 0;
    let framesDecoded = 0;

    while (pos + 6 <= payload.length) {
      // Find the 4-byte group magic
      if (
        payload[pos]   !== JL_GROUP_MAGIC[0] ||
        payload[pos+1] !== JL_GROUP_MAGIC[1] ||
        payload[pos+2] !== JL_GROUP_MAGIC[2] ||
        payload[pos+3] !== JL_GROUP_MAGIC[3]
      ) {
        pos++;
        continue;
      }

      // Read uint16 LE frame size
      const frameBytes = ((payload[pos+4] ?? 0) | ((payload[pos+5] ?? 0) << 8)) >>> 0;
      if (frameBytes === 0 || frameBytes > JL_MAX_FRAME_BYTES) {
        pos++;
        continue;
      }

      pos += 6; // skip magic + size field
      groupsFound++;

      // Log the first group header for format diagnosis
      if (groupsFound <= 2) {
        console.log(`[SpeexCodec] group#${groupsFound} at pos=${pos - 6} frameBytes=${frameBytes}`);
      }

      // Decode the 5 Speex frames in this group
      for (let f = 0; f < JL_FRAMES_PER_GROUP; f++) {
        if (pos + frameBytes > payload.length) break;

        // Copy frame bitstream into WASM heap
        m.HEAPU8.set(payload.subarray(pos, pos + frameBytes), inPtr);
        pos += frameBytes;

        // Load bits (also resets the bit cursor)
        m._speex_bits_read_from(bitsPtr, inPtr, frameBytes);

        // Decode → int16 samples at outPtr
        const ret = m._speex_decode_int(state, bitsPtr, outPtr);
        if (ret < 0) {
          console.warn(`[SpeexCodec] group#${groupsFound} frame ${f}: decode error ${ret} — skipping`);
          continue;
        }
        framesDecoded++;

        // Convert int16 → float32 and deliver
        const f32 = new Float32Array(frameSize);
        for (let j = 0; j < frameSize; j++) {
          f32[j] = (m.HEAP16[outH16 + j] ?? 0) / 32768;
        }
        onPcm(f32, SPEEX_SAMPLE_RATE);
      }
    }

    // ── Cleanup ──────────────────────────────────────────────────────────────
    console.log(`[SpeexCodec] done: ${groupsFound} groups, ${framesDecoded} frames decoded`);
    if (groupsFound === 0) {
      // Dump first 32 bytes of payload as hex to help diagnose magic-byte mismatch
      const hex = Array.from(payload.subarray(0, 32)).map(b => b.toString(16).padStart(2, '0')).join(' ');
      console.warn(`[SpeexCodec] no groups found — first bytes: ${hex}`);
    }
    m._free(inPtr);
    m._free(outPtr);
    m._speex_bits_destroy(bitsPtr);  // frees internal bit buffer
    m._free(bitsPtr);
    m._free(ctlPtr);
    m._speex_decoder_destroy(state);
  }
}
