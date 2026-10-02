import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import { x264Preset, askedEncoder, h264Args, encoderWorks, h264Encoder } from './video-codec';
import { ffmpegArgs } from './video-encode';

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).error === undefined;
const base = { width: 1920, height: 1080, fps: 30, outputPath: '/x/a.mp4', type: 'mp4' as const };

describe('video codec knobs', () => {
  it('reads the x264 preset, defaulting to medium for anything unknown', () => {
    expect(x264Preset({})).toBe('medium');
    expect(x264Preset({ FOLIO_VIDEO_PRESET: 'VeryFast' })).toBe('veryfast');
    expect(x264Preset({ FOLIO_VIDEO_PRESET: 'warp9' })).toBe('medium');
  });
  it('names a hardware encoder only when asked for a known one', () => {
    expect(askedEncoder({})).toBe('libx264');
    expect(askedEncoder({ FOLIO_VIDEO_ENCODER: 'h264_nvenc' })).toBe('h264_nvenc');
    expect(askedEncoder({ FOLIO_VIDEO_ENCODER: 'magic' })).toBe('libx264');
  });
  it('vaapi uploads frames to the device; libx264 keeps the design tuning at the chosen preset', () => {
    const v = h264Args('h264_vaapi', { FOLIO_VAAPI_DEVICE: '/dev/dri/renderD129' });
    expect(v.global).toEqual(['-vaapi_device', '/dev/dri/renderD129']);
    expect(v.filters).toEqual(['format=nv12', 'hwupload']);
    expect(h264Args('libx264', { FOLIO_VIDEO_PRESET: 'fast' }).codec.join(' ')).toContain('-preset fast -tune animation -crf 18');
  });
  it('an odd-sized vaapi encode pads, then uploads, in one filter chain before the input is read', () => {
    const a = ffmpegArgs({ ...base, width: 1081 }, 't', 'h264_vaapi').join(' ');
    expect(a).toContain('-vf pad=ceil(iw/2)*2:ceil(ih/2)*2:0:0:white,format=nv12,hwupload');
    expect(a.indexOf('-vaapi_device')).toBeLessThan(a.indexOf('-i pipe:0'));
  });
});

describe.skipIf(!hasFfmpeg)('encoderWorks', () => {
  it('libx264 always works; a hardware encoder this host cannot run falls back to it', () => {
    expect(encoderWorks('libx264')).toBe(true);
    const env = { FOLIO_VIDEO_ENCODER: 'h264_vaapi', FOLIO_VAAPI_DEVICE: '/dev/dri/no-such-node' };
    expect(encoderWorks('h264_vaapi', 'ffmpeg', env)).toBe(false);
    expect(h264Encoder('ffmpeg', env)).toBe('libx264');
  }, 30_000);
});
