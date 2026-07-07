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

const EXT_MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  gif: 'image/gif', avif: 'image/avif', svg: 'image/svg+xml',
};

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
        const mime = EXT_MIME[ext];
        if (!mime) return { kind: 'blank', note: `image "${id}": "${s}" is not a supported image type — use png/jpg/webp/gif/avif/svg.` };
        const buf = fs.readFileSync(abs);
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
