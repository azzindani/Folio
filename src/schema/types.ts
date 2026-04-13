// ── Layer Types ─────────────────────────────────────────────
export type LayerType =
  | 'rect'
  | 'circle'
  | 'path'
  | 'polygon'
  | 'line'
  | 'text'
  | 'image'
  | 'icon'
  | 'component'
  | 'component_list'
  | 'mermaid'
  | 'chart'
  | 'code'
  | 'math'
  | 'group'
  | 'qrcode'
  | 'auto_layout';

// ── Fill Types ──────────────────────────────────────────────
export interface SolidFill {
  type: 'solid';
  color: string;
  opacity?: number;
}

export interface GradientStop {
  color: string;
  position: number; // 0–100
}

export interface LinearGradientFill {
  type: 'linear';
  angle: number;
  stops: GradientStop[];
}

export interface RadialGradientFill {
  type: 'radial';
  cx: number;
  cy: number;
  radius: number;
  stops: GradientStop[];
}

export interface ConicGradientFill {
  type: 'conic';
  cx: number;
  cy: number;
  stops: GradientStop[];
}

export interface NoiseFill {
  type: 'noise';
  opacity: number;
  frequency: number;
  octaves: number;
}

export interface MultiFill {
  type: 'multi';
  layers: Fill[];
}

export interface NoneFill {
  type: 'none';
}

export type Fill =
  | SolidFill
  | LinearGradientFill
  | RadialGradientFill
  | ConicGradientFill
  | NoiseFill
  | MultiFill
  | NoneFill;

// ── Stroke ──────────────────────────────────────────────────
export interface Stroke {
  color: string;
  width: number;
  dash?: number[];
  linecap?: 'butt' | 'round' | 'square';
  linejoin?: 'miter' | 'round' | 'bevel';
}

// ── Text Content ────────────────────────────────────────────
export interface PlainTextContent {
  type: 'plain';
  value: string;
}

export interface MarkdownTextContent {
  type: 'markdown';
  value: string;
}

export interface RichTextSpan {
  text: string;
  bold?: boolean;
  italic?: boolean;
  color?: string;
  size?: number;
  font_family?: string;
}

export interface RichTextContent {
  type: 'rich';
  spans: RichTextSpan[];
}

export interface ExpressionContent {
  type: 'expression';
  value: string;
}

export type TextContent =
  | PlainTextContent
  | MarkdownTextContent
  | RichTextContent
  | ExpressionContent;

// ── Text Style ──────────────────────────────────────────────
export interface TextStyle {
  font_family?: string;
  font_size?: number;
  font_weight?: number;
  color?: string;
  line_height?: number;
  letter_spacing?: number;
  align?: 'left' | 'center' | 'right';
  vertical_align?: 'top' | 'middle' | 'bottom';
  text_decoration?: 'none' | 'underline' | 'line-through';
}

// ── Shadow ──────────────────────────────────────────────────
export interface Shadow {
  x: number;
  y: number;
  blur: number;
  spread?: number;
  color: string;
}

// ── Effects ─────────────────────────────────────────────────
export interface Effects {
  shadows?: Shadow[];
  blur?: number;
  backdrop_blur?: number;
  opacity?: number;
  blend_mode?: string;
}

// ── Corner Radius ───────────────────────────────────────────
export type Radius = number | { tl: number; tr: number; br: number; bl: number };

// ── Interaction ─────────────────────────────────────────────
export interface HoverEffect {
  scale?: number;
  shadow?: string;
  'fill.opacity'?: number;
  transform?: string;
  transition?: string;
}

export interface Interaction {
  on_click?: {
    action: string;
    target?: string;
  };
  on_hover?: HoverEffect;
  cursor?: string;
}

// ── Position Shorthand ──────────────────────────────────────
export interface GridPosition {
  mode: 'grid';
  col_start: number;
  col_span: number;
  row_start: number;
  baseline_offset: number;
}

export type PositionShorthand = [number, number, number, number] | GridPosition;

// ── Responsive Constraints ──────────────────────────────────
export interface PinConstraints {
  /** Which edges are pinned to the parent/canvas edge */
  left?:   boolean;
  right?:  boolean;
  top?:    boolean;
  bottom?: boolean;
  /** Fix width/height regardless of parent resize */
  fix_width?:  boolean;
  fix_height?: boolean;
}

// ── Base Layer ──────────────────────────────────────────────
export interface BaseLayer {
  id: string;
  type: LayerType;
  z: number;
  x?: number;
  y?: number;
  width?: number | 'auto';
  height?: number | 'auto';
  pos?: PositionShorthand;
  rotation?: number;
  visible?: boolean;
  locked?: boolean;
  opacity?: number;
  clip?: boolean;
  effects?: Effects;
  interaction?: Interaction;
  meta?: Record<string, unknown>;
  /** Conditional visibility — plain JS expression string evaluated at render */
  show_if?: string;
  /** Responsive pin constraints */
  constraints?: PinConstraints;
}

// ── Concrete Layer Types ────────────────────────────────────
export interface RectLayer extends BaseLayer {
  type: 'rect';
  fill?: Fill;
  stroke?: Stroke;
  radius?: Radius;
}

export interface CircleLayer extends BaseLayer {
  type: 'circle';
  cx?: number;
  cy?: number;
  rx?: number;
  ry?: number;
  fill?: Fill;
  stroke?: Stroke;
}

export interface PathLayer extends BaseLayer {
  type: 'path';
  d: string;
  fill?: Fill;
  stroke?: Stroke;
}

export interface PolygonLayer extends BaseLayer {
  type: 'polygon';
  points?: string;
  sides?: number;
  fill?: Fill;
  stroke?: Stroke;
}

export interface LineLayer extends BaseLayer {
  type: 'line';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stroke?: Stroke;
}

export interface TextLayer extends BaseLayer {
  type: 'text';
  content: TextContent;
  style?: TextStyle;
}

export interface ImageLayer extends BaseLayer {
  type: 'image';
  src: string;
  fit?: 'cover' | 'contain' | 'fill' | 'none';
  crop?: { x: number; y: number; width: number; height: number };
}

export interface IconLayer extends BaseLayer {
  type: 'icon';
  name: string;
  size?: number;
  color?: string;
}

export interface ComponentLayer extends BaseLayer {
  type: 'component';
  ref: string;
  slots?: Record<string, unknown>;
  overrides?: Record<string, unknown>;
}

export interface ComponentListLayer extends BaseLayer {
  type: 'component_list';
  component_ref: string;
  items: Record<string, unknown>[];
  gap?: number;
}

export interface MermaidLayer extends BaseLayer {
  type: 'mermaid';
  definition: string;
}

export interface ChartLayer extends BaseLayer {
  type: 'chart';
  spec: Record<string, unknown>;
}

export interface CodeLayer extends BaseLayer {
  type: 'code';
  language: string;
  code: string;
  theme?: string;
}

export interface MathLayer extends BaseLayer {
  type: 'math';
  expression: string;
}

export interface GroupLayer extends BaseLayer {
  type: 'group';
  layers: Layer[];
}

export interface QRCodeLayer extends BaseLayer {
  type: 'qrcode';
  value: string;
  error_correction?: 'L' | 'M' | 'Q' | 'H';
  fill?: string;          // module color (default: '#000000')
  background?: string;   // background color (default: 'transparent')
}

export interface AutoLayoutLayer extends BaseLayer {
  type: 'auto_layout';
  direction: 'row' | 'column';
  gap?: number;
  padding?: number | { top: number; right: number; bottom: number; left: number };
  align_items?: 'start' | 'center' | 'end' | 'stretch';
  justify_content?: 'start' | 'center' | 'end' | 'space-between' | 'space-around';
  wrap?: boolean;
  fill?: Fill;
  stroke?: Stroke;
  radius?: Radius;
  layers: Layer[];
}

export type Layer =
  | RectLayer
  | CircleLayer
  | PathLayer
  | PolygonLayer
  | LineLayer
  | TextLayer
  | ImageLayer
  | IconLayer
  | ComponentLayer
  | ComponentListLayer
  | MermaidLayer
  | ChartLayer
  | CodeLayer
  | MathLayer
  | GroupLayer
  | QRCodeLayer
  | AutoLayoutLayer;

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

// ── Page ────────────────────────────────────────────────────
export interface Page {
  id: string;
  label?: string;
  template_ref?: string;
  slots?: Record<string, unknown>;
  layers?: Layer[];
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
  type: 'poster' | 'carousel' | 'motion';
  created: string;
  modified: string;
  generator?: string;
  generation?: GenerationMeta;
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
  layers?: Layer[];
  pages?: Page[];
}

// ── Component Definition ────────────────────────────────────
export interface ComponentProp {
  type: 'string' | 'number' | 'color' | 'boolean' | 'enum';
  default?: unknown;
  options?: string[];
  description?: string;
}

export interface ComponentSpec {
  _protocol: 'component/v1';
  name: string;
  version: string;
  description?: string;
  props: Record<string, ComponentProp>;
  locked_props?: string[];
  layers: Layer[];
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
