import { type StateManager } from '../../editor/state';
import type { Layer, TextLayer, ImageLayer } from '../../schema/types';

// ── Types ────────────────────────────────────────────────────
type Severity = 'error' | 'warning' | 'info';

interface A11yIssue {
  layerId: string;
  layerLabel: string;
  severity: Severity;
  rule: string;
  message: string;
  suggestion: string;
}

// ── Colour contrast helpers ──────────────────────────────────
function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return null;
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

function relativeLuminance(r: number, g: number, b: number): number {
  const ch = [r, g, b].map(v => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

function contrastRatio(hex1: string, hex2: string): number | null {
  const c1 = hexToRgb(hex1);
  const c2 = hexToRgb(hex2);
  if (!c1 || !c2) return null;
  const l1 = relativeLuminance(...c1);
  const l2 = relativeLuminance(...c2);
  const light = Math.max(l1, l2);
  const dark  = Math.min(l1, l2);
  return (light + 0.05) / (dark + 0.05);
}

// ── Rule checkers ────────────────────────────────────────────
function checkTextContrast(layer: TextLayer, issues: A11yIssue[]): void {
  const color   = layer.style?.color;
  const bgColor = (layer.meta?.background_color as string | undefined);
  if (!color || !bgColor) return;

  const ratio = contrastRatio(color, bgColor);
  if (ratio === null) return;

  const fontSize = layer.style?.font_size ?? 16;
  const isBig    = fontSize >= 18 || (fontSize >= 14 && (layer.style?.font_weight ?? 400) >= 700);
  const minNormal = 4.5;
  const minLarge  = 3.0;
  const required  = isBig ? minLarge : minNormal;

  if (ratio < required) {
    issues.push({
      layerId: layer.id, layerLabel: `text / ${layer.id}`,
      severity: ratio < 2 ? 'error' : 'warning',
      rule: 'WCAG 2.1 §1.4.3',
      message: `Contrast ratio ${ratio.toFixed(2)}:1 — minimum ${required}:1 required`,
      suggestion: `Darken text or lighten background. AA target: ${required}:1, AAA: ${isBig ? '4.5' : '7'}:1`,
    });
  }
}

function checkFontSize(layer: TextLayer, issues: A11yIssue[]): void {
  const size = layer.style?.font_size ?? 16;
  if (size < 12) {
    issues.push({
      layerId: layer.id, layerLabel: `text / ${layer.id}`,
      severity: size < 9 ? 'error' : 'warning',
      rule: 'WCAG 2.1 §1.4.4',
      message: `Font size ${size}px is very small`,
      suggestion: 'Use ≥12px for body text; ≥16px recommended for screen readability.',
    });
  }
}

function checkImageAlt(layer: ImageLayer, issues: A11yIssue[]): void {
  const alt = layer.meta?.alt as string | undefined;
  if (!alt || alt.trim() === '') {
    issues.push({
      layerId: layer.id, layerLabel: `image / ${layer.id}`,
      severity: 'warning',
      rule: 'WCAG 2.1 §1.1.1',
      message: 'Image has no alt text (meta.alt)',
      suggestion: 'Add meta.alt with a meaningful description of the image content.',
    });
  }
}

function checkEmptyText(layer: TextLayer, issues: A11yIssue[]): void {
  const val =
    (layer.content.type === 'plain' || layer.content.type === 'markdown')
      ? layer.content.value.trim()
      : null;
  if (val === '') {
    issues.push({
      layerId: layer.id, layerLabel: `text / ${layer.id}`,
      severity: 'info',
      rule: 'Content',
      message: 'Text layer has empty content',
      suggestion: 'Fill in content or remove the layer.',
    });
  }
}

function checkDuplicateIds(layers: Layer[], issues: A11yIssue[]): void {
  const seen = new Set<string>();
  for (const l of layers) {
    if (seen.has(l.id)) {
      issues.push({
        layerId: l.id, layerLabel: `${l.type} / ${l.id}`,
        severity: 'error',
        rule: 'Schema',
        message: `Duplicate layer ID: "${l.id}"`,
        suggestion: 'Each layer must have a unique id.',
      });
    }
    seen.add(l.id);
  }
}

function runChecks(layers: Layer[]): A11yIssue[] {
  const issues: A11yIssue[] = [];
  checkDuplicateIds(layers, issues);
  for (const l of layers) {
    if (l.type === 'text') {
      checkTextContrast(l as TextLayer, issues);
      checkFontSize(l as TextLayer, issues);
      checkEmptyText(l as TextLayer, issues);
    }
    if (l.type === 'image') {
      checkImageAlt(l as ImageLayer, issues);
    }
    // Recurse into groups / auto_layout
    if ('layers' in l && Array.isArray((l as { layers: Layer[] }).layers)) {
      issues.push(...runChecks((l as { layers: Layer[] }).layers));
    }
  }
  return issues;
}

// ── Panel ────────────────────────────────────────────────────
const ICON: Record<Severity, string> = {
  error:   '✕',
  warning: '⚠',
  info:    'ℹ',
};
const COLOR: Record<Severity, string> = {
  error:   '#e94560',
  warning: '#fdcb6e',
  info:    '#6c5ce7',
};

export class AccessibilityChecker {
  private container: HTMLElement;
  private state: StateManager;
  private listEl!: HTMLElement;
  private summaryEl!: HTMLElement;

  constructor(container: HTMLElement, state: StateManager) {
    this.container = container;
    this.state = state;
    this.build();
    this.state.subscribe((_, keys) => {
      if (keys.some(k => ['design', 'currentPageIndex'].includes(k))) {
        this.runAndRender();
      }
    });
    this.runAndRender();
  }

  private build(): void {
    this.container.innerHTML = `
      <div style="display:flex;flex-direction:column;height:100%;overflow:hidden">
        <div style="padding:6px 10px;display:flex;align-items:center;gap:8px;
                    border-bottom:1px solid var(--color-border)">
          <span style="font-size:11px;font-weight:600;text-transform:uppercase;
                       letter-spacing:.05em;color:var(--color-text-muted)">Accessibility</span>
          <button class="a11y-refresh"
            style="margin-left:auto;padding:2px 8px;border:1px solid var(--color-border);
                   border-radius:4px;background:var(--color-surface);color:var(--color-text);
                   font-size:10px;cursor:pointer">Run checks</button>
        </div>
        <div class="a11y-summary"
          style="padding:6px 10px;font-size:11px;color:var(--color-text-muted);
                 border-bottom:1px solid var(--color-border)">—</div>
        <div class="a11y-list"
          style="flex:1;overflow-y:auto;padding:6px"></div>
      </div>`;

    this.listEl    = this.container.querySelector('.a11y-list')!;
    this.summaryEl = this.container.querySelector('.a11y-summary')!;
    this.container.querySelector('.a11y-refresh')!
      .addEventListener('click', () => this.runAndRender());
  }

  private runAndRender(): void {
    const layers = this.state.getCurrentLayers();
    const issues = runChecks(layers);
    this.render(issues);
  }

  private render(issues: A11yIssue[]): void {
    const errors   = issues.filter(i => i.severity === 'error').length;
    const warnings = issues.filter(i => i.severity === 'warning').length;
    const infos    = issues.filter(i => i.severity === 'info').length;

    this.summaryEl.innerHTML = issues.length === 0
      ? '<span style="color:#00b894">✓ No issues found</span>'
      : `<span style="color:#e94560">${errors}E</span> ` +
        `<span style="color:#fdcb6e">${warnings}W</span> ` +
        `<span style="color:#6c5ce7">${infos}I</span>`;

    if (issues.length === 0) {
      this.listEl.innerHTML =
        '<div style="padding:12px 8px;font-size:11px;color:var(--color-text-muted);text-align:center">' +
        'All checks passed.</div>';
      return;
    }

    this.listEl.innerHTML = issues.map(issue => `
      <div class="a11y-item" data-layer-id="${issue.layerId}"
        style="padding:6px 8px;border-radius:4px;margin-bottom:4px;cursor:pointer;
               border-left:3px solid ${COLOR[issue.severity]};
               background:var(--color-surface)">
        <div style="display:flex;align-items:center;gap:5px;margin-bottom:2px">
          <span style="color:${COLOR[issue.severity]};font-size:11px;font-weight:700">${ICON[issue.severity]}</span>
          <span style="font-size:10px;color:var(--color-text-muted);font-family:var(--font-mono)">${issue.layerLabel}</span>
          <span style="font-size:9px;color:var(--color-text-muted);margin-left:auto">${issue.rule}</span>
        </div>
        <div style="font-size:11px;color:var(--color-text);margin-bottom:2px">${issue.message}</div>
        <div style="font-size:10px;color:var(--color-text-muted);line-height:1.4">${issue.suggestion}</div>
      </div>`).join('');

    // Click → select layer
    this.listEl.querySelectorAll<HTMLElement>('.a11y-item').forEach(el => {
      el.addEventListener('mouseenter', () => el.style.opacity = '.85');
      el.addEventListener('mouseleave', () => el.style.opacity = '1');
      el.addEventListener('click', () => {
        const id = el.dataset.layerId!;
        this.state.set('selectedLayerIds', [id]);
      });
    });
  }
}
