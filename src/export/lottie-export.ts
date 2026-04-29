import type { AnimationSpec, Keyframe } from '../animation/types';

export interface LottieLayer {
  nm: string;
  ty: number;
  ks: LottieTransform;
  ip: number;
  op: number;
  st: number;
  ind: number;
}

export interface LottieTransform {
  o: LottieValue;
  r: LottieValue;
  p: LottieValue;
  a: LottieValue;
  s: LottieValue;
}

export interface LottieValue {
  a: 0 | 1;
  k: number | number[] | LottieKeyframe[];
}

export interface LottieKeyframe {
  t: number;
  s: number[];
  e: number[];
  i?: { x: number[]; y: number[] };
  o?: { x: number[]; y: number[] };
}

export interface LottieJSON {
  v: string;
  nm: string;
  fr: number;
  ip: number;
  op: number;
  w: number;
  h: number;
  layers: LottieLayer[];
  assets: unknown[];
  markers: unknown[];
}

/** Convert a Folio layer's AnimationSpec to Lottie keyframes. */
export function animSpecToLottie(
  name: string,
  anim: AnimationSpec,
  width: number,
  height: number,
  fps = 30,
): LottieJSON {
  const duration = anim.playback?.duration ?? 1000;
  const op = Math.round((duration / 1000) * fps);

  const layers: LottieLayer[] = [];

  if (anim.keyframes && anim.keyframes.length > 0) {
    const kfs: Keyframe[] = anim.keyframes;
    const hasOpacity = kfs.some(kf => kf.opacity !== undefined);
    const opacityKfs: LottieKeyframe[] = hasOpacity
      ? kfs.slice(0, -1).map((kf, i) => ({
          t: Math.round((kf.t / duration) * op),
          s: [kf.opacity !== undefined ? kf.opacity * 100 : 100],
          e: [kfs[i + 1].opacity !== undefined ? (kfs[i + 1].opacity as number) * 100 : 100],
        }))
      : [];

    const layer: LottieLayer = {
      nm: name,
      ty: 4,
      ind: 0,
      ip: 0,
      op,
      st: 0,
      ks: {
        o: opacityKfs.length > 0 ? { a: 1, k: opacityKfs } : { a: 0, k: 100 },
        r: { a: 0, k: 0 },
        p: { a: 0, k: [width / 2, height / 2] },
        a: { a: 0, k: [0, 0] },
        s: { a: 0, k: [100, 100] },
      },
    };
    layers.push(layer);
  }

  return {
    v: '5.9.0',
    nm: name,
    fr: fps,
    ip: 0,
    op,
    w: width,
    h: height,
    layers,
    assets: [],
    markers: [],
  };
}

/** Serialize a LottieJSON to a compact JSON string. */
export function serializeLottie(lottie: LottieJSON): string {
  return JSON.stringify(lottie);
}
