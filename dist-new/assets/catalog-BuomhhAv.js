import{_ as D,a as q,b as S,c as R,d as E,i as H,l as F,n as x,o as j,r as z,s as U,t as J,u as Y,v as K,x as G,y as V}from"./index-DVfAsX4h.js";var Q="/assets/catalog-index-D7J8yULq.json",y=null,g=null;async function A(){return y||g||(g=(async()=>{try{const e=await(await fetch(Q)).json();return y=e.entries,e.entries}finally{g=null}})(),g)}function k(e){return y?.find(t=>t.id===e)}var W="/templates/builtin",T=new Map,I=new Map;async function C(e){if(T.has(e))return T.get(e);const t=I.get(e);if(t)return t;y||await A();const s=k(e);if(!s)return;const a=`${W}/${s.file}`,i=(async()=>{try{const n=await fetch(a);if(!n.ok)return;const r=K(await n.text());return!r||r._protocol!=="template/v1"?void 0:(T.set(e,r),r)}catch{return}finally{I.delete(e)}})();return I.set(e,i),i}function M(e){return T.get(e)}var X={"dark-tech":["dark","pink-accent","classic"],"light-clean":["light","minimal","editorial"],"ocean-blue":["dark","teal","calm"],"neon-bloom":["dark","neon","event"],"indigo-pro":["dark","indigo","saas"],"sunset-glow":["dark","warm","sunset"],"mono-print":["light","mono","editorial"],"forest-deep":["dark","green","organic"],"pastel-dream":["light","pastel","soft","feminine"],"high-contrast":["dark","high-contrast","a11y","electric"],"brutalist-mono":["light","mono","brutalist","editorial"],"cyber-synthwave":["dark","neon","synthwave","retro"],"editorial-cream":["light","warm","editorial","magazine"],"corporate-slate":["dark","corporate","professional","steel"]};function b(e,t="#000000"){return typeof e=="string"?e:e&&typeof e=="object"?e.light??e.dark??Object.values(e)[0]??t:t}function Z(e){const t=/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(e);if(!t)return!1;const s=parseInt(t[1],16),a=parseInt(t[2],16),i=parseInt(t[3],16);return .2126*s+.7152*a+.0722*i>160}var $=null;function _(){return $||($=Object.entries(Y).map(([e,t])=>{const s=t.colors,a=b(s.background,"#000000"),i=b(s.surface,a),n=b(s.primary,"#888888"),r=b(s.secondary,"#888888"),l=b(s.text,"#FFFFFF");return{id:e,name:t.name,spec:t,swatches:[a,i,n,r,l],tags:X[e]??[],light:Z(a)}}),$)}function B(e){return _().find(t=>t.id===e)}var L=[{id:"stats-board",name:"Quarterly Stats — Board Update",templateId:"tmpl-stats-card",themeId:"indigo-pro",description:"Single KPI tile in deep indigo for a clean board deck."},{id:"event-neon",name:"Festival Poster — Neon Bloom",templateId:"tmpl-event-poster",themeId:"neon-bloom",description:"Portrait event poster in cyan/magenta neon."},{id:"pricing-indigo",name:"Pricing Page — Indigo Pro",templateId:"tmpl-pricing-3tier",themeId:"indigo-pro",description:"3-tier landscape pricing with Pro highlighted."},{id:"pricing-mono",name:"Pricing Page — Editorial Mono",templateId:"tmpl-pricing-3tier",themeId:"mono-print",description:"Same pricing layout but light, mono, editorial."},{id:"quote-sunset",name:"Quote Card — Sunset Glow",templateId:"tmpl-quote-card",themeId:"sunset-glow",description:"Warm-toned testimonial for product launch posts."},{id:"carousel-ocean",name:"Launch Carousel — Ocean Blue",templateId:"tmpl-instagram-carousel",themeId:"ocean-blue",description:"4-slide narrative on a calm teal palette."},{id:"kpi-forest",name:"KPI Dashboard — Forest Deep",templateId:"tmpl-kpi-dashboard",themeId:"forest-deep",description:"Interactive HTML KPI dashboard in deep greens."},{id:"report-clean",name:"Sectioned Report — Light Clean",templateId:"tmpl-sectioned-report",themeId:"light-clean",description:"Clean light-mode interactive report with sidebar nav."}];function o(e){return String(e??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;")}function m(e){return o(e)}var ee=class{overlay=null;cb=null;tab="templates";selectedTemplateId=null;selectedThemeId=null;selectedPaletteId=null;selectedTypePackId=null;selectedEffectsPackId=null;index=[];themes=[];palettes=[];typePacks=[];effectsPacks=[];resolvedPalette;resolvedTypePack;resolvedEffectsPack;filter={search:"",tag:null};previewPageIndex=0;io=null;thumbCache=new Map;effectTokenCache=new Map;shellHTML(){return`
      <div class="catalog" role="dialog" aria-label="Folio Catalog">
        <div class="catalog-header">
          <h2 class="catalog-title">Folio Catalog</h2>
          <div class="catalog-tabs">
            <button class="catalog-tab active" data-tab="templates">Templates</button>
            <button class="catalog-tab"        data-tab="themes">Themes</button>
            <button class="catalog-tab"        data-tab="palettes">Palettes</button>
            <button class="catalog-tab"        data-tab="type">Type</button>
            <button class="catalog-tab"        data-tab="effects">Effects</button>
            <button class="catalog-tab"        data-tab="reports">Reports</button>
            <button class="catalog-tab"        data-tab="featured">Featured</button>
          </div>
          <button class="dialog-close" data-action="close" aria-label="Close">×</button>
        </div>
        <div class="catalog-filter" data-pane="filter">${this.filterBarHTML()}</div>
        <div class="catalog-body">
          <div class="catalog-list" data-pane="list">${this.tabHTML()}</div>
          <aside class="catalog-rail" data-pane="rail">${this.railHTML()}</aside>
        </div>
      </div>
    `}filterBarHTML(){if(this.tab==="themes"||this.tab==="featured"||this.tab==="palettes"||this.tab==="type"||this.tab==="effects")return"";const e=this.tab,t=24,s=this.collectTagsRanked(e),a=s.slice(0,t);this.filter.tag&&!a.includes(this.filter.tag)&&a.push(this.filter.tag);const i=Math.max(0,s.length-t),n=a.map(d=>`<button class="tag-chip${this.filter.tag===d?" selected":""}" data-tag="${m(d)}" type="button">${o(d)}</button>`).join(""),r=this.filter.tag?'<button class="tag-chip clear" data-tag="" type="button">clear ×</button>':"",l=i>0?`<span class="tag-chip-more" title="${i} more tags hidden">+${i}</span>`:"";return`
      <input class="catalog-search" type="search" placeholder="Search ${e}…"
             value="${m(this.filter.search)}" data-input="search" />
      <div class="catalog-chips">${n}${r}${l}</div>
      <span class="catalog-count" data-pane="count"></span>
    `}tabHTML(){switch(this.tab){case"templates":return this.renderIndexCards(this.filteredEntries("templates"));case"reports":return this.renderIndexCards(this.filteredEntries("reports"));case"themes":return`<div class="tmpl-grid theme-grid">${this.themes.map(e=>this.themeCardHTML(e)).join("")}</div>`;case"palettes":return this.renderStyleCards("palettes");case"type":return this.renderStyleCards("type");case"effects":return this.renderStyleCards("effects");case"featured":return`<div class="tmpl-grid">${L.map(e=>this.featuredCardHTML(e)).join("")}</div>`}}renderStyleCards(e){if(e==="palettes"){if(!this.palettes.length)return'<p class="tmpl-empty">No palettes available.</p>';const s=this.palettes.map(a=>this.paletteCardHTML(a)).join("");return`<div class="tmpl-grid theme-grid">${this.clearStyleChip(e)}${s}</div>`}if(e==="type"){if(!this.typePacks.length)return'<p class="tmpl-empty">No type packs available.</p>';const s=this.typePacks.map(a=>this.typePackCardHTML(a)).join("");return`<div class="tmpl-grid theme-grid">${this.clearStyleChip(e)}${s}</div>`}if(!this.effectsPacks.length)return'<p class="tmpl-empty">No effects packs available.</p>';const t=this.effectsPacks.map(s=>this.effectsCardHTML(s)).join("");return`<div class="tmpl-grid theme-grid">${this.clearStyleChip(e)}${t}</div>`}clearStyleChip(e){return`
      <button class="tmpl-card style-clear-card" type="button" data-style-clear="${e}">
        <div class="theme-preview" style="background:transparent;border:2px dashed var(--color-border);display:flex;align-items:center;justify-content:center;min-height:120px">
          <span style="color:var(--color-text-muted);font-size:13px">✕ no overlay</span>
        </div>
        <div class="tmpl-meta">
          <div class="tmpl-name">Clear</div>
          <div class="tmpl-sub">use the theme's defaults</div>
        </div>
      </button>
    `}paletteCardHTML(e){const t=e.tags.slice(0,3).map(p=>`<span class="tmpl-tag">${o(p)}</span>`).join(""),s=e.id===this.selectedPaletteId?" selected":"",a=e.swatches[0]??"#0d0d14",i=e.swatches[1]??a,n=e.swatches[2]??"#6c5ce7",r=e.swatches[3]??n,l=e.swatches[4]??this.contrastingText(a),d=e.swatches.slice(0,6).map(p=>`<span class="theme-swatch" style="background:${p}" title="${m(p)}"></span>`).join("");return`
      <button class="tmpl-card theme-card${s}" data-palette-id="${m(e.id)}" type="button">
        <div class="theme-preview" style="background:${a};color:${l};padding:10px;min-height:120px;display:flex;flex-direction:column;justify-content:space-between;gap:6px">
          <div style="display:flex;align-items:center;gap:6px">
            <span style="font-size:22px;font-weight:800;letter-spacing:-0.01em">Aa</span>
            <span style="display:inline-block;width:22px;height:8px;background:${n};border-radius:2px"></span>
            <span style="display:inline-block;width:22px;height:8px;background:${r};border-radius:2px"></span>
          </div>
          <div style="font-size:11px;opacity:0.85;line-height:1.35">Headline on background — body in text.</div>
          <div style="display:flex;align-items:center;gap:6px;justify-content:space-between">
            <span style="background:${n};color:${this.contrastingText(n)};font-size:10px;font-weight:700;padding:3px 8px;border-radius:3px">Action</span>
            <span style="background:${i};color:${l};font-size:10px;padding:3px 6px;border-radius:3px;opacity:0.85">surface</span>
          </div>
          <div class="theme-swatches">${d}</div>
        </div>
        <div class="tmpl-meta">
          <div class="tmpl-name">${o(e.name)}</div>
          <div class="tmpl-sub">${o(e.description)}</div>
          <div class="tmpl-tags">${t}</div>
        </div>
      </button>
    `}removableChip(e,t,s){return`
      <span class="rail-chip rail-chip--removable" title="${m(e)} pack">
        <span>${t} ${o(s)}</span>
        <button class="rail-chip-x" data-drop="${e}" aria-label="Remove ${m(s)}" type="button">×</button>
      </span>
    `}contrastingText(e){const t=/^#?([0-9a-f]{6})$/i.exec(e);if(!t)return"#FFFFFF";const s=parseInt(t[1],16),a=s>>16&255,i=s>>8&255,n=s&255;return .2126*a+.7152*i+.0722*n>140?"#0a0a0a":"#FFFFFF"}typePackCardHTML(e){const t=e.tags.slice(0,3).map(r=>`<span class="tmpl-tag">${o(r)}</span>`).join(""),s=e.id===this.selectedTypePackId?" selected":"",a=o(e.families.heading),i=o(e.families.body),n=o(e.families.mono);return`
      <button class="tmpl-card theme-card${s}" data-typepack-id="${m(e.id)}" type="button">
        <div class="theme-preview" style="background:var(--color-surface-2);min-height:120px;padding:10px;display:flex;flex-direction:column;justify-content:center;gap:4px">
          <div style="font-family:'${a}',sans-serif;font-size:28px;font-weight:800;line-height:1.05;color:var(--color-text)">Aa</div>
          <div style="font-family:'${i}',sans-serif;font-size:13px;color:var(--color-text-muted)">The quick brown fox.</div>
          <div style="font-family:'${n}',monospace;font-size:11px;color:var(--color-text-muted)">{ mono: 0123 }</div>
        </div>
        <div class="tmpl-meta">
          <div class="tmpl-name">${o(e.name)}</div>
          <div class="tmpl-sub">${a} · ${i} · ${n}</div>
          <div class="tmpl-tags">${t}</div>
        </div>
      </button>
    `}effectsCardHTML(e){const t=e.id===this.selectedEffectsPackId?" selected":"",s=e.effectKeys.slice(0,4).map(h=>`<span class="tmpl-tag" style="font-family:var(--font-mono);font-size:10px">${o(h)}</span>`).join(""),a=z(e.id),i=String(a?.effects.shadow_card??"0 4px 12px rgba(0,0,0,0.25)"),n=String(a?.effects.shadow_glow??"0 0 24px rgba(108,92,231,0.5)"),r=Number(a?.effects.blur_glass??0),l=String(a?.effects.shadow_inset??""),d=a?.effects.tint_overlay??a?.effects.highlight??"",p=typeof d=="string"&&d.startsWith("#")?d:"var(--color-surface-2)";return`
      <button class="tmpl-card theme-card${t}" data-effects-id="${m(e.id)}" type="button">
        <div class="theme-preview" style="background:${p};min-height:120px;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(${Math.min(r,12)}px)">
          <span style="display:block;width:56px;height:56px;border-radius:14px;background:var(--color-primary);box-shadow:${i}, ${n}${l?", "+l:""}"></span>
        </div>
        <div class="tmpl-meta">
          <div class="tmpl-name">${o(e.name)}</div>
          <div class="tmpl-sub">${o(e.description)}</div>
          <div class="tmpl-tags">${s}</div>
        </div>
      </button>
    `}renderIndexCards(e){return e.length===0?'<p class="tmpl-empty">No matches.</p>':`<div class="tmpl-grid">${e.map(t=>this.indexCardHTML(t)).join("")}</div>`}indexCardHTML(e){const t=e.tags.slice(0,4).map(l=>`<span class="tmpl-tag">${o(l)}</span>`).join(""),s=e.pages>0?` · ${e.pages} pages`:"",a=e.id===this.selectedTemplateId?" selected":"",i=e.type==="report",n=i?'<span class="tmpl-thumb-badge">Report</span>':"",r=i?"tmpl-thumb tmpl-thumb--report":"tmpl-thumb";return`
      <button class="tmpl-card${a}" data-template="${m(e.id)}" type="button">
        ${n}
        <div class="${r}" data-template-thumb="${m(e.id)}">
          <span class="tmpl-thumb-dim">${e.width} × ${e.height}</span>
        </div>
        <div class="tmpl-meta">
          <div class="tmpl-name">${o(e.name)}</div>
          <div class="tmpl-sub">${o(e.type)}${s} · ${e.slots} editable</div>
          <div class="tmpl-tags">${t}</div>
        </div>
      </button>
    `}themeCardHTML(e){const t=e.tags.slice(0,3).map(l=>`<span class="tmpl-tag">${o(l)}</span>`).join(""),s=e.id===this.selectedThemeId?" selected":"",a=e.swatches.map(l=>`<span class="theme-swatch" style="background:${l}" title="${l}"></span>`).join(""),i=e.light?"#0a0a0a":"#ffffff",n=m(e.spec.typography.families.heading),r=m(e.spec.typography.families.body);return`
      <button class="tmpl-card theme-card${s}" data-theme-id="${m(e.id)}" type="button">
        <div class="theme-preview" style="background:${e.swatches[0]};color:${i}">
          <div class="theme-preview-row">
            <span class="theme-preview-h" style="font-family:'${n}',sans-serif">Aa</span>
            <span class="theme-preview-dot" style="background:${e.swatches[2]}"></span>
            <span class="theme-preview-dot" style="background:${e.swatches[3]}"></span>
          </div>
          <div style="font-family:'${r}',sans-serif;font-size:11px;opacity:0.7;margin-top:6px">The quick brown fox</div>
          <div class="theme-swatches">${a}</div>
        </div>
        <div class="tmpl-meta">
          <div class="tmpl-name">${o(e.name)}</div>
          <div class="tmpl-sub">${n} · ${r}</div>
          <div class="tmpl-tags">${t}</div>
        </div>
      </button>
    `}featuredCardHTML(e){const t=B(e.themeId),s=k(e.templateId),a=t?t.swatches.map(i=>`<span class="theme-swatch sm" style="background:${i}"></span>`).join(""):"";return`
      <button class="tmpl-card combo-card" data-combo-id="${m(e.id)}" type="button">
        <div class="combo-thumb">
          <span class="combo-thumb-title">${o(e.name)}</span>
          <div class="theme-swatches">${a}</div>
        </div>
        <div class="tmpl-meta">
          <div class="tmpl-name">${o(e.name)}</div>
          <div class="tmpl-sub">${o(s?.name??e.templateId)} × ${o(t?.name??e.themeId)}</div>
          <div class="tmpl-sub" style="opacity:.7">${o(e.description??"")}</div>
        </div>
      </button>
    `}railHTML(){return`
      <div class="catalog-rail-head">
        <div class="rail-label-row">
          <div class="rail-label">Live preview</div>
          <button class="btn-shuffle" data-action="shuffle" title="Random combination" aria-label="Shuffle">🎲 Shuffle</button>
        </div>
        <div class="rail-pick" data-rail="pick"></div>
        <div class="rail-hint" data-rail="hint"></div>
      </div>
      <div class="rail-preview" data-rail="preview"></div>
      <div class="catalog-rail-actions">
        <button class="btn btn-primary" data-action="open">Open in editor</button>
        <button class="btn"               data-action="copy-mcp">Copy MCP prompt</button>
        <button class="btn"               data-action="copy-yaml">Copy YAML payload</button>
        <button class="btn-link"          data-action="copy-payload">Copy LLM payload (JSON)</button>
      </div>
    `}filteredEntries(e){const t=e==="reports",s=this.filter.search.trim().toLowerCase(),a=this.filter.tag;return this.index.filter(i=>(t?i.type!=="report":i.type==="report")||a&&!i.tags.includes(a)?!1:s?i.name.toLowerCase().includes(s)||i.id.toLowerCase().includes(s)||i.tags.some(n=>String(n).toLowerCase().includes(s)):!0)}collectTags(e){const t=new Set,s=e==="reports";for(const a of this.index)if(!(s?a.type!=="report":a.type==="report"))for(const i of a.tags)t.add(String(i));return[...t].sort()}collectTagsRanked(e){const t=new Map,s=e==="reports";for(const a of this.index)if(!(s?a.type!=="report":a.type==="report"))for(const i of a.tags)t.set(i,(t.get(i)??0)+1);return[...t.entries()].sort((a,i)=>i[1]-a[1]||a[0].localeCompare(i[0])).map(([a])=>a)}},te=class extends ee{async open(e){this.close(),this.cb=e,this.themes=_(),this.tab="templates",this.filter={search:"",tag:null},this.resolvedPalette=this.resolvedTypePack=this.resolvedEffectsPack=void 0,this.overlay=document.createElement("div"),this.overlay.className="dialog-overlay catalog-overlay",this.overlay.innerHTML=this.shellHTML(),document.body.appendChild(this.overlay),this.installObserver(),this.bindShell(),document.addEventListener("keydown",this.onKey);const[t,s,a,i]=await Promise.all([A(),U(),q(),J()]);this.index=t,this.palettes=s,this.typePacks=a,this.effectsPacks=i;const n=[];for(const r of this.typePacks)n.push(r.families.heading,r.families.body,r.families.mono);R(n),Promise.all(this.effectsPacks.map(r=>x(r.id))).then(()=>{this.tab==="effects"&&this.renderTab()}),this.selectedTemplateId=this.index[0]?.id??null,this.selectedThemeId=this.themes[0]?.id??null,this.refreshFilterBar(),this.renderTab(),this.renderPreview()}close(){this.overlay&&(this.overlay.remove(),this.overlay=null),this.io?.disconnect(),this.io=null,document.removeEventListener("keydown",this.onKey),this.cb=null}onKey=e=>{e.key==="Escape"&&this.close()};async templateUsesEffectTokens(e){const t=this.effectTokenCache.get(e);if(t!==void 0)return t;let s=M(e);if(s??=await C(e),!s)return!1;const a=JSON.stringify(s),i=/\$shadow_(card|glow|inset|text)|\$blur_(glass|backdrop)/.test(a);return this.effectTokenCache.set(e,i),i}async shuffle(){const e=d=>d[Math.floor(Math.random()*d.length)],t=e(this.themes),s=e(this.palettes),a=e(this.typePacks),i=e(this.effectsPacks);t&&(this.selectedThemeId=t.id),s&&(this.selectedPaletteId=s.id),a&&(this.selectedTypePackId=a.id),i&&(this.selectedEffectsPackId=i.id);const[n,r,l]=await Promise.all([s?j(s.id):Promise.resolve(void 0),a?H(a.id):Promise.resolve(void 0),i?x(i.id):Promise.resolve(void 0)]);this.resolvedPalette=n,this.resolvedTypePack=r,this.resolvedEffectsPack=l,this.renderTab(),this.renderPreview()}bindShell(){this.overlay&&(this.overlay.addEventListener("click",e=>{const t=e.target;if(t.classList.contains("catalog-overlay")){this.close();return}if(t.dataset.action==="close"){this.close();return}const s=t.closest("[data-tab]");if(s){this.tab=s.dataset.tab,this.filter={search:"",tag:null},this.refreshTabs(),this.refreshFilterBar(),this.renderTab();return}const a=t.closest("[data-tag]");if(a){const c=a.dataset.tag??"";this.filter.tag=c||null,this.refreshFilterBar(),this.renderTab();return}const i=t.closest("[data-template]");if(i){this.selectedTemplateId=i.dataset.template,this.previewPageIndex=0,this.renderTab(),this.renderPreview();return}const n=t.closest("[data-page-nav]");if(n){e.stopPropagation();const c=n.dataset.pageNav==="next"?1:-1;this.previewPageIndex+=c,this.renderPreview();return}const r=t.closest("[data-theme-id]");if(r){this.selectedThemeId=r.dataset.themeId,this.renderTab(),this.renderPreview();return}const l=t.closest("[data-palette-id]");if(l){this.selectedPaletteId=l.dataset.paletteId,j(this.selectedPaletteId).then(c=>{this.resolvedPalette=c,this.renderTab(),this.renderPreview()});return}const d=t.closest("[data-typepack-id]");if(d){this.selectedTypePackId=d.dataset.typepackId,H(this.selectedTypePackId).then(c=>{this.resolvedTypePack=c,this.renderTab(),this.renderPreview()});return}const p=t.closest("[data-effects-id]");if(p){this.selectedEffectsPackId=p.dataset.effectsId,x(this.selectedEffectsPackId).then(c=>{this.resolvedEffectsPack=c,this.renderTab(),this.renderPreview()});return}const h=t.closest("[data-style-clear]");if(h){const c=h.dataset.styleClear;c==="palettes"&&(this.selectedPaletteId=null,this.resolvedPalette=void 0),c==="type"&&(this.selectedTypePackId=null,this.resolvedTypePack=void 0),c==="effects"&&(this.selectedEffectsPackId=null,this.resolvedEffectsPack=void 0),this.renderTab(),this.renderPreview();return}const f=t.closest("[data-combo-id]");if(f){const c=L.find(v=>v.id===f.dataset.comboId);c&&(this.selectedTemplateId=c.templateId,this.selectedThemeId=c.themeId,this.renderPreview());return}const w=t.closest("[data-drop]");if(w){e.stopPropagation();const c=w.dataset.drop;c==="palette"&&(this.selectedPaletteId=null,this.resolvedPalette=void 0),c==="type"&&(this.selectedTypePackId=null,this.resolvedTypePack=void 0),c==="effects"&&(this.selectedEffectsPackId=null,this.resolvedEffectsPack=void 0),this.renderTab(),this.renderPreview();return}const u=t.closest("[data-action]");if(u){if(u.dataset.action==="shuffle"){this.shuffle();return}this.handleAction(u.dataset.action)}}),this.overlay.addEventListener("input",e=>{const t=e.target;if(t.dataset.input!=="search")return;this.filter.search=t.value;const s=this.overlay?.querySelector('[data-pane="list"]');s&&(s.innerHTML=this.tabHTML()),this.observeThumbs(),this.updateCount()}))}installObserver(){typeof IntersectionObserver>"u"||(this.io=new IntersectionObserver(e=>{for(const t of e)t.isIntersecting&&(this.hydrateCard(t.target),this.io?.unobserve(t.target))},{root:null,rootMargin:"200px",threshold:.01}))}observeThumbs(){!this.overlay||!this.io||this.overlay.querySelectorAll("[data-template-thumb]").forEach(e=>{const t=e.dataset.templateThumb,s=this.thumbCache.get(t);if(s){e.innerHTML=s;return}this.io.observe(e)})}renderTab(){if(!this.overlay)return;const e=this.overlay.querySelector('[data-pane="list"]');e&&(e.innerHTML=this.tabHTML()),this.observeThumbs(),this.updateCount()}refreshTabs(){this.overlay&&this.overlay.querySelectorAll(".catalog-tab").forEach(e=>{e.classList.toggle("active",e.dataset.tab===this.tab)})}refreshFilterBar(){if(!this.overlay)return;const e=this.overlay.querySelector('[data-pane="filter"]');e&&(e.innerHTML=this.filterBarHTML())}updateCount(){if(!this.overlay)return;const e=this.overlay.querySelector('[data-pane="count"]');if(!e)return;let t=0;this.tab==="templates"?t=this.filteredEntries("templates").length:this.tab==="reports"?t=this.filteredEntries("reports").length:this.tab==="themes"?t=this.themes.length:t=L.length,e.textContent=`${t} result${t===1?"":"s"}`}async hydrateCard(e){const t=e.dataset.templateThumb;if(!t)return;if(this.thumbCache.has(t)){e.innerHTML=this.thumbCache.get(t);return}const s=await C(t);if(s)try{const a=E(s,{});(!a.layers||a.layers.length===0)&&a.pages?.[0]?.layers?.length&&(a.layers=a.pages[0].layers);const i=typeof a.theme=="object"&&a.theme&&"ref"in a.theme?a.theme.ref:void 0,n=S(a,{theme:i?B(i)?.spec:void 0});n.setAttribute("viewBox",`0 0 ${a.document.width} ${a.document.height}`),n.setAttribute("preserveAspectRatio","xMidYMid meet"),n.setAttribute("width","100%"),n.setAttribute("height","100%"),n.style.display="block";const r=n.outerHTML;this.thumbCache.set(t,r),e.innerHTML=r}catch{}}async renderPreview(){if(!this.overlay)return;const e=this.overlay.querySelector('[data-rail="preview"]'),t=this.overlay.querySelector('[data-rail="pick"]'),s=this.overlay.querySelector('[data-rail="hint"]');if(!e||!t)return;const a=this.selectedTemplateId?k(this.selectedTemplateId):void 0,i=this.themes.find(h=>h.id===this.selectedThemeId),n=this.palettes.find(h=>h.id===this.selectedPaletteId),r=this.typePacks.find(h=>h.id===this.selectedTypePackId),l=this.effectsPacks.find(h=>h.id===this.selectedEffectsPackId),d=[`<span class="rail-chip">${o(a?.name??"—")}</span>`,'<span class="rail-x">×</span>',`<span class="rail-chip">${o(i?.name??"—")}</span>`];n&&d.push('<span class="rail-x">+</span>',this.removableChip("palette",F("palette",12),n.name)),r&&d.push('<span class="rail-x">+</span>',this.removableChip("type","Aa",r.name)),l&&d.push('<span class="rail-x">+</span>',this.removableChip("effects",F("sparkles",12),l.name)),t.innerHTML=d.join(""),s&&(s.innerHTML="",l&&this.selectedTemplateId&&(await this.templateUsesEffectTokens(this.selectedTemplateId)||(s.innerHTML=`<span class="rail-hint-text">✨ <em>${o(l.name)}</em> is selected, but this template doesn't bind <code>$shadow_*</code> / <code>$blur_*</code> tokens, so the effect won't be visible on the canvas.</span>`))),e.innerHTML='<div class="rail-empty">Loading preview…</div>';const p=await this.composedDesign();if(!p){e.innerHTML='<div class="rail-empty">Pick a template to preview.</div>';return}try{const h=i?.spec?V(i.spec,{palette:this.resolvedPalette,typePack:this.resolvedTypePack,effectsPack:this.resolvedEffectsPack}):void 0,f=p.pages??[],w=f.length>0;let u,c="";if(w){const v=Math.max(0,Math.min(this.previewPageIndex,f.length-1));this.previewPageIndex=v;const P=f[v],N=v===0?"disabled":"",O=v===f.length-1?"disabled":"";c=`
          <div class="rail-page-nav">
            <button data-page-nav="prev" ${N} aria-label="Previous page" type="button">‹</button>
            <span class="rail-page-counter">${v+1} / ${f.length}${P.label?" · "+o(P.label):""}</span>
            <button data-page-nav="next" ${O} aria-label="Next page" type="button">›</button>
          </div>
        `,u=G(P.layers??[],p.document.width,p.document.height,{theme:h})}else u=S(p,{theme:h});this.fitSVG(u,p),e.innerHTML=c,e.appendChild(u)}catch(h){e.innerHTML=`<div class="rail-empty">Preview failed: ${o(h.message)}</div>`}}fitSVG(e,t){const s=t.document.width,a=t.document.height;e.setAttribute("viewBox",`0 0 ${s} ${a}`),e.setAttribute("preserveAspectRatio","xMidYMid meet"),e.setAttribute("width","100%"),e.setAttribute("height","100%"),e.style.maxHeight="420px",e.style.display="block"}async composedDesign(){const e=this.selectedTemplateId;if(!e)return null;let t=M(e);if(t??=await C(e),!t)return null;const s=E(t,{});this.selectedThemeId&&(s.theme={ref:this.selectedThemeId}),this.selectedPaletteId&&(s.palette={ref:this.selectedPaletteId}),this.selectedTypePackId&&(s.type_pack={ref:this.selectedTypePackId}),this.selectedEffectsPackId&&(s.effects_pack={ref:this.selectedEffectsPackId});const a=k(e);return s.meta={...s.meta,id:`from-${e}-${Date.now().toString(36)}`,name:`Untitled (${a?.name??e})`},s}async handleAction(e){const t=await this.composedDesign();if(!t){this.toast("Pick a template first.","error");return}const s={palette:this.resolvedPalette,typePack:this.resolvedTypePack,effectsPack:this.resolvedEffectsPack};switch(e){case"open":this.cb?.onOpen(t,t.meta.name,s),this.close();break;case"copy-mcp":await this.copyMCPPrompt(t);break;case"copy-yaml":await this.copyYAML(t);break;case"copy-payload":await this.copyJSONPayload(t);break}}async copyYAML(e){try{await navigator.clipboard.writeText(D(e)),this.toast("YAML copied to clipboard.","success")}catch{this.toast("Could not copy.","error")}}async copyJSONPayload(e){try{await navigator.clipboard.writeText(JSON.stringify(e,null,2)),this.toast("JSON payload copied.","success")}catch{this.toast("Could not copy.","error")}}async copyMCPPrompt(e){const t=this.selectedTemplateId??"",s=k(t),a=M(t),i=this.themes.find(p=>p.id===this.selectedThemeId),n=(a?.slots??[]).map(p=>`  - ${p.id}: ${JSON.stringify(p.default??"")}`).join(`
`),r=i?.name??"Dark Tech",l=i?.id??"dark-tech",d=["Use the Folio MCP tools to create a design from a built-in template.","",`Template id: ${s?.id??t}`,`Template name: ${s?.name??""}`,`Theme: ${r} (id: ${l})`,`Canvas: ${e.document.width} × ${e.document.height}`,"","Slots (replace values to taste):",n||"  (none)","","Steps:",`  1. inject_template with template_path: "${s?.id??t}" and the slot values above`,"     (the built-in id works directly — no file path needed; list_templates browses the catalog)",`  2. apply_theme with theme_id: ${l}`,"  3. export_design to svg/html/png/pdf as needed","","Voice: keep copy concise. Defaults are deliberately punchy — match that tone."].join(`
`);try{await navigator.clipboard.writeText(d),this.toast("MCP prompt copied to clipboard.","success")}catch{this.toast("Could not copy.","error")}}toast(e,t){this.cb?.onToast?.(e,t)}},ae=new te;export{ae as catalogDialog};
