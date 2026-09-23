/**
 * One moment of a multi-scene piece, as a single-page design ready to render.
 *
 * Outside a transition that is the scene's own page sampled at its local time.
 * Inside one, both scenes are sampled — the outgoing one resting past its end —
 * wrapped in full-canvas groups and posed by scene-transition.ts. A group's
 * transform, opacity and clip_rect are ordinary renderer fields, so the frame
 * stays vectors all the way to resvg.
 */

import type { DesignSpec, Layer } from '../schema/types';
import { specAt } from './gif-frames';
import { sceneAt, type ScenePlan, type PlannedScene } from './scene-plan';
import { transitionPoses, type ScenePose } from './scene-transition';

const FALLBACK_BACKDROP = '#FFFFFF';

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const byZ = (a: Layer, b: Layer): number => (a.z ?? 0) - (b.z ?? 0);

/** The colour of the lowest layer covering the whole canvas — the page's own ground. */
export function backdropColor(layers: Layer[], w: number, h: number): string {
  const find = (list: Layer[]): string | null => {
    for (const l of [...list].sort(byZ)) {
      const o = l as unknown as Record<string, unknown>;
      const fill = o['fill'];
      const color = typeof fill === 'string' ? fill
        : fill && typeof fill === 'object' && typeof (fill as { color?: unknown }).color === 'string' ? (fill as { color: string }).color
        : null;
      const covers = o['type'] === 'background' || (o['type'] === 'rect'
        && (num(o['x']) ?? 0) <= 0 && (num(o['y']) ?? 0) <= 0 && (num(o['width']) ?? 0) >= w && (num(o['height']) ?? 0) >= h);
      if (color && covers) return color;
      const kids = o['layers'];
      if (Array.isArray(kids)) {
        const inner = find(kids as Layer[]);
        if (inner) return inner;
      }
    }
    return null;
  };
  return find(layers) ?? FALLBACK_BACKDROP;
}

/** A stage for a turning face: the scene's own ground taken most of the way to black. */
function stageOf(color: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (!m?.[1]) return '#101010';
  const v = parseInt(m[1], 16);
  const c = (shift: number): string => Math.round(((v >> shift) & 255) * 0.3).toString(16).padStart(2, '0');
  return `#${c(16)}${c(8)}${c(0)}`;
}

function sceneLayers(spec: DesignSpec, scene: PlannedScene, localMs: number, frameMs?: number): Layer[] {
  return specAt(spec, scene.index, localMs, frameMs).pages?.[0]?.layers ?? [];
}

function posed(id: string, z: number, layers: Layer[], pose: ScenePose, w: number, h: number): Layer {
  // A turning face: the scene once per strip, each clipped to its slice (in the
  // scene's own coordinates — the clip rides the strip's transform) and placed.
  // The face is clipped to the exact quadrilateral it projects to (a hidden outline layer).
  if (pose.face) {
    const strips = pose.face.strips.map((s, i) => ({ id: `${id}_s${i}`, type: 'group', z: i + 1, x: 0, y: 0, width: w, height: h, transform: s.transform, clip_rect: s.clip_rect, layers }));
    const outline = { id: `${id}_outline`, type: 'path', z: 0, d: pose.face.outline, visible: false };
    return { id, type: 'group', z, x: 0, y: 0, width: w, height: h, clip_path_ref: `${id}_outline`, layers: [outline, ...strips] } as unknown as Layer;
  }
  return {
    id, type: 'group', z, x: 0, y: 0, width: w, height: h, layers,
    ...(pose.transform ? { transform: pose.transform } : {}),
    ...(pose.opacity !== undefined ? { opacity: pose.opacity } : {}),
    ...(pose.clip_rect ? { clip_rect: pose.clip_rect } : {}),
    ...(pose.blur ? { effects: { blur: pose.blur } } : {}),
  } as unknown as Layer;
}

const onePage = (spec: DesignSpec, id: string, layers: Layer[]): DesignSpec =>
  ({ ...spec, pages: [{ id, layers }] } as DesignSpec);

/** An empty page of the piece — what lies over a turning face (the captions) is added to it. */
export const blankPage = (spec: DesignSpec): DesignSpec => onePage(spec, '__over', []);

/** A moment a face turns, for a raster frame: the stage, and each scene as a page with where its corners land — bottom first. */
export interface TurningFrame { stage: string; faces: Array<{ spec: DesignSpec; corners: Array<[number, number]> }> }

/**
 * The moment at t as faces to warp (warp.ts) — or null when no face is turning.
 * A raster frame draws each scene once and maps it onto its face exactly; the
 * strips of composeSceneFrame are for vector frames, where there are no pixels.
 */
export function turningFrame(spec: DesignSpec, plan: ScenePlan, t: number, frameMs?: number): TurningFrame | null {
  const m = sceneAt(plan, t);
  const tr = m.scene.transition;
  if (!m.from || !tr) return null;
  const w = spec.document.width, h = spec.document.height;
  const poses = transitionPoses(tr.type, m.from.progress, w, h, tr.easing);
  if (!poses.stage) return null;
  const outgoing = sceneLayers(spec, m.from.scene, m.from.local_ms, frameMs);
  const from = { pose: poses.from, spec: onePage(spec, m.from.scene.page_id, outgoing) };
  const to = { pose: poses.to, spec: onePage(spec, m.scene.page_id, sceneLayers(spec, m.scene, m.local_ms, frameMs)) };
  const faces = (poses.fromOnTop ? [to, from] : [from, to]).flatMap(s => (s.pose.face ? [{ spec: s.spec, corners: s.pose.face.corners }] : []));
  return { stage: stageOf(backdropColor(outgoing, w, h)), faces };
}

/** The piece at global time t, as one page. */
export function composeSceneFrame(spec: DesignSpec, plan: ScenePlan, t: number, frameMs?: number): DesignSpec {
  const m = sceneAt(plan, t);
  const w = spec.document.width, h = spec.document.height;
  const incoming = sceneLayers(spec, m.scene, m.local_ms, frameMs);
  const tr = m.scene.transition;
  if (!m.from || !tr) return onePage(spec, m.scene.page_id, incoming);

  const poses = transitionPoses(tr.type, m.from.progress, w, h, tr.easing);
  const outgoing = sceneLayers(spec, m.from.scene, m.from.local_ms, frameMs);
  const layers: Layer[] = [];
  if (poses.backdrop) {
    const ground = backdropColor(outgoing, w, h);
    layers.push({ id: '__scene_backdrop', type: 'rect', z: 0, x: 0, y: 0, width: w, height: h, fill: poses.stage ? stageOf(ground) : ground } as unknown as Layer);
  }
  layers.push(posed('__scene_from', poses.fromOnTop ? 2 : 1, outgoing, poses.from, w, h));
  layers.push(posed('__scene_to', poses.fromOnTop ? 1 : 2, incoming, poses.to, w, h));
  return onePage(spec, m.scene.page_id, layers);
}
