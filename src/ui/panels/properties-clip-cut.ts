// The Cut section — cutting a clip by what is IN its footage: the shots it holds, the silences in its sound,
// and the beat of the music under the piece. The measuring happens on the server (ffmpeg); a split at shots
// is plain browser arithmetic; taking silences out and moving the track's joins onto the beat ripple the whole
// scene, so the engine does them (editor/clip-bridge.ts) and the result is one undo step.

import type { ClipLayer } from '../../animation/video-clip';
import { summarize } from '../../animation/video-clip';
import { rampKeys } from '../../animation/video-time';
import { runClipOp } from '../../editor/clip-bridge';
import { showToast } from '../../utils/toast';
import type { ClipEnv } from './clip-commit';
import { bindClip, block, button, note, num, pick, type ClipSet, type Section } from './clip-controls';
import { measure, measuredFor, sceneTimes, splitAt } from './clip-measure';

type Span = [number, number];
/** Pauses shorter than this after the kept breath are not worth a cut, ms. */
const MIN_CUT_MS = 100;
let every = 1, keep = 150, working = false;

/** The file-clock spans to take out for each silence: the silence less `keep` ms of breath at each end that is not the clip's own edge. */
export function silenceCuts(silences: Span[], from: number, to: number, keepMs: number): Span[] {
  const cuts: Span[] = [];
  for (const [s, e] of silences) {
    const a = Math.max(s, from) + (s <= from ? 0 : keepMs), b = Math.min(e, to) - (e >= to ? 0 : keepMs);
    if (b - a >= MIN_CUT_MS) cuts.push([Math.round(a), Math.round(b)]);
  }
  return cuts;
}

const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)} s`;

export function cutSection(layer: ClipLayer, env: ClipEnv): Section {
  const m = measuredFor(layer);
  const s = summarize(layer);
  const linear = !layer.video?.still && rampKeys(layer.video).length === 0;
  const cuts = m && linear ? silenceCuts(m.silences, s.file.from, s.file.to ?? Infinity, keep) : [];
  const gone = cuts.reduce((t, [a, b]) => t + (b - a), 0);
  const html = block('Cut',
    `<div class="clip-row"><span class="prop-label"></span>${button('measure', working ? 'Measuring…' : m ? 'Measure again' : 'Find shots & silences', 'Read the footage for scene cuts and quiet stretches', working)}</div>`
    + (m ? `<div class="prop-info-row"><span>Found</span><span>${m.shots.length} shot cut${m.shots.length === 1 ? '' : 's'} · ${m.silences.length} silence${m.silences.length === 1 ? '' : 's'}</span></div>` : '')
    + `<div class="clip-row"><span class="prop-label"></span>${button('split', `Split at shots${m ? ` (${m.shots.length})` : ''}`, 'Cut the clip into one clip per shot', !m || !linear || !m.shots.length || working)}</div>`
    + num('keep', 'Keep pause', keep, 0, 1000, 25, 'ms')
    + `<div class="clip-row"><span class="prop-label"></span>${button('silence', cuts.length ? `Cut ${cuts.length} silence${cuts.length === 1 ? '' : 's'} (${seconds(gone)})` : 'Cut silences', 'Take the quiet stretches out and close the gaps', !cuts.length || working)}</div>`
    + (linear ? '' : note('A ramped or frozen clip cannot be cut by its footage — clear the ramp first.'))
    + pick('every', 'Cut to music', [['1', 'Every beat'], ['2', 'Every 2 beats'], ['4', 'The bar (4 beats)']], String(every))
    + `<div class="clip-row"><span class="prop-label"></span>${button('beats', 'Cut the track to the beat', 'Move each cut of this clip\'s track onto the music\'s nearest beat', working)}</div>`
    + note('Cutting to the beat needs music under the piece. The silences go with the gaps closed: everything after moves up.'), true);

  const run = async (op: () => Promise<boolean>): Promise<void> => {
    if (working) return;
    working = true; env.refresh();
    try { await op(); } finally { working = false; env.refresh(); }
  };
  const fail = (e: string): boolean => { showToast(e, 'warning'); return false; };
  const set: ClipSet = (key, value) => {
    if (key === 'keep') { keep = Math.max(0, Math.min(1000, Math.round(Number(value)))); env.refresh(); }
    else if (key === 'every') every = Number(value);
  };
  const act = (a: string): void => {
    const l = env.state.findLayer(env.layerId) as ClipLayer | undefined;
    if (!l) return;
    if (a === 'measure') void run(async () => { const e = await measure(env.state, l); return e ? fail(e) : true; });
    else if (a === 'split') {
      const known = measuredFor(l);
      const pieces = known ? splitAt(env.state, l, sceneTimes(l, known.shots)) : [];
      if (pieces.length > 1) { env.state.replaceLayer(l.id, pieces); showToast(`Split into ${pieces.length} clips.`, 'success'); }
    } else if (a === 'silence') {
      void run(async () => {
        const r = await runClipOp(env.state, { layer_id: l.id, cut: cuts });
        if (!r.ok) return fail(r.error ?? 'The cut did not happen.');
        showToast(`Took ${seconds(Number(r.result?.['removed_ms'] ?? gone))} of silence out — the gaps closed.`, 'success');
        return true;
      });
    } else if (a === 'beats') {
      void run(async () => {
        const r = await runClipOp(env.state, { layer_id: l.id, on_beats: { every } });
        if (!r.ok) return fail(r.hint ? `${r.error ?? ''} ${r.hint}` : r.error ?? 'The cut did not happen.');
        const moved = Array.isArray(r.result?.['moved']) ? (r.result['moved'] as unknown[]).length : 0;
        showToast(moved ? `Moved ${moved} cut${moved === 1 ? '' : 's'} onto the beat.` : 'Every cut already sits on the beat.', 'success');
        return true;
      });
    }
  };
  return { html, bind: root => bindClip(root, env, set, act) };
}
