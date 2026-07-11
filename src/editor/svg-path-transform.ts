// WP-4.8 — apply a 2-D affine matrix [a,b,c,d,e,f] to an SVG path `d` string,
// so an imported element's transform can be BAKED into absolute coordinates (a
// Folio path layer has no transform-matrix field). Curves are preserved: every
// command's control/anchor points are mapped. Elliptical arcs (A) are the one
// approximation — the radii are scaled by the matrix's axis magnitudes and the
// x-axis-rotation is nudged by the matrix rotation, exact for translate/uniform-
// scale/rotate (the cases SVG importers actually emit).

export type Matrix = [number, number, number, number, number, number];

const CMD = /([MmLlHhVvCcSsQqTtAaZz])|(-?\d*\.?\d+(?:e[-+]?\d+)?)/gi;

function tokenize(d: string): Array<{ cmd?: string; num?: number }> {
  const out: Array<{ cmd?: string; num?: number }> = [];
  let m: RegExpExecArray | null;
  CMD.lastIndex = 0;
  while ((m = CMD.exec(d)) !== null) {
    if (m[1]) out.push({ cmd: m[1] });
    else out.push({ num: parseFloat(m[2]) });
  }
  return out;
}

function apply(mx: Matrix, x: number, y: number): [number, number] {
  return [mx[0] * x + mx[2] * y + mx[4], mx[1] * x + mx[3] * y + mx[5]];
}
// Vector (delta) transform — no translation, for relative commands.
function applyVec(mx: Matrix, x: number, y: number): [number, number] {
  return [mx[0] * x + mx[2] * y, mx[1] * x + mx[3] * y];
}
const r2 = (v: number): number => Math.round(v * 1000) / 1000;

/** Transform every coordinate in a path `d` by an affine matrix. Handles all
 *  command letters; relative commands stay relative (delta-transformed). */
export function transformPathD(d: string, mx: Matrix): string {
  const toks = tokenize(d);
  const scaleX = Math.hypot(mx[0], mx[1]);
  const scaleY = Math.hypot(mx[2], mx[3]);
  const rot = (Math.atan2(mx[1], mx[0]) * 180) / Math.PI;

  const out: string[] = [];
  let i = 0;
  const nextNums = (n: number): number[] => {
    const a: number[] = [];
    while (a.length < n && i < toks.length && toks[i].num !== undefined) a.push(toks[i++].num as number);
    return a;
  };

  while (i < toks.length) {
    const t = toks[i++];
    if (t.cmd === undefined) continue;
    const cmd = t.cmd;
    const abs = cmd === cmd.toUpperCase();
    const map = abs ? apply : applyVec;
    switch (cmd.toUpperCase()) {
      case 'Z': out.push('Z'); break;
      case 'M': case 'L': case 'T': {
        const [x, y] = nextNums(2);
        const [nx, ny] = map(mx, x, y);
        out.push(`${cmd}${r2(nx)} ${r2(ny)}`);
        break;
      }
      case 'H': { // horizontal — becomes a general line under rotation/skew
        const [x] = nextNums(1);
        const [nx, ny] = map(mx, x, 0);
        out.push(`${abs ? 'L' : 'l'}${r2(nx)} ${r2(ny)}`);
        break;
      }
      case 'V': {
        const [y] = nextNums(1);
        const [nx, ny] = map(mx, 0, y);
        out.push(`${abs ? 'L' : 'l'}${r2(nx)} ${r2(ny)}`);
        break;
      }
      case 'C': {
        const p = nextNums(6);
        const c = [map(mx, p[0], p[1]), map(mx, p[2], p[3]), map(mx, p[4], p[5])];
        out.push(`${cmd}${c.map(([a, b]) => `${r2(a)} ${r2(b)}`).join(' ')}`);
        break;
      }
      case 'S': case 'Q': {
        const p = nextNums(4);
        const c = [map(mx, p[0], p[1]), map(mx, p[2], p[3])];
        out.push(`${cmd}${c.map(([a, b]) => `${r2(a)} ${r2(b)}`).join(' ')}`);
        break;
      }
      case 'A': {
        const p = nextNums(7);
        const [rx, ry, xrot, laf, sf, x, y] = p;
        const [nx, ny] = map(mx, x, y);
        out.push(`${cmd}${r2(rx * scaleX)} ${r2(ry * scaleY)} ${r2(xrot + rot)} ${laf} ${sf} ${r2(nx)} ${r2(ny)}`);
        break;
      }
      default: break;
    }
  }
  return out.join('');
}
