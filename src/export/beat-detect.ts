/**
 * Tempo, beats and onsets from a mono signal — the timing grid of a soundtrack.
 *
 * Pure math, no decoder: the caller hands in PCM (the engine decodes with
 * ffmpeg). The steps are the textbook ones, kept small:
 *
 *  1. Onset strength — log-magnitude spectral flux: how much NEW energy each
 *     ~23 ms hop brings, summed over frequency bins, with the slow trend removed.
 *  2. Tempo — autocorrelation of that envelope over 60–200 BPM, weighted by a
 *     broad prior around 120 BPM (half and double tempo correlate too; the prior
 *     picks the one a listener taps), refined between lags.
 *  3. Beats — dynamic programming (Ellis 2007): each beat is placed on strong
 *     onsets while keeping the spacing near the tempo, then traced back.
 *
 * It measures; it decides nothing. A soundtrack with no pulse comes back with a
 * low confidence, and the caller says so rather than snapping to noise.
 */

export interface BeatMap {
  bpm: number;
  /** One beat, ms. */
  beat_ms: number;
  /** 0–1: how strongly the envelope repeats at that tempo. Under ~0.2 there is no steady pulse. */
  confidence: number;
  beats_ms: number[];
  /** The sharpest onsets (hits, accents), strongest first then sorted by time, ms. */
  onsets_ms: number[];
  duration_ms: number;
}

const FRAME = 1024;
const HOP = 256;

/** In-place radix-2 FFT; re/im have length FRAME. */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k), wi = Math.sin(ang * k);
        const a = i + k, b = a + len / 2;
        const xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
      }
    }
  }
}

/**
 * Frequency bands (Hz) that each get ONE vote in the onset strength. Summed over
 * raw bins, a kick drum (a handful of bins below 150 Hz) lost to a quiet hi-hat
 * spread over hundreds: live, a 120 BPM beat was tracked on its off-beat ticks.
 */
const BANDS_HZ = [0, 150, 400, 1000, 2500, Infinity];

/** Onset strength per hop: positive log flux per band, bands summed, local mean removed, rectified. */
export function onsetEnvelope(samples: Float32Array, sampleRate = 11025): Float64Array {
  const frames = Math.max(0, Math.floor((samples.length - FRAME) / HOP) + 1);
  const env = new Float64Array(frames);
  const window = Float64Array.from({ length: FRAME }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME - 1)));
  const binHz = sampleRate / FRAME;
  const bands = BANDS_HZ.slice(0, -1).map((lo, b) => ({
    from: Math.max(1, Math.ceil(lo / binHz)), to: Math.min(FRAME / 2, Math.ceil(BANDS_HZ[b + 1] / binHz)),
  })).filter(b => b.to > b.from);
  let prev = new Float64Array(bands.length);
  const re = new Float64Array(FRAME), im = new Float64Array(FRAME);
  for (let f = 0; f < frames; f++) {
    for (let i = 0; i < FRAME; i++) { re[i] = samples[f * HOP + i] * window[i]; im[i] = 0; }
    fft(re, im);
    const level = new Float64Array(bands.length);
    let flux = 0;
    bands.forEach((band, b) => {
      let sum = 0;
      for (let k = band.from; k < band.to; k++) sum += Math.hypot(re[k], im[k]);
      level[b] = Math.log1p((100 * sum) / (band.to - band.from));
      if (f > 0) flux += Math.max(0, level[b] - prev[b]);
    });
    env[f] = flux;
    prev = level;
  }
  // Remove the slow trend (~0.4 s mean) so a crescendo is not read as a stream of onsets.
  const half = 8;
  const out = new Float64Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0, n = 0;
    for (let j = Math.max(0, f - half); j <= Math.min(frames - 1, f + half); j++) { sum += env[j]; n++; }
    out[f] = Math.max(0, env[f] - sum / n);
  }
  return out;
}

/** Tempo in hops per beat, from the envelope's autocorrelation under a prior around 120 BPM. */
function tempoLag(env: Float64Array, sampleRate: number): { lag: number; confidence: number } {
  const hopsPerMin = (60 * sampleRate) / HOP;
  const minLag = Math.floor(hopsPerMin / 200), maxLag = Math.ceil(hopsPerMin / 60);
  // Correlate the envelope with its mean removed: a rectified envelope is never
  // negative, so its raw autocorrelation stays high at every lag, noise included.
  let mean = 0;
  for (const v of env) mean += v;
  mean /= env.length || 1;
  const centred = Float64Array.from(env, v => v - mean);
  const ac = (lag: number): number => { let s = 0; for (let i = lag; i < centred.length; i++) s += centred[i] * centred[i - lag]; return s; };
  const zero = ac(0) || 1;
  let best = minLag, bestScore = -Infinity;
  const scores = new Map<number, number>();
  for (let lag = minLag; lag <= Math.min(maxLag, env.length - 1); lag++) {
    const bpm = hopsPerMin / lag;
    const prior = Math.exp(-0.5 * Math.log2(bpm / 120) ** 2);
    const s = ac(lag) * prior;
    scores.set(lag, s);
    if (s > bestScore) { bestScore = s; best = lag; }
  }
  // Parabolic refinement between neighbouring lags: tempo is rarely a whole number of hops.
  const l = scores.get(best - 1), r = scores.get(best + 1);
  const shift = l !== undefined && r !== undefined && l - 2 * bestScore + r !== 0 ? (0.5 * (l - r)) / (l - 2 * bestScore + r) : 0;
  return { lag: best + Math.max(-0.5, Math.min(0.5, shift)), confidence: Math.max(0, Math.min(1, ac(best) / zero)) };
}

/** Beat positions (hop indices) by dynamic programming over the envelope. */
function trackBeats(env: Float64Array, period: number, tightness = 100): number[] {
  const n = env.length;
  if (n === 0 || period < 1) return [];
  let mean = 0;
  for (const v of env) mean += v;
  mean /= n;
  let sd = 0;
  for (const v of env) sd += (v - mean) ** 2;
  sd = Math.sqrt(sd / n) || 1;
  const score = new Float64Array(n), from = new Int32Array(n).fill(-1);
  for (let t = 0; t < n; t++) {
    const local = env[t] / sd;
    let best = 0, arg = -1;
    for (let tau = Math.max(0, Math.floor(t - 2 * period)); tau <= t - Math.round(period / 2); tau++) {
      const c = score[tau] - tightness * Math.log((t - tau) / period) ** 2;
      if (arg < 0 || c > best) { best = c; arg = tau; }
    }
    score[t] = local + (arg >= 0 ? best : 0);
    from[t] = arg;
  }
  let t = n - 1;
  for (let i = Math.max(0, Math.floor(n - period)); i < n; i++) if (score[i] > score[t]) t = i;
  const beats: number[] = [];
  for (; t >= 0; t = from[t]) beats.push(t);
  return beats.reverse();
}

/**
 * Move a time to the steepest energy rise within ±50 ms — the attack a listener
 * hears as the hit. The envelope works in 23 ms hops over 93 ms frames, and live
 * its beats sat 15–30 ms ahead of a 120 BPM kick.
 */
function toAttack(samples: Float32Array, sampleRate: number, ms: number): number {
  const win = Math.max(1, Math.round(sampleRate * 0.004));
  const from = Math.max(0, Math.round(((ms - 50) / 1000) * sampleRate));
  const to = Math.min(samples.length - win, Math.round(((ms + 50) / 1000) * sampleRate));
  let prev: number | null = null, steepest = 0, at = ms;
  for (let s = from; s <= to; s += win) {
    let e = 0;
    for (let i = 0; i < win; i++) e += (samples[s + i] ?? 0) ** 2;
    const level = Math.log1p((1e4 * e) / win);
    if (prev !== null && level - prev > steepest) { steepest = level - prev; at = (s / sampleRate) * 1000; }
    prev = level;
  }
  return Math.round(at);
}

export function detectBeats(samples: Float32Array, sampleRate: number): BeatMap {
  const duration_ms = Math.round((samples.length / sampleRate) * 1000);
  const env = onsetEnvelope(samples, sampleRate);
  const hopMs = (HOP / sampleRate) * 1000;
  if (env.length < 8) return { bpm: 0, beat_ms: 0, confidence: 0, beats_ms: [], onsets_ms: [], duration_ms };
  const { lag, confidence } = tempoLag(env, sampleRate);
  // The flux of hop f describes the frame that starts there; its onset sits near the frame's middle.
  const centre = (FRAME / 2 / sampleRate) * 1000;
  const toMs = (hop: number): number => Math.round(hop * hopMs + centre);
  const beats_ms = trackBeats(env, lag).map(h => toAttack(samples, sampleRate, toMs(h))).filter(ms => ms <= duration_ms);

  let mean = 0;
  for (const v of env) mean += v;
  mean /= env.length;
  const peaks: Array<{ hop: number; v: number }> = [];
  for (let f = 1; f < env.length - 1; f++) if (env[f] > mean * 3 && env[f] >= env[f - 1] && env[f] > env[f + 1]) peaks.push({ hop: f, v: env[f] });
  const onsets_ms = peaks.sort((a, b) => b.v - a.v).slice(0, 64).map(p => toAttack(samples, sampleRate, toMs(p.hop))).sort((a, b) => a - b);

  const beat_ms = lag * hopMs;
  return { bpm: Math.round((60_000 / beat_ms) * 10) / 10, beat_ms: Math.round(beat_ms * 10) / 10, confidence: Math.round(confidence * 100) / 100, beats_ms, onsets_ms, duration_ms };
}
