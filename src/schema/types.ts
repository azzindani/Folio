import type { AnimationSpec } from '../animation/types';

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
  | 'auto_layout'
  | 'interactive_chart'
  | 'interactive_table'
  | 'rich_text'
  | 'kpi_card'
  | 'map'
  | 'embed_code'
  | 'popup';

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

// ── Gradient Color (for text/stroke) ────────────────────────
export type GradientColor = LinearGradientFill | RadialGradientFill;
export type ColorOrGradient = string | GradientColor;

// ── Stroke ──────────────────────────────────────────────────
export interface Stroke {
  color: ColorOrGradient;
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
  color?: ColorOrGradient;
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
  flip_h?: boolean;
  flip_v?: boolean;
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
  /** Layer id whose shape clips this layer (boolean mask / intersect) */
  clip_path_ref?: string;
  /** Per-layer animation spec */
  animation?: AnimationSpec;
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
  /** Name of a variant defined in ComponentSpec.variants */
  variant?: string;
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

// ── Data Binding Types ──────────────────────────────────────
export type DataSourceType = 'csv' | 'excel' | 'json' | 'inline' | 'api';
export type AggregateOp = 'sum' | 'avg' | 'min' | 'max' | 'count' | 'groupby' | 'filter' | 'sort';

export interface DataSource {
  id: string;
  type: DataSourceType;
  path?: string;
  sheet?: string;
  range?: string;
  headers?: boolean;
  delimiter?: string;
  rows?: Record<string, unknown>[];
  url?: string;
}

export interface DataSpec {
  sources: DataSource[];
}

// ── Report-specific Layer Types ─────────────────────────────

export type ChartType =
  | 'bar' | 'line' | 'area' | 'pie' | 'donut'
  | 'scatter' | 'heatmap' | 'funnel' | 'waterfall';

export interface InteractiveChartLayer extends BaseLayer {
  type: 'interactive_chart';
  chart_type: ChartType;
  data_ref: string;
  x_field?: string;
  y_field?: string;
  color_field?: string;
  title?: string;
  x_label?: string;
  y_label?: string;
  color_scheme?: string;
  custom_colors?: string[];
  legend?: boolean;
  grid?: boolean;
  interactive?: boolean;
  animate?: boolean;
}

export type TableFormatter = 'currency' | 'number' | 'percent' | 'date' | 'badge' | 'delta';

export interface TableColumn {
  field: string;
  title: string;
  width?: number;
  sortable?: boolean;
  formatter?: TableFormatter;
  align?: 'left' | 'center' | 'right';
}

export interface InteractiveTableLayer extends BaseLayer {
  type: 'interactive_table';
  data_ref: string;
  columns: TableColumn[];
  pagination?: boolean;
  page_size?: number;
  filterable?: boolean;
  exportable?: boolean;
  theme?: string;
}

export interface RichTextLayer extends BaseLayer {
  type: 'rich_text';
  content: string;
  format?: 'markdown' | 'html';
  font_family?: string;
  font_size?: number;
  line_height?: number;
  color?: string;
  link_color?: string;
}

export interface KpiCardLayer extends BaseLayer {
  type: 'kpi_card';
  label: string;
  value: string | number;
  format?: 'currency' | 'number' | 'percent' | 'custom';
  currency?: string;
  decimals?: number;
  delta?: string | number;
  delta_format?: 'percent' | 'number';
  delta_positive_color?: string;
  delta_negative_color?: string;
  sparkline_data?: string;
  sparkline_field?: string;
  sparkline_color?: string;
  icon?: string;
  background?: string;
  text_color?: string;
  border_radius?: number;
}

export type MapTileProvider = 'osm' | 'carto-dark' | 'carto-light' | 'stamen-toner';
export type MapOverlayType = 'markers' | 'heatmap' | 'choropleth';

export interface MapOverlay {
  type: MapOverlayType;
  data_ref: string;
  lat_field?: string;
  lng_field?: string;
  label_field?: string;
  value_field?: string;
  intensity_field?: string;
  color?: string;
}

export interface MapLayer extends BaseLayer {
  type: 'map';
  center: [number, number];
  zoom?: number;
  tile_provider?: MapTileProvider;
  overlays?: MapOverlay[];
}

export interface EmbedCodeLayer extends BaseLayer {
  type: 'embed_code';
  html: string;
  sandbox?: boolean;
  allow_scripts?: boolean;
}

export interface PopupLayer extends BaseLayer {
  type: 'popup';
  trigger_id?: string;
  trigger_event?: string;
  modal?: boolean;
  close_on_backdrop?: boolean;
  open_animation?: 'fade' | 'slide-up' | 'slide-right';
  layers?: Layer[];
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
  | AutoLayoutLayer
  | InteractiveChartLayer
  | InteractiveTableLayer
  | RichTextLayer
  | KpiCardLayer
  | MapLayer
  | EmbedCodeLayer
  | PopupLayer;

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
  type: 'poster' | 'carousel' | 'motion' | 'report';
  created: string;
  modified: string;
  generator?: string;
  generation?: GenerationMeta;
}

// ── Report Layout ───────────────────────────────────────────
export type ReportLayoutType = 'paged' | 'scroll' | 'tabs' | 'sidebar';

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
  report?: ReportSpec;
  // Mode B interactive output
  _output_mode?: 'static' | 'interactive';
  state?: Record<string, StateDef>;
  scripts?: ScriptDef[];
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
