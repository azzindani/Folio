// Folio schema — primitive value types: fills, strokes, text content, text style,
// effects, and layout/position helpers. Split out of types.ts; re-exported by it.

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
  /** Center X (%). Defaults to 50. */
  cx?: number;
  /** Center Y (%). Defaults to 50. */
  cy?: number;
  /** Radius (%). Defaults to 50. */
  radius?: number;
  stops: GradientStop[];
}

export interface ConicGradientFill {
  type: 'conic';
  /** Center X (%). Defaults to 50. */
  cx?: number;
  /** Center Y (%). Defaults to 50. */
  cy?: number;
  stops: GradientStop[];
}

export interface NoiseFill {
  type: 'noise';
  opacity: number;
  frequency: number;
  octaves: number;
}

/** Generative tiled patterns — dots, stripes, grids, halftone, memphis, etc.
 *  Rendered as an SVG <pattern> so it tiles seamlessly and rasterizes in resvg. */
export type PatternName =
  | 'dots' | 'dot_grid' | 'grid' | 'graph_paper' | 'isometric'
  | 'stripes' | 'diagonal_stripes' | 'crosshatch' | 'checkerboard'
  | 'chevron' | 'zigzag' | 'triangles' | 'waves' | 'scallop'
  | 'plus' | 'cross' | 'scatter' | 'confetti' | 'halftone' | 'blueprint'
  | 'carbon' | 'houndstooth' | 'brick';

export interface PatternFill {
  type: 'pattern';
  pattern: PatternName;
  /** Foreground (marks) color. */
  fg: string;
  /** Background color; omit for transparent (pattern floats over fills below). */
  bg?: string;
  /** Tile-size multiplier (1 = preset default, ~24px). */
  scale?: number;
  /** Rotation of the whole field, degrees. */
  angle?: number;
  /** Mark weight / stroke multiplier (1 = default). */
  weight?: number;
  /** Mark opacity 0–1. */
  opacity?: number;
}

/** Image / photo-texture fill — tile a texture or fit a single image into the shape. */
export interface ImageFill {
  type: 'image';
  src: string;
  /** tile = repeat texture; cover/contain = single fitted image. Default 'cover'. */
  mode?: 'tile' | 'cover' | 'contain';
  /** Tile edge length in px when mode='tile'. Default 96. */
  tile_size?: number;
  opacity?: number;
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
  | PatternFill
  | ImageFill
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
/** Outline drawn around glyphs (text stroke). */
export interface TextStroke {
  color: string;
  width: number;
}

export interface TextStyle {
  font_family?: string;
  font_size?: number;
  font_weight?: number;
  color?: ColorOrGradient;
  line_height?: number;
  letter_spacing?: number;
  word_spacing?: number;
  align?: 'left' | 'center' | 'right';
  text_align?: 'left' | 'center' | 'right';
  vertical_align?: 'top' | 'middle' | 'bottom';
  text_decoration?: 'none' | 'underline' | 'line-through' | 'overline';
  /** CSS text-transform — UPPERCASE labels, etc. */
  text_transform?: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
  font_style?: 'normal' | 'italic' | 'oblique';
  /** Variable-font axes, e.g. { wght: 350, wdth: 80, opsz: 48, slnt: -6 }. */
  font_variation_settings?: Record<string, number>;
  /** OpenType features, e.g. { liga: 1, smcp: 1, tnum: 1, ss01: 1 } or a raw string. */
  font_feature_settings?: Record<string, number> | string;
  /** Glyph outline (text stroke). */
  stroke?: TextStroke;
  /** Marker/highlighter band painted behind the text. */
  highlight?: string;
  /** Curve plain text along an SVG path (single line). `d` is absolute coords;
   *  `side`/`start_offset`/`spacing` tune placement. */
  text_path?: { d: string; side?: 'left' | 'right'; start_offset?: number };
}

// ── Shadow ──────────────────────────────────────────────────
export interface Shadow {
  x: number;
  y: number;
  blur: number;
  spread?: number;
  color: string;
}

// ── Duotone ─────────────────────────────────────────────────
/** Maps a layer's luminance onto a two-color ramp (shadows→highlights).
 *  The signature editorial/photo treatment; applied via feColorMatrix. */
export interface Duotone {
  /** Color mapped to dark/shadow pixels. */
  shadow: string;
  /** Color mapped to light/highlight pixels. */
  highlight: string;
}

// ── Effects ─────────────────────────────────────────────────
export interface Effects {
  shadows?: Shadow[];
  blur?: number;
  /** Gaussian blur of whatever sits *behind* the layer (glassmorphism). */
  backdrop_blur?: number;
  opacity?: number;
  blend_mode?: string;
  /** Two-tone luminance remap (editorial photo look). */
  duotone?: Duotone;
  /** Film/paper grain overlaid on the layer, 0–1 intensity. */
  grain?: number;
  /** Posterize to N tonal levels (2–8) for a screen-print look. */
  posterize?: number;
  /** Saturation multiplier (0 = grayscale, 1 = unchanged, >1 = punchy). */
  saturate?: number;
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

