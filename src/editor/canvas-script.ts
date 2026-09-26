/**
 * Script components on the canvas, following the transport (phase 3, S7).
 *
 * A component runs in an iframe inside the SVG (layer-renderers-script.ts), and
 * the canvas rebuilds its SVG on every render — every pose frame while playing.
 * A fresh iframe would load from nothing each frame, so the live one is carried
 * into the new SVG with moveBefore, which keeps its page running (a plain move
 * reloads it). Time comes from the player: posed or playing, every component
 * draws the playhead's t; let go, it plays by itself again, as CSS motion does.
 */
import type { MotionPlayer } from './motion-player';

type Movable = Node & { moveBefore?: (node: Node, child: Node | null) => void };
const SCRIPTS = 'iframe[data-folio-script]';

/** Carry each live component from `old` into `fresh` (both in the document, same code). */
export function keepScripts(old: Element, fresh: Element): void {
  const live = new Map<string, HTMLIFrameElement>();
  old.querySelectorAll<HTMLIFrameElement>(SCRIPTS).forEach(f => live.set(f.getAttribute('data-folio-script') ?? '', f));
  if (!live.size) return;
  fresh.querySelectorAll<HTMLIFrameElement>(SCRIPTS).forEach(n => {
    const kept = live.get(n.getAttribute('data-folio-script') ?? '');
    const parent = n.parentNode as Movable | null;
    if (!kept || !parent?.moveBefore || kept.getAttribute('srcdoc') !== n.getAttribute('srcdoc')) return;
    try {
      kept.setAttribute('style', n.getAttribute('style') ?? '');
      parent.moveBefore(kept, n);
      n.remove();
    } catch { /* the fresh one loads instead */ }
  });
}

/** Send the player's time to every component on the canvas; returns the unsubscribe. */
export function driveScripts(player: MotionPlayer, container: HTMLElement): () => void {
  let msg: { folio: 't'; t: number } | { folio: 'free' } = { folio: 'free' };
  const post = (f: HTMLIFrameElement): void => { f.contentWindow?.postMessage(msg, '*'); };
  const all = (): HTMLIFrameElement[] => Array.from(container.querySelectorAll<HTMLIFrameElement>(SCRIPTS));
  const unsub = player.subscribe(s => {
    msg = s.playing || player.isPosed ? { folio: 't', t: s.time } : { folio: 'free' };
    all().forEach(post);
  });
  // A component that loads mid-pose starts on the playhead, not at 0.
  const hook = new MutationObserver(() => all().forEach(f => {
    if (f.dataset['folioHooked']) return;
    f.dataset['folioHooked'] = '1';
    f.addEventListener('load', () => { if (msg.folio === 't') post(f); });
  }));
  hook.observe(container, { childList: true, subtree: true });
  return () => { unsub(); hook.disconnect(); };
}
