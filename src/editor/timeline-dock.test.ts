import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { StateManager } from './state';
import { wireTimelineDock } from './timeline-dock';
import type { DesignSpec, Layer } from '../schema/types';

let app: HTMLElement, phone: { matches: boolean; fire: () => void };
const q = <T extends HTMLElement>(sel: string): T => app.querySelector(sel) as T;

const design = (video: boolean): DesignSpec => ({
  _protocol: 'design/v1', meta: { id: 't', name: 'T', type: 'poster', created: '', modified: '' }, document: { width: 10, height: 10, unit: 'px', dpi: 96 },
  layers: [video ? { id: 'v', type: 'video', z: 1, x: 0, y: 0, width: 10, height: 10, src: 'a.mp4', in: 0, video: { offset_ms: 0, duration_ms: 1000 } } : { id: 'r', type: 'rect', z: 1, x: 0, y: 0, width: 10, height: 10 }] as unknown as Layer[],
}) as unknown as DesignSpec;

beforeEach(() => {
  localStorage.clear();
  const listeners: Array<() => void> = [];
  phone = { matches: false, fire: () => listeners.forEach(f => f()) };
  (window as unknown as { matchMedia: unknown }).matchMedia = () => ({ get matches() { return phone.matches; }, addEventListener: (_: string, f: () => void) => listeners.push(f) });
  app = document.createElement('div');
  app.id = 'app';
  app.innerHTML = `<div class="canvas-section"><div class="timeline-dock" id="timeline-dock" style="display:none"><div data-resize="timeline-dock"></div><button id="timeline-dock-close"></button><div class="timeline-dock-body"></div></div></div>
    <div class="rail"><button class="rpanel-tab" data-tab="timeline"></button></div>
    <div class="tab-pane" data-tab="timeline"><div class="timeline-content"></div></div><button id="status-timeline"></button>`;
  document.body.appendChild(app);
});
afterEach(() => { app.remove(); localStorage.clear(); });

describe('the timeline dock', () => {
  it('takes the timeline out of the right pane on a desktop; closed until asked, then kept', () => {
    const dock = wireTimelineDock(app, new StateManager());
    expect(q('.timeline-dock-body').contains(q('.timeline-content'))).toBe(true);
    expect(q('#timeline-dock').style.display).toBe('none');
    expect(app.classList.contains('has-timeline-dock')).toBe(true);
    expect(dock?.toggle()).toBe(true);
    expect(q('#timeline-dock').style.display).toBe('');
    expect(app.classList.contains('timeline-dock-open')).toBe(true);
    expect(q('#status-timeline').classList.contains('active')).toBe(true);
    expect(localStorage.getItem('folio-timeline-dock-open')).toBe('1');
    expect(dock?.toggle(false)).toBe(false);
    expect(q('#timeline-dock').style.display).toBe('none');
    expect(localStorage.getItem('folio-timeline-dock-open')).toBe('0');
  });

  it('the rail\'s clock tab SHOWS it (never closes it) instead of switching the empty pane; the status button and ✕ flip it', () => {
    const dock = wireTimelineDock(app, new StateManager());
    let reached = 0;
    q('.rpanel-tab').addEventListener('click', () => { reached++; });
    q('.rpanel-tab').click();
    expect(dock?.isOpen()).toBe(true);
    q('.rpanel-tab').click();
    expect(dock?.isOpen()).toBe(true);
    expect(reached).toBe(0);
    q('#status-timeline').click();
    expect(dock?.isOpen()).toBe(false);
    q('#status-timeline').click();
    expect(dock?.isOpen()).toBe(true);
    q('#timeline-dock-close').click();
    expect(dock?.isOpen()).toBe(false);
  });

  it('the first design with footage opens it once; a choice already made is respected', () => {
    const state = new StateManager();
    wireTimelineDock(app, state);
    state.set('design', design(false), false);
    expect(q('#timeline-dock').style.display).toBe('none');
    state.set('design', design(true), false);
    expect(q('#timeline-dock').style.display).toBe('');
    // Closed by hand: a later design with footage leaves it closed.
    app.remove(); localStorage.setItem('folio-timeline-dock-open', '0');
    document.body.appendChild(app);
    const again = new StateManager();
    wireTimelineDock(app, again);
    again.set('design', design(true), false);
    expect(q('#timeline-dock').style.display).toBe('none');
  });

  it('on a phone there is no dock: the timeline stays in its sheet, and returns there when the layout turns phone', () => {
    phone.matches = true;
    const dock = wireTimelineDock(app, new StateManager());
    expect(q('.tab-pane').contains(q('.timeline-content'))).toBe(true);
    expect(dock?.toggle()).toBe(false);
    expect(q('#timeline-dock').style.display).toBe('none');
    expect(app.classList.contains('has-timeline-dock')).toBe(false);
    phone.matches = false; phone.fire();
    expect(q('.timeline-dock-body').contains(q('.timeline-content'))).toBe(true);
    phone.matches = true; phone.fire();
    expect(q('.tab-pane').contains(q('.timeline-content'))).toBe(true);
  });
});
