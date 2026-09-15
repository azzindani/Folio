/**
 * The stage's sound row — the soundtrack drawn under the scene strip on the same
 * scale, a mute switch, and the track settings the editor offers (volume and
 * fades), written through state so they undo.
 *
 * It draws SceneAudio.plan: the plan the stage plays and the mp4 mixes, so a
 * track the piece cuts off is drawn cut where the piece ends, and the plan's
 * notes (cut with no fade, music that runs out) are shown as it gives them.
 */

import type { StateManager } from '../../editor/state';
import type { ScenePlayer } from '../../editor/scene-player';
import type { SceneAudio } from '../../editor/scene-audio';
import type { AudioTrack, DesignSpec } from '../../schema/types';
import { BTN, FIELD, clampMs, el, labelled, secs } from './scene-stage-controls';

export interface SoundRow { element: HTMLElement; redraw(): void }

/** Every sound file a design names — its tracks and its scenes' cues. */
export function designSoundSources(design: DesignSpec | null | undefined): string[] {
  const all = [...(design?.audio ?? []).map(t => t.src), ...(design?.pages ?? []).flatMap(p => (p.audio_cues ?? []).map(c => c.src))];
  return [...new Set(all.filter((s): s is string => typeof s === 'string' && s.trim() !== ''))];
}

function numberField(value: number, max: number, step: number, width: string, cls: string, commit: (v: number) => void): HTMLInputElement {
  const f = el('input', `${FIELD}width:${width};`);
  Object.assign(f, { type: 'number', min: '0', max: String(max), step: String(step), value: String(value) });
  f.className = cls;
  f.addEventListener('change', () => commit(clampMs(f.value, 0, max)));
  return f;
}

function trackControls(state: StateManager, tracks: AudioTrack[], index: number): HTMLElement {
  const t = tracks[index];
  const line = el('div', 'display:flex;align-items:center;gap:14px;flex-wrap:wrap;');
  if (!t) return line;
  const commit = (patch: Partial<AudioTrack> | null): void => {
    state.setAudioTracks(patch === null ? tracks.filter((_, j) => j !== index) : tracks.map((x, j) => (j === index ? { ...x, ...patch } : x)));
  };
  line.appendChild(el('strong', 'color:#FFFFFF;font-weight:600;', `♪ ${t.id}`));
  line.append(
    labelled('Volume %', numberField(Math.round((t.volume ?? 1) * 100), 100, 5, '60px', 'scene-stage-volume', v => commit({ volume: v / 100 }))),
    labelled('Fade in ms', numberField(t.fade_in ?? 0, 10_000, 100, '72px', 'scene-stage-fade-in', v => commit({ fade_in: v }))),
    labelled('Fade out ms', numberField(t.fade_out ?? 0, 10_000, 100, '72px', 'scene-stage-fade-out', v => commit({ fade_out: v }))),
  );
  const remove = el('button', `${BTN}padding:0 10px;`, 'Remove');
  remove.className = 'scene-stage-sound-remove';
  remove.addEventListener('click', () => commit(null));
  line.appendChild(remove);
  return line;
}

export function buildSoundRow(state: StateManager, player: ScenePlayer, audio: SceneAudio, onMute: () => void): SoundRow {
  const root = el('div', 'display:flex;flex-direction:column;gap:8px;');
  root.className = 'scene-stage-sound';
  const row = el('div', 'display:flex;align-items:center;gap:14px;');
  const mute = el('button', BTN, '♪');
  mute.className = 'scene-stage-mute';
  const label = el('span', 'min-width:96px;color:#8A8A8A;font-size:12px;', 'Sound');
  const lane = el('div', 'position:relative;flex:1 1 auto;height:30px;background:#1E1E22;border-radius:4px;overflow:hidden;');
  lane.className = 'scene-stage-sound-lane';
  row.append(mute, label, lane, el('span', 'min-width:34px;'));
  const details = el('div', 'display:flex;flex-direction:column;gap:6px;color:#BDBDBD;');
  root.append(row, details);

  const redraw = (): void => {
    const design = state.get().design;
    const plan = player.plan();
    root.hidden = designSoundSources(design).length === 0;
    mute.title = audio.muted ? 'Sound off — click to hear it' : 'Sound on — click to mute';
    mute.style.opacity = audio.muted ? '0.45' : '1';
    lane.replaceChildren();
    details.replaceChildren();
    if (root.hidden || !design || !plan) return;

    const sound = audio.plan(design, plan);
    const total = Math.max(1, plan.total_ms);
    for (const c of sound.clips) {
      // Tracks on the upper half, cues on the lower: live, a whoosh cue drew over the music bar and vanished into it.
      const place = c.scene ? 'top:16px;height:12px;background:#9A6A1F;' : 'top:2px;height:12px;background:#2F7D72;';
      const bar = el('div', `position:absolute;${place}left:${(c.start_ms / total) * 100}%;width:${(c.length_ms / total) * 100}%;min-width:3px;` +
        'border-radius:2px;color:#F2F2F2;font-size:10px;line-height:12px;padding:0 4px;white-space:nowrap;overflow:hidden;box-sizing:border-box;', c.id);
      bar.className = 'scene-stage-sound-clip';
      bar.title = `${c.src} · ${secs(c.start_ms)}–${secs(c.start_ms + c.length_ms)}${c.cut ? ' · cut at the end of the piece' : ''}`;
      lane.appendChild(bar);
    }
    const tracks = design.audio ?? [];
    tracks.forEach((_, i) => details.appendChild(trackControls(state, tracks, i)));
    const failed = audio.failed();
    if (failed.length) details.appendChild(el('span', 'color:#E8B04A;', `Could not load ${failed.join(', ')}`));
    for (const note of sound.notes) details.appendChild(el('span', 'color:#8A8A8A;', note));
  };

  mute.addEventListener('click', () => {
    audio.muted = !audio.muted;
    onMute();
    redraw();
  });
  redraw();
  return { element: root, redraw };
}
