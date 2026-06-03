import { type StateManager, type EditorState } from '../../editor/state';
import type { DesignSpec, ScriptDef } from '../../schema/types';

// Studio Scripts panel — author design.scripts (Mode-B interactive output) and
// test-run them in the existing sandboxed iframe. Scripts receive (state, data,
// event, console); state mutations are reported back. Edits rewrite
// design.scripts; the export's Mode-B runtime wires them to triggers.

function esc(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
const cell = 'background:var(--color-bg);border:1px solid var(--color-border);border-radius:4px;padding:4px 6px;color:var(--color-text);font-size:11px;box-sizing:border-box;width:100%';
const TRIGGERS = ['onLoad', 'onClick', 'onChange', 'onTimer', 'manual'];

export class ScriptPanelManager {
  private container: HTMLElement;
  private state: StateManager;

  constructor(container: HTMLElement, state: StateManager) {
    this.container = container;
    this.state = state;
    this.state.subscribe(this.onStateChange.bind(this));
    this.render();
  }

  private onStateChange(_s: EditorState, keys: (keyof EditorState)[]): void {
    if (keys.includes('design')) this.render();
  }

  private scripts(): ScriptDef[] {
    return this.state.get().design?.scripts ?? [];
  }

  private mutate(fn: (scripts: ScriptDef[]) => ScriptDef[]): void {
    const design = this.state.get().design;
    if (!design) return;
    const next: DesignSpec = { ...design, scripts: fn([...(design.scripts ?? [])]) };
    // Scripts only run when the output is interactive — flip it on first script.
    if ((next.scripts?.length ?? 0) > 0 && next._output_mode !== 'interactive') next._output_mode = 'interactive';
    this.state.set('design', next);
  }

  private uniqueId(): string {
    const ids = new Set(this.scripts().map(s => s.id));
    let n = this.scripts().length + 1;
    while (ids.has(`script${n}`)) n++;
    return `script${n}`;
  }

  private btn(): string {
    return 'font-size:11px;padding:3px 8px;border:1px solid var(--color-border);border-radius:5px;background:var(--color-bg);color:var(--color-text);cursor:pointer';
  }

  render(): void {
    if (!this.state.get().design) { this.container.innerHTML = ''; return; }
    const scripts = this.scripts();
    const cards = scripts.map((s, i) => this.renderScript(s, i)).join('');
    this.container.innerHTML = `
      <div style="padding:8px 10px;display:flex;flex-direction:column;gap:8px">
        <div style="display:flex;align-items:center;justify-content:space-between">
          <span style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--color-text-muted)">Scripts (${scripts.length})</span>
          <button class="sp-btn" data-sp="add" style="${this.btn()}">+ Script</button>
        </div>
        <div style="font-size:10px;color:var(--color-text-dim);line-height:1.5">Scripts get <code>state, data, event, console</code> and run in a sandboxed iframe. Mutate <code>state</code> to drive the report.</div>
        ${cards || '<div style="color:var(--color-text-muted);font-size:11px;padding:6px 0">No scripts yet.</div>'}
      </div>`;
    this.bind();
  }

  private renderScript(s: ScriptDef, idx: number): string {
    const lang = s.language ?? 'javascript';
    const langSel = ['javascript', 'typescript'].map(l => `<option value="${l}"${lang === l ? ' selected' : ''}>${l}</option>`).join('');
    const trig = s.trigger ?? 'onLoad';
    const trigSel = TRIGGERS.map(t => `<option value="${t}"${trig === t ? ' selected' : ''}>${t}</option>`).join('');
    return `
      <div style="border:1px solid var(--color-border);border-radius:6px;padding:8px;background:var(--color-surface);display:flex;flex-direction:column;gap:5px">
        <div style="display:flex;align-items:center;gap:6px">
          <input class="sp-input" data-sp-field="id" data-idx="${idx}" value="${esc(s.id)}" style="${cell};flex:1;font-weight:600">
          <button class="sp-btn" data-sp="del" data-idx="${idx}" title="Delete" style="border:none;background:none;color:var(--color-text-muted);cursor:pointer;font-size:13px">✕</button>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px">
          <select class="sp-input" data-sp-field="language" data-idx="${idx}" style="${cell}">${langSel}</select>
          <select class="sp-input" data-sp-field="trigger" data-idx="${idx}" style="${cell}">${trigSel}</select>
        </div>
        <textarea class="sp-input sp-code" data-sp-field="code" data-idx="${idx}" rows="6" spellcheck="false" style="${cell};font-family:var(--font-mono);line-height:1.45;resize:vertical;tab-size:2">${esc(s.code)}</textarea>
        <div style="display:flex;align-items:center;gap:8px">
          <button class="sp-btn" data-sp="run" data-idx="${idx}" style="${this.btn()}">▶ Test run</button>
          <span class="sp-out" data-idx="${idx}" style="font-size:10px;color:var(--color-text-muted);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></span>
        </div>
      </div>`;
  }

  private bind(): void {
    this.container.querySelectorAll<HTMLElement>('[data-sp]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        const action = el.dataset.sp!;
        const idx = Number(el.dataset.idx);
        if (action === 'add') {
          this.mutate(s => [...s, { id: this.uniqueId(), language: 'javascript', trigger: 'onLoad', code: "// state, data, event, console are available\nstate.view = 'detail';\nconsole.log('ran', state.view);" }]);
        } else if (action === 'del') {
          this.mutate(s => s.filter((_, i) => i !== idx));
        } else if (action === 'run') {
          void this.run(idx, el);
        }
      });
    });
    this.container.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('.sp-input').forEach(el => {
      el.addEventListener('change', () => {
        const idx = Number(el.dataset.idx);
        const field = el.dataset.spField!;
        this.mutate(s => s.map((sc, i) => i === idx ? { ...sc, [field]: el.value } as ScriptDef : sc));
      });
    });
  }

  // Test-run a single script in the sandbox; surface state patches / errors.
  private async run(idx: number, btn: HTMLElement): Promise<void> {
    const script = this.scripts()[idx];
    if (!script) return;
    const out = this.container.querySelector<HTMLElement>(`.sp-out[data-idx="${idx}"]`);
    const say = (t: string, ok = true): void => { if (out) { out.textContent = t; out.style.color = ok ? 'var(--color-text-muted)' : 'var(--color-danger, #e57373)'; } };
    say('Running…');
    btn.setAttribute('disabled', 'true');
    try {
      const { buildSandboxSrcdoc, runInSandbox } = await import('../../export/script-sandbox');
      const design = this.state.get().design;
      const stateInit: Record<string, unknown> = {};
      for (const [k, def] of Object.entries(design?.state ?? {})) stateInit[k] = (def as { default?: unknown }).default;
      const data: Record<string, unknown[]> = {};
      for (const src of design?.report?.data?.sources ?? []) data[src.id] = (src as { rows?: unknown[] }).rows ?? [];
      const srcdoc = buildSandboxSrcdoc([script]);
      const res = await runInSandbox(srcdoc, script.id, { state: stateInit, data });
      if (res.ok) say(`✓ state → ${JSON.stringify(res.statePatches)}`);
      else say(`✗ ${res.error}`, false);
    } catch (err) {
      say(`✗ ${(err as Error).message}`, false);
    } finally {
      btn.removeAttribute('disabled');
    }
  }
}
