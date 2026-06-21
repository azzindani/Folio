// Folio engine — native DONUT + LINE chart rasterization. A `type:chart` layer is
// a foreignObject (vega) that renders BLANK in PNG/PDF (resvg can't run a browser).
// rasterizeBarChartLayer (engine-finalize-geom) already draws bar charts as native
// rects; this draws donut/pie + line/area charts as native path/ellipse/text so a
// hand-placed data dashboard isn't a hole where the chart should be. §0.4 — the
// engine owns the arc/polyline MATH so the model just says "donut with this data".
import type { Layer } from '../schema/types';

type Item = { label: string; value: number };

const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

function chartMark(o: Record<string, unknown>): string {
  const spec = o['spec'] as Record<string, unknown> | undefined;
  const markRaw = spec?.['mark'] ?? o['chart_type'] ?? o['chartType'];
  return typeof markRaw === 'string' ? markRaw.toLowerCase()
    : (markRaw && typeof markRaw === 'object' ? String((markRaw as Record<string, unknown>)['type'] ?? '').toLowerCase() : '');
}

function arcInnerRadius(o: Record<string, unknown>): number {
  const m = (o['spec'] as Record<string, unknown> | undefined)?.['mark'];
  return m && typeof m === 'object' ? num((m as Record<string, unknown>)['innerRadius'], 0) : 0;
}

function chartItems(o: Record<string, unknown>): Item[] {
  const spec = o['spec'] as Record<string, unknown> | undefined;
  const dv = (spec?.['data'] as Record<string, unknown> | undefined)?.['values'] ?? o['data'] ?? o['values'] ?? spec?.['values'];
  if (!Array.isArray(dv)) return [];
  return (dv as Record<string, unknown>[]).slice(0, 12).map(d => ({
    label: String(d['x'] ?? d['label'] ?? d['name'] ?? d['category'] ?? d['key'] ?? ''),
    value: Number(d['y'] ?? d['value'] ?? d['count'] ?? d['amount'] ?? d['percent'] ?? d['share'] ?? 0),
  })).filter(it => Number.isFinite(it.value));
}

// Draw a donut/pie as native arc paths + a swatch/label/percent legend on the right.
function rasterizeDonut(o: Record<string, unknown>, hole: boolean): Layer | null {
  const items = chartItems(o).filter(it => it.label || it.value);
  if (items.length < 2) return null;
  const x = num(o['x'], 100), y = num(o['y'], 200), w = num(o['width'], 440), h = num(o['height'], 380);
  const total = items.reduce((a, b) => a + Math.abs(b.value), 0) || 1;
  const R = Math.max(40, Math.min(Math.round(h * 0.46), Math.round(w * 0.24)));
  const rIn = hole ? Math.round(R * 0.58) : 0;
  const cx = x + R, cy = y + Math.round(h / 2);
  const accent = str(o['accent']) ?? str(o['bar_color']) ?? '$accent';
  const labelColor = str(o['label_color']) ?? '$text';
  const valueColor = str(o['value_color']) ?? '$muted';
  const palette = Array.isArray(o['colors']) ? (o['colors'] as unknown[]).filter(c => typeof c === 'string') as string[] : [];
  const sliceColor = (i: number): string => palette.length ? palette[i % palette.length] : accent;
  const sliceOpacity = (i: number): number => palette.length ? 1 : Math.max(0.3, 1 - i * 0.18);
  const cid = String(o['id'] ?? 'chart');
  const kids: Layer[] = [];
  let z = 0, a0 = -Math.PI / 2;
  const pt = (rad: number, ang: number): string => `${(cx + rad * Math.cos(ang)).toFixed(1)} ${(cy + rad * Math.sin(ang)).toFixed(1)}`;
  items.forEach((it, i) => {
    const a1 = a0 + (Math.abs(it.value) / total) * 2 * Math.PI;
    const la = (a1 - a0) > Math.PI ? 1 : 0;
    const d = rIn > 0
      ? `M ${pt(R, a0)} A ${R} ${R} 0 ${la} 1 ${pt(R, a1)} L ${pt(rIn, a1)} A ${rIn} ${rIn} 0 ${la} 0 ${pt(rIn, a0)} Z`
      : `M ${cx} ${cy} L ${pt(R, a0)} A ${R} ${R} 0 ${la} 1 ${pt(R, a1)} Z`;
    kids.push({ id: `${cid}_arc${i}`, type: 'path', z: z++, x: cx - R, y: cy - R, width: 2 * R, height: 2 * R, d, fill: { type: 'solid', color: sliceColor(i) }, opacity: sliceOpacity(i) } as unknown as Layer);
    a0 = a1;
  });
  const legendX = x + 2 * R + Math.round(w * 0.07);
  const rowH = Math.max(26, Math.min(46, Math.round((2 * R) / items.length)));
  const sw = 16, fs = Math.max(13, Math.min(20, Math.round(rowH * 0.42)));
  const legendTop = cy - Math.round((items.length * rowH) / 2);
  items.forEach((it, i) => {
    const ly = legendTop + i * rowH;
    const pct = Math.round((Math.abs(it.value) / total) * 100);
    kids.push({ id: `${cid}_sw${i}`, type: 'rect', z: z++, x: legendX, y: ly + 3, width: sw, height: sw, radius: 3, fill: { type: 'solid', color: sliceColor(i) }, opacity: sliceOpacity(i) } as unknown as Layer);
    kids.push({ id: `${cid}_ll${i}`, type: 'text', z: z++, x: legendX + sw + 12, y: ly, width: Math.max(60, w - (legendX - x) - sw - 84), height: rowH, content: { type: 'plain', value: it.label }, style: { font_size: fs, font_weight: 600, color: labelColor, line_height: 1.15 } } as unknown as Layer);
    kids.push({ id: `${cid}_lp${i}`, type: 'text', z: z++, x: x + w - 68, y: ly, width: 68, height: rowH, content: { type: 'plain', value: `${pct}%` }, style: { font_family: 'IBM Plex Mono', font_size: fs, font_weight: 700, color: valueColor, align: 'right' } } as unknown as Layer);
  });
  return { id: cid, type: 'group', z: num(o['z'], 0), x, y, width: w, height: h, layers: kids } as unknown as Layer;
}

// Draw a line/area chart as a native polyline path (+ faint area fill + dots + x labels).
function rasterizeLine(o: Record<string, unknown>, mark: string): Layer | null {
  const pts = chartItems(o).map(it => ({ x: it.label, y: it.value }));
  if (pts.length < 2) return null;
  const x = num(o['x'], 100), y = num(o['y'], 200), w = num(o['width'], 460), h = num(o['height'], 360);
  const ys = pts.map(p => p.y), ymin = Math.min(...ys), ymax = Math.max(...ys), span = (ymax - ymin) || 1;
  const axisH = Math.max(22, Math.round(h * 0.16));
  const chartH = h - axisH, plotBot = y + chartH;
  const accent = str(o['accent']) ?? str(o['line_color']) ?? str(o['bar_color']) ?? '$accent';
  const muted = str(o['label_color']) ?? '$muted';
  const px = (i: number): number => x + (i / (pts.length - 1)) * w;
  const py = (v: number): number => plotBot - chartH * 0.08 - ((v - ymin) / span) * chartH * 0.84;
  const lineD = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${px(i).toFixed(1)} ${py(p.y).toFixed(1)}`).join(' ');
  const cid = String(o['id'] ?? 'chart');
  const kids: Layer[] = [];
  let z = 0;
  kids.push({ id: `${cid}_area`, type: 'path', z: z++, x, y, width: w, height: chartH, d: `${lineD} L ${px(pts.length - 1).toFixed(1)} ${plotBot.toFixed(1)} L ${px(0).toFixed(1)} ${plotBot.toFixed(1)} Z`, fill: { type: 'solid', color: accent }, opacity: mark === 'area' ? 0.2 : 0.1 } as unknown as Layer);
  kids.push({ id: `${cid}_line`, type: 'path', z: z++, x, y, width: w, height: chartH, d: lineD, stroke: { color: accent, width: Math.max(3, Math.round(w * 0.006)) } } as unknown as Layer);
  const dotR = Math.max(4, Math.round(w * 0.011)), labW = Math.round(w * 0.22);
  pts.forEach((p, i) => {
    kids.push({ id: `${cid}_dot${i}`, type: 'ellipse', z: z++, x: px(i) - dotR, y: py(p.y) - dotR, width: 2 * dotR, height: 2 * dotR, fill: { type: 'solid', color: accent } } as unknown as Layer);
    if (p.x) {
      const lx = Math.max(x, Math.min(px(i) - labW / 2, x + w - labW));
      kids.push({ id: `${cid}_lx${i}`, type: 'text', z: z++, x: lx, y: plotBot + 8, width: labW, height: axisH, content: { type: 'plain', value: p.x }, style: { font_family: 'IBM Plex Mono', font_size: Math.max(12, Math.round(w * 0.03)), font_weight: 600, color: muted, align: 'center', line_height: 1.1 } } as unknown as Layer);
    }
  });
  return { id: cid, type: 'group', z: num(o['z'], 0), x, y, width: w, height: h, layers: kids } as unknown as Layer;
}

// Rasterize a hand-placed donut/pie or line/area chart → native group. Returns null
// for any other mark (bars handled by rasterizeBarChartLayer; unknown → foreignObject).
export function rasterizeNonBarChartLayer(l: Layer): Layer | null {
  const o = l as unknown as Record<string, unknown>;
  if (o['type'] !== 'chart') return null;
  const mark = chartMark(o);
  if (mark === 'arc' || mark === 'donut' || mark === 'doughnut') return rasterizeDonut(o, arcInnerRadius(o) > 0 || mark !== 'arc');
  if (mark === 'pie') return rasterizeDonut(o, false);
  if (mark === 'line' || mark === 'area' || mark === 'trend' || mark === 'spline' || mark === 'timeseries') return rasterizeLine(o, mark);
  return null;
}
