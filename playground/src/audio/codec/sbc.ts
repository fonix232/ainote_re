/**
 * SBC decoder — direct TypeScript translation of FFmpeg's libavcodec/sbcdec.c
 * Reference: https://github.com/FFmpeg/FFmpeg/blob/master/libavcodec/sbcdec.c
 *            https://github.com/FFmpeg/FFmpeg/blob/master/libavcodec/sbcdec_data.h
 *            https://github.com/FFmpeg/FFmpeg/blob/master/libavcodec/sbc.c
 */
import type { AudioCodec } from './types.js';

// ── sbcdec_data.h tables ─────────────────────────────────────────────────────

// #define SS4(val) ((int32_t)val >> 12)
// #define SS8(val) ((int32_t)val >> 14)
function SS4(val: number): number { return (val | 0) >> 12; }
function SS8(val: number): number { return (val | 0) >> 14; }

// #define SN4(val) ((int32_t)val >> (11 + 1 + SBCDEC_FIXED_EXTRA_BITS))  = >> 14
function SN(val: number): number { return (val | 0) >> 14; }

const sbc_proto_4_40m0 = new Int32Array([
  SS4(0x00000000), SS4(0xffa6982f), SS4(0xfba93848), SS4(0x0456c7b8),
  SS4(0x005967d1), SS4(0xfffb9ac7), SS4(0xff589157), SS4(0xf9c2a8d8),
  SS4(0x027c1434), SS4(0x0019118b), SS4(0xfff3c74c), SS4(0xff137330),
  SS4(0xf81b8d70), SS4(0x00ec1b8b), SS4(0xfff0b71a), SS4(0xffe99b00),
  SS4(0xfef84470), SS4(0xf6fb4370), SS4(0xffcdc351), SS4(0xffe01dc7),
]);

const sbc_proto_4_40m1 = new Int32Array([
  SS4(0xffe090ce), SS4(0xff2c0475), SS4(0xf694f800), SS4(0xff2c0475),
  SS4(0xffe090ce), SS4(0xffe01dc7), SS4(0xffcdc351), SS4(0xf6fb4370),
  SS4(0xfef84470), SS4(0xffe99b00), SS4(0xfff0b71a), SS4(0x00ec1b8b),
  SS4(0xf81b8d70), SS4(0xff137330), SS4(0xfff3c74c), SS4(0x0019118b),
  SS4(0x027c1434), SS4(0xf9c2a8d8), SS4(0xff589157), SS4(0xfffb9ac7),
]);

const sbc_proto_8_80m0 = new Int32Array([
  SS8(0x00000000), SS8(0xfe8d1970), SS8(0xee979f00), SS8(0x11686100),
  SS8(0x0172e690), SS8(0xfff5bd1a), SS8(0xfdf1c8d4), SS8(0xeac182c0),
  SS8(0x0d9daee0), SS8(0x00e530da), SS8(0xffe9811d), SS8(0xfd52986c),
  SS8(0xe7054ca0), SS8(0x0a00d410), SS8(0x006c1de4), SS8(0xffdba705),
  SS8(0xfcbc98e8), SS8(0xe3889d20), SS8(0x06af2308), SS8(0x000bb7db),
  SS8(0xffca00ed), SS8(0xfc3fbb68), SS8(0xe071bc00), SS8(0x03bf7948),
  SS8(0xffc4e05c), SS8(0xffb54b3b), SS8(0xfbedadc0), SS8(0xdde26200),
  SS8(0x0142291c), SS8(0xff960e94), SS8(0xff9f3e17), SS8(0xfbd8f358),
  SS8(0xdbf79400), SS8(0xff405e01), SS8(0xff7d4914), SS8(0xff8b1a31),
  SS8(0xfc1417b8), SS8(0xdac7bb40), SS8(0xfdbb828c), SS8(0xff762170),
]);

const sbc_proto_8_80m1 = new Int32Array([
  SS8(0xff7c272c), SS8(0xfcb02620), SS8(0xda612700), SS8(0xfcb02620),
  SS8(0xff7c272c), SS8(0xff762170), SS8(0xfdbb828c), SS8(0xdac7bb40),
  SS8(0xfc1417b8), SS8(0xff8b1a31), SS8(0xff7d4914), SS8(0xff405e01),
  SS8(0xdbf79400), SS8(0xfbd8f358), SS8(0xff9f3e17), SS8(0xff960e94),
  SS8(0x0142291c), SS8(0xdde26200), SS8(0xfbedadc0), SS8(0xffb54b3b),
  SS8(0xffc4e05c), SS8(0x03bf7948), SS8(0xe071bc00), SS8(0xfc3fbb68),
  SS8(0xffca00ed), SS8(0x000bb7db), SS8(0x06af2308), SS8(0xe3889d20),
  SS8(0xfcbc98e8), SS8(0xffdba705), SS8(0x006c1de4), SS8(0x0a00d410),
  SS8(0xe7054ca0), SS8(0xfd52986c), SS8(0xffe9811d), SS8(0x00e530da),
  SS8(0x0d9daee0), SS8(0xeac182c0), SS8(0xfdf1c8d4), SS8(0xfff5bd1a),
]);

// synmatrix4[8][4]
const synmatrix4 = [
  [SN(0x05a82798), SN(0xfa57d868), SN(0xfa57d868), SN(0x05a82798)],
  [SN(0x030fbc54), SN(0xf89be510), SN(0x07641af0), SN(0xfcf043ac)],
  [SN(0x00000000), SN(0x00000000), SN(0x00000000), SN(0x00000000)],
  [SN(0xfcf043ac), SN(0x07641af0), SN(0xf89be510), SN(0x030fbc54)],
  [SN(0xfa57d868), SN(0x05a82798), SN(0x05a82798), SN(0xfa57d868)],
  [SN(0xf89be510), SN(0xfcf043ac), SN(0x030fbc54), SN(0x07641af0)],
  [SN(0xf8000000), SN(0xf8000000), SN(0xf8000000), SN(0xf8000000)],
  [SN(0xf89be510), SN(0xfcf043ac), SN(0x030fbc54), SN(0x07641af0)],
];

// synmatrix8[16][8]
const synmatrix8 = [
  [SN(0x05a82798), SN(0xfa57d868), SN(0xfa57d868), SN(0x05a82798), SN(0x05a82798), SN(0xfa57d868), SN(0xfa57d868), SN(0x05a82798)],
  [SN(0x0471ced0), SN(0xf8275a10), SN(0x018f8b84), SN(0x06a6d988), SN(0xf9592678), SN(0xfe70747c), SN(0x07d8a5f0), SN(0xfb8e3130)],
  [SN(0x030fbc54), SN(0xf89be510), SN(0x07641af0), SN(0xfcf043ac), SN(0xfcf043ac), SN(0x07641af0), SN(0xf89be510), SN(0x030fbc54)],
  [SN(0x018f8b84), SN(0xfb8e3130), SN(0x06a6d988), SN(0xf8275a10), SN(0x07d8a5f0), SN(0xf9592678), SN(0x0471ced0), SN(0xfe70747c)],
  [SN(0x00000000), SN(0x00000000), SN(0x00000000), SN(0x00000000), SN(0x00000000), SN(0x00000000), SN(0x00000000), SN(0x00000000)],
  [SN(0xfe70747c), SN(0x0471ced0), SN(0xf9592678), SN(0x07d8a5f0), SN(0xf8275a10), SN(0x06a6d988), SN(0xfb8e3130), SN(0x018f8b84)],
  [SN(0xfcf043ac), SN(0x07641af0), SN(0xf89be510), SN(0x030fbc54), SN(0x030fbc54), SN(0xf89be510), SN(0x07641af0), SN(0xfcf043ac)],
  [SN(0xfb8e3130), SN(0x07d8a5f0), SN(0xfe70747c), SN(0xf9592678), SN(0x06a6d988), SN(0x018f8b84), SN(0xf8275a10), SN(0x0471ced0)],
  [SN(0xfa57d868), SN(0x05a82798), SN(0x05a82798), SN(0xfa57d868), SN(0xfa57d868), SN(0x05a82798), SN(0x05a82798), SN(0xfa57d868)],
  [SN(0xf9592678), SN(0x018f8b84), SN(0x07d8a5f0), SN(0x0471ced0), SN(0xfb8e3130), SN(0xf8275a10), SN(0xfe70747c), SN(0x06a6d988)],
  [SN(0xf89be510), SN(0xfcf043ac), SN(0x030fbc54), SN(0x07641af0), SN(0x07641af0), SN(0x030fbc54), SN(0xfcf043ac), SN(0xf89be510)],
  [SN(0xf8275a10), SN(0xf9592678), SN(0xfb8e3130), SN(0xfe70747c), SN(0x018f8b84), SN(0x0471ced0), SN(0x06a6d988), SN(0x07d8a5f0)],
  [SN(0xf8000000), SN(0xf8000000), SN(0xf8000000), SN(0xf8000000), SN(0xf8000000), SN(0xf8000000), SN(0xf8000000), SN(0xf8000000)],
  [SN(0xf8275a10), SN(0xf9592678), SN(0xfb8e3130), SN(0xfe70747c), SN(0x018f8b84), SN(0x0471ced0), SN(0x06a6d988), SN(0x07d8a5f0)],
  [SN(0xf89be510), SN(0xfcf043ac), SN(0x030fbc54), SN(0x07641af0), SN(0x07641af0), SN(0x030fbc54), SN(0xfcf043ac), SN(0xf89be510)],
  [SN(0xf9592678), SN(0x018f8b84), SN(0x07d8a5f0), SN(0x0471ced0), SN(0xfb8e3130), SN(0xf8275a10), SN(0xfe70747c), SN(0x06a6d988)],
];

// sbc_offset4[freq][sb] and sbc_offset8[freq][sb] — from sbc.c
const sbc_offset4 = [
  [-1, 0, 0, 0],
  [-2, 0, 0, 1],
  [-2, 0, 0, 1],
  [-2, 0, 0, 1],
];
const sbc_offset8 = [
  [-2, 0, 0, 0, 0, 0, 0, 1],
  [-3, 0, 0, 0, 0, 0, 1, 2],
  [-4, 0, 0, 0, 0, 0, 1, 2],
  [-4, 0, 0, 0, 0, 0, 1, 2],
];

// ── Bit allocation (ff_sbc_calculate_bits) ────────────────────────────────────

function calculateBits(
  scaleFactor: Int32Array[], channels: number, subbands: number,
  bitpool: number, allocation: number, mode: number, freq: number,
  bits: Int32Array[],
): void {
  const offsets = subbands === 8 ? sbc_offset8 : sbc_offset4;

  if (mode === 0 || mode === 1) {
    for (let ch = 0; ch < channels; ch++) {
      const bitneed = new Int32Array(subbands);
      let max_bitneed = 0;
      if (allocation === 1) {
        for (let sb = 0; sb < subbands; sb++) {
          bitneed[sb] = scaleFactor[ch]![sb]!;
          if (bitneed[sb]! > max_bitneed) max_bitneed = bitneed[sb]!;
        }
      } else {
        for (let sb = 0; sb < subbands; sb++) {
          if (scaleFactor[ch]![sb] === 0) {
            bitneed[sb] = -5;
          } else {
            const loudness = scaleFactor[ch]![sb]! - offsets[freq]![sb]!;
            bitneed[sb] = loudness > 0 ? loudness >> 1 : loudness;
          }
          if (bitneed[sb]! > max_bitneed) max_bitneed = bitneed[sb]!;
        }
      }
      let bitcount = 0, slicecount = 0, bitslice = max_bitneed + 1;
      do {
        bitslice--;
        bitcount += slicecount;
        slicecount = 0;
        for (let sb = 0; sb < subbands; sb++) {
          const bn = bitneed[sb]!;
          if (bn > bitslice + 1 && bn < bitslice + 16) slicecount++;
          else if (bn === bitslice + 1) slicecount += 2;
        }
      } while (bitcount + slicecount < bitpool);
      if (bitcount + slicecount === bitpool) { bitcount += slicecount; bitslice--; }
      for (let sb = 0; sb < subbands; sb++) {
        const bn = bitneed[sb]!;
        bits[ch]![sb] = bn < bitslice + 2 ? 0 : Math.min(bn - bitslice, 16);
      }
      for (let sb = 0; bitcount < bitpool && sb < subbands; sb++) {
        if (bits[ch]![sb]! >= 2 && bits[ch]![sb]! < 16) { bits[ch]![sb]!++; bitcount++; }
        else if (bitneed[sb] === bitslice + 1 && bitpool > bitcount + 1) { bits[ch]![sb] = 2; bitcount += 2; }
      }
      for (let sb = 0; bitcount < bitpool && sb < subbands; sb++) {
        if (bits[ch]![sb]! < 16) { bits[ch]![sb]!++; bitcount++; }
      }
    }
  } else {
    const bitneed: number[][] = [new Array(subbands).fill(0), new Array(subbands).fill(0)];
    let max_bitneed = 0;
    if (allocation === 1) {
      for (let ch = 0; ch < 2; ch++)
        for (let sb = 0; sb < subbands; sb++) {
          bitneed[ch]![sb] = scaleFactor[ch]![sb]!;
          if (bitneed[ch]![sb]! > max_bitneed) max_bitneed = bitneed[ch]![sb]!;
        }
    } else {
      for (let ch = 0; ch < 2; ch++)
        for (let sb = 0; sb < subbands; sb++) {
          if (scaleFactor[ch]![sb] === 0) {
            bitneed[ch]![sb] = -5;
          } else {
            const loudness = scaleFactor[ch]![sb]! - offsets[freq]![sb]!;
            bitneed[ch]![sb] = loudness > 0 ? loudness >> 1 : loudness;
          }
          if (bitneed[ch]![sb]! > max_bitneed) max_bitneed = bitneed[ch]![sb]!;
        }
    }
    let bitcount = 0, slicecount = 0, bitslice = max_bitneed + 1;
    do {
      bitslice--;
      bitcount += slicecount;
      slicecount = 0;
      for (let ch = 0; ch < 2; ch++)
        for (let sb = 0; sb < subbands; sb++) {
          const bn = bitneed[ch]![sb]!;
          if (bn > bitslice + 1 && bn < bitslice + 16) slicecount++;
          else if (bn === bitslice + 1) slicecount += 2;
        }
    } while (bitcount + slicecount < bitpool);
    if (bitcount + slicecount === bitpool) { bitcount += slicecount; bitslice--; }
    for (let ch = 0; ch < 2; ch++)
      for (let sb = 0; sb < subbands; sb++) {
        const bn = bitneed[ch]![sb]!;
        bits[ch]![sb] = bn < bitslice + 2 ? 0 : Math.min(bn - bitslice, 16);
      }
    let ch = 0, sb = 0;
    while (bitcount < bitpool) {
      if (bits[ch]![sb]! >= 2 && bits[ch]![sb]! < 16) { bits[ch]![sb]!++; bitcount++; }
      else if (bitneed[ch]![sb] === bitslice + 1 && bitpool > bitcount + 1) { bits[ch]![sb] = 2; bitcount += 2; }
      if (ch === 1) { ch = 0; sb++; if (sb >= subbands) break; } else ch = 1;
    }
    ch = 0; sb = 0;
    while (bitcount < bitpool) {
      if (bits[ch]![sb]! < 16) { bits[ch]![sb]!++; bitcount++; }
      if (ch === 1) { ch = 0; sb++; if (sb >= subbands) break; } else ch = 1;
    }
  }
}

// ── Synthesis filter ──────────────────────────────────────────────────────────

class SynthState {
  V: [Int32Array, Int32Array] = [new Int32Array(170), new Int32Array(170)];
  offset: [Int32Array, Int32Array] = [new Int32Array(16), new Int32Array(16)];

  init(): void {
    this.V[0]!.fill(0);
    this.V[1]!.fill(0);
    for (let ch = 0; ch < 2; ch++)
      for (let i = 0; i < 16; i++)
        this.offset[ch]![i] = 10 * i + 10;
  }
}

function synthesizeFour(
  state: SynthState, ch: number,
  sbSamples: Int32Array[], blocks: number,
  out: Int16Array, outBase: number,
): void {
  const v = state.V[ch]!;
  const offset = state.offset[ch]!;
  for (let blk = 0; blk < blocks; blk++) {
    const sbs = sbSamples[blk]!;
    for (let i = 0; i < 8; i++) {
      offset[i]!--;
      if (offset[i]! < 0) { offset[i] = 79; v.copyWithin(80, 0, 9); }
      const row = synmatrix4[i]!;
      v[offset[i]!] = (
        Math.imul(row[0]!, sbs[0]!) + Math.imul(row[1]!, sbs[1]!) +
        Math.imul(row[2]!, sbs[2]!) + Math.imul(row[3]!, sbs[3]!)
      ) >>> 0 >> 15;
    }
    for (let i = 0; i < 4; i++) {
      const k = (i + 4) & 0xf;
      const idx = i * 5;
      let sum =
        Math.imul(v[offset[i]! + 0]!, sbc_proto_4_40m0[idx + 0]!) +
        Math.imul(v[offset[k]! + 1]!, sbc_proto_4_40m1[idx + 0]!) +
        Math.imul(v[offset[i]! + 2]!, sbc_proto_4_40m0[idx + 1]!) +
        Math.imul(v[offset[k]! + 3]!, sbc_proto_4_40m1[idx + 1]!) +
        Math.imul(v[offset[i]! + 4]!, sbc_proto_4_40m0[idx + 2]!) +
        Math.imul(v[offset[k]! + 5]!, sbc_proto_4_40m1[idx + 2]!) +
        Math.imul(v[offset[i]! + 6]!, sbc_proto_4_40m0[idx + 3]!) +
        Math.imul(v[offset[k]! + 7]!, sbc_proto_4_40m1[idx + 3]!) +
        Math.imul(v[offset[i]! + 8]!, sbc_proto_4_40m0[idx + 4]!) +
        Math.imul(v[offset[k]! + 9]!, sbc_proto_4_40m1[idx + 4]!);
      sum = (sum >>> 0) >> 15;
      out[outBase + blk * 4 + i] = sum < -32768 ? -32768 : sum > 32767 ? 32767 : sum;
    }
  }
}

function synthesizeEight(
  state: SynthState, ch: number,
  sbSamples: Int32Array[], blocks: number,
  out: Int16Array, outBase: number,
): void {
  const v = state.V[ch]!;
  const offset = state.offset[ch]!;
  for (let blk = 0; blk < blocks; blk++) {
    const sbs = sbSamples[blk]!;
    for (let i = 0; i < 16; i++) {
      offset[i]!--;
      if (offset[i]! < 0) { offset[i] = 159; v.copyWithin(160, 0, 9); }
      const row = synmatrix8[i]!;
      v[offset[i]!] = (
        Math.imul(row[0]!, sbs[0]!) + Math.imul(row[1]!, sbs[1]!) +
        Math.imul(row[2]!, sbs[2]!) + Math.imul(row[3]!, sbs[3]!) +
        Math.imul(row[4]!, sbs[4]!) + Math.imul(row[5]!, sbs[5]!) +
        Math.imul(row[6]!, sbs[6]!) + Math.imul(row[7]!, sbs[7]!)
      ) >>> 0 >> 15;
    }
    for (let i = 0; i < 8; i++) {
      const k = (i + 8) & 0xf;
      const idx = i * 5;
      let sum =
        Math.imul(v[offset[i]! + 0]!, sbc_proto_8_80m0[idx + 0]!) +
        Math.imul(v[offset[k]! + 1]!, sbc_proto_8_80m1[idx + 0]!) +
        Math.imul(v[offset[i]! + 2]!, sbc_proto_8_80m0[idx + 1]!) +
        Math.imul(v[offset[k]! + 3]!, sbc_proto_8_80m1[idx + 1]!) +
        Math.imul(v[offset[i]! + 4]!, sbc_proto_8_80m0[idx + 2]!) +
        Math.imul(v[offset[k]! + 5]!, sbc_proto_8_80m1[idx + 2]!) +
        Math.imul(v[offset[i]! + 6]!, sbc_proto_8_80m0[idx + 3]!) +
        Math.imul(v[offset[k]! + 7]!, sbc_proto_8_80m1[idx + 3]!) +
        Math.imul(v[offset[i]! + 8]!, sbc_proto_8_80m0[idx + 4]!) +
        Math.imul(v[offset[k]! + 9]!, sbc_proto_8_80m1[idx + 4]!);
      sum = (sum >>> 0) >> 15;
      out[outBase + blk * 8 + i] = sum < -32768 ? -32768 : sum > 32767 ? 32767 : sum;
    }
  }
}

// ── Frame decoder ─────────────────────────────────────────────────────────────

const SBCDEC_FIXED_EXTRA_BITS = 2;

function decodeSbcFrame(data: Uint8Array, state: SynthState): Int16Array | null {
  if (data.length < 4 || data[0] !== 0x9C) return null;

  const b1       = data[1]!;
  const freq     = (b1 >> 6) & 0x3;
  const blocks   = 4 * (((b1 >> 4) & 0x3) + 1);
  const mode     = (b1 >> 2) & 0x3;
  const alloc    = (b1 >> 1) & 0x1;
  const subbands = (b1 & 0x1) ? 8 : 4;
  const bitpool  = data[2]!;
  const channels = mode === 0 ? 1 : 2;

  let consumed = 32; // bits consumed, starts after 4-byte header
  function readBit(): number { return (data[consumed >> 3]! >> (7 - (consumed++ & 0x7))) & 1; }
  function readBits(n: number): number { let r = 0; for (let i = 0; i < n; i++) r = (r << 1) | readBit(); return r; }

  // Joint stereo join flags
  let joint = 0;
  if (mode === 3) {
    for (let sb = 0; sb < subbands - 1; sb++) joint |= readBit() << sb;
    // byte-align after join flags
    consumed = (consumed + 7) & ~7;
  }

  // Scale factors
  const scaleFactor: Int32Array[] = [new Int32Array(subbands), new Int32Array(subbands)];
  for (let ch = 0; ch < channels; ch++)
    for (let sb = 0; sb < subbands; sb++)
      scaleFactor[ch]![sb] = readBits(4);

  // Bit allocation
  const bits: Int32Array[] = [new Int32Array(subbands), new Int32Array(subbands)];
  calculateBits(scaleFactor, channels, subbands, bitpool, alloc, mode, freq, bits);

  // levels[ch][sb] = (1 << bits) - 1
  const levels: Int32Array[] = [new Int32Array(subbands), new Int32Array(subbands)];
  for (let ch = 0; ch < channels; ch++)
    for (let sb = 0; sb < subbands; sb++)
      levels[ch]![sb] = (1 << bits[ch]![sb]!) - 1;

  // Subband samples
  const sb_sample: Int32Array[][] = [];
  for (let blk = 0; blk < blocks; blk++) {
    sb_sample[blk] = [new Int32Array(subbands), new Int32Array(subbands)];
    for (let ch = 0; ch < channels; ch++) {
      for (let sb = 0; sb < subbands; sb++) {
        if (levels[ch]![sb] === 0) { sb_sample[blk]![ch]![sb] = 0; continue; }
        const shift = scaleFactor[ch]![sb]! + 1 + SBCDEC_FIXED_EXTRA_BITS;
        const audio_sample = readBits(bits[ch]![sb]!);
        sb_sample[blk]![ch]![sb] =
          Math.trunc(((audio_sample * 2 + 1) * (1 << shift)) / levels[ch]![sb]!) - (1 << shift);
      }
    }
  }

  // Joint stereo reconstruction
  if (mode === 3) {
    for (let blk = 0; blk < blocks; blk++)
      for (let sb = 0; sb < subbands; sb++)
        if (joint & (1 << sb)) {
          const l = sb_sample[blk]![0]![sb]! + sb_sample[blk]![1]![sb]!;
          const r = sb_sample[blk]![0]![sb]! - sb_sample[blk]![1]![sb]!;
          sb_sample[blk]![0]![sb] = l;
          sb_sample[blk]![1]![sb] = r;
        }
  }

  // Synthesis
  const samplesPerCh = blocks * subbands;
  const ch0out = new Int16Array(samplesPerCh);
  const ch1out = channels === 2 ? new Int16Array(samplesPerCh) : null;
  const sbsCh0 = sb_sample.map(blk => blk[0]!);
  const sbsCh1 = channels === 2 ? sb_sample.map(blk => blk[1]!) : [];

  if (subbands === 4) {
    synthesizeFour(state, 0, sbsCh0, blocks, ch0out, 0);
    if (ch1out) synthesizeFour(state, 1, sbsCh1, blocks, ch1out, 0);
  } else {
    synthesizeEight(state, 0, sbsCh0, blocks, ch0out, 0);
    if (ch1out) synthesizeEight(state, 1, sbsCh1, blocks, ch1out, 0);
  }

  // Downmix to mono
  const mono = new Int16Array(samplesPerCh);
  if (ch1out) {
    for (let i = 0; i < samplesPerCh; i++) mono[i] = (ch0out[i]! + ch1out[i]!) >> 1;
  } else {
    mono.set(ch0out);
  }
  return mono;
}

// ── Frame-size calculator ─────────────────────────────────────────────────────

export function sbcFrameSize(data: Uint8Array, offset = 0): number | null {
  if (data.length < offset + 4 || data[offset] !== 0x9C) return null;
  const b1   = data[offset + 1]!;
  const nblks = 4 * (((b1 >> 4) & 0x3) + 1);
  const mode  = (b1 >> 2) & 0x3;
  const ch    = mode === 0 ? 1 : 2;
  const nsb   = (b1 & 0x1) ? 8 : 4;
  const bp    = data[offset + 2]!;
  if (mode === 3) return 4 + Math.floor(4 * nsb * ch / 8) + Math.ceil((nblks * bp * ch + nsb) / 8);
  return 4 + Math.floor(4 * nsb * ch / 8) + Math.ceil(nblks * ch * bp / 8);
}

// ── Codec adapter ─────────────────────────────────────────────────────────────

export class SbcCodec implements AudioCodec {
  readonly sampleRate: number;
  readonly streaming  = true;
  private _state = new SynthState();

  constructor(sampleRate = 16000) { this.sampleRate = sampleRate; }

  open(): void { this._state.init(); console.log(`[SbcCodec] open @${this.sampleRate}Hz`); }
  close(): void { console.log('[SbcCodec] close'); }

  decode(bytes: Uint8Array): Float32Array | null {
    try {
      const s16 = decodeSbcFrame(bytes, this._state);
      if (!s16) return null;
      const f32 = new Float32Array(s16.length);
      for (let i = 0; i < s16.length; i++) f32[i] = s16[i]! / 32768.0;
      return f32;
    } catch (e) {
      console.error('[SbcCodec] decode error', e, 'frame[0..3]:', Array.from(bytes.slice(0, 4)).map(x => x.toString(16)));
      return null;
    }
  }
}

