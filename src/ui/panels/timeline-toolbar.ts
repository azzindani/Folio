// The timeline's toolbar: transport and time on the left, the clip tools beside them, the view (options, zoom) on the right.
// Every control keeps the id it had — the panel binds by id, and specs click them. Duration, stagger and trails sit in an
// options row the ⋯ button opens, so the toolbar is one line wherever there is room for one.

export interface ToolbarState { duration: number; hold: number; time: string; total: string; optionsOpen: boolean; onlySelected: boolean }

export function toolbarHTML(s: ToolbarState): string {
  return `
        <div class="timeline-toolbar">
          <div class="tl-group">
            <button class="btn btn-sm tl-icon" id="tl-play" aria-label="Play / pause">▶</button>
            <button class="btn btn-sm tl-icon" id="tl-stop" aria-label="Stop">■</button>
            <span class="tl-time"><span id="tl-timecode">${s.time}</span><span class="tl-total" id="tl-total"> / ${s.total}</span></span>
          </div>
          <div class="tl-group">
            <button class="btn btn-sm" id="tl-split" title="Cut the selected clip — or the top clip under the playhead — in two at the playhead (S)">✂ Split</button>
            <button class="btn btn-sm" id="tl-freeze" title="Hold the frame at the playhead for the time beside it, and move everything after it later">❄ Freeze</button>
            <input class="tl-num" id="tl-hold" type="number" min="100" max="10000" step="100" value="${s.hold}" aria-label="Freeze hold, ms" title="How long ❄ Freeze holds the frame, ms">
          </div>
          <div class="tl-group tl-view">
            <button class="btn btn-sm" id="tl-options-toggle" aria-expanded="${s.optionsOpen}" aria-controls="tl-options" title="Duration, stagger, trails">⋯</button>
            <span class="tl-zoom" role="group" aria-label="Zoom">
              <button class="btn btn-sm" id="tl-zoom-out" title="Zoom out" aria-label="Zoom out">−</button>
              <button class="btn btn-sm" id="tl-zoom-fit" title="Fit the whole scene in view" aria-label="Fit the scene">Fit</button>
              <button class="btn btn-sm" id="tl-zoom-in" title="Zoom in — or Ctrl + scroll, or pinch" aria-label="Zoom in">+</button>
            </span>
          </div>
        </div>
        <div class="timeline-options" id="tl-options"${s.optionsOpen ? '' : ' hidden'}>
          <label title="How long the scene is, ms — by default it fits what plays">Duration
            <input class="tl-num" id="tl-duration" type="number" min="100" max="30000" step="100" value="${s.duration}"> ms</label>
          <label title="Offset each SELECTED layer's keyframes by this much more than the one before — the panel's op:sequence.">Stagger
            <input class="tl-num" id="tl-stagger" type="number" min="0" max="5000" step="10" value="80"> ms</label>
          <button class="btn btn-sm" id="tl-stagger-apply">Stagger</button>
          <label class="tl-check" title="Draw each animated layer's path on the canvas — spacing shows the easing."><input id="tl-trails" type="checkbox"> Trails</label>
          <label class="tl-check" title="Show only the selected layers' rows, instead of the whole sequence"><input id="tl-selected-only" type="checkbox"${s.onlySelected ? ' checked' : ''}> Selected only</label>
        </div>`;
}
