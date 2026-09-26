// Script component layer (phase 3, S7): its document in a sandboxed iframe —
// scripts run, nothing else (no same-origin, so it cannot reach the editor).
// The editor drives its clock by postMessage; resvg draws no foreignObject,
// so raster exports swap in frames captured from headless Chrome.
import type { ScriptLayer } from '../schema/types';
import { createSVGElement } from './svg-utils';
import { applyCommonAttributes } from './layer-renderers-shared';
import { buildScriptDoc } from '../scripting/script-runtime';

export function renderScript(layer: ScriptLayer, still = false): SVGElement {
  const w = typeof layer.width === 'number' ? layer.width : 400;
  const h = typeof layer.height === 'number' ? layer.height : 300;
  const fo = createSVGElement('foreignObject', { x: layer.x ?? 0, y: layer.y ?? 0, width: w, height: h });
  const iframe = document.createElement('iframe');
  iframe.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  iframe.style.cssText = `width:${w}px;height:${h}px;border:none;background:transparent;display:block`;
  iframe.setAttribute('sandbox', 'allow-scripts');
  iframe.setAttribute('data-folio-script', layer.id);
  iframe.setAttribute('srcdoc', buildScriptDoc(layer, still));
  fo.appendChild(iframe);
  applyCommonAttributes(fo, layer);
  return fo;
}
