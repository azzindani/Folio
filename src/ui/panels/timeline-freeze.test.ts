import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { StateManager } from '../../editor/state';
import { registerServerHost } from '../../editor/server-host';
import { TimelinePanelManager } from './timeline-panel';
import { holdMs, setHoldMs } from './clip-freeze';
import type { DesignSpec, Layer } from '../../schema/types';

const design = (): DesignSpec => ({
  _protocol: 'design/v1', meta: { id: 't', name: 'T', type: 'poster', created: '', modified: '' }, document: { width: 100, height: 100, unit: 'px', dpi: 96 },
  layers: [{ id: 'a', type: 'video', z: 1, x: 0, y: 0, width: 100, height: 100, src: 'assets/video/a.mp4', in: 0, out: 2000, video: { offset_ms: 0, duration_ms: 2000 } } as unknown as Layer],
}) as unknown as DesignSpec;

let host: HTMLElement, state: StateManager;
beforeEach(() => {
  setHoldMs(1000);
  state = new StateManager();
  state.set('design', design(), false);
  host = document.createElement('div');
  document.body.appendChild(host);
  new TimelinePanelManager(host, state);
});
afterEach(() => { host.remove(); document.querySelectorAll('.toast').forEach(t => t.remove()); });

describe('❄ Freeze on the timeline', () => {
  it('sits beside ✂ Split with the remembered hold, clamped to what the engine accepts', () => {
    expect(host.querySelector('#tl-split')).not.toBeNull();
    expect(host.querySelector('#tl-freeze')).not.toBeNull();
    const hold = host.querySelector('#tl-hold') as HTMLInputElement;
    expect(hold.value).toBe('1000');
    hold.value = '2500'; hold.dispatchEvent(new Event('change'));
    expect(holdMs()).toBe(2500);
    hold.value = '5'; hold.dispatchEvent(new Event('change'));
    expect(holdMs()).toBe(100);
    expect(hold.value).toBe('100');
  });

  it('a design with no server file says where to save it, and changes nothing', async () => {
    registerServerHost({ rel: () => null, save: async () => false });
    (host.querySelector('#tl-freeze') as HTMLButtonElement).click();
    await new Promise(r => setTimeout(r, 20));
    expect(document.body.textContent).toContain('save the design to the library');
    expect(state.getCurrentLayers().map(l => l.id)).toEqual(['a']);
  });
});
