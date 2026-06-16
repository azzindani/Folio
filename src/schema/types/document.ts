// Folio schema — document-level types: theme, palette, type/effects packs, page,
// presentation, report, design, component, template, project. Split out of types.ts.
import type { DataSpec, Layer } from './layers';

// ── Theme ───────────────────────────────────────────────────
export interface TypographyScale {
  size: number;
  weight: number;
  line_height: number;
}

export interface ThemeSpec {
  _protocol: 'theme/v1';
  name: string;
  version: string;
  colors: Record<string, string | Record<string, string>>;
  typography: {
    scale: Record<string, TypographyScale>;
    families: Record<string, string>;
  };
  spacing: {
    unit: number;
    scale: number[];
  };
  effects: Record<string, string | number>;
  radii: Record<string, number>;
}

// ── Palette ─────────────────────────────────────────────────
/**
 * A PaletteSpec is the colors-only slice of a theme, packaged so it can
 * be swapped independently. composeTheme(theme, { palette }) overlays
 * palette.colors on top of theme.colors — the rest of the theme
 * (typography, spacing, radii, effects) is untouched.
 *
 * Authored as `*.palette.yaml` under public/styles/palettes/ and indexed
 * by scripts/gen-palette-index.mjs.
 */
export interface PaletteSpec {
  _protocol: 'palette/v1';
  /** Stable slug used by `palette: { ref: <id> }` references. */
  id: string;
  /** Display name shown in the picker. */
  name: string;
  /** Author-managed semver for cache busting. */
  version: string;
  /** Mood/domain tags surfaced in the picker (e.g. "formal", "healthcare"). */
  tags?: string[];
  /** One-line description shown on hover. */
  description?: string;
  /**
   * Same shape as ThemeSpec.colors — keys overlay the theme's color
   * map. Any keys not declared here fall through to the theme.
   */
  colors: Record<string, string | Record<string, string>>;
}

// ── Type pack ───────────────────────────────────────────────
/**
 * A TypePackSpec is the typography slice of a theme — font families
 * plus the type scale. Swappable independently so the same template +
 * palette pair can read as "editorial serif" or "geometric sans" by
 * flipping a single ref.
 *
 * composeTheme(theme, { typePack }) overlays typePack.families on top
 * of theme.typography.families, and (if provided) typePack.scale on
 * top of theme.typography.scale. Unspecified slots fall through.
 *
 * Authored as `*.type-pack.yaml` under public/styles/type-packs/.
 */
export interface TypePackSpec {
  _protocol: 'type-pack/v1';
  id: string;
  name: string;
  version: string;
  tags?: string[];
  description?: string;
  /** Font family slots: heading / body / mono / display / accent / ... */
  families: Record<string, string>;
  /** Optional size+weight+line-height scale (overlays theme.typography.scale). */
  scale?: Record<string, TypographyScale>;
}

// ── Effects pack ────────────────────────────────────────────
/**
 * An EffectsPackSpec is the effects slice of a theme — shadows, blur,
 * glow, and any other "surface treatment" tokens. Swapping packs flips
 * the visual register (flat / neon / brutalist / soft-elevation)
 * without touching colors or typography.
 *
 * composeTheme(theme, { effectsPack }) overlays effectsPack.effects on
 * top of theme.effects. Unspecified keys fall through.
 *
 * Authored as `*.effects-pack.yaml` under public/styles/effects-packs/.
 */
export interface EffectsPackSpec {
  _protocol: 'effects-pack/v1';
  id: string;
  name: string;
  version: string;
  tags?: string[];
  description?: string;
  /** Same shape as ThemeSpec.effects — overlays the theme's effects map. */
  effects: Record<string, string | number>;
}

// ── Easing ───────────────────────────────────────────────────
export type EasingFunction =
  | 'linear' | 'ease' | 'ease-in' | 'ease-out' | 'ease-in-out'
  | `cubic-bezier(${string})` | `steps(${string})`;

// ── Page Transition ─────────────────────────────────────────
export type PageTransitionType =
  | 'none' | 'fade' | 'slide-left' | 'slide-right' | 'slide-up' | 'slide-down'
  | 'zoom-in' | 'zoom-out' | 'flip-h' | 'flip-v' | 'cube-left' | 'cube-right'
  | 'reveal' | 'wipe-left' | 'wipe-right' | 'dissolve' | 'morph';

export interface PageTransition {
  type: PageTransitionType;
  duration?: number;   // ms, default 400
  easing?: EasingFunction;
}

// ── Audio Track ──────────────────────────────────────────────
export interface AudioTrack {
  id: string;
  src: string;        // URL or base64 data URI
  start_time?: number; // ms offset into the presentation timeline
  duration?: number;
  volume?: number;    // 0–1
  loop?: boolean;
  fade_in?: number;   // ms
  fade_out?: number;  // ms
}

// ── Presentation Settings ────────────────────────────────────
export interface PresentationSettings {
  auto_advance?: number;   // ms per slide; 0 = manual
  loop?: boolean;
  show_progress?: boolean;
  show_slide_numbers?: boolean;
  show_controls?: boolean;
  keyboard?: boolean;
  touch?: boolean;
  fullscreen_on_start?: boolean;
  aspect_ratio?: '16:9' | '4:3' | '1:1' | string;
}

// ── Page ────────────────────────────────────────────────────
export interface Page {
  id: string;
  label?: string;
  template_ref?: string;
  slots?: Record<string, unknown>;
  layers?: Layer[];
  /** Incoming transition (plays when this slide enters) */
  transition?: PageTransition;
  /** Speaker notes (markdown) */
  notes?: string;
  /** Per-slide auto-advance override in ms (0 = manual) */
  auto_advance?: number;
  /** Audio cues that start when this slide becomes active */
  audio_cues?: Pick<AudioTrack, 'src' | 'volume' | 'fade_in'>[];
}

// ── Design Document ─────────────────────────────────────────
export interface DesignDocument {
  width: number;
  height: number;
  unit: string;
  dpi: number;
  aspect_ratio?: string;
}

export interface GenerationMeta {
  status: 'in_progress' | 'complete';
  total_pages: number;
  completed_pages: number;
  last_operation?: string;
}

export interface DesignMeta {
  id: string;
  name: string;
  type: 'poster' | 'carousel' | 'motion' | 'report' | 'presentation';
  created: string;
  modified: string;
  generator?: string;
  generation?: GenerationMeta;
}

// ── Report Layout ───────────────────────────────────────────
export type ReportLayoutType = 'paged' | 'scroll' | 'tabs' | 'sidebar' | 'flow';

export interface NavigationSpec {
  type: 'sidebar' | 'topbar' | 'tabs' | 'dots';
  width?: number;
  position?: 'left' | 'right';
  labels?: boolean;
  collapsible?: boolean;
  show_icons?: boolean;
  active_color?: string;
  background?: string;
}

export interface ReportSpec {
  layout: ReportLayoutType;
  navigation?: NavigationSpec;
  data?: DataSpec;
  /** Force responsive flow rendering (12-col grid, no fixed canvas) regardless of layout. */
  flow?: boolean;
  /** Centered container max width in px for scroll/flow reports (default 1200). */
  max_width?: number;
  /** Accent color for links, active states, chart defaults (CSS color or token). */
  accent?: string;
  /** Heading font family (Google font name) for flow reports. */
  font_heading?: string;
  /** Body font family (Google font name) for flow reports. */
  font_body?: string;
}

export interface DesignSpec {
  _protocol: 'design/v1';
  _mode?: 'complete' | 'in_progress';
  meta: DesignMeta;
  document: DesignDocument;
  theme?: {
    ref: string;
    overrides?: Record<string, string>;
  };
  /**
   * Optional style overlays. Each axis is orthogonal — a design can
   * mix any palette × type pack × effects pack on top of its theme.
   * composeTheme() applies them in order before render.
   */
  palette?: {
    ref: string;
  };
  type_pack?: {
    ref: string;
  };
  effects_pack?: {
    ref: string;
  };
  layers?: Layer[];
  pages?: Page[];
  report?: ReportSpec;
  // Presentation / motion settings
  presentation?: PresentationSettings;
  audio?: AudioTrack[];
  // Mode B interactive output
  _output_mode?: 'static' | 'interactive';
  state?: Record<string, StateDef>;
  scripts?: ScriptDef[];
  /**
   * Per-layer animations keyed by layer id. Loaded into editor state
   * on loadDesign and applied to the SVG by injecting CSS keyframes
   * + animation rules so static templates can ship with motion
   * (enter, loop, exit). Used by both canvas preview and exporters.
   */
  animations?: Record<string, import('../../animation/types').AnimationSpec>;
}

// ── Mode B — Interactive Output ─────────────────────────────
export interface StateDef {
  type: 'string' | 'number' | 'boolean';
  default: unknown;
}

export interface ScriptDef {
  id: string;
  language: 'typescript' | 'javascript';
  trigger?: string;
  code: string;
}

// ── Component Definition ────────────────────────────────────
export interface ComponentProp {
  type: 'string' | 'number' | 'color' | 'boolean' | 'enum';
  default?: unknown;
  options?: string[];
  description?: string;
}

/**
 * A named variant overrides a subset of a component's props.
 * e.g. { name: 'primary', props: { color: '#6c5ce7' } }
 */
export interface ComponentVariant {
  name: string;
  description?: string;
  /** Prop values to merge over the component defaults when this variant is active */
  props: Record<string, unknown>;
  /** Optional layer-level overrides (keyed by layer id) */
  overrides?: Record<string, Partial<Layer>>;
}

export interface ComponentSpec {
  _protocol: 'component/v1';
  name: string;
  version: string;
  description?: string;
  props: Record<string, ComponentProp>;
  locked_props?: string[];
  layers: Layer[];
  /** Named variants — select one via ComponentLayer.variant */
  variants?: ComponentVariant[];
}

// ── Template Definition ─────────────────────────────────────
export interface SlotDefinition {
  type: 'string' | 'number' | 'color' | 'boolean' | 'image' | 'icon';
  default?: unknown;
  description?: string;
  required?: boolean;
}

export interface TemplateSpec {
  _protocol: 'template/v1';
  name: string;
  version: string;
  description?: string;
  slots: Record<string, SlotDefinition>;
  document: DesignDocument;
  layers: Layer[];
}

// ── Project Manifest ────────────────────────────────────────
export interface ProjectConfig {
  default_theme: string;
  default_canvas: string;
  default_export_format: string;
  grid?: {
    columns: number;
    gutter: number;
    margin: number;
    baseline: number;
  };
}

export interface ProjectDesignEntry {
  id: string;
  path: string;
  type: string;
  pages?: number;
  status?: string;
  thumbnail?: string | null;
}

export interface ProjectSpec {
  _protocol: 'project/v1';
  meta: {
    id: string;
    name: string;
    version: string;
    created: string;
    modified: string;
    author?: string;
    tags?: string[];
  };
  config: ProjectConfig;
  themes: { id: string; path: string; active?: boolean }[];
  components: { registry: string };
  templates: { registry: string };
  designs: ProjectDesignEntry[];
  assets: {
    fonts: { id: string; path: string; family: string; variable?: boolean }[];
    images: { id: string; path: string }[];
  };
  exports: unknown[];
}
