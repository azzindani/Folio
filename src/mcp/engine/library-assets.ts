// Library — the project assets drawer.
//
// This used to be a SECOND asset manager: its own markup, its own verbs, its
// own dialogs, sharing nothing with the editor's panel but the HTTP endpoints.
// The two drifted, as duplicates do — the editor's manager was rebuilt three
// times while this one still had a "New folder" button that only primed an
// upload and no way to delete a folder at all. Someone standing here saw none
// of the fixes.
//
// So the drawer no longer implements a file manager. It hosts THE file manager:
// the same explorer the editor mounts, built standalone by
// vite.assets.config.ts and loaded from /asset-explorer.js. This file is now
// just the frame around it — a shell, a palette bridge, and the open/close.

/** Escape for HTML text/attribute context. */
function esc(s: string): string {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));
}

export const ASSET_STYLE = `
#assetsbtn{margin-left:6px}
.adrawer{position:fixed;inset:auto 0 0 0;height:min(86vh,720px);background:var(--panel);border-top:1px solid var(--bd2);
  z-index:60;display:none;flex-direction:column}
.adrawer.open{display:flex}
.adrawer-head{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--bd)}
.adrawer-head h2{font-size:14px;margin:0;font-weight:700;color:var(--fg)}
.abtn{min-height:44px;padding:0 14px;border-radius:8px;border:1px solid var(--bd2);background:var(--panel2);
  color:var(--fg);font:inherit;font-size:13px;font-weight:600;cursor:pointer}
.abtn:hover{border-color:var(--acc)}
.abtn-close{margin-left:auto}
/* The explorer fills what is left of the drawer. .ax is height:100%, so this
   box has to have a definite one — flex:1 with min-height:0 gives it that. */
.axmount{flex:1;min-height:0;display:flex;flex-direction:column;position:relative}
/* Palette bridge. The explorer is styled in the editor's design tokens; this
   page has its own names for the same things. Mapping them here means the
   shared stylesheet needs no per-page variant, and the drawer follows the
   Library's own light/dark switch for free. */
.axmount{
  --color-surface:var(--panel);
  --color-surface-2:var(--panel2);
  --color-surface-3:var(--bd);
  --color-text:var(--fg);
  --color-text-muted:var(--mut);
  --color-border:var(--bd);
  --color-primary:var(--acc);
  --color-danger:#e5484d;
  --radius-sm:8px;
  --font-mono:ui-monospace,SFMono-Regular,Menlo,monospace;
}
.axloading{padding:16px;color:var(--mut);font-size:13px}
@media(max-width:640px){.adrawer{height:92vh}}
`;

/**
 * The drawer shell. The file manager itself is mounted into #axmount at open
 * time, so nothing here duplicates its markup.
 */
export function assetDrawerMarkup(_projects: { name: string }[]): string {
  return `<div class="adrawer" id="adrawer" aria-label="Project assets">
  <div class="adrawer-head">
    <h2>Assets</h2>
    <button class="abtn abtn-close" id="aclose" type="button">Close</button>
  </div>
  <div class="axmount" id="axmount"><div class="axloading">Loading the file manager…</div></div>
</div>`;
}

/** Tags that pull in the shared explorer. Stable filenames — see
 *  vite.assets.config.ts, which exists so this page can link them. */
export const ASSET_ASSETS = `<link rel="stylesheet" href="/asset-explorer.css">
<script src="/asset-explorer.js" defer></script>`;

export const ASSET_SCRIPT = `(function(){
var drawer=document.getElementById('adrawer'),btn=document.getElementById('assetsbtn'),
    mountEl=document.getElementById('axmount'),panel=null;
if(!drawer||!btn||!mountEl)return;
function token(){try{return new URLSearchParams(location.search).get('token');}catch(e){return null;}}
/* Deep link: /library?assets=<project> opens straight into that project. */
function wanted(){try{return new URLSearchParams(location.search).get('assets')||null;}catch(e){return null;}}
function ensure(){
  if(panel)return true;
  /* The bundle is deferred, so the first open can land before it does. Say so
     rather than opening an empty drawer — a blank pane reads as broken, which
     is exactly the report that started all of this. */
  if(!window.FolioAssets||!window.FolioAssets.mount){
    mountEl.innerHTML='<div class="axloading">Still loading the file manager… try again in a moment.</div>';
    return false;
  }
  mountEl.innerHTML='';
  panel=window.FolioAssets.mount(mountEl,{project:wanted(),token:token(),scope:'library'});
  return true;
}
function open(){drawer.classList.add('open');ensure();}
function close(){drawer.classList.remove('open');}
btn.onclick=function(){drawer.classList.contains('open')?close():open();};
var closeBtn=document.getElementById('aclose');
if(closeBtn)closeBtn.onclick=close;
if(wanted()!==null){if(document.readyState==='complete')open();else window.addEventListener('load',open);}
})();`;

export { esc };
