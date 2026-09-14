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

function sceneLayers(spec: DesignSpec, scene: PlannedScene, localMs: number): Layer[] {
  return specAt(spec, scene.index, localMs).pages?.[0]?.layers ?? [];
}

function posed(id: string, z: number, layers: Layer[], pose: ScenePose, w: number, h: number): Layer {
  return {
    id, type: 'group', z, x: 0, y: 0, width: w, height: h, layers,
    ...(pose.transform ? { transform: pose.transform } : {}),
    ...(pose.opacity !== undefined ? { opacity: pose.opacity } : {}),
    ...(pose.clip_rect ? { clip_rect: pose.clip_rect } : {}),
  } as unknown as Layer;
}

const onePage = (spec: DesignSpec, id: string, layers: Layer[]): DesignSpec =>
  ({ ...spec, pages: [{ id, layers }] } as DesignSpec);

/** The piece at global time t, as one page. */
export function composeSceneFrame(spec: DesignSpec, plan: ScenePlan, t: number): DesignSpec {
  const m = sceneAt(plan, t);
  const w = spec.document.width, h = spec.document.height;
  const incoming = sceneLayers(spec, m.scene, m.local_ms);
  const tr = m.scene.transition;
  if (!m.from || !tr) return onePage(spec, m.scene.page_id, incoming);

  const poses = transitionPoses(tr.type, m.from.progress, w, h, tr.easing);
  const outgoing = sceneLayers(spec, m.from.scene, m.from.local_ms);
  const layers: Layer[] = [];
  if (poses.backdrop) {
    layers.push({ id: '__scene_backdrop', type: 'rect', z: 0, x: 0, y: 0, width: w, height: h, fill: backdropColor(outgoing, w, h) } as unknown as Layer);
  }
  layers.push(posed('__scene_from', poses.fromOnTop ? 2 : 1, outgoing, poses.from, w, h));
  layers.push(posed('__scene_to', poses.fromOnTop ? 1 : 2, incoming, poses.to, w, h));
  return onePage(spec, m.scene.page_id, layers);
}
