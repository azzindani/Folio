/**
 * Captions as subtitle files — SubRip (.srt) and WebVTT (.vtt) — for players and
 * platforms that show their own subtitles instead of the burned-in ones.
 */

import type { CaptionCue } from '../schema/types';

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

function stamp(ms: number, separator: ',' | '.'): string {
  const t = Math.max(0, Math.round(ms));
  return `${pad(Math.floor(t / 3_600_000))}:${pad(Math.floor(t / 60_000) % 60)}:${pad(Math.floor(t / 1000) % 60)}${separator}${pad(t % 1000, 3)}`;
}

/** A blank line ends a cue in both formats, and "-->" is reserved in WebVTT. */
const cueText = (text: string): string => text.replace(/\r/g, '').replace(/\n\s*\n+/g, '\n').replace(/-->/g, '→').trim();

export function toSrt(cues: CaptionCue[]): string {
  return cues.map((c, i) => `${i + 1}\n${stamp(c.from_ms, ',')} --> ${stamp(c.to_ms, ',')}\n${cueText(c.text)}\n`).join('\n');
}

export function toVtt(cues: CaptionCue[]): string {
  return `WEBVTT\n\n${cues.map(c => `${stamp(c.from_ms, '.')} --> ${stamp(c.to_ms, '.')}\n${cueText(c.text)}\n`).join('\n')}`;
}
