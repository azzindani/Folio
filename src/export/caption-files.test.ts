import { describe, it, expect } from 'vitest';
import { toSrt, toVtt } from './caption-files';

const cues = [
  { text: 'Every format', from_ms: 800, to_ms: 3200 },
  { text: 'from one spec\n\n--> today', from_ms: 3_723_004, to_ms: 3_725_000 },
];

describe('subtitle files', () => {
  it('writes SubRip with comma milliseconds and numbered cues', () => {
    expect(toSrt(cues)).toBe('1\n00:00:00,800 --> 00:00:03,200\nEvery format\n\n2\n01:02:03,004 --> 01:02:05,000\nfrom one spec\n→ today\n');
  });

  it('writes WebVTT with its header and dot milliseconds, never a reserved arrow in the text', () => {
    const vtt = toVtt(cues);
    expect(vtt.startsWith('WEBVTT\n\n00:00:00.800 --> 00:00:03.200\nEvery format\n')).toBe(true);
    expect(vtt).toContain('01:02:03.004 --> 01:02:05.000\nfrom one spec\n→ today\n');
  });
});
