// THE asset resolver for server-side rendering (render_preview AND
// export_design run this — one truth, no preview/export divergence).
// For every image layer src and image fill src, in place on the in-memory
// spec (never the file on disk):
//   assets/… path  → found: embed as data: URI (resvg can't read relative
//                    hrefs) · missing: blank → placeholder frame + note
//   data: URI      → validated; undecodable: blank → placeholder + note
//   https?:// URL  → server can't fetch: blank → placeholder + note that
//                    names the fix (asset_add). NO SILENT BLANKS.
import * as fs from 'fs';
import * as path from 'path';
import type { DesignSpec, Layer, Page } from '../../schema/types';
import type { Fill } from '../../schema/types';
import { parseDimensions } from './reference';
import { readAssetManifest } from './assets';

const EXT_MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  gif: 'image/gif', avif: 'image/avif', svg: 'image/svg+xml',
};

// Trust the BYTES over the filename — a PNG saved as .jpg would make resvg
// JPEG-decode PNG bytes and silently render nothing (live-audit finding).
function sniffMime(buf: Buffer, ext: string): string | undefined {
  if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf.length >= 3 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'image/gif';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buf.slice(0, 512).toString('utf8').trimStart().startsWith('<')) return 'image/svg+xml';
  return EXT_MIME[ext];
}

/** Search order — the same contract flagMissingImages used. */
export function assetBaseDirs(designPath: string, projectPath?: string): string[] {
  const dirs = [path.dirname(designPath), path.dirname(path.dirname(designPath))];
  const proj = projectPath ?? path.dirname(path.dirname(designPath));
  dirs.push(proj, path.join(proj, 'assets'));
  return dirs;
}

type Resolution =
  | { kind: 'keep' }                       // already renderable (valid data: URI)
  | { kind: 'embed'; dataUri: string }     // file found → inline
  | { kind: 'blank'; note: string };       // unrenderable → placeholder + note

function resolveSrc(src: string, id: string, dirs: string[]): Resolution {
  const s = src.trim();
  if (!s) return { kind: 'keep' };

  if (/^data:/i.test(s)) {
    const m = s.match(/^data:([^;,]*)(;base64)?,([\s\S]*)$/);
    if (m) {
      const mime = (m[1] ?? '').toLowerCase();
      if (mime.includes('svg')) return { kind: 'keep' };
      try {
        const buf = m[2] ? Buffer.from(m[3] ?? '', 'base64') : Buffer.from(decodeURIComponent(m[3] ?? ''), 'binary');
        if (buf.length > 0 && parseDimensions(buf)) return { kind: 'keep' };
      } catch { /* fall through to blank */ }
    }
    return { kind: 'blank', note: `image "${id}": the data: URI is not a decodable image — re-encode it, or store the file with manage_design {op:"asset_add"} and use src:"assets/images/…".` };
  }

  if (/^(https?:|\/\/)/i.test(s)) {
    return { kind: 'blank', note: `image "${id}": remote URL "${s.slice(0, 60)}" renders in the EDITOR only — server exports cannot fetch it. Store it with manage_design {op:"asset_add"} and use src:"assets/images/…" so it appears in PNG/PDF too.` };
  }

  // Local path (relative, or file:// stripped) — search the base dirs.
  const rel = s.replace(/^file:\/\//i, '');
  for (const d of dirs) {
    try {
      const abs = path.resolve(d, rel);
      if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
        const ext = (abs.match(/\.([a-z0-9]+)$/i)?.[1] ?? '').toLowerCase();
        const buf = fs.readFileSync(abs);
        const mime = sniffMime(buf, ext);
        if (!mime) return { kind: 'blank', note: `image "${id}": "${s}" is not a supported image type — use png/jpg/webp/gif/avif/svg.` };
        return { kind: 'embed', dataUri: `data:${mime};base64,${buf.toString('base64')}` };
      }
    } catch { /* try the next base dir */ }
  }
  return { kind: 'blank', note: `image "${id}": asset "${s}" not found — exported as a placeholder frame. Upload it first (manage_design {op:"asset_add"}) or check the path with {op:"asset_list"}.` };
}

function resolveFill(fill: Fill | undefined, id: string, dirs: string[], notes: string[]): Fill | undefined {
  if (!fill || typeof fill !== 'object') return fill;
  if (fill.type === 'multi' && Array.isArray(fill.layers)) {
    return { ...fill, layers: fill.layers.map(f => resolveFill(f, id, dirs, notes) ?? f) };
  }
  if (fill.type !== 'image' || typeof fill.src !== 'string') return fill;
  const r = resolveSrc(fill.src, id, dirs);
  if (r.kind === 'embed') return { ...fill, src: r.dataUri };
  if (r.kind === 'blank') {
    notes.push(r.note.replace(`image "${id}"`, `image fill on "${id}"`));
    // A fill has no placeholder frame — degrade to a quiet neutral so the
    // shape still reads instead of vanishing.
    return { type: 'solid', color: 'rgba(128,128,160,0.12)' };
  }
  return fill;
}

/**
 * diagnose_design image audit — pure read (works on a CLONE, never mutates
 * the caller's spec): unresolvable srcs become warnings, and resolvable
 * rasters are checked for aspect distortion (>5%) and upscaling (>2×
 * native), the two placement mistakes a vision-less model cannot see.
 */
export interface ImageFinding {
  code: string;
  severity: 'error' | 'warning' | 'suggestion';
  message: string;
  layer_id?: string;
}

export function auditImageAssets(spec: DesignSpec, designPath: string, projectPath?: string): ImageFinding[] {
  const findings: ImageFinding[] = [];
  const clone = JSON.parse(JSON.stringify(spec)) as DesignSpec;
  for (const note of resolveImageAssets(clone, designPath, projectPath)) {
    const id = note.match(/"([^"]+)"/)?.[1];
    findings.push({ code: 'image_unresolvable', severity: 'warning', message: note, ...(id ? { layer_id: id } : {}) });
  }
  const visit = (layers: Layer[] | undefined): void => {
    for (const l of layers ?? []) {
      if (l.type === 'image') {
        const img = l as Layer & { src?: string; width?: number; height?: number; fit?: string };
        const m = (img.src ?? '').match(/^data:image\/(?:png|jpeg|webp|gif);base64,([\s\S]+)$/);
        if (m && typeof img.width === 'number' && typeof img.height === 'number' && img.width > 0 && img.height > 0) {
          try {
            const native = parseDimensions(Buffer.from(m[1], 'base64'));
            if (native && native.w > 0 && native.h > 0) {
              const ratio = (img.width / img.height) / (native.w / native.h);
              if (!img.fit && Math.abs(ratio - 1) > 0.05) {
                findings.push({ code: 'image_distorted', severity: 'warning', layer_id: l.id,
                  message: `image "${l.id}": box ${img.width}×${img.height} distorts the ${native.w}×${native.h} source by ${Math.round(Math.abs(ratio - 1) * 100)}% — add fit:"cover" (crop) or match the native aspect.` });
              }
              if (img.width > native.w * 2 || img.height > native.h * 2) {
                findings.push({ code: 'image_upscaled', severity: 'suggestion', layer_id: l.id,
                  message: `image "${l.id}": displayed at ${img.width}×${img.height} but the source is only ${native.w}×${native.h} — >2× upscale will look soft in exports. Use a larger source or a smaller box.` });
              }
            }
          } catch { /* not decodable — already reported as unresolvable */ }
        }
      }
      if (l.type === 'group') visit((l as Layer & { layers?: Layer[] }).layers);
    }
  };
  visit(clone.layers);
  for (const p of clone.pages ?? []) visit((p as Page & { layers?: Layer[] }).layers);
  // Text-on-busy-image check runs on the ORIGINAL spec (the clone's srcs were
  // just rewritten to data: URIs, losing the assets/ path the manifest keys on).
  findings.push(...auditBusyImageText(spec, designPath, projectPath));
  return findings;
}

/**
 * WP-1.4: a vision-less model can't see that its headline landed on a BUSY
 * photo. Ingest already classifies each asset's luminance (dark|light|busy) —
 * flag text sitting ≥60% on a busy image with no painted scrim between them
 * in z. Suggestion-tier: a deliberate art-directed overlap stays legal (§0.4).
 */
function auditBusyImageText(spec: DesignSpec, designPath: string, projectPath?: string): ImageFinding[] {
  const findings: ImageFinding[] = [];
  const projectDir = projectPath ?? path.dirname(path.dirname(designPath));
  const manifest = readAssetManifest(projectDir);
  const busyPaths = new Set<string>();
  for (const rows of Object.values(manifest)) {
    for (const e of rows ?? []) if (e.luminance === 'busy') busyPaths.add(e.path.replace(/^\.\//, ''));
  }
  if (!busyPaths.size) return findings;

  const box = (l: Layer): { x: number; y: number; w: number; h: number; z: number } => {
    const r = l as unknown as Record<string, unknown>;
    return { x: Number(r['x']) || 0, y: Number(r['y']) || 0, w: Number(r['width']) || 0, h: Number(r['height']) || 0, z: Number(r['z']) || 0 };
  };
  // Fraction of box `a` covered by box `b`.
  const coveredBy = (a: ReturnType<typeof box>, b: ReturnType<typeof box>): number => {
    const ox = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
    const oy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    return a.w * a.h > 0 ? (ox * oy) / (a.w * a.h) : 0;
  };
  const checkArray = (layers: Layer[] | undefined, page?: string): void => {
    const flat: Layer[] = [];
    const collect = (ls?: Layer[]): void => {
      for (const l of ls ?? []) { if (l) { flat.push(l); if (l.type === 'group') collect((l as Layer & { layers?: Layer[] }).layers); } }
    };
    collect(layers);
    const busyImages = flat.filter(l => l.type === 'image'
      && busyPaths.has(String((l as Layer & { src?: string }).src ?? '').replace(/^\.\//, '')));
    if (!busyImages.length) return;
    for (const t of flat) {
      if (t.type !== 'text') continue;
      const tb = box(t);
      if (tb.w <= 0) continue;
      if (tb.h <= 0) tb.h = 48;                                   // unmeasured blind-model box
      for (const im of busyImages) {
        const ib = box(im);
        if (tb.z <= ib.z || coveredBy(tb, ib) < 0.6) continue;    // not really ON the photo
        const hasScrim = flat.some(s => {
          if (s === t || s === im || s.type === 'text' || s.type === 'group' || s.type === 'image') return false;
          const sb = box(s);
          const opac = typeof (s as Layer & { opacity?: number }).opacity === 'number' ? (s as Layer & { opacity: number }).opacity : 1;
          return sb.z > ib.z && sb.z < tb.z && opac >= 0.25 && coveredBy(tb, sb) >= 0.8;
        });
        if (!hasScrim) {
          findings.push({ code: 'text_on_busy_image', severity: 'suggestion', layer_id: t.id,
            message: `text "${t.id}"${page ? ` (page ${page})` : ''} sits on busy photo "${im.id}" with no scrim — add a rect between them (e.g. fill:"#00000066", z between the image and the text) or move the text off the photo.` });
        }
        break;                                                    // one finding per text
      }
    }
  };
  checkArray(spec.layers);
  for (const p of spec.pages ?? []) checkArray((p as Page & { layers?: Layer[] }).layers, p.id);
  return findings;
}

/**
 * Resolve every image reference in the (in-memory) spec for server-side
 * rasterization. Mutates `spec`; returns human/model-readable notes for
 * everything it could not make renderable. Never touches the file on disk.
 */
export function resolveImageAssets(spec: DesignSpec, designPath: string, projectPath?: string): string[] {
  const dirs = assetBaseDirs(designPath, projectPath).filter(Boolean);
  const notes: string[] = [];

  const visit = (layers: Layer[] | undefined): void => {
    for (const l of layers ?? []) {
      if (l.type === 'image') {
        const img = l as Layer & { src?: string };
        if (typeof img.src === 'string' && img.src.trim()) {
          const r = resolveSrc(img.src, l.id, dirs);
          if (r.kind === 'embed') img.src = r.dataUri;
          else if (r.kind === 'blank') { img.src = ''; notes.push(r.note); }
        }
      }
      const withFill = l as Layer & { fill?: Fill };
      if (withFill.fill) withFill.fill = resolveFill(withFill.fill, l.id, dirs, notes) ?? withFill.fill;
      if (l.type === 'group') visit((l as Layer & { layers?: Layer[] }).layers);
    }
  };
  visit(spec.layers);
  for (const p of spec.pages ?? []) visit((p as Page & { layers?: Layer[] }).layers);
  return notes;
}
