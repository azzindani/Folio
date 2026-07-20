import{i as z,r as f}from"./src-B_AjVX1K.js";import{B as Q,C as Y,V as tt,W as et,_ as at,a as rt,b as nt,c as it,d as ot,v as st}from"./chunk-ICPOFSXX-DwAMnJ9k.js";import{n as lt}from"./ordinal-D2tSGGnb.js";import{n as S}from"./path-twzkuM_u.js";import{p as _}from"./math-CZnq5-jz.js";import{t as B}from"./arc-DLldWqKd.js";import{t as ct}from"./array-BMp8a0m3.js";import{f as ut,r as dt}from"./chunk-5PVQY5BW-BFeIdkHR.js";import{t as pt}from"./chunk-426QAEUC-ZmdSB5tJ.js";import{t as ft}from"./chunk-4BX2VUAB-CRRyKgvV.js";import{t as gt}from"./mermaid-parser.core-D5XWCc7p.js";function mt(t,a){return a<t?-1:a>t?1:a>=t?0:NaN}function ht(t){return t}function xt(){var t=ht,a=mt,g=null,s=S(0),l=S(_),y=S(0);function o(e){var n,c=(e=ct(e)).length,u,m,x=0,d=new Array(c),i=new Array(c),v=+s.apply(this,arguments),w=Math.min(_,Math.max(-_,l.apply(this,arguments)-v)),h,D=Math.min(Math.abs(w)/c,y.apply(this,arguments)),$=D*(w<0?-1:1),p;for(n=0;n<c;++n)(p=i[d[n]=n]=+t(e[n],n,e))>0&&(x+=p);for(a!=null?d.sort(function(A,C){return a(i[A],i[C])}):g!=null&&d.sort(function(A,C){return g(e[A],e[C])}),n=0,m=x?(w-c*$)/x:0;n<c;++n,v=h)u=d[n],p=i[u],h=v+(p>0?p*m:0)+$,i[u]={data:e[u],index:n,value:p,startAngle:v,endAngle:h,padAngle:D};return i}return o.value=function(e){return arguments.length?(t=typeof e=="function"?e:S(+e),o):t},o.sortValues=function(e){return arguments.length?(a=e,g=null,o):a},o.sort=function(e){return arguments.length?(g=e,a=null,o):g},o.startAngle=function(e){return arguments.length?(s=typeof e=="function"?e:S(+e),o):s},o.endAngle=function(e){return arguments.length?(l=typeof e=="function"?e:S(+e),o):l},o.padAngle=function(e){return arguments.length?(y=typeof e=="function"?e:S(+e),o):y},o}var I=ot.pie,F={sections:new Map,showData:!1,config:I},T=F.sections,W=F.showData,vt=structuredClone(I),V={getConfig:f(()=>structuredClone(vt),"getConfig"),clear:f(()=>{T=new Map,W=F.showData,rt()},"clear"),setDiagramTitle:et,getDiagramTitle:Y,setAccTitle:tt,getAccTitle:st,setAccDescription:Q,getAccDescription:at,addSection:f(({label:t,value:a})=>{if(a<0)throw new Error(`"${t}" has invalid value: ${a}. Negative values are not allowed in pie charts. All slice values must be >= 0.`);T.has(t)||(T.set(t,a),z.debug(`added new section: ${t}, with value: ${a}`))},"addSection"),getSections:f(()=>T,"getSections"),setShowData:f(t=>{W=t},"setShowData"),getShowData:f(()=>W,"getShowData")},St=f((t,a)=>{ft(t,a),a.setShowData(t.showData),t.sections.map(a.addSection)},"populateDb"),yt={parse:f(async t=>{const a=await gt("pie",t);z.debug(a),St(a,V)},"parse")},wt=f(t=>`
  .pieCircle{
    stroke: ${t.pieStrokeColor};
    stroke-width : ${t.pieStrokeWidth};
    opacity : ${t.pieOpacity};
  }
  .pieOuterCircle{
    stroke: ${t.pieOuterStrokeColor};
    stroke-width: ${t.pieOuterStrokeWidth};
    fill: none;
  }
  .pieTitleText {
    text-anchor: middle;
    font-size: ${t.pieTitleTextSize};
    fill: ${t.pieTitleTextColor};
    font-family: ${t.fontFamily};
  }
  .slice {
    font-family: ${t.fontFamily};
    fill: ${t.pieSectionTextColor};
    font-size:${t.pieSectionTextSize};
    // fill: white;
  }
  .legend text {
    fill: ${t.pieLegendTextColor};
    font-family: ${t.fontFamily};
    font-size: ${t.pieLegendTextSize};
  }
`,"getStyles"),At=f(t=>{const a=[...t.values()].reduce((s,l)=>s+l,0),g=[...t.entries()].map(([s,l])=>({label:s,value:l})).filter(s=>s.value/a*100>=1);return xt().value(s=>s.value).sort(null)(g)},"createPieArcs"),Ft={parser:yt,db:V,renderer:{draw:f((t,a,g,s)=>{z.debug(`rendering pie chart
`+t);const l=s.db,y=nt(),o=dt(l.getConfig(),y.pie),e=40,n=18,c=4,u=450,m=u,x=pt(a),d=x.append("g");d.attr("transform","translate("+m/2+","+u/2+")");const{themeVariables:i}=y;let[v]=ut(i.pieOuterStrokeWidth);v??=2;const w=o.textPosition,h=Math.min(m,u)/2-e,D=B().innerRadius(0).outerRadius(h),$=B().innerRadius(h*w).outerRadius(h*w);d.append("circle").attr("cx",0).attr("cy",0).attr("r",h+v/2).attr("class","pieOuterCircle");const p=l.getSections(),A=At(p),C=[i.pie1,i.pie2,i.pie3,i.pie4,i.pie5,i.pie6,i.pie7,i.pie8,i.pie9,i.pie10,i.pie11,i.pie12];let b=0;p.forEach(r=>{b+=r});const R=A.filter(r=>(r.data.value/b*100).toFixed(0)!=="0"),k=lt(C).domain([...p.keys()]);d.selectAll("mySlices").data(R).enter().append("path").attr("d",D).attr("fill",r=>k(r.data.label)).attr("class","pieCircle"),d.selectAll("mySlices").data(R).enter().append("text").text(r=>(r.data.value/b*100).toFixed(0)+"%").attr("transform",r=>"translate("+$.centroid(r)+")").style("text-anchor","middle").attr("class","slice");const U=d.append("text").text(l.getDiagramTitle()).attr("x",0).attr("y",-(u-50)/2).attr("class","pieTitleText"),G=[...p.entries()].map(([r,M])=>({label:r,value:M})),E=d.selectAll(".legend").data(G).enter().append("g").attr("class","legend").attr("transform",(r,M)=>{const P=n+c,H=P*G.length/2,J=12*n,K=M*P-H;return"translate("+J+","+K+")"});E.append("rect").attr("width",n).attr("height",n).style("fill",r=>k(r.label)).style("stroke",r=>k(r.label)),E.append("text").attr("x",n+c).attr("y",n-c).text(r=>l.getShowData()?`${r.label} [${r.value}]`:r.label);const j=Math.max(...E.selectAll("text").nodes().map(r=>r?.getBoundingClientRect().width??0)),X=m+e+n+c+j,L=U.node()?.getBoundingClientRect().width??0,Z=m/2-L/2,q=m/2+L/2,N=Math.min(0,Z),O=Math.max(X,q)-N;x.attr("viewBox",`${N} 0 ${O} ${u}`),it(x,u,O,o.useMaxWidth)},"draw")},styles:wt};export{Ft as diagram};
