// Folio schema — layer types: the LayerType/Layer unions and every concrete layer
// interface. Split out of types.ts; re-exported by it.
import type { AnimationSpec } from '../../animation/types';
import type { Effects, Fill, Interaction, PinConstraints, PositionShorthand, Radius, Stroke, TextContent, TextStyle } from './primitives';

// ── Layer Types ─────────────────────────────────────────────
export type LayerType =
  | 'rect'
  | 'circle'
  | 'ellipse'
  | 'path'
  | 'polygon'
  | 'polyline'
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
  | 'popup'
  | 'particle'
  | 'button'
  | 'tabs'
  | 'accordion'
  | 'filter_bar'
  | 'toggle'
  | 'tooltip'
  | 'callout'
  | 'progress';

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
  /** Flow-report grid span (1–12 columns). Ignored outside flow/scroll reports. */
  span?: number;
  /** Flow-report explicit row height override (px). Source of truth honored by
   *  computeFlowLayout (the computed `height` is rewritten each layout pass, so
   *  a user-resized height lives here instead). Ignored outside flow reports. */
  flow_h?: number;
  rotation?: number;
  flip_h?: boolean;
  flip_v?: boolean;
  visible?: boolean;
  locked?: boolean;
  opacity?: number;
  /** Hyperlink — wraps the rendered layer in an <a href>. Becomes a clickable
   *  link in the editor/HTML and a PDF link annotation in browser-printed PDFs. */
  href?: string;
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
  /** PowerApps-style formula bindings: { fill: "=state.active ? '#f00' : '#ccc'" } */
  formulas?: Record<string, string>;
  /**
   * A raw SVG transform appended to whatever the layer already has.
   *
   * Written by the frame sampler to materialise the skew_x/skew_y channels,
   * which the CSS route plays but a sampled still could not show. Authorable
   * by hand too, but presets and layout own placement — reach for x/y first.
   */
  transform?: string;
  /** Stroke dash pattern + offset — how the `draw` channel is materialised in a
   *  sampled frame: dasharray = the path's own length, offset = the part not
   *  yet drawn. */
  stroke_dasharray?: string | number;
  stroke_dashoffset?: number;
  /** SVG animateMotion path for kinetic animation */
  motion_path?: {
    path: string;        // SVG path d attribute (e.g. "M 0 0 Q 200 100 400 0")
    duration?: number;   // ms, default 2000
    loop?: boolean;
    easing?: string;     // CSS easing, default 'ease-in-out'
    auto_rotate?: boolean; // rotate element along path
  };
  /** 3D rotation transform */
  rotate3d?: {
    x?: number;          // degrees
    y?: number;
    z?: number;
    perspective?: number; // px, default 800
  };
}

// ── Concrete Layer Types ────────────────────────────────────
export interface RectLayer extends BaseLayer {
  type: 'rect';
  fill?: Fill;
  stroke?: Stroke;
  radius?: Radius;
}

export interface CircleLayer extends BaseLayer {
  // `ellipse` is accepted as an alias — same shape (rx/ry), same renderer.
  type: 'circle' | 'ellipse';
  cx?: number;
  cy?: number;
  rx?: number;
  ry?: number;
  fill?: Fill;
  stroke?: Stroke;
}

export interface PathLayer extends BaseLayer {
  // `polyline` is accepted as an alias — both go through the same renderer.
  type: 'path' | 'polyline';
  d: string;
  fill?: Fill;
  stroke?: Stroke;
  /** SVG fill-rule — 'evenodd' punches holes (ring/donut/gear shapes). */
  fill_rule?: 'nonzero' | 'evenodd';
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
  /** 'reference' = a locked, dimmed tracing underlay (a Canva export/screenshot
   *  the user is matching) — built on top of, then hidden/removed before export.
   *  Defaults to a normal content image when absent. */
  role?: 'content' | 'reference';
  // ── Photo treatments (WP-1.5) — pure SVG (clipPath + primitives), so every
  //    treatment rasterizes identically in resvg exports, not just the editor.
  /** Clip the photo to a shape; implies cover-fit. */
  mask?: 'circle' | 'blob' | 'arch' | 'rounded' | 'hex';
  /** Crop focus [fx, fy] as 0–1 fractions — keeps the subject when cover-cropping. */
  focal?: [number, number];
  /** Legibility scrim painted OVER the photo (inside the mask). */
  overlay?: { fill?: string; opacity?: number; blend?: string };
  /** Outline around the photo/mask shape. */
  frame?: { stroke?: string; width?: number; offset?: number };
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
export type DataSourceType = 'csv' | 'excel' | 'json' | 'inline' | 'api' | 'query' | 'transform';
/** Query engine for type:'query' sources. http = fetch a JSON endpoint; sql/duckdb need a configured connector. */
export type QueryEngine = 'http' | 'sql' | 'duckdb';
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
  /** type:'query' — the engine to run against. */
  engine?: QueryEngine;
  /** type:'query' — SQL text (sql/duckdb) or a JSONPath/key for http extraction. */
  query?: string;
  /** type:'query' — named connection (resolved server-side; creds never enter the design). */
  connection?: string;
  /** type:'transform' — id of the source dataset to aggregate. */
  from?: string;
  /** type:'transform' — field to group rows by. */
  group_by?: string;
  /** type:'transform' — aggregation operator. */
  agg?: 'sum' | 'avg' | 'min' | 'max' | 'count';
  /** type:'transform' — numeric field to aggregate (omit for count). */
  value?: string;
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
  /** Rendering library — chartjs (default) or plotly (heatmap/box/scatter/3d). */
  library?: 'chartjs' | 'plotly';
  /** Raw Plotly { data, layout } passthrough (library:'plotly') — static, advanced charts. */
  plotly_spec?: { data?: unknown[]; layout?: Record<string, unknown> };
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
  /** Click a row → open an auto-built detail modal of that row's fields. */
  row_detail?: boolean;
  /** Field whose value titles the row-detail modal (defaults to the first column). */
  row_detail_title?: string;
}

export interface RichTextLayer extends BaseLayer {
  type: 'rich_text';
  content: string;
  /**
   * Tolerated alias for `content`. AccordionItem and other prose-bearing
   * shapes call this field `body`, so authors reasonably reach for `body`
   * here too — accepting it beats rendering an empty box in silence.
   */
  body?: string;
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
  /** Title shown in the modal header (report export). */
  title?: string;
  /** Markdown body (alternative to child layers) for quick insight popups. */
  body?: string;
  layers?: Layer[];
}

// ── Interactive report controls ─────────────────────────────
/** A runtime action a control fires. Sugar strings also accepted:
 *  "open_modal:<id>", "close_modal", "toggle:<key>", "set:<key>=<val>",
 *  "filter:<field>", "tab:<group>:<id>", "accordion:<id>", "scroll_to:<id>",
 *  "open_url:<url>", "download_csv:<tableId>", "next_page"/"prev_page"/"goto_page:<id>". */
export type ControlActionType =
  | 'open_modal' | 'close_modal' | 'toggle' | 'set' | 'filter'
  | 'tab' | 'accordion' | 'scroll_to' | 'open_url' | 'download_csv'
  | 'next_page' | 'prev_page' | 'goto_page';

export interface ControlAction {
  type: ControlActionType;
  target?: string;     // modal id / state key / field / element id / url
  value?: string | number | boolean;
}

export interface ButtonLayer extends BaseLayer {
  type: 'button';
  label: string;
  /** Action sugar string ("open_modal:m1") or a structured ControlAction. */
  action?: string | ControlAction;
  icon?: string;
  variant?: 'solid' | 'outline' | 'ghost' | 'link';
  size?: 'sm' | 'md' | 'lg';
  background?: string;
  text_color?: string;
  border_radius?: number;
  full_width?: boolean;
}

export interface TabItem {
  id?: string;
  label: string;
  icon?: string;
  layers?: Layer[];
}

export interface TabsLayer extends BaseLayer {
  type: 'tabs';
  tabs: TabItem[];
  active?: number;            // initially-active tab index
  variant?: 'underline' | 'pills' | 'enclosed';
  align?: 'left' | 'center' | 'right' | 'stretch';
}

export interface AccordionItem {
  id?: string;
  title: string;
  /** Markdown body OR child layers (layers win when both present). */
  body?: string;
  layers?: Layer[];
  open?: boolean;
}

export interface AccordionLayer extends BaseLayer {
  type: 'accordion';
  items: AccordionItem[];
  /** Only one panel open at a time. */
  exclusive?: boolean;
}

export interface FilterOption {
  label: string;
  value: string | number;
}

export interface FilterBarLayer extends BaseLayer {
  type: 'filter_bar';
  /** State key the selection writes to (defaults to `field`). */
  state_key?: string;
  /** Dataset field this filters; linked tables/charts filter on it. */
  field: string;
  label?: string;
  multi?: boolean;
  /** Explicit options, or derive distinct values from a dataset. */
  options?: (FilterOption | string | number)[];
  options_from?: string;     // data_ref to derive distinct options from
  style?: 'chips' | 'buttons' | 'dropdown';
  include_all?: boolean;     // show an "All" reset chip
}

export interface ToggleLayer extends BaseLayer {
  type: 'toggle';
  state_key: string;
  label?: string;
  /** Two-option segmented switch; selecting writes value to state_key. */
  options: (FilterOption | string)[];
  value?: string | number | boolean;  // initial
  style?: 'switch' | 'segmented';
}

export interface TooltipLayer extends BaseLayer {
  type: 'tooltip';
  /** Visible trigger content (text or icon). */
  label?: string;
  icon?: string;
  /** Markdown shown on hover/focus. */
  content: string;
  placement?: 'top' | 'bottom' | 'left' | 'right';
}

export interface CalloutLayer extends BaseLayer {
  type: 'callout';
  variant?: 'info' | 'success' | 'warning' | 'danger' | 'neutral';
  title?: string;
  /** Markdown body. */
  content: string;
  icon?: string;
}

export interface ProgressLayer extends BaseLayer {
  type: 'progress';
  label?: string;
  value: number;             // 0..max
  max?: number;              // default 100
  style?: 'bar' | 'radial';
  color?: string;
  show_value?: boolean;
  unit?: string;             // suffix e.g. "%"
}

export interface ParticleLayer extends BaseLayer {
  type: 'particle';
  count?: number;      // default 50
  size?: number;       // default 4 (px)
  speed?: number;      // default 3 (seconds per cycle)
  colors?: string[];   // default ['#6c5ce7','#00cec9','#fd79a8']
  shape?: 'circle' | 'square' | 'star';
  spread?: number;     // 0-1, default 1 (full layer area)
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
  | PopupLayer
  | ParticleLayer
  | ButtonLayer
  | TabsLayer
  | AccordionLayer
  | FilterBarLayer
  | ToggleLayer
  | TooltipLayer
  | CalloutLayer
  | ProgressLayer;

