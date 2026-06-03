import { describe, it, expect, afterEach } from 'vitest';
import { StateManager } from '../../editor/state';
import { ScriptPanelManager } from './script-panel';
import type { DesignSpec, ScriptDef } from '../../schema/types';

function design(scripts?: ScriptDef[]): DesignSpec {
  return {
    _protocol: 'design/v1',
    meta: { id: 'r', name: 'R', type: 'report', created: '', modified: '' },
    document: { width: 1200, height: 100, unit: 'px', dpi: 96 },
    pages: [{ id: 'p', label: 'P', layers: [] }],
    report: { layout: 'flow' },
    ...(scripts ? { scripts } : {}),
  } as unknown as DesignSpec;
}
function setup(scripts?: ScriptDef[]) {
  const state = new StateManager();
  const el = document.createElement('div');
  document.body.appendChild(el);
  const panel = new ScriptPanelManager(el, state);
  state.set('design', design(scripts), false);
  return { state, el, panel };
}
const scripts = (s: StateManager): ScriptDef[] => s.get().design!.scripts ?? [];

afterEach(() => { document.body.innerHTML = ''; });

describe('ScriptPanelManager', () => {
  it('shows an empty state + Add button when there are no scripts', () => {
    const { el } = setup();
    expect(el.textContent).toContain('Scripts (0)');
    expect(el.querySelector('[data-sp="add"]')).not.toBeNull();
  });

  it('adds a script and flips the design to interactive output', () => {
    const { state, el } = setup();
    el.querySelector<HTMLButtonElement>('[data-sp="add"]')!.click();
    expect(scripts(state)).toHaveLength(1);
    expect(scripts(state)[0]).toMatchObject({ language: 'javascript', trigger: 'onLoad' });
    expect(state.get().design!._output_mode).toBe('interactive');
  });

  it('renders fields for an existing script', () => {
    const { el } = setup([{ id: 'onLoad', language: 'javascript', trigger: 'onLoad', code: "state.x=1" }]);
    expect(el.querySelector<HTMLInputElement>('.sp-input[data-sp-field="id"]')?.value).toBe('onLoad');
    expect(el.querySelector<HTMLTextAreaElement>('textarea[data-sp-field="code"]')?.value).toBe('state.x=1');
    expect(el.querySelector('[data-sp="run"]')).not.toBeNull();
  });

  it('edits the code via the textarea', () => {
    const { state, el } = setup([{ id: 's1', language: 'javascript', code: 'a' }]);
    const ta = el.querySelector<HTMLTextAreaElement>('textarea[data-sp-field="code"]')!;
    ta.value = "state.view='detail'";
    ta.dispatchEvent(new Event('change'));
    expect(scripts(state)[0].code).toBe("state.view='detail'");
  });

  it('changes language + trigger via selects', () => {
    const { state, el } = setup([{ id: 's1', language: 'javascript', code: '' }]);
    const lang = el.querySelector<HTMLSelectElement>('select[data-sp-field="language"]')!;
    lang.value = 'typescript'; lang.dispatchEvent(new Event('change'));
    expect(scripts(state)[0].language).toBe('typescript');
    const trig = el.querySelector<HTMLSelectElement>('select[data-sp-field="trigger"]')!;
    trig.value = 'onClick'; trig.dispatchEvent(new Event('change'));
    expect(scripts(state)[0].trigger).toBe('onClick');
  });

  it('deletes a script', () => {
    const { state, el } = setup([{ id: 'a', language: 'javascript', code: '' }, { id: 'b', language: 'javascript', code: '' }]);
    el.querySelector<HTMLButtonElement>('[data-sp="del"][data-idx="0"]')!.click();
    expect(scripts(state).map(s => s.id)).toEqual(['b']);
  });
});
