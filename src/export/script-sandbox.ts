import type { ScriptDef } from '../schema/types';

export interface SandboxContext {
  state: Record<string, unknown>;
  data: Record<string, unknown>;
}

export interface SandboxResult {
  ok: boolean;
  statePatches: Record<string, unknown>;
  error?: string;
}

/**
 * Builds a sandboxed iframe srcdoc string.
 * The iframe has no access to window, document, fetch, or eval of the parent.
 * Communication is via postMessage.
 * Blocked: window, document, fetch, eval, require, XMLHttpRequest
 */
export function buildSandboxSrcdoc(scripts: ScriptDef[]): string {
  const scriptBodies = scripts.map(s =>
    `_scripts[${JSON.stringify(s.id)}]=${JSON.stringify(s.code)};`,
  ).join('\n');

  return `<!DOCTYPE html><html><body><script>
(function(){
  "use strict";
  var _scripts={};
  ${scriptBodies}
  var _state={};var _data={};
  function _safe(code,ctx){
    var fn=new Function(
      'state','data','event','console',
      'window','document','fetch','eval','require','XMLHttpRequest',
      '"use strict";'+code
    );
    return fn(ctx.state,ctx.data,ctx.event,_safeConsole,
      undefined,undefined,undefined,undefined,undefined,undefined);
  }
  var _safeConsole={log:function(){},warn:function(){},error:function(){}};
  window.addEventListener('message',function(e){
    if(!e.data||e.data.type!=='run')return;
    var msg=e.data;
    _state=msg.state||{};_data=msg.data||{};
    var code=_scripts[msg.scriptId]||'';
    try{
      _safe(code,{state:_state,data:_data,event:msg.event||{}});
      parent.postMessage({type:'result',id:msg.id,ok:true,state:_state},'*');
    }catch(err){
      parent.postMessage({type:'result',id:msg.id,ok:false,error:String(err),state:_state},'*');
    }
  });
})();
<\/script></body></html>`;
}

/**
 * Browser-only: runs a script inside a hidden sandboxed iframe, returns patched state.
 * Resolves after the script completes or after `timeoutMs`.
 */
export function runInSandbox(
  srcdoc: string,
  scriptId: string,
  ctx: SandboxContext,
  timeoutMs = 2000,
): Promise<SandboxResult> {
  return new Promise(resolve => {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox', 'allow-scripts');
    iframe.style.display = 'none';
    iframe.srcdoc = srcdoc;

    const msgId = `${scriptId}-${Date.now()}`;
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      document.body.removeChild(iframe);
      resolve({ ok: false, statePatches: {}, error: 'Script timed out' });
    }, timeoutMs);

    const handler = (ev: MessageEvent) => {
      if (!ev.data || ev.data.id !== msgId) return;
      clearTimeout(timer);
      window.removeEventListener('message', handler);
      settled = true;
      document.body.removeChild(iframe);
      resolve({
        ok: ev.data.ok,
        statePatches: ev.data.state ?? {},
        error: ev.data.error,
      });
    };

    window.addEventListener('message', handler);
    document.body.appendChild(iframe);

    iframe.addEventListener('load', () => {
      iframe.contentWindow?.postMessage(
        { type: 'run', id: msgId, scriptId, state: ctx.state, data: ctx.data },
        '*',
      );
    });
  });
}
