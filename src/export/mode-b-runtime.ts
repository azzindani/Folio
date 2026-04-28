import type { StateDef, ScriptDef } from '../schema/types';

export interface RuntimeOptions {
  state: Record<string, StateDef>;
  scripts: ScriptDef[];
  dataJson?: string;
}

/** Evaluates a template expression like "`Step ${state.step + 1}`" against a state snapshot. */
export function evaluateExpression(
  expr: string,
  state: Record<string, unknown>,
  data: Record<string, unknown> = {},
): unknown {
  try {
    const fn = new Function('state', 'data', `"use strict"; return (${expr});`);
    return fn(state, data);
  } catch {
    return expr;
  }
}

/** Returns the serialised initial state object from StateDef map. */
export function buildInitialState(defs: Record<string, StateDef>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, def] of Object.entries(defs)) {
    result[k] = def.default ?? (def.type === 'number' ? 0 : def.type === 'boolean' ? false : '');
  }
  return result;
}

/**
 * Generates the inline JS boot script for Mode B output.
 * The script is injected into the HTML; it:
 *   1. Initialises window.FolioState from the StateDef defaults
 *   2. Exposes setState(k, v) which re-evaluates [data-expr] elements and patches the DOM
 *   3. Wires defined scripts to their trigger elements
 */
export function generateModeBRuntime(opts: RuntimeOptions): string {
  const initialState = buildInitialState(opts.state);
  const scriptDefs = opts.scripts.map(s => ({
    id: s.id,
    trigger: s.trigger ?? null,
    code: s.code,
  }));

  return `(function(){
  var _state=${JSON.stringify(initialState)};
  var _data=${opts.dataJson ?? '{}'};

  function _evalExpr(expr){
    try{return (new Function('state','data','"use strict";return ('+expr+');'))(_state,_data);}
    catch(e){return expr;}
  }

  function _patch(){
    document.querySelectorAll('[data-expr]').forEach(function(el){
      var expr=el.dataset.expr||'';
      var result=_evalExpr(expr);
      if(el.tagName==='INPUT')el.value=String(result);
      else el.textContent=String(result);
    });
    document.querySelectorAll('[data-show-if]').forEach(function(el){
      var v=_evalExpr(el.dataset.showIf||'false');
      el.style.display=v?'':'none';
    });
  }

  window.FolioState={
    get:function(k){return _state[k];},
    set:function(k,v){_state[k]=v;_patch();},
    reset:function(){${JSON.stringify(initialState)};Object.assign(_state,${JSON.stringify(initialState)});_patch();},
    getAll:function(){return Object.assign({},_state);}
  };

  // Wire script triggers
  var _scripts=${JSON.stringify(scriptDefs)};
  _scripts.forEach(function(s){
    if(!s.trigger)return;
    var el=document.querySelector('[data-script-id="'+s.trigger+'"]');
    if(!el)return;
    el.addEventListener('click',function(event){
      try{(new Function('state','data','event','"use strict";'+s.code))(window.FolioState,_data,event);}
      catch(e){console.warn('Folio script error:',e);}
    });
  });

  _patch();
})();`;
}
