/**
 * Script components (phase 3, S7) — the document a `script` layer runs in.
 *
 * The component draws a MOMENT: `folio.frame(t => …)` is called with the time
 * Folio asks for, never a clock of its own, so the editor, the HTML export and
 * every captured video frame see the same picture at the same t. The shim puts
 * the page's time sources on that clock (Date.now, performance.now, rAF) and
 * its randomness on a seed that restarts every frame (folio.random), so frame
 * 120 is frame 120 however it was reached. A CSP blocks every network request:
 * no CDN, no fetch — a component carries everything it draws.
 *
 * Driven three ways: on its own (real rAF, looping `duration`) when nothing
 * hosts it — a standalone HTML export; by `postMessage({folio:'t', t})` from
 * the editor's clock; by `__folioRender(t)` from the frame capture, which sets
 * `__folioCapture` first so it never runs by itself.
 */

import type { ScriptLayer } from '../schema/types';

/** A stable 32-bit seed from a layer id, when the layer names none. */
export function seedOf(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

const CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:";

/** The shim: Folio's clock and seed, before the component's code runs. */
function shim(seed: number, w: number, h: number, duration: number, loop: boolean): string {
  return `(function(){
var SEED=${seed >>> 0},s=SEED,now=0,frames=[],raf=[],realRaf=window.requestAnimationFrame.bind(window);
function rnd(){s|=0;s=s+0x6D2B79F5|0;var t=Math.imul(s^s>>>15,1|s);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;}
function hash(n){var x=Math.imul((n|0)^SEED,0x9E3779B1);x^=x>>>15;x=Math.imul(x,0x85EBCA77);x^=x>>>13;return(x>>>0)/4294967296;}
var folio={width:${w},height:${h},duration:${duration},loop:${loop},random:rnd,hash:hash,frame:function(fn){frames.push(fn);},get t(){return now;}};
Math.random=rnd;Date.now=function(){return 1700000000000+now;};performance.now=function(){return now;};
window.requestAnimationFrame=function(fn){raf.push(fn);return raf.length;};window.cancelAnimationFrame=function(){};
window.setTimeout=window.setInterval=function(){return 0;};
window.folio=folio;
window.__folioRender=function(t){now=t;s=SEED;var q=raf;raf=[];for(var i=0;i<q.length;i++)q[i](t);for(var j=0;j<frames.length;j++)frames[j](t);document.documentElement.setAttribute('data-folio-t',String(t));};
window.__folioRealRaf=realRaf;
})();`;
}

/** Plays the component by itself until a host sends the time. */
const DRIVER = `(function(){
var hosted=false,start=null,f=window.folio;
addEventListener('message',function(e){var d=e.data;if(d&&d.folio==='t'&&typeof d.t==='number'){hosted=true;window.__folioRender(d.t);}else if(d&&d.folio==='free'&&hosted){hosted=false;start=null;window.__folioRealRaf(tick);}});
function tick(ts){if(hosted)return;if(start===null)start=ts;var t=ts-start;if(f.duration>0)t=f.loop?t%f.duration:Math.min(t,f.duration);window.__folioRender(t);window.__folioRealRaf(tick);}
if(window.__folioCapture)window.__folioRender(0);else window.__folioRealRaf(tick);
})();`;

/** `</script>` inside the component's own text would end its <script> early. */
const inScript = (code: string): string => code.replace(/<\/script/gi, '<\\/script');
const inStyle = (css: string): string => css.replace(/<\/style/gi, '<\\/style');

/** The whole document a script layer runs in; `still` draws t=0 once and never plays (a thumbnail). */
export function buildScriptDoc(layer: ScriptLayer, still = false): string {
  const w = typeof layer.width === 'number' ? layer.width : 400;
  const h = typeof layer.height === 'number' ? layer.height : 300;
  const seed = typeof layer.seed === 'number' ? layer.seed : seedOf(layer.id);
  const duration = typeof layer.duration === 'number' && layer.duration > 0 ? layer.duration : 0;
  return `<!doctype html><html><head><meta charset="utf-8">`
    + `<meta http-equiv="Content-Security-Policy" content="${CSP}">`
    + `<style>html,body{margin:0;padding:0;width:${w}px;height:${h}px;overflow:hidden;background:transparent}</style>`
    + (layer.css ? `<style>${inStyle(layer.css)}</style>` : '')
    + `</head><body>${layer.html ?? ''}`
    + (still ? '<script>window.__folioCapture=true;</script>' : '')
    + `<script>${shim(seed, w, h, duration, layer.loop === true)}</script>`
    + `<script>${inScript(layer.js ?? '')}</script>`
    + `<script>${DRIVER}</script></body></html>`;
}
