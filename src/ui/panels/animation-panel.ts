import type { StateManager, EditorState } from '../../editor/state';
import type { AnimationSpec } from '../../animation/types';
import type {
  EnterAnimationType, ExitAnimationType, LoopAnimationType, EasingFunction,
} from '../../animation/types';

const ENTER_TYPES: EnterAnimationType[] = [
  'fade_in', 'fade_up', 'fade_down', 'fade_left', 'fade_right',
  'scale_in', 'scale_up', 'slide_up', 'slide_down', 'slide_left', 'slide_right',
  'flip_in', 'rotate_in', 'blur_in', 'bounce_in',
];

const EXIT_TYPES: ExitAnimationType[] = [
  'fade_out', 'fade_up_out', 'fade_down_out',
  'scale_out', 'slide_up_out', 'slide_down_out', 'blur_out',
];

const LOOP_TYPES: LoopAnimationType[] = [
  'float', 'pulse', 'glow', 'spin', 'shake', 'bounce', 'breathe',
];

const EASINGS: EasingFunction[] = [
  'linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out',
];

const NONE = '(none)';

export class AnimationPanel {
  private container: HTMLElement;
  private state: StateManager;

  constructor(container: HTMLElement, state: StateManager) {
    this.container = container;
    this.state = state;
    this.render();
    this.state.subscribe(this.onStateChange.bind(this));
  }

  private onStateChange(_s: EditorState, keys: (keyof EditorState)[]): void {
    if (keys.includes('selectedLayerIds') || keys.includes('animations') || keys.includes('design')) {
      this.render();
    }
  }

  render(): void {
    const { selectedLayerIds, animations } = this.state.get();
    const layerId = selectedLayerIds[0];

    if (!layerId) {
      this.container.innerHTML = `
        <div style="padding:16px;font-size:12px;color:var(--color-text-muted)">
          Select a layer to add animations.
        </div>`;
      return;
    }

    const anim: AnimationSpec = animations[layerId] ?? {};

    this.container.innerHTML = `
      <div class="anim-panel">
        <div class="anim-section">
          <div class="anim-section-title">Entrance</div>
          ${this.renderAnimGroup('enter', anim.enter)}
        </div>
        <div class="anim-section">
          <div class="anim-section-title">Loop</div>
          ${this.renderLoopGroup(anim.loop)}
        </div>
        <div class="anim-section">
          <div class="anim-section-title">Exit</div>
          ${this.renderAnimGroup('exit', anim.exit)}
        </div>
        <div class="anim-section">
          <div class="anim-section-title">Keyframes
            <button class="anim-add-kf btn btn-sm" style="font-size:10px;padding:1px 5px">+ Add</button>
          </div>
          ${this.renderKeyframeList(anim)}
        </div>
      </div>`;

    this.bindEvents(layerId, anim);
  }

  private renderAnimGroup(
    kind: 'enter' | 'exit',
    current?: { type?: string; delay?: number; duration?: number; easing?: string },
  ): string {
    const types = kind === 'enter' ? ENTER_TYPES : EXIT_TYPES;
    const typeOpts = [NONE, ...types].map(t =>
      `<option value="${t}"${t === (current?.type ?? NONE) ? ' selected' : ''}>${t}</option>`
    ).join('');
    const easingOpts = EASINGS.map(e =>
      `<option value="${e}"${e === (current?.easing ?? 'ease') ? ' selected' : ''}>${e}</option>`
    ).join('');

    return `
      <div style="display:grid;gap:4px">
        <select class="anim-select" data-kind="${kind}" data-field="type">${typeOpts}</select>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px">
          ${this.renderNumInput(kind, 'delay',    'Delay ms',    current?.delay ?? 0)}
          ${this.renderNumInput(kind, 'duration', 'Duration ms', current?.duration ?? 400)}
          <div>
            <div class="anim-label">Easing</div>
            <select class="anim-select" data-kind="${kind}" data-field="easing"
              style="width:100%">${easingOpts}</select>
          </div>
        </div>
      </div>`;
  }

  private renderLoopGroup(current?: { type?: string; duration?: number }): string {
    const typeOpts = [NONE, ...LOOP_TYPES].map(t =>
      `<option value="${t}"${t === (current?.type ?? NONE) ? ' selected' : ''}>${t}</option>`
    ).join('');
    return `
      <div style="display:grid;gap:4px">
        <select class="anim-select" data-kind="loop" data-field="type">${typeOpts}</select>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px">
          ${this.renderNumInput('loop', 'duration', 'Duration ms', current?.duration ?? 1000)}
        </div>
      </div>`;
  }

  private renderNumInput(kind: string, field: string, label: string, value: number): string {
    return `
      <div>
        <div class="anim-label">${label}</div>
        <input class="anim-num" type="number" min="0" step="50"
          data-kind="${kind}" data-field="${field}" value="${value}"
          style="width:100%">
      </div>`;
  }

  private renderKeyframeList(anim: AnimationSpec): string {
    const kfs = anim.keyframes ?? [];
    if (!kfs.length) return `<div style="font-size:10px;color:var(--color-text-muted);padding:4px 0">No keyframes yet.</div>`;

    return kfs.map((kf, i) => `
      <div class="anim-kf-row" data-kf-index="${i}">
        <span class="anim-kf-t">${kf.t}ms</span>
        <span class="anim-kf-props">${Object.keys(kf).filter(k => k !== 't').join(', ')}</span>
        <button class="anim-kf-del" data-kf-index="${i}" title="Remove keyframe">&times;</button>
      </div>`).join('');
  }

  private bindEvents(layerId: string, anim: AnimationSpec): void {
    // Select + number input changes
    this.container.querySelectorAll<HTMLSelectElement>('.anim-select').forEach(sel => {
      sel.addEventListener('change', () => this.applyChange(layerId, anim, sel.dataset.kind!, sel.dataset.field!, sel.value));
    });

    this.container.querySelectorAll<HTMLInputElement>('.anim-num').forEach(inp => {
      inp.addEventListener('change', () => this.applyChange(layerId, anim, inp.dataset.kind!, inp.dataset.field!, parseFloat(inp.value)));
    });

    // Add keyframe (at t=0 by default)
    this.container.querySelector('.anim-add-kf')?.addEventListener('click', () => {
      const kfs = [...(anim.keyframes ?? [])];
      const t = kfs.length ? (kfs[kfs.length - 1].t ?? 0) + 500 : 0;
      kfs.push({ t, opacity: 1 });
      const updated = { ...anim, keyframes: kfs };
      this.state.set('animations', { ...this.state.get().animations, [layerId]: updated }, false);
    });

    // Delete keyframe
    this.container.querySelectorAll<HTMLButtonElement>('.anim-kf-del').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.kfIndex!, 10);
        const kfs = (anim.keyframes ?? []).filter((_, i) => i !== idx);
        const updated = { ...anim, keyframes: kfs };
        this.state.set('animations', { ...this.state.get().animations, [layerId]: updated }, false);
      });
    });
  }

  private applyChange(layerId: string, anim: AnimationSpec, kind: string, field: string, value: unknown): void {
    const updated: AnimationSpec = { ...anim };

    if (kind === 'enter') {
      if (value === NONE) {
        delete updated.enter;
      } else {
        updated.enter = { ...(updated.enter ?? {}), [field]: value } as AnimationSpec['enter'];
        if (!updated.enter!.type) delete updated.enter;
      }
    } else if (kind === 'exit') {
      if (value === NONE) {
        delete updated.exit;
      } else {
        updated.exit = { ...(updated.exit ?? {}), [field]: value } as AnimationSpec['exit'];
        if (!updated.exit!.type) delete updated.exit;
      }
    } else if (kind === 'loop') {
      if (value === NONE) {
        delete updated.loop;
      } else {
        updated.loop = { ...(updated.loop ?? {}), [field]: value } as AnimationSpec['loop'];
        if (!updated.loop!.type) delete updated.loop;
      }
    }

    this.state.set('animations', { ...this.state.get().animations, [layerId]: updated }, false);
  }
}
