function m(n){return`<!DOCTYPE html><html><body><script>
(function(){
  "use strict";
  var _scripts={};
  ${n.map(e=>`_scripts[${JSON.stringify(e.id)}]=${JSON.stringify(e.code)};`).join(`
`)}
  var _state={};var _data={};
  function _safe(code,ctx){
    var fn=new Function(
      'state','data','event','console',
      'window','document','fetch','require','XMLHttpRequest',
      '"use strict";'+code
    );
    return fn(ctx.state,ctx.data,ctx.event,_safeConsole,
      undefined,undefined,undefined,undefined,undefined);
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
<\/script></body></html>`}function f(n,e,r,c=2e3){return new Promise(d=>{const t=document.createElement("iframe");t.setAttribute("sandbox","allow-scripts"),t.style.display="none",t.srcdoc=n;const o=`${e}-${Date.now()}`;let s=!1;const u=setTimeout(()=>{s||(s=!0,document.body.removeChild(t),d({ok:!1,statePatches:{},error:"Script timed out"}))},c),i=a=>{!a.data||a.data.id!==o||(clearTimeout(u),window.removeEventListener("message",i),s=!0,document.body.removeChild(t),d({ok:a.data.ok,statePatches:a.data.state??{},error:a.data.error}))};window.addEventListener("message",i),document.body.appendChild(t),t.addEventListener("load",()=>{t.contentWindow?.postMessage({type:"run",id:o,scriptId:e,state:r.state,data:r.data},"*")})})}export{m as buildSandboxSrcdoc,f as runInSandbox};
