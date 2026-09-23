// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import yaml from 'js-yaml';
import { TIER3_HANDLERS } from '../handlers';

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).error === undefined && spawnSync('ffprobe', ['-version']).error === undefined;

/** A mono 16-bit WAV with a 10 ms click every beat. */
function clickWav(bpm: number, seconds: number, rate = 22_050): Buffer {
  const n = rate * seconds;
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  const every = Math.round((rate * 60) / bpm);
  for (let i = 0; i < n; i++) {
    const k = i % every;
    const v = k < rate * 0.01 ? Math.sin((2 * Math.PI * 1000 * k) / rate) * Math.exp(-k / (rate * 0.003)) * 20_000 : 0;
    b.writeInt16LE(Math.round(v), 44 + i * 2);
  }
  return b;
}

describe.skipIf(!hasFfmpeg)('diagnose_design — scene cuts against the beat', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-beatcut-'));
  const design = path.join(root, 'designs/deck.design.yaml');
  const write = (first: number, audio = true): void => {
    const page = (id: string, ms: number): Record<string, unknown> => ({ id, auto_advance: ms, layers: [{ id: `${id}-bg`, type: 'rect', z: 0, x: 0, y: 0, width: 64, height: 64, fill: '#FFFFFF' }] });
    fs.writeFileSync(design, yaml.dump({
      meta: { id: 'deck', name: 'Deck', type: 'carousel' }, document: { width: 64, height: 64 },
      pages: [page('s1', first), page('s2', 2400)], ...(audio ? { audio: [{ id: 'click', src: 'assets/audio/click.wav' }] } : {}),
    }));
  };
  const cuts = async (): Promise<Array<{ code: string; page?: string; message: string; fix?: string }>> => {
    const handler = TIER3_HANDLERS['diagnose_design'];
    const r = handler ? await handler({ design_path: design }) : {};
    return ((r as { findings?: Array<{ code: string; page?: string; message: string; fix?: string }> }).findings ?? []).filter(f => f.code === 'beat_cut');
  };
  beforeAll(() => {
    fs.mkdirSync(path.join(root, 'designs'), { recursive: true });
    fs.mkdirSync(path.join(root, 'assets/audio'), { recursive: true });
    fs.writeFileSync(path.join(root, 'assets/audio/click.wav'), clickWav(100, 16));
  });
  afterAll(() => { fs.rmSync(root, { recursive: true, force: true }); });

  it('names a cut 100 ms before the beat, with the scene length that lands it', async () => {
    write(2300);
    const [f, ...rest] = await cuts();
    expect(rest).toEqual([]);
    expect(f?.page).toBe('s2');
    expect(f?.message).toMatch(/cuts in at 2300ms, \d+ms before the beat/);
    const len = Number(/length_ms:(\d+)/.exec(f?.fix ?? '')?.[1]);
    expect(Math.abs(len - 2400)).toBeLessThan(15);
  }, 60_000);

  it('is quiet once the cut is on the beat, and without music', async () => {
    write(2400);
    expect(await cuts()).toEqual([]);
    write(2300, false);
    expect(await cuts()).toEqual([]);
  }, 60_000);
});
