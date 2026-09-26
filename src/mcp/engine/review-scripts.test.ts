// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest';
import type { DesignSpec, Layer, ScriptLayer } from '../../schema/types';
import { reviewLayout } from './layout-review';
import { withMotion } from './layout-review-motion';
import { captureForReview } from './review-scripts';
import { chromiumPath } from './script-capture';
import { Cdp } from './cdp-client';
import { clearScriptFrames, collectScripts } from '../../scripting/script-frames';

// A component that paints most of its box: a script piece the review used to read as empty.
const PAINT = `const c = document.getElementById('c'), g = c.getContext('2d'); c.width = folio.width; c.height = folio.height;
folio.frame(t => { g.clearRect(0, 0, c.width, c.height); g.fillStyle = '#26221C'; g.fillRect(0, 0, c.width, c.height * Math.min(1, 0.4 + t / 4000)); });`;
const walk = { id: 'walk', type: 'script', z: 1, x: 80, y: 80, width: 900, height: 900, html: '<canvas id="c"></canvas>', js: PAINT, duration: 4000 } as unknown as ScriptLayer;
const bg = { id: 'bg', type: 'rect', z: 0, x: 0, y: 0, width: 1080, height: 1080, fill: '#F4EDE0' } as unknown as Layer;
const spec = (markers?: Record<string, number>): DesignSpec =>
  ({ meta: { id: 's', name: 'S', type: 'poster' }, document: { width: 1080, height: 1080 }, layers: [bg, walk as unknown as Layer], ...(markers ? { markers } : {}) } as unknown as DesignSpec);

afterEach(() => clearScriptFrames());

describe('the layout review reads a script component as drawn (close-out C4)', () => {
  it('asks for the component at the page\'s first moment and at every shot it measures', () => {
    const s = spec({ open: 0, late: 3000 });
    const { missing } = collectScripts(() => withMotion(reviewLayout(s, '/tmp'), s, '/tmp'));
    const times = [...new Set(missing.map(m => m.t))].sort((a, b) => a - b);
    expect(times[0]).toBe(0);
    expect(times.length).toBeGreaterThanOrEqual(2);
  }, 30_000);

  it('answers with no work for a design without components', async () => {
    const s = { ...spec(), layers: [bg] } as DesignSpec;
    expect(await captureForReview(s, '/tmp')).toEqual({ notes: [], keys: [] });
  });

  it.skipIf(!chromiumPath() || !Cdp.available())('measures the drawing once its frames are captured', async () => {
    const s = spec();
    expect(reviewLayout(s, '/tmp')[0]?.ink ?? 1).toBeLessThan(0.05);
    const got = await captureForReview(s, '/tmp');
    expect(got.keys.length).toBeGreaterThan(0);
    expect(reviewLayout(s, '/tmp')[0]?.ink ?? 0).toBeGreaterThan(0.25);
  }, 60_000);
});
