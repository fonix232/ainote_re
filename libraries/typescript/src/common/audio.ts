/**
 * Audio format types — @ainote/protocols
 *
 * Extracted from types.ts so consumers that only need audio metadata
 * don't pull in the full protocol surface.
 */

/** Discriminant slug for an audio format. */
export type AudioFormatSlug = 'sbc' | 'opus' | 'speex' | 'avo' | 'pcm-s16le' | 'mp3' | 'aac' | 'unknown';

/** Codec-level parameters used to configure decoders / players. */
export interface CodecParams {
  type:        'opus' | 'speex' | 'sbc' | 'avo' | 'pcm' | 'passthrough';
  sampleRate?: number;   // Hz
  channels?:   number;   // 1 = mono, 2 = stereo
  frameBytes?: number;   // fixed frame size where applicable
}

/**
 * Full audio format descriptor — slug, file extension, human name, and codec params.
 * Protocols reference the pre-defined constants in AUDIO_FORMATS.
 */
export interface AudioFormat {
  readonly slug:      AudioFormatSlug;
  readonly extension: string;    // without leading dot
  readonly name:      string;    // human-readable label
  readonly codec:     CodecParams;
}

export const AUDIO_FORMATS = {
  opus:      { slug: 'opus',      extension: 'opus', name: 'Opus Mono 16\u202fkHz',           codec: { type: 'opus',        sampleRate: 16000, channels: 1 } },
  speex:     { slug: 'speex',     extension: 'spx',  name: 'JieLi Speex WB 16\u202fkHz',     codec: { type: 'speex',       sampleRate: 16000, channels: 1, frameBytes: 40 } },
  avo:       { slug: 'avo',       extension: 'avo',  name: 'Mobvoi AVO (Opus 48\u202fkHz)',   codec: { type: 'avo',         sampleRate: 48000, channels: 1, frameBytes: 160 } },
  sbc:       { slug: 'sbc',       extension: 'sbc',  name: 'Doway SBC',                       codec: { type: 'sbc',         sampleRate: 16000, channels: 1 } },
  recolxSbc: { slug: 'sbc',       extension: 'sbc',  name: 'Recolx SBC 16\u202fkHz Mono',    codec: { type: 'sbc',         sampleRate: 16000, channels: 1, frameBytes: 40 } },
  pcm:       { slug: 'pcm-s16le', extension: 'raw',  name: 'PCM S16LE',                       codec: { type: 'pcm',         sampleRate: 16000, channels: 1 } },
  mp3:       { slug: 'mp3',       extension: 'mp3',  name: 'MP3',                             codec: { type: 'passthrough' } },
  aac:       { slug: 'aac',       extension: 'aac',  name: 'AAC',                             codec: { type: 'passthrough' } },
  unknown:   { slug: 'unknown',   extension: 'bin',  name: 'Unknown',                         codec: { type: 'passthrough' } },
} as const satisfies Record<string, AudioFormat>;
