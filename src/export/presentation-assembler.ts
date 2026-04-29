import type { DesignSpec, Page, PageTransition } from '../schema/types';
import { renderToSVGString } from '../mcp/engine/svg-export';
import { generateLayerCSS, generateStaggerCSS } from '../animation/css-generator';
import { generateTransitionCSS, transitionClassName } from '../animation/transition-css';

export interface PresentationOptions {
  title?: string;
  theme?: 'dark' | 'light';
  /** Override the design's presentation settings */
  auto_advance?: number;
}

export function assemblePresentationHTML(
  spec: DesignSpec,
  opts: PresentationOptions = {},
): string {
  const pages  = spec.pages ?? [];
  const ps     = spec.presentation ?? {};
  const title  = opts.title ?? spec.meta.name;
  const dark   = opts.theme !== 'light';
  const autoMs = opts.auto_advance ?? ps.auto_advance ?? 0;

  // Collect transitions from pages
  const transitions: PageTransition[] = pages
    .map(p => p.transition)
    .filter((t): t is PageTransition => !!t);

  const transitionCSS = generateTransitionCSS(transitions);
  const animCSS = buildLayerAnimCSS(pages);
  const slides  = pages.map((p, i) => renderSlide(spec, p, i)).join('\n');
  const audioTracks = buildAudioTracks(spec);
  const pageData = JSON.stringify(pages.map((p, i) => ({
    id: p.id,
    label: p.label ?? `Slide ${i + 1}`,
    notes: p.notes ?? '',
    autoMs: p.auto_advance ?? autoMs,
    transition: p.transition?.type ?? 'fade',
    transitionMs: p.transition?.duration ?? 400,
  })));

  return `<!DOCTYPE html>
<html lang="en" data-theme="${dark ? 'dark' : 'light'}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escHtml(title)}</title>
<style>
${PRESENTATION_BASE_CSS}
${transitionCSS}
${animCSS}
</style>
</head>
<body>
<div id="folio-deck" class="folio-deck">
${slides}
</div>
<div id="folio-controls" class="folio-controls">
  <button id="btn-prev" aria-label="Previous">&#8592;</button>
  <span id="slide-counter"></span>
  <button id="btn-next" aria-label="Next">&#8594;</button>
  <button id="btn-fs" aria-label="Fullscreen">&#9974;</button>
  <button id="btn-notes" aria-label="Speaker notes">&#128203;</button>
  <button id="btn-tp" aria-label="Teleprompter">&#9654;&#9654;</button>
</div>
<div id="folio-notes" class="folio-notes" hidden></div>
<div id="folio-progress" class="folio-progress"><div id="folio-progress-bar"></div></div>
${audioTracks}
<script type="application/json" id="folio-page-data">${pageData}</script>
<script>${PRESENTATION_RUNTIME_JS}</script>
</body>
</html>`;
}

function renderSlide(spec: DesignSpec, page: Page, index: number): string {
  const boundSpec: DesignSpec = { ...spec, pages: undefined, layers: page.layers ?? [] };
  let svg = '';
  try { svg = renderToSVGString(boundSpec); }
  catch { svg = `<p style="color:red">Render error: ${escHtml(page.id)}</p>`; }
  const cls = transitionClassName(page.transition ?? { type: 'fade' });
  const active = index === 0 ? ' active' : '';
  return `<section class="ft-slide${active}" data-slide-id="${escHtml(page.id)}" data-slide-index="${index}" data-transition-cls="${cls}">${svg}</section>`;
}

function buildLayerAnimCSS(pages: Page[]): string {
  const rules: string[] = [];
  for (const page of pages) {
    for (const layer of page.layers ?? []) {
      const l = layer as { id?: string; animation?: Parameters<typeof generateLayerCSS>[1] };
      if (l.animation && l.id) rules.push(generateLayerCSS(l.id, l.animation));
    }
    const anyPage = page as unknown as { animation?: Parameters<typeof generateStaggerCSS>[0] };
    if (anyPage.animation) rules.push(generateStaggerCSS(anyPage.animation));
  }
  return rules.join('\n');
}

function buildAudioTracks(spec: DesignSpec): string {
  const tracks = spec.audio ?? [];
  if (tracks.length === 0) return '';
  return tracks.map(t =>
    `<audio id="audio-${escHtml(t.id)}" src="${escHtml(t.src)}" ${t.loop ? 'loop' : ''} preload="auto" style="display:none"></audio>`
  ).join('\n');
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const PRESENTATION_BASE_CSS = `
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:100%;height:100%;overflow:hidden;background:#000}
body[data-theme=light]{background:#fff}
.folio-deck{position:relative;width:100%;height:100%;overflow:hidden}
.folio-controls{position:fixed;bottom:1rem;left:50%;transform:translateX(-50%);
  display:flex;align-items:center;gap:.75rem;background:rgba(0,0,0,.5);
  padding:.4rem 1rem;border-radius:2rem;z-index:100;backdrop-filter:blur(4px)}
.folio-controls button{background:none;border:none;color:#fff;font-size:1.1rem;cursor:pointer;opacity:.8}
.folio-controls button:hover{opacity:1}
#slide-counter{color:#fff;font:14px/1 system-ui;min-width:3rem;text-align:center}
.folio-progress{position:fixed;bottom:0;left:0;width:100%;height:3px;background:rgba(255,255,255,.1)}
#folio-progress-bar{height:100%;background:#6c5ce7;transition:width .3s ease}
.folio-notes{position:fixed;bottom:4rem;left:50%;transform:translateX(-50%);
  max-width:60%;background:rgba(0,0,0,.85);color:#eee;padding:1rem 1.5rem;
  border-radius:.5rem;font:15px/1.5 system-ui;z-index:99;backdrop-filter:blur(4px)}
.ft-slide svg{width:100%;height:100%;object-fit:contain}
[data-scroll-anim]{opacity:0;transform:translateY(20px);transition:opacity .6s ease,transform .6s ease}
[data-scroll-anim].scroll-visible{opacity:1;transform:none}
.folio-teleprompter{position:fixed;inset:0;background:rgba(0,0,0,.92);color:#fff;
  font:28px/1.8 system-ui;z-index:200;overflow:hidden;display:flex;align-items:center;justify-content:center;padding:4rem}
.folio-teleprompter p{max-width:800px;text-align:center}
`;

const PRESENTATION_RUNTIME_JS = `(function(){
  var pages=JSON.parse(document.getElementById('folio-page-data').textContent||'[]');
  var slides=Array.from(document.querySelectorAll('.ft-slide'));
  var cur=0,total=slides.length,timer=null;

  function go(n,dir){
    if(n<0||n>=total)return;
    var prev=slides[cur],next=slides[n];
    var pData=pages[n]||{};
    var cls=prev.dataset.transitionCls||'ft-fade-400';
    prev.classList.add('leaving',cls+'-leave');
    next.classList.add(cls+'-enter');
    next.classList.add('active');
    prev.addEventListener('animationend',function h(){
      prev.classList.remove('active','leaving',cls+'-leave');
      next.classList.remove(cls+'-enter');
      prev.removeEventListener('animationend',h);
    },{once:true});
    cur=n;
    document.getElementById('slide-counter').textContent=(cur+1)+'/'+total;
    document.getElementById('folio-progress-bar').style.width=((cur+1)/total*100)+'%';
    document.getElementById('folio-notes').textContent=pData.notes||'';
    scheduleAuto(pData.autoMs||0);
    playCues(n);
  }

  function scheduleAuto(ms){
    clearTimeout(timer);
    if(ms>0)timer=setTimeout(function(){go(cur+1,1);},ms);
  }

  function playCues(n){
    var slide=slides[n];
    slide.querySelectorAll('[data-audio-cue]').forEach(function(el){
      var audio=document.getElementById('audio-'+el.dataset.audioCue);
      if(audio)audio.play().catch(function(){});
    });
  }

  document.getElementById('btn-prev').onclick=function(){go(cur-1,-1);};
  document.getElementById('btn-next').onclick=function(){go(cur+1,1);};
  document.getElementById('btn-fs').onclick=function(){
    if(document.fullscreenElement)document.exitFullscreen();
    else document.documentElement.requestFullscreen();
  };
  document.getElementById('btn-notes').onclick=function(){
    var el=document.getElementById('folio-notes');
    el.hidden=!el.hidden;
  };

  // Teleprompter
  var tpEl=null,tpTimer=null,tpSpeed=2;
  document.getElementById('btn-tp').onclick=function(){toggleTeleprompter();};
  function toggleTeleprompter(){
    if(tpEl){document.body.removeChild(tpEl);tpEl=null;clearInterval(tpTimer);return;}
    var pData=pages[cur]||{};
    if(!pData.notes)return;
    tpEl=document.createElement('div');tpEl.className='folio-teleprompter';
    tpEl.innerHTML='<p>'+pData.notes+'</p>';
    tpEl.onclick=function(){toggleTeleprompter();};
    document.body.appendChild(tpEl);
    var scrollPos=0;
    tpTimer=setInterval(function(){scrollPos+=tpSpeed;tpEl.scrollTop=scrollPos;},50);
  }

  // Scroll-triggered animations
  var io=new IntersectionObserver(function(entries){
    entries.forEach(function(e){
      if(e.isIntersecting){e.target.classList.add('scroll-visible');io.unobserve(e.target);}
    });
  },{threshold:0.15});
  document.querySelectorAll('[data-scroll-anim]').forEach(function(el){io.observe(el);});

  document.addEventListener('keydown',function(e){
    if(e.key==='ArrowRight'||e.key==='ArrowDown'||e.key===' ')go(cur+1,1);
    else if(e.key==='ArrowLeft'||e.key==='ArrowUp')go(cur-1,-1);
    else if(e.key==='f'||e.key==='F')document.getElementById('btn-fs').click();
    else if(e.key==='Escape')document.exitFullscreen&&document.exitFullscreen();
    else if(e.key==='n'||e.key==='N')document.getElementById('btn-notes').click();
    else if(e.key==='t'||e.key==='T')toggleTeleprompter();
  });

  // Touch swipe
  var tx=0;
  document.addEventListener('touchstart',function(e){tx=e.touches[0].clientX;});
  document.addEventListener('touchend',function(e){
    var dx=e.changedTouches[0].clientX-tx;
    if(Math.abs(dx)>50){dx<0?go(cur+1,1):go(cur-1,-1);}
  });

  window.FolioPresenter={goto:go,current:function(){return cur;},total:total};
  document.getElementById('slide-counter').textContent='1/'+total;
  scheduleAuto((pages[0]||{}).autoMs||0);
})();`;
