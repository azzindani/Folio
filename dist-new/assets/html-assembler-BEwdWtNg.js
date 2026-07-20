import{r as A}from"./aggregator-UDagAFqB.js";import{b as N,g as M}from"./index-DVfAsX4h.js";function q(t,i){return F(t,i)}function J(t,i){return t.map(e=>q(e,i))}function D(t,i){return typeof t=="string"&&(t.startsWith("$data.")||t.startsWith("$agg."))?A(t,i):t}function F(t,i){if(t==null)return t;if(Array.isArray(t))return t.map(e=>F(e,i));if(typeof t=="object"){const e={};for(const[r,o]of Object.entries(t))e[r]=F(D(o,i),i);return e}return t}function H(t){return t.map((i,e)=>({id:i.id,label:i.label??i.id,index:e}))}function R(t,i){const e=H(i);switch(t.type??"sidebar"){case"sidebar":return B(t,e);case"topbar":return U(t,e);case"tabs":return V(t,e);case"dots":return W(e);default:return""}}function B(t,i){const e=t.background??"#1a1a2e",r=t.active_color??"#6c5ce7",o=t.width??240,a=i.map(n=>`<li class="nav-item" data-page="${n.id}" onclick="window.Folio.nav.goto('${n.id}')">${t.labels!==!1?w(n.label):""}</li>`).join(`
`);return`<nav class="folio-sidebar" style="width:${o}px;background:${w(e)};">
  <ul class="nav-list" data-active-color="${w(r)}">
${a}
  </ul>
</nav>`}function U(t,i){const e=t.background??"#1a1a2e",r=t.active_color??"#6c5ce7",o=i.map(a=>`<li class="nav-item" data-page="${a.id}" onclick="window.Folio.nav.goto('${a.id}')">${w(a.label)}</li>`).join(`
`);return`<nav class="folio-topbar" style="background:${w(e)};" data-active-color="${w(r)}">
  <ul class="nav-list">${o}</ul>
</nav>`}function V(t,i){const e=t.active_color??"#6c5ce7",r=i.map(o=>`<button class="nav-tab" data-page="${o.id}" onclick="window.Folio.nav.goto('${o.id}')">${w(o.label)}</button>`).join(`
`);return`<div class="folio-tabs" data-active-color="${w(e)}">${r}</div>`}function W(t){return`<div class="folio-dots">${t.map(i=>`<span class="nav-dot" data-page="${i.id}" onclick="window.Folio.nav.goto('${i.id}')"></span>`).join("")}</div>`}function w(t){return t.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}function E(t){if(typeof document>"u"||typeof XMLSerializer>"u")throw new Error("renderToSVGStringUniversal: no DOM available. Call from a browser, or install a jsdom shim on globalThis before calling (see mcp/engine/svg-export.ts).");const i=N(t);let e=new XMLSerializer().serializeToString(i);return e=e.replace(/(<svg[^>]*?) xmlns="http:\/\/www\.w3\.org\/2000\/svg"/,"$1"),e.includes("xmlns=")||(e=e.replace("<svg",'<svg xmlns="http://www.w3.org/2000/svg"')),e}function Y(t){switch(t){case"kpi_card":return 3;case"interactive_chart":return 6;case"button":return 3;case"toggle":return 4;case"tooltip":return 2;case"progress":return 4;default:return 12}}var G=new Set(["interactive_chart","interactive_table","kpi_card","rich_text","embed_code","popup","button","tabs","accordion","filter_bar","toggle","tooltip","callout","progress"]);function k(t){return G.has(t.type)}function L(t){return t?t.some(i=>k(i)||L(i.layers)):!1}function I(t){if(!t)return[];const i=[];for(const e of t){k(e)&&i.push(e);const r=e.layers;r&&i.push(...I(r))}return i}function $(t,i){switch(t.type){case"interactive_chart":return Q(t,i);case"interactive_table":return it(t,i);case"kpi_card":return et(t,i);case"rich_text":return rt(t,i);case"embed_code":return at(t,i);case"button":return lt(t,i);case"tabs":return ut(t,i);case"accordion":return gt(t,i);case"popup":return bt(t,i);case"filter_bar":return vt(t,i);case"toggle":return st(t,i);case"tooltip":return ft(t,i);case"callout":return dt(t,i);case"progress":return pt(t,i);default:return""}}function d(t){return String(t??"").replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;")}function p(t){return String(t??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}function g(t,i){if(i.flow)return`grid-column:span ${X(t.span??Y(t.type))}`;const e=t.x??0,r=t.y??0,o=t.width,a=t.height,n=["position:absolute",`left:${e}px`,`top:${r}px`];return typeof o=="number"&&n.push(`width:${o}px`),typeof a=="number"&&n.push(`height:${a}px`),n.join(";")}function X(t){return isFinite(t)?Math.max(1,Math.min(12,Math.round(t))):12}function S(t,i){if(typeof t!="string"||t.length===0)return[];const e=t.startsWith("$data.")?t.slice(6):t;return i.datasets.get(e)?.rows??[]}function z(t,i,e){if(t==null)return"";switch(i){case"currency":{const r=e?.currency??"USD",o=e?.decimals??0,a=typeof t=="number"?t:Number(t);return isFinite(a)?a.toLocaleString(void 0,{style:"currency",currency:r,minimumFractionDigits:o,maximumFractionDigits:o}):String(t)}case"number":{const r=e?.decimals??0,o=typeof t=="number"?t:Number(t);return isFinite(o)?o.toLocaleString(void 0,{minimumFractionDigits:r,maximumFractionDigits:r}):String(t)}case"percent":{const r=typeof t=="number"?t:Number(t);if(!isFinite(r))return String(t);const o=e?.decimals??1;return`${r.toFixed(o)}%`}case"date":{const r=t instanceof Date?t:new Date(String(t));return isNaN(r.getTime())?String(t):r.toLocaleDateString()}default:return String(t)}}function K(t){const i=t;if(t.chart_type==null){const e=i.chart??i.kind;typeof e=="string"&&(i.chart_type=e)}t.x_field==null&&typeof i.x=="string"&&(i.x_field=i.x),t.y_field==null&&typeof i.y=="string"&&(i.y_field=i.y)}function Q(t,i){const e=`chart-${t.id}`;K(t);const r=S(t.data_ref,i);if(t.library==="plotly")return tt(t,r,e,i);i.needsChartJs=!0;const o=Z(t,r,i.isDark,i.accent);i.chartInits.push(`(window.__folioCharts=window.__folioCharts||{})[${JSON.stringify(e)}]={cfg:${JSON.stringify(o)},rows:${JSON.stringify(r)},x:${JSON.stringify(t.x_field??"x")},y:${JSON.stringify(t.y_field??"y")}};`);const a=t.title?`<div class="ic-title">${p(t.title)}</div>`:"",n=i.flow?`;height:${typeof t.height=="number"?t.height:340}px`:"";return`<div class="ic-chart" data-layer-id="${d(t.id)}" style="${g(t,i)}${n}">
    ${a}
    <div class="ic-chart-canvas-wrap"><canvas id="${e}"></canvas></div>
  </div>`}function Z(t,i,e,r){const o=t.x_field??"x",a=t.y_field??"y",n=i.map(h=>h[o]),s=i.map(h=>Number(h[a]??0)),c=r?[r,...j(e)]:j(e),l=t.custom_colors&&t.custom_colors.length>0?t.custom_colors:c,f=t.grid!==!1,v=t.legend!==!1,u=t.animate!==!1,b=e?"#cbd5e1":"#334155",m=e?"rgba(255,255,255,0.08)":"rgba(0,0,0,0.08)",_={label:t.y_label||a,data:s,backgroundColor:t.chart_type==="pie"||t.chart_type==="donut"?l:l[0],borderColor:l[0],borderWidth:2,fill:t.chart_type==="area",tension:.3};return{type:t.chart_type==="donut"?"doughnut":t.chart_type==="area"?"line":t.chart_type,data:{labels:n,datasets:[_]},options:{responsive:!0,maintainAspectRatio:!1,animation:u?{duration:600}:!1,plugins:{legend:{display:v,labels:{color:b}}},scales:["pie","doughnut","donut"].includes(t.chart_type)?{}:{x:{ticks:{color:b},grid:{display:f,color:m}},y:{ticks:{color:b},grid:{display:f,color:m}}}}}}function j(t){return t?["#60a5fa","#34d399","#f472b6","#fbbf24","#a78bfa","#22d3ee","#fb7185"]:["#2563eb","#059669","#db2777","#d97706","#7c3aed","#0891b2","#be123c"]}function tt(t,i,e,r){r.needsPlotly=!0;const o=t.title?`<div class="ic-title">${p(t.title)}</div>`:"",a=r.flow?`;height:${typeof t.height=="number"?t.height:360}px`:"",n=r.accent??(r.isDark?"#60a5fa":"#2563eb");return t.plotly_spec?r.chartInits.push(`(window.__folioPlotly=window.__folioPlotly||{})[${JSON.stringify(e)}]={raw:${JSON.stringify(t.plotly_spec)},dark:${r.isDark}};`):r.chartInits.push(`(window.__folioPlotly=window.__folioPlotly||{})[${JSON.stringify(e)}]={rows:${JSON.stringify(i)},x:${JSON.stringify(t.x_field??"x")},y:${JSON.stringify(t.y_field??"y")},ctype:${JSON.stringify(t.chart_type)},color:${JSON.stringify(n)},dark:${r.isDark}};`),`<div class="ic-chart" data-layer-id="${d(t.id)}" style="${g(t,r)}${a}">
    ${o}
    <div class="ic-chart-canvas-wrap"><div id="${e}" class="ic-plotly"></div></div>
  </div>`}function it(t,i){const e=S(t.data_ref,i),r=t.columns??[],o=(r.length>0?r:Object.keys(e[0]??{}).map(b=>({field:b}))).map(b=>{const m=b;return{...m,title:m.title??m.label??m.header??m.name??m.field}}),a=JSON.stringify(o),n=JSON.stringify(e),s=`table-${t.id}`,c=t.filterable?`<input class="ic-table-filter" data-target="${s}" placeholder="Filter…" aria-label="Filter table">`:"",l=t.exportable?`<button class="ic-table-export" data-target="${s}" title="Download CSV">Export</button>`:"",f=!!t.row_detail,v=t.row_detail_title??o[0]?.field??"";i.tableInits.push(`window.__folioTables = window.__folioTables || {};
window.__folioTables[${JSON.stringify(s)}] = { columns: ${a}, rows: ${n}, pageSize: ${t.page_size??25}, page: 0, sort: null, rowDetail: ${f}, titleField: ${JSON.stringify(v)} };`);const u=f?`<div class="ic-modal" id="${s}-rowmodal" data-modal role="dialog" aria-modal="true" aria-hidden="true">
    <div class="ic-modal-backdrop" data-folio-action="close_modal:${s}-rowmodal"></div>
    <div class="ic-modal-dialog"><div class="ic-modal-head"><div class="ic-modal-title"></div><button class="ic-modal-close" data-folio-action="close_modal:${s}-rowmodal" aria-label="Close">×</button></div><div class="ic-modal-body"></div></div>
  </div>`:"";return`<div class="ic-table${f?" ic-table-clickable":""}" id="${s}" data-layer-id="${d(t.id)}" style="${g(t,i)}">
    ${c||l?`<div class="ic-table-toolbar">${c}${l}</div>`:""}
    <div class="ic-table-scroll"><table><thead></thead><tbody></tbody></table></div>
    ${t.pagination?'<div class="ic-table-pager"></div>':""}
  </div>${u}`}function et(t,i){const e=z(t.value,t.format,{currency:t.currency,decimals:t.decimals}),r=t.delta!=null?z(t.delta,t.delta_format??"percent"):"",o=typeof t.delta=="number"?Math.sign(t.delta):0,a=o>0?t.delta_positive_color??"var(--ic-pos)":o<0?t.delta_negative_color??"var(--ic-neg)":"var(--ic-muted)",n=t.sparkline_data?S(t.sparkline_data,i):[],s=t.sparkline_field?n.map(b=>Number(b[t.sparkline_field]??0)):[],c=s.length>1?ot(s,t.sparkline_color??"currentColor"):"",l=t.background??"",f=t.text_color??"",v=t.border_radius!=null?`border-radius:${t.border_radius}px;`:"",u=`${l?`background:${l};`:""}${f?`color:${f};`:""}${v}`;return`<div class="ic-kpi" data-layer-id="${d(t.id)}" style="${g(t,i)};${u}">
    ${t.icon?`<div class="ic-kpi-icon">${p(t.icon)}</div>`:""}
    <div class="ic-kpi-label">${p(t.label)}</div>
    <div class="ic-kpi-value">${p(e)}</div>
    ${r?`<div class="ic-kpi-delta" style="color:${a}">${o>0?"▲":o<0?"▼":""} ${p(r)}</div>`:""}
    ${c?`<div class="ic-kpi-spark">${c}</div>`:""}
  </div>`}function ot(t,i){const o=Math.min(...t),a=Math.max(...t)-o||1;return`<svg viewBox="0 0 100 28" preserveAspectRatio="none"><polyline points="${t.map((n,s)=>{const c=s/(t.length-1)*100,l=28-(n-o)/a*26-1;return`${c.toFixed(1)},${l.toFixed(1)}`}).join(" ")}" fill="none" stroke="${d(i)}" stroke-width="1.5" stroke-linejoin="round"/></svg>`}function rt(t,i){t.font_family&&i.fontFamilies.add(t.font_family);const e=[g(t,i),t.font_family?`font-family:'${t.font_family}',sans-serif`:"",t.font_size?`font-size:${t.font_size}px`:"",t.line_height?`line-height:${t.line_height}`:"",t.color?`color:${t.color}`:""].filter(Boolean).join(";"),r=t.format==="html"?t.content:y(t.content);return`<div class="ic-richtext" data-layer-id="${d(t.id)}" style="${e}">${r}</div>`}function y(t){let i=p(t);return i=i.replace(/^### (.*)$/gm,"<h3>$1</h3>"),i=i.replace(/^## (.*)$/gm,"<h2>$1</h2>"),i=i.replace(/^# (.*)$/gm,"<h1>$1</h1>"),i=i.replace(/\*\*([^*]+)\*\*/g,"<strong>$1</strong>"),i=i.replace(/\*([^*]+)\*/g,"<em>$1</em>"),i=i.replace(/`([^`]+)`/g,"<code>$1</code>"),i=i.replace(/\[([^\]]+)\]\(([^)]+)\)/g,'<a href="$2">$1</a>'),i.replace(/\n/g,"<br>")}function at(t,i){return`<div class="ic-embed" data-layer-id="${d(t.id)}" style="${g(t,i)}">${t.html}</div>`}function nt(t){if(!t)return"";if(typeof t=="string")return t;const i=t.target??"";switch(t.type){case"set":return`set:${i}=${t.value??""}`;case"toggle":return`toggle:${i}`;case"open_modal":return`open_modal:${i}`;case"close_modal":return i?`close_modal:${i}`:"close_modal";case"filter":return t.value!=null?`filter:${i}:${t.value}`:`filter:${i}`;case"scroll_to":return`scroll_to:${i}`;case"download_csv":return`download_csv:${i}`;case"open_url":return`open_url:${i}`;case"goto_page":return`goto_page:${i}`;default:return i?`${t.type}:${i}`:t.type}}function C(t){return t&&typeof t=="object"?{label:String(t.label),value:String(t.value)}:{label:String(t),value:String(t)}}function ct(t,i){const e=new Set;for(const r of t){const o=r[i];o!=null&&e.add(String(o))}return[...e]}function lt(t,i){const e=t.variant??"solid",r=t.size??"md",o=nt(t.action),a=`${t.background?`background:${t.background};border-color:${t.background};`:""}${t.text_color?`color:${t.text_color};`:""}${t.border_radius!=null?`border-radius:${t.border_radius}px;`:""}`,n=t.icon?`<span class="ic-btn-ic">${p(t.icon)}</span>`:"";return`<div class="ic-ctl" style="${g(t,i)}${t.full_width?";width:100%":""}">
    <button class="ic-btn ic-btn-${e} ic-btn-${r}"${t.full_width?' style="width:100%"':""}${a?` style="${a}"`:""}${o?` data-folio-action="${d(o)}"`:""}>${n}${p(t.label)}</button>
  </div>`}function st(t,i){const e=t.value!=null?String(t.value):t.options[0]?C(t.options[0]).value:"",r=t.options.map(a=>{const{label:n,value:s}=C(a);return`<button class="ic-seg-opt${s===e?" active":""}" data-folio-action="set:${d(t.state_key)}=${d(s)}" data-seg-group="${d(t.state_key)}" data-seg-value="${d(s)}">${p(n)}</button>`}).join(""),o=t.label?`<span class="ic-ctl-label">${p(t.label)}</span>`:"";return`<div class="ic-ctl" style="${g(t,i)}">${o}<div class="ic-seg" role="group">${r}</div></div>`}function dt(t,i){const e=t.variant??"info",r=t.icon??{info:"ℹ",success:"✓",warning:"⚠",danger:"✕",neutral:"•"}[e],o=t.title?`<div class="ic-callout-title">${p(t.title)}</div>`:"",a=t.content??t.text??"";return`<div class="ic-callout ic-callout-${e}" data-layer-id="${d(t.id)}" style="${g(t,i)}">
    <div class="ic-callout-ic">${p(r)}</div>
    <div class="ic-callout-body">${o}<div class="ic-richtext">${y(a)}</div></div>
  </div>`}function pt(t,i){const e=t.max??100,r=Math.max(0,Math.min(100,t.value/e*100)),o=t.color??i.accent??"var(--ic-accent)",a=t.show_value===!1?"":`${t.value}${t.unit??(e===100?"%":"")}`,n=t.label?`<div class="ic-prog-label"><span>${p(t.label)}</span><span class="ic-prog-val">${p(a)}</span></div>`:a?`<div class="ic-prog-label"><span></span><span class="ic-prog-val">${p(a)}</span></div>`:"";if(t.style==="radial"){const c=2*Math.PI*30,l=c*(1-r/100);return`<div class="ic-prog ic-prog-radial" style="${g(t,i)}">
      <svg viewBox="0 0 80 80"><circle cx="40" cy="40" r="30" class="ic-prog-track"/><circle cx="40" cy="40" r="30" class="ic-prog-arc" stroke="${d(o)}" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${l.toFixed(1)}"/></svg>
      <div class="ic-prog-center">${p(a)}</div>${t.label?`<div class="ic-prog-rlabel">${p(t.label)}</div>`:""}
    </div>`}return`<div class="ic-prog" style="${g(t,i)}">${n}<div class="ic-prog-track-bar"><div class="ic-prog-fill" style="width:${r.toFixed(1)}%;background:${d(o)}"></div></div></div>`}function ft(t,i){const e=t.icon?p(t.icon):t.label?p(t.label):"ℹ";return`<span class="ic-tip" data-placement="${t.placement??"top"}" tabindex="0" style="${g(t,i)}">
    <span class="ic-tip-trigger">${e}</span>
    <span class="ic-tip-pop"><span class="ic-richtext">${y(t.content)}</span></span>
  </span>`}function ut(t,i){const e=t.active??0,r=t.variant??"underline",o=t.align??"left",a=`tabs-${t.id}`,n=t.tabs.map((c,l)=>{const f=c.id??`${a}-${l}`,v=c.icon?`<span class="ic-tab-ic">${p(c.icon)}</span>`:"";return`<button class="ic-tab${l===e?" active":""}" data-folio-action="tab:${a}:${f}" data-tab-group="${a}" data-tab-id="${f}">${v}${p(c.label)}</button>`}).join(""),s=t.tabs.map((c,l)=>{const f=c.id??`${a}-${l}`,v=(c.layers??[]).map(u=>$(u,i)).join(`
`);return`<div class="ic-tab-panel${l===e?" active":""}" data-tab-panel="${a}" data-tab-id="${f}"><div class="folio-flow-grid">${v}</div></div>`}).join(`
`);return`<div class="ic-tabs ic-tabs-${r}" data-layer-id="${d(t.id)}" style="${g(t,i)}">
    <div class="ic-tab-bar ic-tab-align-${o}" role="tablist">${n}</div>${s}
  </div>`}function gt(t,i){const e=t.items.map((r,o)=>{const a=`acc-${t.id}-${o}`,n=r.open??!1,s=r.layers&&r.layers.length?`<div class="folio-flow-grid">${r.layers.map(l=>$(l,i)).join(`
`)}</div>`:`<div class="ic-richtext">${y(r.body??"")}</div>`,c=t.exclusive?` data-acc-group="acc-${d(t.id)}"`:"";return`<div class="ic-acc-item${n?" open":""}" id="${a}"${c}>
      <button class="ic-acc-head" data-folio-action="accordion:${a}"><span>${p(r.title)}</span><span class="ic-acc-chev">▾</span></button>
      <div class="ic-acc-panel"><div class="ic-acc-inner">${s}</div></div>
    </div>`}).join(`
`);return`<div class="ic-accordion" data-layer-id="${d(t.id)}" style="${g(t,i)}">${e}</div>`}function bt(t,i){const e=t.title?`<div class="ic-modal-head"><div class="ic-modal-title">${p(t.title)}</div><button class="ic-modal-close" data-folio-action="close_modal:${d(t.id)}" aria-label="Close">×</button></div>`:`<button class="ic-modal-close ic-modal-close-float" data-folio-action="close_modal:${d(t.id)}" aria-label="Close">×</button>`,r=t.layers&&t.layers.length?`<div class="folio-flow-grid">${t.layers.map(a=>$(a,i)).join(`
`)}</div>`:`<div class="ic-richtext">${y(t.body??"")}</div>`,o=t.close_on_backdrop===!1?"":` data-folio-action="close_modal:${d(t.id)}"`;return`<div class="ic-modal" id="${d(t.id)}" data-modal role="dialog" aria-modal="true" aria-hidden="true">
    <div class="ic-modal-backdrop"${o}></div>
    <div class="ic-modal-dialog">${e}<div class="ic-modal-body">${r}</div></div>
  </div>`}function vt(t,i){const e=t.field,r=t.style??"chips";let o=[];t.options&&t.options.length?o=t.options.map(C):t.options_from&&(o=ct(S(t.options_from,i),e).map(l=>({label:l,value:l})));const a=!!t.multi,n=t.label?`<span class="ic-filter-label">${p(t.label)}</span>`:"";if(r==="dropdown"){const l=o.map(f=>`<option value="${d(f.value)}">${p(f.label)}</option>`).join("");return`<div class="ic-filter" data-layer-id="${d(t.id)}" style="${g(t,i)}">${n}<select class="ic-filter-select" data-filter-field="${d(e)}"${a?" multiple":""}>${t.include_all!==!1&&!a?'<option value="__all__">All</option>':""}${l}</select></div>`}const s=t.include_all!==!1?`<button class="ic-chip active" data-folio-action="filter:${d(e)}:__all__" data-filter-field="${d(e)}" data-filter-value="__all__">All</button>`:"",c=o.map(l=>`<button class="ic-chip" data-folio-action="filter:${d(e)}:${d(l.value)}" data-filter-field="${d(e)}" data-filter-value="${d(l.value)}"${a?' data-multi="1"':""}>${p(l.label)}</button>`).join("");return`<div class="ic-filter ic-filter-${r}" data-layer-id="${d(t.id)}" style="${g(t,i)}">${n}<div class="ic-chips">${s}${c}</div></div>`}function _t(t,i,e={}){const r=t.pages??[],o=t.report,a=e.title??t.meta.name,n=e.theme!=="light",s=o?.layout==="flow"||o?.flow===!0,c={datasets:i,pageId:"",pageWidth:t.document?.width??1080,pageHeight:t.document?.height??1080,isDark:n,flow:s,accent:o?.accent,chartInits:[],tableInits:[],fontFamilies:new Set,needsChartJs:!!e.forceChartJs};o?.font_heading&&c.fontFamilies.add(o.font_heading),o?.font_body&&c.fontFamilies.add(o.font_body);const l=o?.navigation?R(o.navigation,r):"",f=r.map((h,O)=>mt(t,h,O,i,c)).join(`
`),v=s?"layout-flow":o?.layout==="scroll"?"layout-scroll":o?.layout==="tabs"?"layout-tabs":"layout-paged",u=[`--folio-maxw:${o?.max_width??1200}px`,o?.accent?`--ic-accent:${o.accent}`:"",o?.font_heading?`--folio-font-head:'${o.font_heading}',Georgia,serif`:"",o?.font_body?`--folio-font-body:'${o.font_body}',system-ui,sans-serif`:""].filter(Boolean).join(";"),b=c.fontFamilies.size>0?`<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?${[...c.fontFamilies].map(h=>`family=${encodeURIComponent(h).replace(/%20/g,"+")}:wght@300;400;500;600;700;900`).join("&")}&display=swap" rel="stylesheet">`:"",m=[c.needsChartJs?'<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"><\/script>':"",c.needsPlotly?'<script src="https://cdn.plot.ly/plotly-2.27.0.min.js"><\/script>':""].filter(Boolean).join(`
  `),_=[...c.tableInits,...c.chartInits].join(`
`);return`<!DOCTYPE html>
<html lang="en" data-theme="${n?"dark":"light"}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${x(a)}</title>
  ${M}
  ${b}
  ${m}
  <style>${wt}</style>
</head>
<body class="${v}" data-theme="${n?"dark":"light"}"${u?` style="${u}"`:""}>
${l}
<main class="folio-report" id="folio-report">${s?`<div class="folio-flow">${f}</div>`:f}</main>
<script type="application/json" id="folio-design">${JSON.stringify({meta:t.meta,pageCount:r.length,pageIds:r.map(h=>h.id)})}<\/script>
${_?`<script>${_}<\/script>`:""}
<script>${xt}<\/script>
</body>
</html>`}function mt(t,i,e,r,o){o.pageId=i.id;const a=J(i.layers??[],r),n=e===0?" active":"",s=t.document?.width??1080,c=t.document?.height??1080;if(o.pageWidth=s,o.pageHeight=c,o.flow){const u=a.map(b=>k(b)?$(b,o):`<div class="folio-flow-svg" style="grid-column:span 12">${ht(t,b,i.id)}</div>`).join(`
`);return`<section class="folio-page${n}" data-page-id="${x(i.id)}" data-page-index="${e}">
      <div class="folio-flow-grid">${u}</div>
    </section>`}if(!L(a)){const u=T(t,a,i.id);return`<section class="folio-page${n}" data-page-id="${x(i.id)}" data-page-index="${e}">${u}</section>`}const l=I(a),f=T(t,P(a),i.id),v=l.map(u=>$(u,o)).join(`
`);return`<section class="folio-page${n}" data-page-id="${x(i.id)}" data-page-index="${e}">
    <div class="folio-page-stage" style="position:relative;width:${s}px;height:${c}px;margin:0 auto;">
      ${f}
      ${v}
    </div>
  </section>`}function P(t){return t.filter(i=>!k(i)).map(i=>{const e=i.layers;return e?{...i,layers:P(e)}:i})}function T(t,i,e){if(i.length===0)return"";const r={...t,pages:void 0,layers:i};try{return E(r)}catch{return`<p style="color:red">Page render error: ${x(e)}</p>`}}function ht(t,i,e){const r=typeof i.width=="number"?i.width:t.document?.width??1200,o=typeof i.height=="number"?i.height:80,a={...i,x:0,y:0},n={...t,pages:void 0,layers:[a],document:{...t.document,width:r,height:o}};try{return E(n)}catch{return`<p style="color:red">Render error: ${x(e)}</p>`}}function x(t){return t.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}var wt=`
*{box-sizing:border-box;margin:0;padding:0}
html,body{min-height:100%;font-family:var(--folio-font-body,system-ui,-apple-system,sans-serif)}
body{background:#0b0d12;color:#e8e8ec;
  --folio-maxw:1200px;
  --ic-pos:#22c55e;--ic-neg:#ef4444;--ic-muted:#94a3b8;
  --ic-surface:#161821;--ic-surface2:#1c1f2b;--ic-border:rgba(255,255,255,.08);--ic-accent:#60a5fa}
body[data-theme=light]{background:#f7f7fa;color:#1a1a1a;
  --ic-surface:#ffffff;--ic-surface2:#f0f1f5;--ic-border:rgba(0,0,0,.10);--ic-accent:#2563eb}
/* Paged & tabs lock to the viewport (one screen at a time); scroll & flow grow the document. */
body.layout-paged,body.layout-tabs{height:100%;display:flex;flex-direction:column}
body.layout-paged #folio-report,body.layout-tabs #folio-report{flex:1;overflow:auto}
body.layout-scroll,body.layout-flow{height:auto;display:block}
body.layout-scroll #folio-report,body.layout-flow #folio-report{overflow:visible}
.folio-sidebar{position:fixed;left:0;top:0;bottom:0;overflow-y:auto;padding:1rem 0;z-index:10;background:var(--ic-surface);border-right:1px solid var(--ic-border);min-width:200px}
.folio-sidebar .nav-list{list-style:none}
.folio-sidebar .nav-item{padding:.6rem 1.2rem;cursor:pointer;white-space:nowrap}
.folio-sidebar .nav-item:hover{background:rgba(255,255,255,.04)}
.folio-sidebar .nav-item.active{font-weight:700;border-left:3px solid var(--ic-accent);background:rgba(96,165,250,.08)}
.folio-topbar{width:100%;padding:.5rem 1rem;background:var(--ic-surface);border-bottom:1px solid var(--ic-border)}
.folio-topbar .nav-list{list-style:none;display:flex;gap:1rem}
.folio-topbar .nav-item{cursor:pointer;padding:.4rem .8rem;border-radius:4px}
.folio-topbar .nav-item.active{background:rgba(96,165,250,.12);color:var(--ic-accent)}
.folio-tabs{display:flex;gap:2px;border-bottom:1px solid var(--ic-border);padding:0 1rem}
.folio-tabs .nav-tab{cursor:pointer;padding:.6rem 1.2rem;border:none;background:none;color:inherit;border-bottom:2px solid transparent}
.folio-tabs .nav-tab.active{border-bottom-color:var(--ic-accent);color:var(--ic-accent)}
.folio-dots{display:flex;gap:.5rem;justify-content:center;padding:.5rem}
.nav-dot{width:10px;height:10px;border-radius:50%;background:rgba(255,255,255,.3);cursor:pointer;border:none}
.nav-dot.active{background:var(--ic-accent)}
#folio-report{padding:1rem}
.layout-flow #folio-report{padding:0}
.layout-paged .folio-page{display:none}
.layout-paged .folio-page.active{display:block}
.layout-scroll .folio-page{display:block;margin-bottom:2rem}
.layout-tabs .folio-page{display:none}
.layout-tabs .folio-page.active{display:block}
.folio-page-stage svg{position:absolute;top:0;left:0;max-width:100%;height:auto}
.folio-page svg:not([class]){max-width:100%;height:auto}

/* ── Flow layout: responsive editorial document ── */
.folio-flow{max-width:var(--folio-maxw,1200px);margin:0 auto;padding:56px 28px 80px}
.layout-flow .folio-page{display:block}
.layout-flow .folio-page+.folio-page{margin-top:8px}
.folio-flow-grid{display:grid;grid-template-columns:repeat(12,1fr);gap:22px;align-items:stretch}
.folio-flow-grid>*{min-width:0}
.folio-flow-svg svg{max-width:100%;height:auto;display:block}
/* Flow headings (rich_text spanning full width) read as section rhythm. */
.layout-flow .ic-richtext{align-self:center}
.layout-flow .ic-richtext h1,.layout-flow .ic-richtext h2{font-family:var(--folio-font-head,inherit)}
@media (max-width:900px){
  .folio-flow{padding:36px 18px 60px}
  .folio-flow-grid>*{grid-column:1/-1 !important}
}
@media (min-width:901px) and (max-width:1180px){
  /* tighten to a coarse grid so 3-col KPI rows wrap cleanly on mid widths */
  .folio-flow-grid{grid-template-columns:repeat(6,1fr)}
  .folio-flow-grid>.ic-kpi{grid-column:span 2 !important}
}
/* Editorial polish (flat, no glow): larger tabular numerals, quiet hover-accent. */
.layout-flow .ic-kpi-value{font-size:30px;font-variant-numeric:tabular-nums}
.layout-flow .ic-kpi,.layout-flow .ic-chart,.layout-flow .ic-table{transition:border-color .15s ease}
.layout-flow .ic-kpi:hover,.layout-flow .ic-chart:hover,.layout-flow .ic-table:hover{border-color:var(--ic-accent)}
.layout-flow .ic-table thead th{background:var(--ic-surface2)}

/* Interactive widgets */
.ic-chart{background:var(--ic-surface);border:1px solid var(--ic-border);border-radius:6px;padding:14px;display:flex;flex-direction:column}
.ic-title{font-size:13px;font-weight:600;margin-bottom:8px;color:inherit}
.ic-chart-canvas-wrap{flex:1;position:relative;min-height:0}
.ic-chart canvas{max-width:100%;max-height:100%}
.ic-plotly{width:100%;height:100%;min-height:0}

.ic-table{background:var(--ic-surface);border:1px solid var(--ic-border);border-radius:6px;display:flex;flex-direction:column;overflow:hidden}
.ic-table-toolbar{display:flex;gap:8px;padding:8px;border-bottom:1px solid var(--ic-border)}
.ic-table-filter{flex:1;padding:6px 10px;border:1px solid var(--ic-border);border-radius:4px;background:transparent;color:inherit;font:inherit}
.ic-table-filter:focus{outline:none;border-color:var(--ic-accent)}
.ic-table-export{padding:6px 12px;border:1px solid var(--ic-border);border-radius:4px;background:transparent;color:inherit;cursor:pointer;font:inherit}
.ic-table-export:hover{border-color:var(--ic-accent);color:var(--ic-accent)}
.ic-table-scroll{flex:1;overflow:auto}
.ic-table table{width:100%;border-collapse:collapse;font-size:13px}
.ic-table thead th{text-align:left;padding:10px 14px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--ic-muted);border-bottom:1px solid var(--ic-border);cursor:pointer;user-select:none;white-space:nowrap;background:rgba(0,0,0,.15);position:sticky;top:0}
.ic-table thead th[data-sort='asc']::after{content:' ▲';color:var(--ic-accent);font-size:10px}
.ic-table thead th[data-sort='desc']::after{content:' ▼';color:var(--ic-accent);font-size:10px}
.ic-table tbody td{padding:10px 14px;border-bottom:1px solid var(--ic-border)}
.ic-table tbody tr:hover{background:rgba(96,165,250,.06)}
.ic-table .badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;background:rgba(96,165,250,.15);color:var(--ic-accent)}
.ic-table-pager{display:flex;justify-content:space-between;align-items:center;padding:8px 14px;border-top:1px solid var(--ic-border);font-size:12px;color:var(--ic-muted)}
.ic-table-pager button{padding:4px 12px;border:1px solid var(--ic-border);border-radius:4px;background:transparent;color:inherit;cursor:pointer;font:inherit}
.ic-table-pager button:disabled{opacity:.4;cursor:not-allowed}
.ic-table-clickable tbody tr{cursor:pointer}
.ic-table-clickable tbody tr:hover{background:rgba(245,200,66,.08)}
.ic-rowdetail{display:flex;flex-direction:column}
.ic-rowdetail-line{display:flex;justify-content:space-between;gap:24px;padding:11px 2px;border-bottom:1px solid var(--ic-border);font-size:14px}
.ic-rowdetail-line:last-child{border-bottom:none}
.ic-rowdetail-line span:first-child{color:var(--ic-muted);font-weight:600}
.ic-rowdetail-line span:last-child{text-align:right}

.ic-kpi{background:var(--ic-surface);border:1px solid var(--ic-border);border-radius:6px;padding:14px 18px 12px;display:flex;flex-direction:column;gap:3px;overflow:hidden;position:relative}
.ic-kpi-icon{font-size:18px;margin-bottom:4px}
.ic-kpi-label{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--ic-muted);font-weight:600}
.ic-kpi-value{font-size:26px;font-weight:700;line-height:1.1}
.ic-kpi-delta{font-size:12px;font-weight:500;position:relative;z-index:1}
.ic-kpi-spark{position:absolute;left:0;right:0;bottom:0;height:34px;color:var(--ic-accent);opacity:.35;pointer-events:none}
.ic-kpi-spark svg{width:100%;height:100%;display:block}

.ic-richtext{font-size:14px;line-height:1.55}
.ic-richtext h1{font-size:24px;margin:.4em 0}
.ic-richtext h2{font-size:18px;margin:.4em 0}
.ic-richtext h3{font-size:15px;margin:.4em 0}
.ic-richtext a{color:var(--ic-accent);text-decoration:none}
.ic-richtext a:hover{text-decoration:underline}
.ic-richtext code{font-family:ui-monospace,monospace;background:rgba(0,0,0,.2);padding:1px 6px;border-radius:3px;font-size:.92em}

.ic-embed{overflow:hidden}

/* ── Controls: button / segmented / chips ── */
.ic-ctl{display:flex;align-items:center;gap:10px}
.ic-ctl-label{font-size:12px;color:var(--ic-muted);font-weight:600}
.ic-btn{display:inline-flex;align-items:center;gap:7px;font:inherit;font-weight:600;cursor:pointer;border:1px solid var(--ic-accent);border-radius:8px;padding:9px 16px;background:var(--ic-accent);color:#0b0d12;transition:filter .15s,background .15s,color .15s;line-height:1}
.ic-btn:hover{filter:brightness(1.08)}
.ic-btn-outline{background:transparent;color:var(--ic-accent)}
.ic-btn-ghost{background:transparent;border-color:transparent;color:inherit}
.ic-btn-ghost:hover{background:var(--ic-surface2)}
.ic-btn-link{background:transparent;border-color:transparent;color:var(--ic-accent);padding:6px 4px;text-decoration:underline}
.ic-btn-sm{padding:6px 12px;font-size:12px}
.ic-btn-lg{padding:12px 22px;font-size:15px}
.ic-btn-ic{font-size:1.05em}
.ic-seg{display:inline-flex;background:var(--ic-surface2);border:1px solid var(--ic-border);border-radius:9px;padding:3px;gap:2px}
.ic-seg-opt{font:inherit;cursor:pointer;border:none;background:transparent;color:var(--ic-muted);padding:6px 14px;border-radius:6px;font-weight:600;transition:background .15s,color .15s}
.ic-seg-opt.active{background:var(--ic-accent);color:#0b0d12}
.ic-chips{display:flex;flex-wrap:wrap;gap:8px}
.ic-filter{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.ic-filter-label{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--ic-muted);font-weight:700}
.ic-chip{font:inherit;font-size:13px;cursor:pointer;border:1px solid var(--ic-border);border-radius:999px;padding:6px 14px;background:var(--ic-surface);color:inherit;transition:all .15s}
.ic-chip:hover{border-color:var(--ic-accent)}
.ic-chip.active{background:var(--ic-accent);border-color:var(--ic-accent);color:#0b0d12;font-weight:600}
.ic-filter-select{font:inherit;padding:8px 12px;border:1px solid var(--ic-border);border-radius:8px;background:var(--ic-surface);color:inherit;min-width:160px}

/* ── Callout ── */
.ic-callout{display:flex;gap:12px;padding:14px 16px;border-radius:10px;border:1px solid var(--ic-border);border-left-width:4px;background:var(--ic-surface)}
.ic-callout-ic{font-size:18px;line-height:1.4;flex:none}
.ic-callout-title{font-weight:700;margin-bottom:3px}
.ic-callout-body{min-width:0}
.ic-callout-info{border-left-color:var(--ic-accent)}.ic-callout-info .ic-callout-ic{color:var(--ic-accent)}
.ic-callout-success{border-left-color:var(--ic-pos)}.ic-callout-success .ic-callout-ic{color:var(--ic-pos)}
.ic-callout-warning{border-left-color:#f5a623}.ic-callout-warning .ic-callout-ic{color:#f5a623}
.ic-callout-danger{border-left-color:var(--ic-neg)}.ic-callout-danger .ic-callout-ic{color:var(--ic-neg)}
.ic-callout-neutral{border-left-color:var(--ic-muted)}.ic-callout-neutral .ic-callout-ic{color:var(--ic-muted)}

/* ── Progress / gauge ── */
.ic-prog{display:flex;flex-direction:column;gap:7px;justify-content:center}
.ic-prog-label{display:flex;justify-content:space-between;font-size:12px;color:var(--ic-muted);font-weight:600}
.ic-prog-val{color:inherit}
.ic-prog-track-bar{height:9px;border-radius:999px;background:var(--ic-surface2);overflow:hidden}
.ic-prog-fill{height:100%;border-radius:999px;transition:width .5s ease}
.ic-prog-radial{align-items:center;text-align:center;position:relative}
.ic-prog-radial svg{width:96px;height:96px;transform:rotate(-90deg)}
.ic-prog-track{fill:none;stroke:var(--ic-surface2);stroke-width:8}
.ic-prog-arc{fill:none;stroke-width:8;stroke-linecap:round;transition:stroke-dashoffset .6s ease}
.ic-prog-center{position:absolute;top:50%;left:50%;transform:translate(-50%,-60%);font-weight:700;font-size:18px}
.ic-prog-rlabel{font-size:12px;color:var(--ic-muted);margin-top:2px}

/* ── Tooltip / popover ── */
.ic-tip{position:relative;display:inline-flex;align-items:center;cursor:help}
.ic-tip-trigger{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;border-radius:999px;background:var(--ic-surface2);color:var(--ic-muted);font-size:12px;font-weight:700;padding:0 6px}
.ic-tip-pop{position:absolute;z-index:50;bottom:130%;left:50%;transform:translateX(-50%) translateY(4px);background:#0b0d12;color:#e8e8ec;border:1px solid var(--ic-border);border-radius:8px;padding:10px 12px;width:240px;font-size:12.5px;line-height:1.5;opacity:0;visibility:hidden;transition:opacity .15s,transform .15s;box-shadow:0 8px 24px rgba(0,0,0,.4)}
.ic-tip:hover .ic-tip-pop,.ic-tip:focus .ic-tip-pop{opacity:1;visibility:visible;transform:translateX(-50%) translateY(0)}
.ic-tip[data-placement=bottom] .ic-tip-pop{bottom:auto;top:130%}

/* ── Tabs ── */
.ic-tabs{display:flex;flex-direction:column;gap:16px}
.ic-tab-bar{display:flex;gap:4px;border-bottom:1px solid var(--ic-border)}
.ic-tab-align-center{justify-content:center}.ic-tab-align-right{justify-content:flex-end}
.ic-tab-align-stretch .ic-tab{flex:1}
.ic-tab{font:inherit;font-weight:600;cursor:pointer;border:none;background:none;color:var(--ic-muted);padding:10px 16px;border-bottom:2px solid transparent;margin-bottom:-1px;transition:color .15s,border-color .15s;display:inline-flex;align-items:center;gap:7px}
.ic-tab:hover{color:inherit}
.ic-tab.active{color:var(--ic-accent);border-bottom-color:var(--ic-accent)}
.ic-tabs-pills .ic-tab-bar{border-bottom:none;gap:8px}
.ic-tabs-pills .ic-tab{border-radius:999px;border:1px solid var(--ic-border);margin-bottom:0}
.ic-tabs-pills .ic-tab.active{background:var(--ic-accent);color:#0b0d12;border-color:var(--ic-accent)}
.ic-tab-panel{display:none}.ic-tab-panel.active{display:block}

/* ── Accordion ── */
.ic-accordion{display:flex;flex-direction:column;gap:10px}
.ic-acc-item{border:1px solid var(--ic-border);border-radius:10px;overflow:hidden;background:var(--ic-surface)}
.ic-acc-head{width:100%;text-align:left;font:inherit;font-weight:600;font-size:15px;cursor:pointer;background:none;border:none;color:inherit;padding:14px 18px;display:flex;justify-content:space-between;align-items:center;gap:12px}
.ic-acc-chev{transition:transform .2s;color:var(--ic-muted)}
.ic-acc-item.open .ic-acc-chev{transform:rotate(180deg)}
.ic-acc-panel{display:grid;grid-template-rows:0fr;transition:grid-template-rows .25s ease}
.ic-acc-item.open .ic-acc-panel{grid-template-rows:1fr}
.ic-acc-inner{overflow:hidden}
.ic-acc-item.open .ic-acc-inner{padding:0 18px 16px}

/* ── Modal / popup ── */
body.ic-modal-lock{overflow:hidden}
.ic-modal{display:none;position:fixed;inset:0;z-index:1000;align-items:center;justify-content:center;padding:24px}
.ic-modal.open{display:flex}
.ic-modal-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.6);backdrop-filter:blur(2px)}
.ic-modal-dialog{position:relative;z-index:1;background:var(--ic-surface);border:1px solid var(--ic-border);border-radius:14px;max-width:720px;width:100%;max-height:85vh;overflow:auto;box-shadow:0 24px 64px rgba(0,0,0,.5);animation:icModalIn .2s ease}
@keyframes icModalIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
.ic-modal-head{display:flex;justify-content:space-between;align-items:center;padding:18px 22px;border-bottom:1px solid var(--ic-border)}
.ic-modal-title{font-size:18px;font-weight:700;font-family:var(--folio-font-head,inherit)}
.ic-modal-close{font:inherit;font-size:22px;line-height:1;cursor:pointer;background:none;border:none;color:var(--ic-muted);padding:0 4px}
.ic-modal-close:hover{color:inherit}
.ic-modal-close-float{position:absolute;top:12px;right:14px;z-index:2}
.ic-modal-body{padding:22px}
`,xt=`(function(){
  var pages=Array.from(document.querySelectorAll('.folio-page'));
  var navItems=Array.from(document.querySelectorAll('.nav-item,.nav-dot,.nav-tab'));

  // ── Shared interactivity: state store + event bus + cross-component filters ──
  var Folio={nav:{},state:{},events:{},filters:{}};
  var _state={},_subs=[],_ev={};
  Folio.state.get=function(k){return _state[k];};
  Folio.state.set=function(k,v){_state[k]=v;_subs.forEach(function(f){f(k,v);});reactState();Folio.events.emit('state:change',{key:k,value:v});};
  Folio.state.subscribe=function(f){_subs.push(f);};
  Folio.state.all=function(){return _state;};
  Folio.events.on=function(n,f){(_ev[n]=_ev[n]||[]).push(f);};
  Folio.events.emit=function(n,p){(_ev[n]||[]).forEach(function(f){try{f(p);}catch(e){}});};
  // A row passes when, for every filtered field, its value is in the selected set.
  Folio.applyFilters=function(rows){
    var f=Folio.filters,keys=Object.keys(f).filter(function(k){return f[k]&&f[k].length;});
    if(!keys.length)return rows;
    return rows.filter(function(r){return keys.every(function(k){return f[k].indexOf(String(r[k]))>=0;});});
  };
  function reactState(){
    document.querySelectorAll('[data-show-if]').forEach(function(el){
      try{var fn=new Function('state','return ('+el.getAttribute('data-show-if')+')');el.style.display=fn(_state)?'':'none';}catch(e){}
    });
    document.querySelectorAll('[data-seg-group]').forEach(function(el){
      var g=el.getAttribute('data-seg-group');el.classList.toggle('active',String(_state[g])===el.getAttribute('data-seg-value'));
    });
  }
  function setActive(id){
    pages.forEach(function(p){p.classList.toggle('active',p.dataset.pageId===id)});
    navItems.forEach(function(n){n.classList.toggle('active',n.dataset.page===id)});
  }
  function goto(id){setActive(id)}
  function next(){
    var cur=pages.findIndex(function(p){return p.classList.contains('active')});
    var nxt=pages[(cur+1)%pages.length];
    if(nxt)goto(nxt.dataset.pageId||'');
  }
  function prev(){
    var cur=pages.findIndex(function(p){return p.classList.contains('active')});
    var prv=pages[(cur-1+pages.length)%pages.length];
    if(prv)goto(prv.dataset.pageId||'');
  }
  document.querySelectorAll('[data-on-click]').forEach(function(el){
    el.addEventListener('click',function(){
      var action=el.dataset.onClick||'';
      if(action==='next_page')next();
      else if(action==='prev_page')prev();
      else if(action.startsWith('goto_page:')){goto(action.split(':')[1]||'');}
      else if(action.startsWith('open_url:')){window.open(action.split(':').slice(1).join(':'),'_blank');}
    });
  });

  // ── Table runtime ──
  function fmtCell(v, formatter){
    if(v==null)return '';
    if(formatter==='currency'){var n=Number(v);return isFinite(n)?n.toLocaleString(undefined,{style:'currency',currency:'USD'}):String(v);}
    if(formatter==='number'){var n2=Number(v);return isFinite(n2)?n2.toLocaleString():String(v);}
    if(formatter==='percent'){var n3=Number(v);return isFinite(n3)?n3.toFixed(1)+'%':String(v);}
    if(formatter==='badge'){return '<span class="badge">'+escHtmlJs(String(v))+'</span>';}
    if(formatter==='delta'){var n4=Number(v);if(!isFinite(n4))return String(v);var sign=n4>0?'▲':n4<0?'▼':'';var col=n4>0?'var(--ic-pos)':n4<0?'var(--ic-neg)':'var(--ic-muted)';return '<span style="color:'+col+'">'+sign+' '+Math.abs(n4).toFixed(1)+'%</span>';}
    return escHtmlJs(String(v));
  }
  function escHtmlJs(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
  function openRowDetail(id,row){
    var t=window.__folioTables[id];var m=document.getElementById(id+'-rowmodal');if(!t||!m)return;
    var ttl=m.querySelector('.ic-modal-title'),bd=m.querySelector('.ic-modal-body');
    if(ttl)ttl.textContent=row[t.titleField]==null?'Detail':String(row[t.titleField]);
    if(bd)bd.innerHTML='<div class="ic-rowdetail">'+t.columns.map(function(c){return '<div class="ic-rowdetail-line"><span>'+escHtmlJs(c.title||c.field)+'</span><span>'+fmtCell(row[c.field],c.formatter)+'</span></div>';}).join('')+'</div>';
    openModal(id+'-rowmodal');
  }
  function renderTable(id){
    var t=window.__folioTables&&window.__folioTables[id];if(!t)return;
    var root=document.getElementById(id);if(!root)return;
    var thead=root.querySelector('thead'),tbody=root.querySelector('tbody');
    var rows=Folio.applyFilters(t.rows).slice();
    if(t.filter){var ql=t.filter.toLowerCase();rows=rows.filter(function(r){return Object.values(r).some(function(v){return String(v==null?'':v).toLowerCase().indexOf(ql)>=0;});});}
    if(t.sort){var k=t.sort.field,dir=t.sort.dir;rows.sort(function(a,b){var av=a[k],bv=b[k];if(av==bv)return 0;if(av==null)return 1;if(bv==null)return -1;var na=Number(av),nb=Number(bv);if(!isNaN(na)&&!isNaN(nb)){return dir==='asc'?na-nb:nb-na;}return dir==='asc'?String(av).localeCompare(String(bv)):String(bv).localeCompare(String(av));});}
    var totalPages=Math.max(1,Math.ceil(rows.length/t.pageSize));
    if(t.page>=totalPages)t.page=totalPages-1;
    var start=t.page*t.pageSize,pageRows=rows.slice(start,start+t.pageSize);
    thead.innerHTML='<tr>'+t.columns.map(function(c){var s=t.sort&&t.sort.field===c.field?t.sort.dir:'';return '<th data-field="'+c.field+'"'+(s?' data-sort="'+s+'"':'')+(c.align?' style="text-align:'+c.align+'"':'')+'>'+escHtmlJs(c.title)+'</th>';}).join('')+'</tr>';
    tbody.innerHTML=pageRows.map(function(r,ri){return '<tr'+(t.rowDetail?' data-row-idx="'+ri+'"':'')+'>'+t.columns.map(function(c){return '<td'+(c.align?' style="text-align:'+c.align+'"':'')+'>'+fmtCell(r[c.field],c.formatter)+'</td>';}).join('')+'</tr>';}).join('');
    if(t.rowDetail){t._page=pageRows;Array.from(tbody.querySelectorAll('tr[data-row-idx]')).forEach(function(tr){
      tr.addEventListener('click',function(){var r=t._page[Number(tr.dataset.rowIdx)];if(!r)return;openRowDetail(id,r);});
    });}
    Array.from(thead.querySelectorAll('th')).forEach(function(th){
      var col=t.columns.find(function(c){return c.field===th.dataset.field;});
      if(!col||col.sortable===false)return;
      th.addEventListener('click',function(){var dir=t.sort&&t.sort.field===col.field&&t.sort.dir==='asc'?'desc':'asc';t.sort={field:col.field,dir:dir};renderTable(id);});
    });
    var pager=root.querySelector('.ic-table-pager');
    if(pager){pager.innerHTML='<button '+(t.page===0?'disabled':'')+' data-act="prev">‹ Prev</button><span>Page '+(t.page+1)+' of '+totalPages+' · '+rows.length+' rows</span><button '+(t.page>=totalPages-1?'disabled':'')+' data-act="next">Next ›</button>';
      pager.querySelectorAll('button').forEach(function(b){b.addEventListener('click',function(){if(b.dataset.act==='prev'&&t.page>0)t.page--;else if(b.dataset.act==='next'&&t.page<totalPages-1)t.page++;renderTable(id);});});
    }
  }
  Folio.renderTables=function(){if(window.__folioTables)Object.keys(window.__folioTables).forEach(function(id){renderTable(id);});};
  function exportCsv(id){var t=window.__folioTables&&window.__folioTables[id];if(!t)return;
    var headers=t.columns.map(function(c){return JSON.stringify(c.title||c.field);}).join(',');
    var rows=t.rows.map(function(r){return t.columns.map(function(c){var v=r[c.field];return JSON.stringify(v==null?'':String(v));}).join(',');}).join('\\n');
    var blob=new Blob([headers+'\\n'+rows],{type:'text/csv;charset=utf-8;'});
    var url=URL.createObjectURL(blob);var a=document.createElement('a');a.href=url;a.download=id+'.csv';document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(url);
  }
  if(window.__folioTables){
    Folio.renderTables();
    document.querySelectorAll('.ic-table-filter').forEach(function(input){
      var id=input.dataset.target;input.addEventListener('input',function(){var t=window.__folioTables[id];if(!t)return;t.filter=input.value;t.page=0;renderTable(id);});
    });
    document.querySelectorAll('.ic-table-export').forEach(function(btn){
      btn.addEventListener('click',function(){exportCsv(btn.dataset.target);});
    });
  }

  // ── Charts: build from registry (applying active filters), update on filter change ──
  function chartData(c){var rows=Folio.applyFilters(c.rows);return {labels:rows.map(function(r){return r[c.x];}),data:rows.map(function(r){return Number(r[c.y]||0);})};}
  function buildCharts(){
    if(!window.Chart||!window.__folioCharts)return;
    Object.keys(window.__folioCharts).forEach(function(id){
      var c=window.__folioCharts[id];var el=document.getElementById(id);if(!el||c.inst)return;
      var d=chartData(c);c.cfg.data.labels=d.labels;c.cfg.data.datasets[0].data=d.data;
      try{c.inst=new window.Chart(el.getContext('2d'),c.cfg);}catch(e){}
    });
  }
  // ── Plotly charts (library:'plotly') — mapped traces re-filter; raw specs are static ──
  function plotlyTrace(c){var rows=Folio.applyFilters(c.rows);var xs=rows.map(function(r){return r[c.x];}),ys=rows.map(function(r){return Number(r[c.y]||0);});var t=c.ctype;
    if(t==='pie'||t==='donut')return [{type:'pie',labels:xs,values:ys,hole:t==='donut'?0.5:0}];
    if(t==='bar')return [{type:'bar',x:xs,y:ys,marker:{color:c.color}}];
    if(t==='area')return [{type:'scatter',mode:'lines',x:xs,y:ys,fill:'tozeroy',line:{color:c.color}}];
    if(t==='scatter')return [{type:'scatter',mode:'markers',x:xs,y:ys,marker:{color:c.color}}];
    return [{type:'scatter',mode:'lines+markers',x:xs,y:ys,line:{color:c.color}}];}
  function plotlyLayout(c){var gc=c.dark?'rgba(255,255,255,.08)':'rgba(0,0,0,.08)';return {margin:{t:8,r:12,b:42,l:54},paper_bgcolor:'rgba(0,0,0,0)',plot_bgcolor:'rgba(0,0,0,0)',font:{color:c.dark?'#cbd5e1':'#334155',family:'Inter,system-ui,sans-serif'},xaxis:{gridcolor:gc,zeroline:false},yaxis:{gridcolor:gc,zeroline:false},showlegend:false};}
  function buildPlotly(){if(!window.Plotly||!window.__folioPlotly)return;
    Object.keys(window.__folioPlotly).forEach(function(id){var c=window.__folioPlotly[id];var el=document.getElementById(id);if(!el||c._b)return;c._b=true;
      try{if(c.raw){var lay=Object.assign({paper_bgcolor:'rgba(0,0,0,0)',plot_bgcolor:'rgba(0,0,0,0)',font:{color:c.dark?'#cbd5e1':'#334155',family:'Inter,system-ui,sans-serif'},margin:{t:8,r:12,b:42,l:54}},c.raw.layout||{});window.Plotly.newPlot(id,c.raw.data||[],lay,{responsive:true,displayModeBar:false});}else{window.Plotly.newPlot(id,plotlyTrace(c),plotlyLayout(c),{responsive:true,displayModeBar:false});}}catch(e){}});}
  function updatePlotly(){if(!window.Plotly||!window.__folioPlotly)return;Object.keys(window.__folioPlotly).forEach(function(id){var c=window.__folioPlotly[id];if(!c._b||c.raw)return;try{window.Plotly.react(id,plotlyTrace(c),plotlyLayout(c));}catch(e){}});}
  function resizePlotly(){if(!window.Plotly||!window.__folioPlotly)return;Object.keys(window.__folioPlotly).forEach(function(id){try{window.Plotly.Plots.resize(id);}catch(e){}});}
  Folio.updateCharts=function(){
    if(window.__folioCharts)Object.keys(window.__folioCharts).forEach(function(id){var c=window.__folioCharts[id];if(!c.inst)return;var d=chartData(c);c.inst.data.labels=d.labels;c.inst.data.datasets[0].data=d.data;c.inst.update();});
    updatePlotly();
  };
  if(window.Chart){buildCharts();}else{var _ct=setInterval(function(){if(window.Chart){clearInterval(_ct);buildCharts();}},50);setTimeout(function(){clearInterval(_ct);},8000);}
  if(window.Plotly){buildPlotly();}else{var _pt=setInterval(function(){if(window.Plotly){clearInterval(_pt);buildPlotly();}},50);setTimeout(function(){clearInterval(_pt);},8000);}

  // ── Generic action dispatcher (buttons, chips, tabs, accordions, modals) ──
  function openModal(id){var m=document.getElementById(id);if(!m)return;m.classList.add('open');m.setAttribute('aria-hidden','false');document.body.classList.add('ic-modal-lock');setTimeout(function(){if(window.__folioCharts)Object.keys(window.__folioCharts).forEach(function(k){var c=window.__folioCharts[k];if(c.inst&&c.inst.resize)c.inst.resize();});resizePlotly();},20);}
  function closeModal(id){var m=id?document.getElementById(id):document.querySelector('.ic-modal.open');if(!m)return;m.classList.remove('open');m.setAttribute('aria-hidden','true');if(!document.querySelector('.ic-modal.open'))document.body.classList.remove('ic-modal-lock');}
  function switchTab(group,tid){
    document.querySelectorAll('[data-tab-group="'+group+'"]').forEach(function(b){b.classList.toggle('active',b.getAttribute('data-tab-id')===tid);});
    document.querySelectorAll('[data-tab-panel="'+group+'"]').forEach(function(p){p.classList.toggle('active',p.getAttribute('data-tab-id')===tid);});
    // Charts inside a previously-hidden panel render at 0×0; nudge them to resize.
    setTimeout(function(){if(window.__folioCharts)Object.keys(window.__folioCharts).forEach(function(id){var c=window.__folioCharts[id];if(c.inst&&c.inst.resize)c.inst.resize();});resizePlotly();},20);
  }
  function toggleAccordion(id){var it=document.getElementById(id);if(!it)return;var willOpen=!it.classList.contains('open');var g=it.getAttribute('data-acc-group');
    if(g&&willOpen){document.querySelectorAll('[data-acc-group="'+g+'"]').forEach(function(o){if(o!==it)o.classList.remove('open');});}
    it.classList.toggle('open',willOpen);}
  function setFilter(field,value,multi){
    if(value==='__all__'){Folio.filters[field]=[];}
    else if(multi){var cur=Folio.filters[field]||[];var i=cur.indexOf(value);if(i>=0)cur.splice(i,1);else cur.push(value);Folio.filters[field]=cur;}
    else{Folio.filters[field]=(Folio.filters[field]&&Folio.filters[field][0]===value)?[]:[value];}
    // reflect chip active states
    document.querySelectorAll('[data-filter-field="'+field+'"]').forEach(function(ch){var v=ch.getAttribute('data-filter-value');if(v==null)return;
      if(v==='__all__')ch.classList.toggle('active',!(Folio.filters[field]&&Folio.filters[field].length));
      else ch.classList.toggle('active',(Folio.filters[field]||[]).indexOf(v)>=0);});
    if(window.__folioTables)Object.keys(window.__folioTables).forEach(function(id){window.__folioTables[id].page=0;});
    Folio.renderTables();Folio.updateCharts();Folio.events.emit('filter:change',{field:field});
  }
  function dispatch(action){
    if(!action)return;var c=action.indexOf(':');var verb=c<0?action:action.slice(0,c);var rest=c<0?'':action.slice(c+1);
    if(verb==='open_modal')openModal(rest);
    else if(verb==='close_modal')closeModal(rest);
    else if(verb==='toggle')Folio.state.set(rest,!Folio.state.get(rest));
    else if(verb==='set'){var eq=rest.indexOf('=');var k=eq<0?rest:rest.slice(0,eq);var v=eq<0?true:rest.slice(eq+1);Folio.state.set(k,v);}
    else if(verb==='filter'){var p=rest.split(':');var ch=document.querySelector('[data-filter-field="'+p[0]+'"][data-filter-value="'+p.slice(1).join(':')+'"]');setFilter(p[0],p.slice(1).join(':'),ch&&ch.hasAttribute('data-multi'));}
    else if(verb==='tab'){var t=rest.split(':');switchTab(t[0],t.slice(1).join(':'));}
    else if(verb==='accordion')toggleAccordion(rest);
    else if(verb==='scroll_to'){var el=document.getElementById(rest);if(el)el.scrollIntoView({behavior:'smooth',block:'start'});}
    else if(verb==='download_csv')exportCsv(rest);
    else if(verb==='next_page')next();
    else if(verb==='prev_page')prev();
    else if(verb==='goto_page')goto(rest);
    else if(verb==='open_url')window.open(rest,'_blank');
  }
  document.addEventListener('click',function(e){
    var el=e.target.closest&&e.target.closest('[data-folio-action]');
    if(el){e.preventDefault();dispatch(el.getAttribute('data-folio-action'));}
  });
  document.querySelectorAll('.ic-filter-select').forEach(function(sel){
    sel.addEventListener('change',function(){var field=sel.getAttribute('data-filter-field');
      if(sel.multiple){Folio.filters[field]=Array.from(sel.selectedOptions).map(function(o){return o.value;}).filter(function(v){return v!=='__all__';});}
      else{Folio.filters[field]=sel.value==='__all__'?[]:[sel.value];}
      if(window.__folioTables)Object.keys(window.__folioTables).forEach(function(id){window.__folioTables[id].page=0;});
      Folio.renderTables();Folio.updateCharts();});
  });
  document.addEventListener('keydown',function(e){if(e.key==='Escape')closeModal();});

  Folio.nav={goto:goto,next:next,prev:prev};Folio.openModal=openModal;Folio.closeModal=closeModal;window.Folio=Folio;
  reactState();
  if(pages.length>0&&!pages.some(function(p){return p.classList.contains('active');})){
    goto(pages[0].dataset.pageId||'');
  }
})();`;export{_t as assembleReportHTML};
