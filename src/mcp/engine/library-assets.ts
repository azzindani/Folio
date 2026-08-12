// Library — the project assets drawer.
//
// The editor's asset panel only helps once a design is open. The library is
// where you arrive with a phone full of screenshots and no design yet, so the
// upload has to live here too. Same endpoints as the editor panel
// (/__project_files/<project>/__assets…), which are the same engine ops the MCP
// asset_* tools call — one store, one set of rules, three front doors.
//
// Kept out of library-gallery.ts to hold that file inside the line budget.

/** Escape for HTML text/attribute context. */
function esc(s: string): string {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));
}

export const ASSET_STYLE = `
#assetsbtn{margin-left:6px}
.adrawer{position:fixed;inset:auto 0 0 0;height:min(86vh,720px);background:var(--panel);border-top:1px solid var(--bd2);
  z-index:60;display:none;flex-direction:column}
.adrawer.open{display:flex}
.adrawer-head{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--bd);flex-wrap:wrap}
.adrawer-head h2{font-size:14px;margin:0;font-weight:700;color:var(--fg)}
.adrawer select,.adrawer input[type=search]{background:var(--panel2);color:var(--fg);border:1px solid var(--bd2);
  border-radius:8px;min-height:44px;padding:0 10px;font:inherit;font-size:13px}
.abtn{min-height:44px;padding:0 14px;border-radius:8px;border:1px solid var(--bd2);background:var(--panel2);
  color:var(--fg);font:inherit;font-size:13px;font-weight:600;cursor:pointer}
.abtn:hover{border-color:var(--acc)}
.abtn-primary{background:var(--acc);border-color:var(--acc);color:#fff}
.abtn-close{margin-left:auto}
.achips{display:flex;gap:6px;padding:8px 12px;overflow-x:auto;border-bottom:1px solid var(--bd)}
.achip{min-height:36px;padding:0 12px;white-space:nowrap;border-radius:18px;border:1px solid var(--bd2);
  background:var(--panel2);color:var(--mut);font-size:12px;font-weight:600;cursor:pointer}
.achip.on{background:var(--acc);border-color:var(--acc);color:#fff}
.agrid{flex:1;overflow-y:auto;padding:12px;display:grid;gap:10px;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));align-content:start}
.acard{border:1px solid var(--bd);border-radius:10px;overflow:hidden;background:var(--panel2)}
.acard img,.acard .afont{width:100%;height:104px;object-fit:cover;display:block;background:var(--bd)}
.acard .afont{display:flex;align-items:center;justify-content:center;font-size:22px;color:var(--mut)}
.aname{padding:6px 8px 0;font-size:12px;font-weight:600;color:var(--fg);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ameta{padding:0 8px 6px;font-size:10px;color:var(--mut)}
.aacts{display:flex;border-top:1px solid var(--bd)}
.aacts button{flex:1;min-height:40px;background:none;border:none;color:var(--mut);font:inherit;font-size:11px;font-weight:600;cursor:pointer}
.aacts button+button{border-left:1px solid var(--bd)}
.aacts button:hover{color:var(--fg)}
.aacts .adel:hover{color:#f87171}
.aempty{grid-column:1/-1;color:var(--mut);font-size:13px;line-height:1.5;padding:16px}
.aedit{position:absolute;inset:0;background:var(--panel);z-index:2;display:none;flex-direction:column}
.aedit.open{display:flex}
.aedit-head{display:flex;gap:8px;align-items:center;padding:10px 12px;border-bottom:1px solid var(--bd);flex-wrap:wrap}
.aedit input[type=text]{flex:1;min-width:140px;min-height:44px;padding:0 10px;font:inherit;font-size:13px;
  background:var(--panel2);color:var(--fg);border:1px solid var(--bd2);border-radius:8px}
.aedit textarea{flex:1;margin:12px;padding:12px;background:var(--panel2);color:var(--fg);border:1px solid var(--bd2);
  border-radius:10px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;line-height:1.55;resize:none}
.afoot{padding:8px 12px;border-top:1px solid var(--bd);font-size:11px;color:var(--mut)}
@media(max-width:640px){.adrawer{height:92vh}.adrawer-head{gap:6px}}
`;

/**
 * The drawer markup. Projects come from the library scan so the picker is
 * populated without another round trip.
 */
export function assetDrawerMarkup(projects: { name: string }[]): string {
  const opts = projects
    .map(p => `<option value="${esc(p.name)}">${esc(p.name)}</option>`)
    .join('');
  return `<div class="adrawer" id="adrawer" aria-label="Project assets">
  <div class="adrawer-head">
    <h2>Assets</h2>
    <select id="aproj" aria-label="Project">${opts}</select>
    <button class="abtn abtn-primary" id="aupload" type="button">＋ Upload</button>
    <button class="abtn" id="asharedupload" type="button" title="Upload into the SHARED library — every project can use it">◆ Add to shared</button>
    <button class="abtn" id="anote" type="button" title="Write a markdown or text file here">✎ Write</button>
    <button class="abtn" id="anewfolder" type="button" title="Upload into a new folder">New folder</button>
    <button class="abtn" id="arefresh" type="button" title="Refresh">↻</button>
    <button class="abtn abtn-close" id="aclose" type="button">Close</button>
    <input type="file" id="afile" multiple hidden
      accept="image/png,image/jpeg,image/webp,image/gif,image/avif,image/svg+xml,font/ttf,font/otf,font/woff2,font/woff,.ttf,.otf,.woff,.woff2,.md,.markdown,.txt,.csv,.json,.yaml,.yml,text/markdown,text/plain,text/csv,application/json">
  </div>
  <div class="adrawer-head" style="border:none;padding-bottom:0">
    <input type="search" id="asearch" placeholder="Search assets…" style="flex:1">
  </div>
  <div class="achips" id="achips"></div>
  <div class="agrid" id="agrid"></div>
  <div class="afoot" id="afoot"></div>
  <div class="aedit" id="aedit" aria-label="Edit text asset">
    <div class="aedit-head">
      <input type="text" id="aename" placeholder="brief.md" aria-label="File name">
      <button class="abtn abtn-primary" id="aesave" type="button">Save</button>
      <button class="abtn" id="aecancel" type="button">Cancel</button>
    </div>
    <textarea id="aetext" spellcheck="false" placeholder="# Brief&#10;&#10;Paste the copy, links and notes the design should be built from."></textarea>
  </div>
</div>`;
}

/**
 * Drawer behaviour. Plain ES5-ish DOM code, inlined into the page like the rest
 * of the library's script — no bundler runs over this file.
 *
 * Auth rides the folio_session cookie the library page already holds, so the
 * fetches carry credentials and nothing here handles tokens.
 */
export const ASSET_SCRIPT = `(function(){
var drawer=document.getElementById('adrawer');if(!drawer)return;
var projSel=document.getElementById('aproj'),grid=document.getElementById('agrid'),chips=document.getElementById('achips'),
    foot=document.getElementById('afoot'),file=document.getElementById('afile'),search=document.getElementById('asearch');
var ed=document.getElementById('aedit'),edName=document.getElementById('aename'),edText=document.getElementById('aetext');
var rows=[],folders=[],libFolders=[],folder=null,store='all',pendingFolder=null,pendingScope='project',edFolder='';
function shared(p){return String(p||'').indexOf('lib/')===0;}
var DOC=/\\.(md|markdown|txt|csv|json|ya?ml)$/i;
function base(){return '/__project_files/'+encodeURIComponent(projSel.value||'');}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function open(){drawer.classList.add('open');load();}
function close(){drawer.classList.remove('open');}
function visible(){
  var q=(search.value||'').trim().toLowerCase();
  return rows.filter(function(a){
    if(store!=='all'&&(store==='library')!==shared(a.path))return false;
    if(folder!==null&&(a.folder||'')!==folder)return false;
    if(!q)return true;
    return a.path.toLowerCase().indexOf(q)>=0||String(a.alt||'').toLowerCase().indexOf(q)>=0;
  }).sort(function(x,y){
    var rk=function(k){return k==='images'||k==='icons'?0:1;};var r=rk(x.kind)-rk(y.kind);
    return r||x.path.localeCompare(y.path);
  });
}
function draw(){
  var list=visible();
  chips.innerHTML=['<button class="achip'+(folder===null&&store==='all'?' on':'')+'" data-f="*">All</button>',
    '<button class="achip'+(store==='library'?' on':'')+'" data-f="store:library">\u25C6 Shared</button>',
    '<button class="achip'+(store==='project'?' on':'')+'" data-f="store:project">This project</button>',
    '<button class="achip'+(folder===''?' on':'')+'" data-f="">Root</button>']
    .concat((store==='library'?libFolders:folders).map(function(f){return '<button class="achip'+(folder===f?' on':'')+'" data-f="'+esc(f)+'">'+esc(f)+'</button>';})).join('');
  grid.innerHTML=list.length?list.map(function(a,i){
    var name=a.path.split('/').pop(),dims=a.width?a.width+'×'+a.height:'',kb=Math.max(1,Math.round(a.bytes/1024))+' KB';
    var meta=[dims,kb,a.folder||''].filter(Boolean).join(' · ');
    var thumb=a.kind==='docs'?'<div class="afont">\u{1F4C4}</div>':a.kind==='fonts'?'<div class="afont">Aa</div>'
      :'<img loading="lazy" alt="'+esc(a.alt||name)+'" src="'+base()+'/'+a.path.split('/').map(encodeURIComponent).join('/')+'">';
    return '<div class="acard">'+thumb+'<div class="aname">'+esc(name)+'</div><div class="ameta">'+esc(meta)+'</div>'+
      '<div class="aacts">'+(a.kind==='docs'?'<button data-a="edt" data-i="'+i+'">Edit</button>':'')+
      '<button data-a="ren" data-i="'+i+'">Rename</button>'+
      '<button data-a="mov" data-i="'+i+'">Move</button>'+
      '<button class="adel" data-a="del" data-i="'+i+'">Delete</button></div></div>';
  }).join(''):'<div class="aempty">'+(rows.length?'Nothing matches that filter.':'No assets yet. Upload one — \u201C＋ Upload\u201D keeps it in this project, \u201C\u25C6 Add to shared\u201D puts it in the library every project can use.')+'</div>';
  var nShared=rows.filter(function(a){return shared(a.path);}).length;
  foot.textContent=(rows.length-nShared)+' in '+(projSel.value||'')+' \u00B7 '+nShared+' shared';
  [].forEach.call(chips.querySelectorAll('.achip'),function(c){
    c.onclick=function(){var v=c.getAttribute('data-f');
      if(v.indexOf('store:')===0){var want=v.slice(6);store=store===want?'all':want;folder=null;}
      else{folder=v==='*'?null:v;if(v==='*')store='all';}
      draw();};
  });
  [].forEach.call(grid.querySelectorAll('[data-a]'),function(b){
    b.onclick=function(){
      var a=list[+b.getAttribute('data-i')];if(!a)return;
      var act=b.getAttribute('data-a'),n=a.path.split('/').pop();
      if(act==='edt'){edOpen(a);}
      else if(act==='ren'){var nn=prompt('Rename asset (keep the extension):',n);if(nn&&nn!==n)manage({op:'move',asset_path:a.path,new_name:nn});}
      else if(act==='mov'){var f=prompt('Move to folder (blank = project root):',a.folder||'');if(f!==null)manage({op:'move',asset_path:a.path,folder:f});}
      else if(act==='del'){if(confirm('Delete '+n+'? It moves to .trash and any design using it shows a placeholder.'))manage({op:'delete',asset_path:a.path});}
    };
  });
}
function load(){
  if(!projSel.value){rows=[];folders=[];draw();return;}
  fetch(base()+'/__assets',{credentials:'include'}).then(function(r){return r.json();}).then(function(j){
    rows=j.assets||[];folders=j.folders||[];libFolders=j.library_folders||[];draw();
  }).catch(function(){grid.innerHTML='<div class="aempty">Could not reach the server.</div>';});
}
function manage(body){
  fetch(base()+'/__assets/manage',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
    .then(function(r){return r.json();}).then(function(j){if(!j.ok)alert(j.error||'Failed');load();})
    .catch(function(){alert('Could not reach the server.');});
}
function upload(files,into,scope){
  var i=0,ok=0;
  (function next(){
    if(i>=files.length){if(ok)foot.textContent='Uploaded '+ok+' asset'+(ok===1?'':'s');load();return;}
    var f=files[i++],kind=/\\.(ttf|otf|woff2?)$/i.test(f.name)?'fonts':(/\\.(md|markdown|txt|csv|json|ya?ml)$/i.test(f.name)?'docs':'images'),
        toLib=scope==='library',
        seg=(toLib||!into)?'':encodeURIComponent(into)+'/',
        qs=toLib?'?scope=library&folder='+encodeURIComponent(into||kind):'';
    fetch(base()+'/assets/'+kind+'/'+seg+encodeURIComponent(f.name)+qs,{method:'POST',credentials:'include',
      headers:{'Content-Type':f.type||'application/octet-stream'},body:f})
      .then(function(r){return r.json().catch(function(){return {};});})
      .then(function(j){if(j.ok)ok++;else alert(f.name+': '+(j.error||'upload failed'));next();})
      .catch(function(){alert(f.name+': upload failed');next();});
  })();
}
// ── Write/edit a text asset ────────────────────────────────────────────────
// Saving posts plain text to the same upload route an image uses; the server
// ingests it by filename, so the extension alone decides where it lands.
function edOpen(a){
  edFolder=a?(a.folder||''):(folder||'');
  edName.value=a?a.path.split('/').pop():'';
  edText.value='';
  ed.classList.add('open');
  if(a){
    edText.value='Loading…';edText.disabled=true;
    fetch(base()+'/'+a.path.split('/').map(encodeURIComponent).join('/'),{credentials:'include'})
      .then(function(r){return r.text();}).then(function(t){edText.value=t;edText.disabled=false;})
      .catch(function(){edText.value='';edText.disabled=false;alert('Could not read that file.');});
  } else {setTimeout(function(){edName.focus();},0);}
}
function edClose(){ed.classList.remove('open');}
function edSave(){
  var n=(edName.value||'').trim();
  if(!n){alert('Give the file a name, ending in .md, .txt, .csv, .json or .yaml.');return;}
  if(!DOC.test(n)){alert('Text files only here: .md, .markdown, .txt, .csv, .json, .yaml.');return;}
  if(!edText.value){alert('The file is empty — write something first.');return;}
  var seg=edFolder?encodeURIComponent(edFolder)+'/':'';
  fetch(base()+'/assets/docs/'+seg+encodeURIComponent(n),{method:'POST',credentials:'include',
    headers:{'Content-Type':'text/plain;charset=utf-8'},body:edText.value})
    .then(function(r){return r.json().catch(function(){return {};});})
    .then(function(j){if(j.ok){edClose();load();}else alert(j.error||'Save failed');})
    .catch(function(){alert('Could not reach the server.');});
}
document.getElementById('anote').onclick=function(){edOpen(null);};
document.getElementById('aesave').onclick=edSave;
document.getElementById('aecancel').onclick=edClose;
document.getElementById('assetsbtn').onclick=function(){drawer.classList.contains('open')?close():open();};
document.getElementById('aclose').onclick=function(){edClose();close();};
document.getElementById('arefresh').onclick=load;
document.getElementById('aupload').onclick=function(){pendingFolder=null;pendingScope='project';file.click();};
document.getElementById('asharedupload').onclick=function(){
  var n=prompt('File it under which shared folder? (e.g. "microsoft/logos")',folder||'');if(n===null)return;
  pendingFolder=n;pendingScope='library';file.click();};
document.getElementById('anewfolder').onclick=function(){
  var n=prompt('Upload into which folder?',folder||'screenshots');if(n===null)return;pendingFolder=n;file.click();};
file.onchange=function(){
  if(file.files&&file.files.length)upload(file.files,pendingFolder!==null?pendingFolder:(folder||''),pendingScope);
  pendingFolder=null;pendingScope='project';file.value='';};
projSel.onchange=function(){folder=null;load();};
search.oninput=draw;
// Deep link: /library?assets=<project> opens straight into that project.
try{var qp=new URLSearchParams(location.search).get('assets');
  if(qp!==null){if(qp)projSel.value=qp;open();}}catch(e){}
})();`;
