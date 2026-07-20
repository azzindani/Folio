import{o as yt,t as Mt}from"./chunk-DRxrnsUs.js";import{i as nt,o as me,r as u,t as xt}from"./src-B_AjVX1K.js";import{B as ke,C as ye,V as ge,W as pe,_ as ve,a as Te,b as lt,c as xe,s as be,v as we}from"./chunk-ICPOFSXX-DwAMnJ9k.js";import{t as _e}from"./linear-DFD6-zbF.js";import{E as Xt,M as De,O as Ut,S as Zt,_ as Se,b as Ce,f as Qt,g as Me,h as Ee,j as Ie,k as Jt,m as Ae,n as $e,r as Kt,v as Ye,w as te,y as Le}from"./time-CsnXUZYP.js";import{o as Fe}from"./timer-Bq7Ooxmf.js";import{h as Oe}from"./chunk-5PVQY5BW-BFeIdkHR.js";import{t as We}from"./dist-1yvYajuZ.js";function Ve(t){return t}var wt=1,It=2,$t=3,bt=4,ee=1e-6;function ze(t){return"translate("+t+",0)"}function Pe(t){return"translate(0,"+t+")"}function Ne(t){return e=>+t(e)}function Re(t,e){return e=Math.max(0,t.bandwidth()-e*2)/2,t.round()&&(e=Math.round(e)),s=>+t(s)+e}function He(){return!this.__axis}function re(t,e){var s=[],i=null,a=null,d=6,p=6,E=3,Y=typeof window<"u"&&window.devicePixelRatio>1?0:.5,C=t===wt||t===bt?-1:1,b=t===bt||t===It?"x":"y",F=t===wt||t===$t?ze:Pe;function w(_){var P=i??(e.ticks?e.ticks.apply(e,s):e.domain()),A=a??(e.tickFormat?e.tickFormat.apply(e,s):Ve),x=Math.max(d,0)+E,I=e.range(),O=+I[0]+Y,L=+I[I.length-1]+Y,N=(e.bandwidth?Re:Ne)(e.copy(),Y),R=_.selection?_.selection():_,$=R.selectAll(".domain").data([null]),v=R.selectAll(".tick").data(P,e).order(),k=v.exit(),f=v.enter().append("g").attr("class","tick"),T=v.select("line"),g=v.select("text");$=$.merge($.enter().insert("path",".tick").attr("class","domain").attr("stroke","currentColor")),v=v.merge(f),T=T.merge(f.append("line").attr("stroke","currentColor").attr(b+"2",C*d)),g=g.merge(f.append("text").attr("fill","currentColor").attr(b,C*x).attr("dy",t===wt?"0em":t===$t?"0.71em":"0.32em")),_!==R&&($=$.transition(_),v=v.transition(_),T=T.transition(_),g=g.transition(_),k=k.transition(_).attr("opacity",ee).attr("transform",function(r){return isFinite(r=N(r))?F(r+Y):this.getAttribute("transform")}),f.attr("opacity",ee).attr("transform",function(r){var l=this.parentNode.__axis;return F((l&&isFinite(l=l(r))?l:N(r))+Y)})),k.remove(),$.attr("d",t===bt||t===It?p?"M"+C*p+","+O+"H"+Y+"V"+L+"H"+C*p:"M"+Y+","+O+"V"+L:p?"M"+O+","+C*p+"V"+Y+"H"+L+"V"+C*p:"M"+O+","+Y+"H"+L),v.attr("opacity",1).attr("transform",function(r){return F(N(r)+Y)}),T.attr(b+"2",C*d),g.attr(b,C*x).text(A),R.filter(He).attr("fill","none").attr("font-size",10).attr("font-family","sans-serif").attr("text-anchor",t===It?"start":t===bt?"end":"middle"),R.each(function(){this.__axis=N})}return w.scale=function(_){return arguments.length?(e=_,w):e},w.ticks=function(){return s=Array.from(arguments),w},w.tickArguments=function(_){return arguments.length?(s=_==null?[]:Array.from(_),w):s.slice()},w.tickValues=function(_){return arguments.length?(i=_==null?null:Array.from(_),w):i&&i.slice()},w.tickFormat=function(_){return arguments.length?(a=_,w):a},w.tickSize=function(_){return arguments.length?(d=p=+_,w):d},w.tickSizeInner=function(_){return arguments.length?(d=+_,w):d},w.tickSizeOuter=function(_){return arguments.length?(p=+_,w):p},w.tickPadding=function(_){return arguments.length?(E=+_,w):E},w.offset=function(_){return arguments.length?(Y=+_,w):Y},w}function Be(t){return re(wt,t)}function je(t){return re($t,t)}var Ge=Mt(((t,e)=>{(function(s,i){typeof t=="object"&&typeof e<"u"?e.exports=i():typeof define=="function"&&define.amd?define(i):(s=typeof globalThis<"u"?globalThis:s||self).dayjs_plugin_isoWeek=i()})(t,(function(){"use strict";var s="day";return function(i,a,d){var p=function(C){return C.add(4-C.isoWeekday(),s)},E=a.prototype;E.isoWeekYear=function(){return p(this).year()},E.isoWeek=function(C){if(!this.$utils().u(C))return this.add(7*(C-this.isoWeek()),s);var b,F,w,_,P=p(this),A=(b=this.isoWeekYear(),F=this.$u,w=(F?d.utc:d)().year(b).startOf("year"),_=4-w.isoWeekday(),w.isoWeekday()>4&&(_+=7),w.add(_,s));return P.diff(A,"week")+1},E.isoWeekday=function(C){return this.$utils().u(C)?this.day()||7:this.day(this.day()%7?C:C-7)};var Y=E.startOf;E.startOf=function(C,b){var F=this.$utils(),w=!!F.u(b)||b;return F.p(C)==="isoweek"?w?this.date(this.date()-(this.isoWeekday()-1)).startOf("day"):this.date(this.date()-1-(this.isoWeekday()-1)+7).endOf("day"):Y.bind(this)(C,b)}}}))})),qe=Mt(((t,e)=>{(function(s,i){typeof t=="object"&&typeof e<"u"?e.exports=i():typeof define=="function"&&define.amd?define(i):(s=typeof globalThis<"u"?globalThis:s||self).dayjs_plugin_customParseFormat=i()})(t,(function(){"use strict";var s={LTS:"h:mm:ss A",LT:"h:mm A",L:"MM/DD/YYYY",LL:"MMMM D, YYYY",LLL:"MMMM D, YYYY h:mm A",LLLL:"dddd, MMMM D, YYYY h:mm A"},i=/(\[[^[]*\])|([-_:/.,()\s]+)|(A|a|Q|YYYY|YY?|ww?|MM?M?M?|Do|DD?|hh?|HH?|mm?|ss?|S{1,3}|z|ZZ?)/g,a=/\d/,d=/\d\d/,p=/\d\d?/,E=/\d*[^-_:/,()\s\d]+/,Y={},C=function(x){return(x=+x)+(x>68?1900:2e3)},b=function(x){return function(I){this[x]=+I}},F=[/[+-]\d\d:?(\d\d)?|Z/,function(x){(this.zone||(this.zone={})).offset=(function(I){if(!I||I==="Z")return 0;var O=I.match(/([+-]|\d\d)/g),L=60*O[1]+(+O[2]||0);return L===0?0:O[0]==="+"?-L:L})(x)}],w=function(x){var I=Y[x];return I&&(I.indexOf?I:I.s.concat(I.f))},_=function(x,I){var O,L=Y.meridiem;if(L){for(var N=1;N<=24;N+=1)if(x.indexOf(L(N,0,I))>-1){O=N>12;break}}else O=x===(I?"pm":"PM");return O},P={A:[E,function(x){this.afternoon=_(x,!1)}],a:[E,function(x){this.afternoon=_(x,!0)}],Q:[a,function(x){this.month=3*(x-1)+1}],S:[a,function(x){this.milliseconds=100*+x}],SS:[d,function(x){this.milliseconds=10*+x}],SSS:[/\d{3}/,function(x){this.milliseconds=+x}],s:[p,b("seconds")],ss:[p,b("seconds")],m:[p,b("minutes")],mm:[p,b("minutes")],H:[p,b("hours")],h:[p,b("hours")],HH:[p,b("hours")],hh:[p,b("hours")],D:[p,b("day")],DD:[d,b("day")],Do:[E,function(x){var I=Y.ordinal,O=x.match(/\d+/);if(this.day=O[0],I)for(var L=1;L<=31;L+=1)I(L).replace(/\[|\]/g,"")===x&&(this.day=L)}],w:[p,b("week")],ww:[d,b("week")],M:[p,b("month")],MM:[d,b("month")],MMM:[E,function(x){var I=w("months"),O=(w("monthsShort")||I.map((function(L){return L.slice(0,3)}))).indexOf(x)+1;if(O<1)throw new Error;this.month=O%12||O}],MMMM:[E,function(x){var I=w("months").indexOf(x)+1;if(I<1)throw new Error;this.month=I%12||I}],Y:[/[+-]?\d+/,b("year")],YY:[d,function(x){this.year=C(x)}],YYYY:[/\d{4}/,b("year")],Z:F,ZZ:F};function A(x){for(var I=x,O=Y&&Y.formats,L=(x=I.replace(/(\[[^\]]+])|(LTS?|l{1,4}|L{1,4})/g,(function(T,g,r){var l=r&&r.toUpperCase();return g||O[r]||s[r]||O[l].replace(/(\[[^\]]+])|(MMMM|MM|DD|dddd)/g,(function(y,m,h){return m||h.slice(1)}))}))).match(i),N=L.length,R=0;R<N;R+=1){var $=L[R],v=P[$],k=v&&v[0],f=v&&v[1];L[R]=f?{regex:k,parser:f}:$.replace(/^\[|\]$/g,"")}return function(T){for(var g={},r=0,l=0;r<N;r+=1){var y=L[r];if(typeof y=="string")l+=y.length;else{var m=y.regex,h=y.parser,S=T.slice(l),n=m.exec(S)[0];h.call(g,n),T=T.replace(n,"")}}return(function(c){var o=c.afternoon;if(o!==void 0){var D=c.hours;o?D<12&&(c.hours+=12):D===12&&(c.hours=0),delete c.afternoon}})(g),g}}return function(x,I,O){O.p.customParseFormat=!0,x&&x.parseTwoDigitYear&&(C=x.parseTwoDigitYear);var L=I.prototype,N=L.parse;L.parse=function(R){var $=R.date,v=R.utc,k=R.args;this.$u=v;var f=k[1];if(typeof f=="string"){var T=k[2]===!0,g=k[3]===!0,r=T||g,l=k[2];g&&(l=k[2]),Y=this.$locale(),!T&&l&&(Y=O.Ls[l]),this.$d=(function(S,n,c,o){try{if(["x","X"].indexOf(n)>-1)return new Date((n==="X"?1e3:1)*S);var D=A(n)(S),W=D.year,M=D.month,V=D.day,z=D.hours,ft=D.minutes,H=D.seconds,J=D.milliseconds,rt=D.zone,at=D.week,ht=new Date,mt=V||(W||M?1:ht.getDate()),ot=W||ht.getFullYear(),B=0;W&&!M||(B=M>0?M-1:ht.getMonth());var et,U=z||0,q=ft||0,it=H||0,Z=J||0;return rt?new Date(Date.UTC(ot,B,mt,U,q,it,Z+60*rt.offset*1e3)):c?new Date(Date.UTC(ot,B,mt,U,q,it,Z)):(et=new Date(ot,B,mt,U,q,it,Z),at&&(et=o(et).week(at).toDate()),et)}catch{return new Date("")}})($,f,v,O),this.init(),l&&l!==!0&&(this.$L=this.locale(l).$L),r&&$!=this.format(f)&&(this.$d=new Date("")),Y={}}else if(f instanceof Array)for(var y=f.length,m=1;m<=y;m+=1){k[1]=f[m-1];var h=O.apply(this,k);if(h.isValid()){this.$d=h.$d,this.$L=h.$L,this.init();break}m===y&&(this.$d=new Date(""))}else N.call(this,R)}}}))})),Xe=Mt(((t,e)=>{(function(s,i){typeof t=="object"&&typeof e<"u"?e.exports=i():typeof define=="function"&&define.amd?define(i):(s=typeof globalThis<"u"?globalThis:s||self).dayjs_plugin_advancedFormat=i()})(t,(function(){"use strict";return function(s,i){var a=i.prototype,d=a.format;a.format=function(p){var E=this,Y=this.$locale();if(!this.isValid())return d.bind(this)(p);var C=this.$utils(),b=(p||"YYYY-MM-DDTHH:mm:ssZ").replace(/\[([^\]]+)]|Q|wo|ww|w|WW|W|zzz|z|gggg|GGGG|Do|X|x|k{1,2}|S/g,(function(F){switch(F){case"Q":return Math.ceil((E.$M+1)/3);case"Do":return Y.ordinal(E.$D);case"gggg":return E.weekYear();case"GGGG":return E.isoWeekYear();case"wo":return Y.ordinal(E.week(),"W");case"w":case"ww":return C.s(E.week(),F==="w"?1:2,"0");case"W":case"WW":return C.s(E.isoWeek(),F==="W"?1:2,"0");case"k":case"kk":return C.s(String(E.$H===0?24:E.$H),F==="k"?1:2,"0");case"X":return Math.floor(E.$d.getTime()/1e3);case"x":return E.$d.getTime();case"z":return"["+E.offsetName()+"]";case"zzz":return"["+E.offsetName("long")+"]";default:return F}}));return d.bind(this)(b)}}}))})),Ue=Mt(((t,e)=>{(function(s,i){typeof t=="object"&&typeof e<"u"?e.exports=i():typeof define=="function"&&define.amd?define(i):(s=typeof globalThis<"u"?globalThis:s||self).dayjs_plugin_duration=i()})(t,(function(){"use strict";var s,i,a=1e3,d=6e4,p=36e5,E=864e5,Y=/\[([^\]]+)]|Y{1,4}|M{1,4}|D{1,2}|d{1,4}|H{1,2}|h{1,2}|a|A|m{1,2}|s{1,2}|Z{1,2}|SSS/g,C=31536e6,b=2628e6,F=/^(-|\+)?P(?:([-+]?[0-9,.]*)Y)?(?:([-+]?[0-9,.]*)M)?(?:([-+]?[0-9,.]*)W)?(?:([-+]?[0-9,.]*)D)?(?:T(?:([-+]?[0-9,.]*)H)?(?:([-+]?[0-9,.]*)M)?(?:([-+]?[0-9,.]*)S)?)?$/,w={years:C,months:b,days:E,hours:p,minutes:d,seconds:a,milliseconds:1,weeks:6048e5},_=function($){return $ instanceof N},P=function($,v,k){return new N($,k,v.$l)},A=function($){return i.p($)+"s"},x=function($){return $<0},I=function($){return x($)?Math.ceil($):Math.floor($)},O=function($){return Math.abs($)},L=function($,v){return $?x($)?{negative:!0,format:""+O($)+v}:{negative:!1,format:""+$+v}:{negative:!1,format:""}},N=(function(){function $(k,f,T){var g=this;if(this.$d={},this.$l=T,k===void 0&&(this.$ms=0,this.parseFromMilliseconds()),f)return P(k*w[A(f)],this);if(typeof k=="number")return this.$ms=k,this.parseFromMilliseconds(),this;if(typeof k=="object")return Object.keys(k).forEach((function(y){g.$d[A(y)]=k[y]})),this.calMilliseconds(),this;if(typeof k=="string"){var r=k.match(F);if(r){var l=r.slice(2).map((function(y){return y!=null?Number(y):0}));return this.$d.years=l[0],this.$d.months=l[1],this.$d.weeks=l[2],this.$d.days=l[3],this.$d.hours=l[4],this.$d.minutes=l[5],this.$d.seconds=l[6],this.calMilliseconds(),this}}return this}var v=$.prototype;return v.calMilliseconds=function(){var k=this;this.$ms=Object.keys(this.$d).reduce((function(f,T){return f+(k.$d[T]||0)*w[T]}),0)},v.parseFromMilliseconds=function(){var k=this.$ms;this.$d.years=I(k/C),k%=C,this.$d.months=I(k/b),k%=b,this.$d.days=I(k/E),k%=E,this.$d.hours=I(k/p),k%=p,this.$d.minutes=I(k/d),k%=d,this.$d.seconds=I(k/a),k%=a,this.$d.milliseconds=k},v.toISOString=function(){var k=L(this.$d.years,"Y"),f=L(this.$d.months,"M"),T=+this.$d.days||0;this.$d.weeks&&(T+=7*this.$d.weeks);var g=L(T,"D"),r=L(this.$d.hours,"H"),l=L(this.$d.minutes,"M"),y=this.$d.seconds||0;this.$d.milliseconds&&(y+=this.$d.milliseconds/1e3,y=Math.round(1e3*y)/1e3);var m=L(y,"S"),h=k.negative||f.negative||g.negative||r.negative||l.negative||m.negative,S=r.format||l.format||m.format?"T":"",n=(h?"-":"")+"P"+k.format+f.format+g.format+S+r.format+l.format+m.format;return n==="P"||n==="-P"?"P0D":n},v.toJSON=function(){return this.toISOString()},v.format=function(k){var f=k||"YYYY-MM-DDTHH:mm:ss",T={Y:this.$d.years,YY:i.s(this.$d.years,2,"0"),YYYY:i.s(this.$d.years,4,"0"),M:this.$d.months,MM:i.s(this.$d.months,2,"0"),D:this.$d.days,DD:i.s(this.$d.days,2,"0"),H:this.$d.hours,HH:i.s(this.$d.hours,2,"0"),m:this.$d.minutes,mm:i.s(this.$d.minutes,2,"0"),s:this.$d.seconds,ss:i.s(this.$d.seconds,2,"0"),SSS:i.s(this.$d.milliseconds,3,"0")};return f.replace(Y,(function(g,r){return r||String(T[g])}))},v.as=function(k){return this.$ms/w[A(k)]},v.get=function(k){var f=this.$ms,T=A(k);return T==="milliseconds"?f%=1e3:f=T==="weeks"?I(f/w[T]):this.$d[T],f||0},v.add=function(k,f,T){var g;return g=f?k*w[A(f)]:_(k)?k.$ms:P(k,this).$ms,P(this.$ms+g*(T?-1:1),this)},v.subtract=function(k,f){return this.add(k,f,!0)},v.locale=function(k){var f=this.clone();return f.$l=k,f},v.clone=function(){return P(this.$ms,this)},v.humanize=function(k){return s().add(this.$ms,"ms").locale(this.$l).fromNow(!k)},v.valueOf=function(){return this.asMilliseconds()},v.milliseconds=function(){return this.get("milliseconds")},v.asMilliseconds=function(){return this.as("milliseconds")},v.seconds=function(){return this.get("seconds")},v.asSeconds=function(){return this.as("seconds")},v.minutes=function(){return this.get("minutes")},v.asMinutes=function(){return this.as("minutes")},v.hours=function(){return this.get("hours")},v.asHours=function(){return this.as("hours")},v.days=function(){return this.get("days")},v.asDays=function(){return this.as("days")},v.weeks=function(){return this.get("weeks")},v.asWeeks=function(){return this.as("weeks")},v.months=function(){return this.get("months")},v.asMonths=function(){return this.as("months")},v.years=function(){return this.get("years")},v.asYears=function(){return this.as("years")},$})(),R=function($,v,k){return $.add(v.years()*k,"y").add(v.months()*k,"M").add(v.days()*k,"d").add(v.hours()*k,"h").add(v.minutes()*k,"m").add(v.seconds()*k,"s").add(v.milliseconds()*k,"ms")};return function($,v,k){s=k,i=k().$utils(),k.duration=function(g,r){return P(g,{$l:k.locale()},r)},k.isDuration=_;var f=v.prototype.add,T=v.prototype.subtract;v.prototype.add=function(g,r){return _(g)?R(this,g,1):f.bind(this)(g,r)},v.prototype.subtract=function(g,r){return _(g)?R(this,g,-1):T.bind(this)(g,r)}}}))})),Ze=We(),G=yt(me(),1),Qe=yt(Ge(),1),Je=yt(qe(),1),Ke=yt(Xe(),1),ti=yt(Ue(),1),Yt=(function(){var t=u(function(r,l,y,m){for(y=y||{},m=r.length;m--;y[r[m]]=l);return y},"o"),e=[6,8,10,12,13,14,15,16,17,18,20,21,22,23,24,25,26,27,28,29,30,31,33,35,36,38,40],s=[1,26],i=[1,27],a=[1,28],d=[1,29],p=[1,30],E=[1,31],Y=[1,32],C=[1,33],b=[1,34],F=[1,9],w=[1,10],_=[1,11],P=[1,12],A=[1,13],x=[1,14],I=[1,15],O=[1,16],L=[1,19],N=[1,20],R=[1,21],$=[1,22],v=[1,23],k=[1,25],f=[1,35],T={trace:u(function(){},"trace"),yy:{},symbols_:{error:2,start:3,gantt:4,document:5,EOF:6,line:7,SPACE:8,statement:9,NL:10,weekday:11,weekday_monday:12,weekday_tuesday:13,weekday_wednesday:14,weekday_thursday:15,weekday_friday:16,weekday_saturday:17,weekday_sunday:18,weekend:19,weekend_friday:20,weekend_saturday:21,dateFormat:22,inclusiveEndDates:23,topAxis:24,axisFormat:25,tickInterval:26,excludes:27,includes:28,todayMarker:29,title:30,acc_title:31,acc_title_value:32,acc_descr:33,acc_descr_value:34,acc_descr_multiline_value:35,section:36,clickStatement:37,taskTxt:38,taskData:39,click:40,callbackname:41,callbackargs:42,href:43,clickStatementDebug:44,$accept:0,$end:1},terminals_:{2:"error",4:"gantt",6:"EOF",8:"SPACE",10:"NL",12:"weekday_monday",13:"weekday_tuesday",14:"weekday_wednesday",15:"weekday_thursday",16:"weekday_friday",17:"weekday_saturday",18:"weekday_sunday",20:"weekend_friday",21:"weekend_saturday",22:"dateFormat",23:"inclusiveEndDates",24:"topAxis",25:"axisFormat",26:"tickInterval",27:"excludes",28:"includes",29:"todayMarker",30:"title",31:"acc_title",32:"acc_title_value",33:"acc_descr",34:"acc_descr_value",35:"acc_descr_multiline_value",36:"section",38:"taskTxt",39:"taskData",40:"click",41:"callbackname",42:"callbackargs",43:"href"},productions_:[0,[3,3],[5,0],[5,2],[7,2],[7,1],[7,1],[7,1],[11,1],[11,1],[11,1],[11,1],[11,1],[11,1],[11,1],[19,1],[19,1],[9,1],[9,1],[9,1],[9,1],[9,1],[9,1],[9,1],[9,1],[9,1],[9,1],[9,1],[9,2],[9,2],[9,1],[9,1],[9,1],[9,2],[37,2],[37,3],[37,3],[37,4],[37,3],[37,4],[37,2],[44,2],[44,3],[44,3],[44,4],[44,3],[44,4],[44,2]],performAction:u(function(l,y,m,h,S,n,c){var o=n.length-1;switch(S){case 1:return n[o-1];case 2:this.$=[];break;case 3:n[o-1].push(n[o]),this.$=n[o-1];break;case 4:case 5:this.$=n[o];break;case 6:case 7:this.$=[];break;case 8:h.setWeekday("monday");break;case 9:h.setWeekday("tuesday");break;case 10:h.setWeekday("wednesday");break;case 11:h.setWeekday("thursday");break;case 12:h.setWeekday("friday");break;case 13:h.setWeekday("saturday");break;case 14:h.setWeekday("sunday");break;case 15:h.setWeekend("friday");break;case 16:h.setWeekend("saturday");break;case 17:h.setDateFormat(n[o].substr(11)),this.$=n[o].substr(11);break;case 18:h.enableInclusiveEndDates(),this.$=n[o].substr(18);break;case 19:h.TopAxis(),this.$=n[o].substr(8);break;case 20:h.setAxisFormat(n[o].substr(11)),this.$=n[o].substr(11);break;case 21:h.setTickInterval(n[o].substr(13)),this.$=n[o].substr(13);break;case 22:h.setExcludes(n[o].substr(9)),this.$=n[o].substr(9);break;case 23:h.setIncludes(n[o].substr(9)),this.$=n[o].substr(9);break;case 24:h.setTodayMarker(n[o].substr(12)),this.$=n[o].substr(12);break;case 27:h.setDiagramTitle(n[o].substr(6)),this.$=n[o].substr(6);break;case 28:this.$=n[o].trim(),h.setAccTitle(this.$);break;case 29:case 30:this.$=n[o].trim(),h.setAccDescription(this.$);break;case 31:h.addSection(n[o].substr(8)),this.$=n[o].substr(8);break;case 33:h.addTask(n[o-1],n[o]),this.$="task";break;case 34:this.$=n[o-1],h.setClickEvent(n[o-1],n[o],null);break;case 35:this.$=n[o-2],h.setClickEvent(n[o-2],n[o-1],n[o]);break;case 36:this.$=n[o-2],h.setClickEvent(n[o-2],n[o-1],null),h.setLink(n[o-2],n[o]);break;case 37:this.$=n[o-3],h.setClickEvent(n[o-3],n[o-2],n[o-1]),h.setLink(n[o-3],n[o]);break;case 38:this.$=n[o-2],h.setClickEvent(n[o-2],n[o],null),h.setLink(n[o-2],n[o-1]);break;case 39:this.$=n[o-3],h.setClickEvent(n[o-3],n[o-1],n[o]),h.setLink(n[o-3],n[o-2]);break;case 40:this.$=n[o-1],h.setLink(n[o-1],n[o]);break;case 41:case 47:this.$=n[o-1]+" "+n[o];break;case 42:case 43:case 45:this.$=n[o-2]+" "+n[o-1]+" "+n[o];break;case 44:case 46:this.$=n[o-3]+" "+n[o-2]+" "+n[o-1]+" "+n[o];break}},"anonymous"),table:[{3:1,4:[1,2]},{1:[3]},t(e,[2,2],{5:3}),{6:[1,4],7:5,8:[1,6],9:7,10:[1,8],11:17,12:s,13:i,14:a,15:d,16:p,17:E,18:Y,19:18,20:C,21:b,22:F,23:w,24:_,25:P,26:A,27:x,28:I,29:O,30:L,31:N,33:R,35:$,36:v,37:24,38:k,40:f},t(e,[2,7],{1:[2,1]}),t(e,[2,3]),{9:36,11:17,12:s,13:i,14:a,15:d,16:p,17:E,18:Y,19:18,20:C,21:b,22:F,23:w,24:_,25:P,26:A,27:x,28:I,29:O,30:L,31:N,33:R,35:$,36:v,37:24,38:k,40:f},t(e,[2,5]),t(e,[2,6]),t(e,[2,17]),t(e,[2,18]),t(e,[2,19]),t(e,[2,20]),t(e,[2,21]),t(e,[2,22]),t(e,[2,23]),t(e,[2,24]),t(e,[2,25]),t(e,[2,26]),t(e,[2,27]),{32:[1,37]},{34:[1,38]},t(e,[2,30]),t(e,[2,31]),t(e,[2,32]),{39:[1,39]},t(e,[2,8]),t(e,[2,9]),t(e,[2,10]),t(e,[2,11]),t(e,[2,12]),t(e,[2,13]),t(e,[2,14]),t(e,[2,15]),t(e,[2,16]),{41:[1,40],43:[1,41]},t(e,[2,4]),t(e,[2,28]),t(e,[2,29]),t(e,[2,33]),t(e,[2,34],{42:[1,42],43:[1,43]}),t(e,[2,40],{41:[1,44]}),t(e,[2,35],{43:[1,45]}),t(e,[2,36]),t(e,[2,38],{42:[1,46]}),t(e,[2,37]),t(e,[2,39])],defaultActions:{},parseError:u(function(l,y){if(y.recoverable)this.trace(l);else{var m=new Error(l);throw m.hash=y,m}},"parseError"),parse:u(function(l){var y=this,m=[0],h=[],S=[null],n=[],c=this.table,o="",D=0,W=0,M=0,V=2,z=1,ft=n.slice.call(arguments,1),H=Object.create(this.lexer),J={yy:{}};for(var rt in this.yy)Object.prototype.hasOwnProperty.call(this.yy,rt)&&(J.yy[rt]=this.yy[rt]);H.setInput(l,J.yy),J.yy.lexer=H,J.yy.parser=this,typeof H.yylloc>"u"&&(H.yylloc={});var at=H.yylloc;n.push(at);var ht=H.options&&H.options.ranges;typeof J.yy.parseError=="function"?this.parseError=J.yy.parseError:this.parseError=Object.getPrototypeOf(this).parseError;function mt(X){m.length=m.length-2*X,S.length=S.length-X,n.length=n.length-X}u(mt,"popStack");function ot(){var X=h.pop()||H.lex()||z;return typeof X!="number"&&(X instanceof Array&&(h=X,X=h.pop()),X=y.symbols_[X]||X),X}u(ot,"lex");for(var B,et,U,q,it,Z={},kt,K,qt,Tt;;){if(U=m[m.length-1],this.defaultActions[U]?q=this.defaultActions[U]:((B===null||typeof B>"u")&&(B=ot()),q=c[U]&&c[U][B]),typeof q>"u"||!q.length||!q[0]){var Et="";Tt=[];for(kt in c[U])this.terminals_[kt]&&kt>V&&Tt.push("'"+this.terminals_[kt]+"'");H.showPosition?Et="Parse error on line "+(D+1)+`:
`+H.showPosition()+`
Expecting `+Tt.join(", ")+", got '"+(this.terminals_[B]||B)+"'":Et="Parse error on line "+(D+1)+": Unexpected "+(B==z?"end of input":"'"+(this.terminals_[B]||B)+"'"),this.parseError(Et,{text:H.match,token:this.terminals_[B]||B,line:H.yylineno,loc:at,expected:Tt})}if(q[0]instanceof Array&&q.length>1)throw new Error("Parse Error: multiple actions possible at state: "+U+", token: "+B);switch(q[0]){case 1:m.push(B),S.push(H.yytext),n.push(H.yylloc),m.push(q[1]),B=null,et?(B=et,et=null):(W=H.yyleng,o=H.yytext,D=H.yylineno,at=H.yylloc,M>0&&M--);break;case 2:if(K=this.productions_[q[1]][1],Z.$=S[S.length-K],Z._$={first_line:n[n.length-(K||1)].first_line,last_line:n[n.length-1].last_line,first_column:n[n.length-(K||1)].first_column,last_column:n[n.length-1].last_column},ht&&(Z._$.range=[n[n.length-(K||1)].range[0],n[n.length-1].range[1]]),it=this.performAction.apply(Z,[o,W,D,J.yy,q[1],S,n].concat(ft)),typeof it<"u")return it;K&&(m=m.slice(0,-1*K*2),S=S.slice(0,-1*K),n=n.slice(0,-1*K)),m.push(this.productions_[q[1]][0]),S.push(Z.$),n.push(Z._$),qt=c[m[m.length-2]][m[m.length-1]],m.push(qt);break;case 3:return!0}}return!0},"parse")};T.lexer=(function(){return{EOF:1,parseError:u(function(l,y){if(this.yy.parser)this.yy.parser.parseError(l,y);else throw new Error(l)},"parseError"),setInput:u(function(r,l){return this.yy=l||this.yy||{},this._input=r,this._more=this._backtrack=this.done=!1,this.yylineno=this.yyleng=0,this.yytext=this.matched=this.match="",this.conditionStack=["INITIAL"],this.yylloc={first_line:1,first_column:0,last_line:1,last_column:0},this.options.ranges&&(this.yylloc.range=[0,0]),this.offset=0,this},"setInput"),input:u(function(){var r=this._input[0];return this.yytext+=r,this.yyleng++,this.offset++,this.match+=r,this.matched+=r,r.match(/(?:\r\n?|\n).*/g)?(this.yylineno++,this.yylloc.last_line++):this.yylloc.last_column++,this.options.ranges&&this.yylloc.range[1]++,this._input=this._input.slice(1),r},"input"),unput:u(function(r){var l=r.length,y=r.split(/(?:\r\n?|\n)/g);this._input=r+this._input,this.yytext=this.yytext.substr(0,this.yytext.length-l),this.offset-=l;var m=this.match.split(/(?:\r\n?|\n)/g);this.match=this.match.substr(0,this.match.length-1),this.matched=this.matched.substr(0,this.matched.length-1),y.length-1&&(this.yylineno-=y.length-1);var h=this.yylloc.range;return this.yylloc={first_line:this.yylloc.first_line,last_line:this.yylineno+1,first_column:this.yylloc.first_column,last_column:y?(y.length===m.length?this.yylloc.first_column:0)+m[m.length-y.length].length-y[0].length:this.yylloc.first_column-l},this.options.ranges&&(this.yylloc.range=[h[0],h[0]+this.yyleng-l]),this.yyleng=this.yytext.length,this},"unput"),more:u(function(){return this._more=!0,this},"more"),reject:u(function(){if(this.options.backtrack_lexer)this._backtrack=!0;else return this.parseError("Lexical error on line "+(this.yylineno+1)+`. You can only invoke reject() in the lexer when the lexer is of the backtracking persuasion (options.backtrack_lexer = true).
`+this.showPosition(),{text:"",token:null,line:this.yylineno});return this},"reject"),less:u(function(r){this.unput(this.match.slice(r))},"less"),pastInput:u(function(){var r=this.matched.substr(0,this.matched.length-this.match.length);return(r.length>20?"...":"")+r.substr(-20).replace(/\n/g,"")},"pastInput"),upcomingInput:u(function(){var r=this.match;return r.length<20&&(r+=this._input.substr(0,20-r.length)),(r.substr(0,20)+(r.length>20?"...":"")).replace(/\n/g,"")},"upcomingInput"),showPosition:u(function(){var r=this.pastInput(),l=new Array(r.length+1).join("-");return r+this.upcomingInput()+`
`+l+"^"},"showPosition"),test_match:u(function(r,l){var y,m,h;if(this.options.backtrack_lexer&&(h={yylineno:this.yylineno,yylloc:{first_line:this.yylloc.first_line,last_line:this.last_line,first_column:this.yylloc.first_column,last_column:this.yylloc.last_column},yytext:this.yytext,match:this.match,matches:this.matches,matched:this.matched,yyleng:this.yyleng,offset:this.offset,_more:this._more,_input:this._input,yy:this.yy,conditionStack:this.conditionStack.slice(0),done:this.done},this.options.ranges&&(h.yylloc.range=this.yylloc.range.slice(0))),m=r[0].match(/(?:\r\n?|\n).*/g),m&&(this.yylineno+=m.length),this.yylloc={first_line:this.yylloc.last_line,last_line:this.yylineno+1,first_column:this.yylloc.last_column,last_column:m?m[m.length-1].length-m[m.length-1].match(/\r?\n?/)[0].length:this.yylloc.last_column+r[0].length},this.yytext+=r[0],this.match+=r[0],this.matches=r,this.yyleng=this.yytext.length,this.options.ranges&&(this.yylloc.range=[this.offset,this.offset+=this.yyleng]),this._more=!1,this._backtrack=!1,this._input=this._input.slice(r[0].length),this.matched+=r[0],y=this.performAction.call(this,this.yy,this,l,this.conditionStack[this.conditionStack.length-1]),this.done&&this._input&&(this.done=!1),y)return y;if(this._backtrack){for(var S in h)this[S]=h[S];return!1}return!1},"test_match"),next:u(function(){if(this.done)return this.EOF;this._input||(this.done=!0);var r,l,y,m;this._more||(this.yytext="",this.match="");for(var h=this._currentRules(),S=0;S<h.length;S++)if(y=this._input.match(this.rules[h[S]]),y&&(!l||y[0].length>l[0].length)){if(l=y,m=S,this.options.backtrack_lexer){if(r=this.test_match(y,h[S]),r!==!1)return r;if(this._backtrack){l=!1;continue}else return!1}else if(!this.options.flex)break}return l?(r=this.test_match(l,h[m]),r!==!1?r:!1):this._input===""?this.EOF:this.parseError("Lexical error on line "+(this.yylineno+1)+`. Unrecognized text.
`+this.showPosition(),{text:"",token:null,line:this.yylineno})},"next"),lex:u(function(){var l=this.next();return l||this.lex()},"lex"),begin:u(function(l){this.conditionStack.push(l)},"begin"),popState:u(function(){return this.conditionStack.length-1>0?this.conditionStack.pop():this.conditionStack[0]},"popState"),_currentRules:u(function(){return this.conditionStack.length&&this.conditionStack[this.conditionStack.length-1]?this.conditions[this.conditionStack[this.conditionStack.length-1]].rules:this.conditions.INITIAL.rules},"_currentRules"),topState:u(function(l){return l=this.conditionStack.length-1-Math.abs(l||0),l>=0?this.conditionStack[l]:"INITIAL"},"topState"),pushState:u(function(l){this.begin(l)},"pushState"),stateStackSize:u(function(){return this.conditionStack.length},"stateStackSize"),options:{"case-insensitive":!0},performAction:u(function(l,y,m,h){switch(m){case 0:return this.begin("open_directive"),"open_directive";case 1:return this.begin("acc_title"),31;case 2:return this.popState(),"acc_title_value";case 3:return this.begin("acc_descr"),33;case 4:return this.popState(),"acc_descr_value";case 5:this.begin("acc_descr_multiline");break;case 6:this.popState();break;case 7:return"acc_descr_multiline_value";case 8:break;case 9:break;case 10:break;case 11:return 10;case 12:break;case 13:break;case 14:this.begin("href");break;case 15:this.popState();break;case 16:return 43;case 17:this.begin("callbackname");break;case 18:this.popState();break;case 19:this.popState(),this.begin("callbackargs");break;case 20:return 41;case 21:this.popState();break;case 22:return 42;case 23:this.begin("click");break;case 24:this.popState();break;case 25:return 40;case 26:return 4;case 27:return 22;case 28:return 23;case 29:return 24;case 30:return 25;case 31:return 26;case 32:return 28;case 33:return 27;case 34:return 29;case 35:return 12;case 36:return 13;case 37:return 14;case 38:return 15;case 39:return 16;case 40:return 17;case 41:return 18;case 42:return 20;case 43:return 21;case 44:return"date";case 45:return 30;case 46:return"accDescription";case 47:return 36;case 48:return 38;case 49:return 39;case 50:return":";case 51:return 6;case 52:return"INVALID"}},"anonymous"),rules:[/^(?:%%\{)/i,/^(?:accTitle\s*:\s*)/i,/^(?:(?!\n||)*[^\n]*)/i,/^(?:accDescr\s*:\s*)/i,/^(?:(?!\n||)*[^\n]*)/i,/^(?:accDescr\s*\{\s*)/i,/^(?:[\}])/i,/^(?:[^\}]*)/i,/^(?:%%(?!\{)*[^\n]*)/i,/^(?:[^\}]%%*[^\n]*)/i,/^(?:%%*[^\n]*[\n]*)/i,/^(?:[\n]+)/i,/^(?:\s+)/i,/^(?:%[^\n]*)/i,/^(?:href[\s]+["])/i,/^(?:["])/i,/^(?:[^"]*)/i,/^(?:call[\s]+)/i,/^(?:\([\s]*\))/i,/^(?:\()/i,/^(?:[^(]*)/i,/^(?:\))/i,/^(?:[^)]*)/i,/^(?:click[\s]+)/i,/^(?:[\s\n])/i,/^(?:[^\s\n]*)/i,/^(?:gantt\b)/i,/^(?:dateFormat\s[^#\n;]+)/i,/^(?:inclusiveEndDates\b)/i,/^(?:topAxis\b)/i,/^(?:axisFormat\s[^#\n;]+)/i,/^(?:tickInterval\s[^#\n;]+)/i,/^(?:includes\s[^#\n;]+)/i,/^(?:excludes\s[^#\n;]+)/i,/^(?:todayMarker\s[^\n;]+)/i,/^(?:weekday\s+monday\b)/i,/^(?:weekday\s+tuesday\b)/i,/^(?:weekday\s+wednesday\b)/i,/^(?:weekday\s+thursday\b)/i,/^(?:weekday\s+friday\b)/i,/^(?:weekday\s+saturday\b)/i,/^(?:weekday\s+sunday\b)/i,/^(?:weekend\s+friday\b)/i,/^(?:weekend\s+saturday\b)/i,/^(?:\d\d\d\d-\d\d-\d\d\b)/i,/^(?:title\s[^\n]+)/i,/^(?:accDescription\s[^#\n;]+)/i,/^(?:section\s[^\n]+)/i,/^(?:[^:\n]+)/i,/^(?::[^#\n;]+)/i,/^(?::)/i,/^(?:$)/i,/^(?:.)/i],conditions:{acc_descr_multiline:{rules:[6,7],inclusive:!1},acc_descr:{rules:[4],inclusive:!1},acc_title:{rules:[2],inclusive:!1},callbackargs:{rules:[21,22],inclusive:!1},callbackname:{rules:[18,19,20],inclusive:!1},href:{rules:[15,16],inclusive:!1},click:{rules:[24,25],inclusive:!1},INITIAL:{rules:[0,1,3,5,8,9,10,11,12,13,14,17,23,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52],inclusive:!0}}}})();function g(){this.yy={}}return u(g,"Parser"),g.prototype=T,T.Parser=g,new g})();Yt.parser=Yt;var ei=Yt;G.default.extend(Qe.default);G.default.extend(Je.default);G.default.extend(Ke.default);var ie={friday:5,saturday:6},Q="",Wt="",Vt=void 0,zt="",gt=[],pt=[],Pt=new Map,Nt=[],St=[],dt="",Rt="",ae=["active","done","crit","milestone","vert"],Ht=[],ct="",vt=!1,Bt=!1,jt="sunday",Ct="saturday",Lt=0,ii=u(function(){Nt=[],St=[],dt="",Ht=[],_t=0,Ot=void 0,Dt=void 0,j=[],Q="",Wt="",Rt="",Vt=void 0,zt="",gt=[],pt=[],vt=!1,Bt=!1,Lt=0,Pt=new Map,ct="",Te(),jt="sunday",Ct="saturday"},"clear"),ni=u(function(t){ct=t},"setDiagramId"),si=u(function(t){Wt=t},"setAxisFormat"),ri=u(function(){return Wt},"getAxisFormat"),ai=u(function(t){Vt=t},"setTickInterval"),oi=u(function(){return Vt},"getTickInterval"),ci=u(function(t){zt=t},"setTodayMarker"),li=u(function(){return zt},"getTodayMarker"),ui=u(function(t){Q=t},"setDateFormat"),di=u(function(){vt=!0},"enableInclusiveEndDates"),fi=u(function(){return vt},"endDatesAreInclusive"),hi=u(function(){Bt=!0},"enableTopAxis"),mi=u(function(){return Bt},"topAxisEnabled"),ki=u(function(t){Rt=t},"setDisplayMode"),yi=u(function(){return Rt},"getDisplayMode"),gi=u(function(){return Q},"getDateFormat"),pi=u(function(t){gt=t.toLowerCase().split(/[\s,]+/)},"setIncludes"),vi=u(function(){return gt},"getIncludes"),Ti=u(function(t){pt=t.toLowerCase().split(/[\s,]+/)},"setExcludes"),xi=u(function(){return pt},"getExcludes"),bi=u(function(){return Pt},"getLinks"),wi=u(function(t){dt=t,Nt.push(t)},"addSection"),_i=u(function(){return Nt},"getSections"),Di=u(function(){let t=ne();const e=10;let s=0;for(;!t&&s<e;)t=ne(),s++;return St=j,St},"getTasks"),oe=u(function(t,e,s,i){const a=t.format(e.trim()),d=t.format("YYYY-MM-DD");return i.includes(a)||i.includes(d)?!1:s.includes("weekends")&&(t.isoWeekday()===ie[Ct]||t.isoWeekday()===ie[Ct]+1)||s.includes(t.format("dddd").toLowerCase())?!0:s.includes(a)||s.includes(d)},"isInvalidDate"),Si=u(function(t){jt=t},"setWeekday"),Ci=u(function(){return jt},"getWeekday"),Mi=u(function(t){Ct=t},"setWeekend"),ce=u(function(t,e,s,i){if(!s.length||t.manualEndTime)return;let a;t.startTime instanceof Date?a=(0,G.default)(t.startTime):a=(0,G.default)(t.startTime,e,!0),a=a.add(1,"d");let d;t.endTime instanceof Date?d=(0,G.default)(t.endTime):d=(0,G.default)(t.endTime,e,!0);const[p,E]=Ei(a,d,e,s,i);t.endTime=p.toDate(),t.renderEndTime=E},"checkTaskDates"),Ei=u(function(t,e,s,i,a){let d=!1,p=null;for(;t<=e;)d||(p=e.toDate()),d=oe(t,s,i,a),d&&(e=e.add(1,"d")),t=t.add(1,"d");return[e,p]},"fixTaskDates"),Ft=u(function(t,e,s){if(s=s.trim(),u(d=>{const p=d.trim();return p==="x"||p==="X"},"isTimestampFormat")(e)&&/^\d+$/.test(s))return new Date(Number(s));const i=/^after\s+(?<ids>[\d\w- ]+)/.exec(s);if(i!==null){let d=null;for(const E of i.groups.ids.split(" ")){let Y=st(E);Y!==void 0&&(!d||Y.endTime>d.endTime)&&(d=Y)}if(d)return d.endTime;const p=new Date;return p.setHours(0,0,0,0),p}let a=(0,G.default)(s,e.trim(),!0);if(a.isValid())return a.toDate();{nt.debug("Invalid date:"+s),nt.debug("With date format:"+e.trim());const d=new Date(s);if(d===void 0||isNaN(d.getTime())||d.getFullYear()<-1e4||d.getFullYear()>1e4)throw new Error("Invalid date:"+s);return d}},"getStartDate"),le=u(function(t){const e=/^(\d+(?:\.\d+)?)([Mdhmswy]|ms)$/.exec(t.trim());return e!==null?[Number.parseFloat(e[1]),e[2]]:[NaN,"ms"]},"parseDuration"),ue=u(function(t,e,s,i=!1){s=s.trim();const a=/^until\s+(?<ids>[\d\w- ]+)/.exec(s);if(a!==null){let C=null;for(const F of a.groups.ids.split(" ")){let w=st(F);w!==void 0&&(!C||w.startTime<C.startTime)&&(C=w)}if(C)return C.startTime;const b=new Date;return b.setHours(0,0,0,0),b}let d=(0,G.default)(s,e.trim(),!0);if(d.isValid())return i&&(d=d.add(1,"d")),d.toDate();let p=(0,G.default)(t);const[E,Y]=le(s);if(!Number.isNaN(E)){const C=p.add(E,Y);C.isValid()&&(p=C)}return p.toDate()},"getEndDate"),_t=0,ut=u(function(t){return t===void 0?(_t=_t+1,"task"+_t):t},"parseId"),Ii=u(function(t,e){let s;e.substr(0,1)===":"?s=e.substr(1,e.length):s=e;const i=s.split(","),a={};Gt(i,a,ae);for(let p=0;p<i.length;p++)i[p]=i[p].trim();let d="";switch(i.length){case 1:a.id=ut(),a.startTime=t.endTime,d=i[0];break;case 2:a.id=ut(),a.startTime=Ft(void 0,Q,i[0]),d=i[1];break;case 3:a.id=ut(i[0]),a.startTime=Ft(void 0,Q,i[1]),d=i[2];break;default:}return d&&(a.endTime=ue(a.startTime,Q,d,vt),a.manualEndTime=(0,G.default)(d,"YYYY-MM-DD",!0).isValid(),ce(a,Q,pt,gt)),a},"compileData"),Ai=u(function(t,e){let s;e.substr(0,1)===":"?s=e.substr(1,e.length):s=e;const i=s.split(","),a={};Gt(i,a,ae);for(let d=0;d<i.length;d++)i[d]=i[d].trim();switch(i.length){case 1:a.id=ut(),a.startTime={type:"prevTaskEnd",id:t},a.endTime={data:i[0]};break;case 2:a.id=ut(),a.startTime={type:"getStartDate",startData:i[0]},a.endTime={data:i[1]};break;case 3:a.id=ut(i[0]),a.startTime={type:"getStartDate",startData:i[1]},a.endTime={data:i[2]};break;default:}return a},"parseData"),Ot,Dt,j=[],de={},$i=u(function(t,e){const s={section:dt,type:dt,processed:!1,manualEndTime:!1,renderEndTime:null,raw:{data:e},task:t,classes:[]},i=Ai(Dt,e);s.raw.startTime=i.startTime,s.raw.endTime=i.endTime,s.id=i.id,s.prevTaskId=Dt,s.active=i.active,s.done=i.done,s.crit=i.crit,s.milestone=i.milestone,s.vert=i.vert,s.order=Lt,Lt++;const a=j.push(s);Dt=s.id,de[s.id]=a-1},"addTask"),st=u(function(t){const e=de[t];return j[e]},"findTaskById"),Yi=u(function(t,e){const s={section:dt,type:dt,description:t,task:t,classes:[]},i=Ii(Ot,e);s.startTime=i.startTime,s.endTime=i.endTime,s.id=i.id,s.active=i.active,s.done=i.done,s.crit=i.crit,s.milestone=i.milestone,s.vert=i.vert,Ot=s,St.push(s)},"addTaskOrg"),ne=u(function(){const t=u(function(s){const i=j[s];let a="";switch(j[s].raw.startTime.type){case"prevTaskEnd":i.startTime=st(i.prevTaskId).endTime;break;case"getStartDate":a=Ft(void 0,Q,j[s].raw.startTime.startData),a&&(j[s].startTime=a);break}return j[s].startTime&&(j[s].endTime=ue(j[s].startTime,Q,j[s].raw.endTime.data,vt),j[s].endTime&&(j[s].processed=!0,j[s].manualEndTime=(0,G.default)(j[s].raw.endTime.data,"YYYY-MM-DD",!0).isValid(),ce(j[s],Q,pt,gt))),j[s].processed},"compileTask");let e=!0;for(const[s,i]of j.entries())t(s),e=e&&i.processed;return e},"compileTasks"),Li=u(function(t,e){let s=e;lt().securityLevel!=="loose"&&(s=(0,Ze.sanitizeUrl)(e)),t.split(",").forEach(function(i){st(i)!==void 0&&(he(i,()=>{window.open(s,"_self")}),Pt.set(i,s))}),fe(t,"clickable")},"setLink"),fe=u(function(t,e){t.split(",").forEach(function(s){let i=st(s);i!==void 0&&i.classes.push(e)})},"setClass"),Fi=u(function(t,e,s){if(lt().securityLevel!=="loose"||e===void 0)return;let i=[];if(typeof s=="string"){i=s.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);for(let a=0;a<i.length;a++){let d=i[a].trim();d.startsWith('"')&&d.endsWith('"')&&(d=d.substr(1,d.length-2)),i[a]=d}}i.length===0&&i.push(t),st(t)!==void 0&&he(t,()=>{Oe.runFunc(e,...i)})},"setClickFun"),he=u(function(t,e){Ht.push(function(){const s=ct?`${ct}-${t}`:t,i=document.querySelector(`[id="${s}"]`);i!==null&&i.addEventListener("click",function(){e()})},function(){const s=ct?`${ct}-${t}`:t,i=document.querySelector(`[id="${s}-text"]`);i!==null&&i.addEventListener("click",function(){e()})})},"pushFun"),Oi={getConfig:u(()=>lt().gantt,"getConfig"),clear:ii,setDateFormat:ui,getDateFormat:gi,enableInclusiveEndDates:di,endDatesAreInclusive:fi,enableTopAxis:hi,topAxisEnabled:mi,setAxisFormat:si,getAxisFormat:ri,setTickInterval:ai,getTickInterval:oi,setTodayMarker:ci,getTodayMarker:li,setAccTitle:ge,getAccTitle:we,setDiagramTitle:pe,getDiagramTitle:ye,setDiagramId:ni,setDisplayMode:ki,getDisplayMode:yi,setAccDescription:ke,getAccDescription:ve,addSection:wi,getSections:_i,getTasks:Di,addTask:$i,findTaskById:st,addTaskOrg:Yi,setIncludes:pi,getIncludes:vi,setExcludes:Ti,getExcludes:xi,setClickEvent:u(function(t,e,s){t.split(",").forEach(function(i){Fi(i,e,s)}),fe(t,"clickable")},"setClickEvent"),setLink:Li,getLinks:bi,bindFunctions:u(function(t){Ht.forEach(function(e){e(t)})},"bindFunctions"),parseDuration:le,isInvalidDate:oe,setWeekday:Si,getWeekday:Ci,setWeekend:Mi};function Gt(t,e,s){let i=!0;for(;i;)i=!1,s.forEach(function(a){const d="^\\s*"+a+"\\s*$",p=new RegExp(d);t[0].match(p)&&(e[a]=!0,t.shift(1),i=!0)})}u(Gt,"getTaskTags");G.default.extend(ti.default);var Wi=u(function(){nt.debug("Something is calling, setConf, remove the call")},"setConf"),se={monday:Ee,tuesday:Le,wednesday:Ce,thursday:Ye,friday:Ae,saturday:Me,sunday:Se},Vi=u((t,e)=>{let s=[...t].map(()=>-1/0),i=[...t].sort((d,p)=>d.startTime-p.startTime||d.order-p.order),a=0;for(const d of i)for(let p=0;p<s.length;p++)if(d.startTime>=s[p]){s[p]=d.endTime,d.order=p+e,p>a&&(a=p);break}return a},"getMaxIntersections"),tt,At=1e4,qi={parser:ei,db:Oi,renderer:{setConf:Wi,draw:u(function(t,e,s,i){const a=lt().gantt;i.db.setDiagramId(e);const d=lt().securityLevel;let p;d==="sandbox"&&(p=xt("#i"+e));const E=d==="sandbox"?xt(p.nodes()[0].contentDocument.body):xt("body"),Y=d==="sandbox"?p.nodes()[0].contentDocument:document,C=Y.getElementById(e);tt=C.parentElement.offsetWidth,tt===void 0&&(tt=1200),a.useWidth!==void 0&&(tt=a.useWidth);const b=i.db.getTasks();let F=[];for(const f of b)F.push(f.type);F=k(F);const w={};let _=2*a.topPadding;if(i.db.getDisplayMode()==="compact"||a.displayMode==="compact"){const f={};for(const g of b)f[g.section]===void 0?f[g.section]=[g]:f[g.section].push(g);let T=0;for(const g of Object.keys(f)){const r=Vi(f[g],T)+1;T+=r,_+=r*(a.barHeight+a.barGap),w[g]=r}}else{_+=b.length*(a.barHeight+a.barGap);for(const f of F)w[f]=b.filter(T=>T.type===f).length}C.setAttribute("viewBox","0 0 "+tt+" "+_);const P=E.select(`[id="${e}"]`),A=$e().domain([Ie(b,function(f){return f.startTime}),De(b,function(f){return f.endTime})]).rangeRound([0,tt-a.leftPadding-a.rightPadding]);function x(f,T){const g=f.startTime,r=T.startTime;let l=0;return g>r?l=1:g<r&&(l=-1),l}u(x,"taskCompare"),b.sort(x),I(b,tt,_),xe(P,_,tt,a.useMaxWidth),P.append("text").text(i.db.getDiagramTitle()).attr("x",tt/2).attr("y",a.titleTopMargin).attr("class","titleText");function I(f,T,g){const r=a.barHeight,l=r+a.barGap,y=a.topPadding,m=a.leftPadding,h=_e().domain([0,F.length]).range(["#00B9FA","#F95002"]).interpolate(Fe);L(l,y,m,T,g,f,i.db.getExcludes(),i.db.getIncludes()),R(m,y,T,g),O(f,l,y,m,r,h,T,g),$(l,y,m,r,h),v(m,y,T,g)}u(I,"makeGantt");function O(f,T,g,r,l,y,m){f.sort((c,o)=>c.vert===o.vert?0:c.vert?1:-1);const h=[...new Set(f.map(c=>c.order))].map(c=>f.find(o=>o.order===c));P.append("g").selectAll("rect").data(h).enter().append("rect").attr("x",0).attr("y",function(c,o){return o=c.order,o*T+g-2}).attr("width",function(){return m-a.rightPadding/2}).attr("height",T).attr("class",function(c){for(const[o,D]of F.entries())if(c.type===D)return"section section"+o%a.numberSectionStyles;return"section section0"}).enter();const S=P.append("g").selectAll("rect").data(f).enter(),n=i.db.getLinks();if(S.append("rect").attr("id",function(c){return e+"-"+c.id}).attr("rx",3).attr("ry",3).attr("x",function(c){return c.milestone?A(c.startTime)+r+.5*(A(c.endTime)-A(c.startTime))-.5*l:A(c.startTime)+r}).attr("y",function(c,o){return o=c.order,c.vert?a.gridLineStartPadding:o*T+g}).attr("width",function(c){return c.milestone?l:c.vert?.08*l:A(c.renderEndTime||c.endTime)-A(c.startTime)}).attr("height",function(c){return c.vert?b.length*(a.barHeight+a.barGap)+a.barHeight*2:l}).attr("transform-origin",function(c,o){return o=c.order,(A(c.startTime)+r+.5*(A(c.endTime)-A(c.startTime))).toString()+"px "+(o*T+g+.5*l).toString()+"px"}).attr("class",function(c){const o="task";let D="";c.classes.length>0&&(D=c.classes.join(" "));let W=0;for(const[V,z]of F.entries())c.type===z&&(W=V%a.numberSectionStyles);let M="";return c.active?c.crit?M+=" activeCrit":M=" active":c.done?c.crit?M=" doneCrit":M=" done":c.crit&&(M+=" crit"),M.length===0&&(M=" task"),c.milestone&&(M=" milestone "+M),c.vert&&(M=" vert "+M),M+=W,M+=" "+D,o+M}),S.append("text").attr("id",function(c){return e+"-"+c.id+"-text"}).text(function(c){return c.task}).attr("font-size",a.fontSize).attr("x",function(c){let o=A(c.startTime),D=A(c.renderEndTime||c.endTime);if(c.milestone&&(o+=.5*(A(c.endTime)-A(c.startTime))-.5*l,D=o+l),c.vert)return A(c.startTime)+r;const W=this.getBBox().width;return W>D-o?D+W+1.5*a.leftPadding>m?o+r-5:D+r+5:(D-o)/2+o+r}).attr("y",function(c,o){return c.vert?a.gridLineStartPadding+b.length*(a.barHeight+a.barGap)+60:(o=c.order,o*T+a.barHeight/2+(a.fontSize/2-2)+g)}).attr("text-height",l).attr("class",function(c){const o=A(c.startTime);let D=A(c.endTime);c.milestone&&(D=o+l);const W=this.getBBox().width;let M="";c.classes.length>0&&(M=c.classes.join(" "));let V=0;for(const[ft,H]of F.entries())c.type===H&&(V=ft%a.numberSectionStyles);let z="";return c.active&&(c.crit?z="activeCritText"+V:z="activeText"+V),c.done?c.crit?z=z+" doneCritText"+V:z=z+" doneText"+V:c.crit&&(z=z+" critText"+V),c.milestone&&(z+=" milestoneText"),c.vert&&(z+=" vertText"),W>D-o?D+W+1.5*a.leftPadding>m?M+" taskTextOutsideLeft taskTextOutside"+V+" "+z:M+" taskTextOutsideRight taskTextOutside"+V+" "+z+" width-"+W:M+" taskText taskText"+V+" "+z+" width-"+W}),lt().securityLevel==="sandbox"){let c;c=xt("#i"+e);const o=c.nodes()[0].contentDocument;S.filter(function(D){return n.has(D.id)}).each(function(D){var W=o.querySelector("#"+CSS.escape(e+"-"+D.id)),M=o.querySelector("#"+CSS.escape(e+"-"+D.id+"-text"));const V=W.parentNode;var z=o.createElement("a");z.setAttribute("xlink:href",n.get(D.id)),z.setAttribute("target","_top"),V.appendChild(z),z.appendChild(W),z.appendChild(M)})}}u(O,"drawRects");function L(f,T,g,r,l,y,m,h){if(m.length===0&&h.length===0)return;let S,n;for(const{startTime:M,endTime:V}of y)(S===void 0||M<S)&&(S=M),(n===void 0||V>n)&&(n=V);if(!S||!n)return;if((0,G.default)(n).diff((0,G.default)(S),"year")>5){nt.warn("The difference between the min and max time is more than 5 years. This will cause performance issues. Skipping drawing exclude days.");return}const c=i.db.getDateFormat(),o=[];let D=null,W=(0,G.default)(S);for(;W.valueOf()<=n;)i.db.isInvalidDate(W,c,m,h)?D?D.end=W:D={start:W,end:W}:D&&(o.push(D),D=null),W=W.add(1,"d");P.append("g").selectAll("rect").data(o).enter().append("rect").attr("id",M=>e+"-exclude-"+M.start.format("YYYY-MM-DD")).attr("x",M=>A(M.start.startOf("day"))+g).attr("y",a.gridLineStartPadding).attr("width",M=>A(M.end.endOf("day"))-A(M.start.startOf("day"))).attr("height",l-T-a.gridLineStartPadding).attr("transform-origin",function(M,V){return(A(M.start)+g+.5*(A(M.end)-A(M.start))).toString()+"px "+(V*f+.5*l).toString()+"px"}).attr("class","exclude-range")}u(L,"drawExcludeDays");function N(f,T,g,r){if(g<=0||f>T)return 1/0;const l=T-f,y=G.default.duration({[r??"day"]:g}).asMilliseconds();return y<=0?1/0:Math.ceil(l/y)}u(N,"getEstimatedTickCount");function R(f,T,g,r){const l=i.db.getDateFormat(),y=i.db.getAxisFormat();let m;y?m=y:l==="D"?m="%d":m=a.axisFormat??"%Y-%m-%d";let h=je(A).tickSize(-r+T+a.gridLineStartPadding).tickFormat(Kt(m));const S=/^([1-9]\d*)(millisecond|second|minute|hour|day|week|month)$/.exec(i.db.getTickInterval()||a.tickInterval);if(S!==null){const n=parseInt(S[1],10);if(isNaN(n)||n<=0)nt.warn(`Invalid tick interval value: "${S[1]}". Skipping custom tick interval.`);else{const c=S[2],o=i.db.getWeekday()||a.weekday,D=A.domain(),W=D[0],M=D[1],V=N(W,M,n,c);if(V>At)nt.warn(`The tick interval "${n}${c}" would generate ${V} ticks, which exceeds the maximum allowed (${At}). This may indicate an invalid date or time range. Skipping custom tick interval.`);else switch(c){case"millisecond":h.ticks(Jt.every(n));break;case"second":h.ticks(Ut.every(n));break;case"minute":h.ticks(Xt.every(n));break;case"hour":h.ticks(te.every(n));break;case"day":h.ticks(Zt.every(n));break;case"week":h.ticks(se[o].every(n));break;case"month":h.ticks(Qt.every(n));break}}}if(P.append("g").attr("class","grid").attr("transform","translate("+f+", "+(r-50)+")").call(h).selectAll("text").style("text-anchor","middle").attr("fill","#000").attr("stroke","none").attr("font-size",10).attr("dy","1em"),i.db.topAxisEnabled()||a.topAxis){let n=Be(A).tickSize(-r+T+a.gridLineStartPadding).tickFormat(Kt(m));if(S!==null){const c=parseInt(S[1],10);if(isNaN(c)||c<=0)nt.warn(`Invalid tick interval value: "${S[1]}". Skipping custom tick interval.`);else{const o=S[2],D=i.db.getWeekday()||a.weekday,W=A.domain(),M=W[0],V=W[1];if(N(M,V,c,o)<=At)switch(o){case"millisecond":n.ticks(Jt.every(c));break;case"second":n.ticks(Ut.every(c));break;case"minute":n.ticks(Xt.every(c));break;case"hour":n.ticks(te.every(c));break;case"day":n.ticks(Zt.every(c));break;case"week":n.ticks(se[D].every(c));break;case"month":n.ticks(Qt.every(c));break}}}P.append("g").attr("class","grid").attr("transform","translate("+f+", "+T+")").call(n).selectAll("text").style("text-anchor","middle").attr("fill","#000").attr("stroke","none").attr("font-size",10)}}u(R,"makeGrid");function $(f,T){let g=0;const r=Object.keys(w).map(l=>[l,w[l]]);P.append("g").selectAll("text").data(r).enter().append(function(l){const y=l[0].split(be.lineBreakRegex),m=-(y.length-1)/2,h=Y.createElementNS("http://www.w3.org/2000/svg","text");h.setAttribute("dy",m+"em");for(const[S,n]of y.entries()){const c=Y.createElementNS("http://www.w3.org/2000/svg","tspan");c.setAttribute("alignment-baseline","central"),c.setAttribute("x","10"),S>0&&c.setAttribute("dy","1em"),c.textContent=n,h.appendChild(c)}return h}).attr("x",10).attr("y",function(l,y){if(y>0)for(let m=0;m<y;m++)return g+=r[y-1][1],l[1]*f/2+g*f+T;else return l[1]*f/2+T}).attr("font-size",a.sectionFontSize).attr("class",function(l){for(const[y,m]of F.entries())if(l[0]===m)return"sectionTitle sectionTitle"+y%a.numberSectionStyles;return"sectionTitle"})}u($,"vertLabels");function v(f,T,g,r){const l=i.db.getTodayMarker();if(l==="off")return;const y=P.append("g").attr("class","today"),m=new Date,h=y.append("line");h.attr("x1",A(m)+f).attr("x2",A(m)+f).attr("y1",a.titleTopMargin).attr("y2",r-a.titleTopMargin).attr("class","today"),l!==""&&h.attr("style",l.replace(/,/g,";"))}u(v,"drawToday");function k(f){const T={},g=[];for(let r=0,l=f.length;r<l;++r)Object.prototype.hasOwnProperty.call(T,f[r])||(T[f[r]]=!0,g.push(f[r]));return g}u(k,"checkUnique")},"draw")},styles:u(t=>`
  .mermaid-main-font {
        font-family: ${t.fontFamily};
  }

  .exclude-range {
    fill: ${t.excludeBkgColor};
  }

  .section {
    stroke: none;
    opacity: 0.2;
  }

  .section0 {
    fill: ${t.sectionBkgColor};
  }

  .section2 {
    fill: ${t.sectionBkgColor2};
  }

  .section1,
  .section3 {
    fill: ${t.altSectionBkgColor};
    opacity: 0.2;
  }

  .sectionTitle0 {
    fill: ${t.titleColor};
  }

  .sectionTitle1 {
    fill: ${t.titleColor};
  }

  .sectionTitle2 {
    fill: ${t.titleColor};
  }

  .sectionTitle3 {
    fill: ${t.titleColor};
  }

  .sectionTitle {
    text-anchor: start;
    font-family: ${t.fontFamily};
  }


  /* Grid and axis */

  .grid .tick {
    stroke: ${t.gridColor};
    opacity: 0.8;
    shape-rendering: crispEdges;
  }

  .grid .tick text {
    font-family: ${t.fontFamily};
    fill: ${t.textColor};
  }

  .grid path {
    stroke-width: 0;
  }


  /* Today line */

  .today {
    fill: none;
    stroke: ${t.todayLineColor};
    stroke-width: 2px;
  }


  /* Task styling */

  /* Default task */

  .task {
    stroke-width: 2;
  }

  .taskText {
    text-anchor: middle;
    font-family: ${t.fontFamily};
  }

  .taskTextOutsideRight {
    fill: ${t.taskTextDarkColor};
    text-anchor: start;
    font-family: ${t.fontFamily};
  }

  .taskTextOutsideLeft {
    fill: ${t.taskTextDarkColor};
    text-anchor: end;
  }


  /* Special case clickable */

  .task.clickable {
    cursor: pointer;
  }

  .taskText.clickable {
    cursor: pointer;
    fill: ${t.taskTextClickableColor} !important;
    font-weight: bold;
  }

  .taskTextOutsideLeft.clickable {
    cursor: pointer;
    fill: ${t.taskTextClickableColor} !important;
    font-weight: bold;
  }

  .taskTextOutsideRight.clickable {
    cursor: pointer;
    fill: ${t.taskTextClickableColor} !important;
    font-weight: bold;
  }


  /* Specific task settings for the sections*/

  .taskText0,
  .taskText1,
  .taskText2,
  .taskText3 {
    fill: ${t.taskTextColor};
  }

  .task0,
  .task1,
  .task2,
  .task3 {
    fill: ${t.taskBkgColor};
    stroke: ${t.taskBorderColor};
  }

  .taskTextOutside0,
  .taskTextOutside2
  {
    fill: ${t.taskTextOutsideColor};
  }

  .taskTextOutside1,
  .taskTextOutside3 {
    fill: ${t.taskTextOutsideColor};
  }


  /* Active task */

  .active0,
  .active1,
  .active2,
  .active3 {
    fill: ${t.activeTaskBkgColor};
    stroke: ${t.activeTaskBorderColor};
  }

  .activeText0,
  .activeText1,
  .activeText2,
  .activeText3 {
    fill: ${t.taskTextDarkColor} !important;
  }


  /* Completed task */

  .done0,
  .done1,
  .done2,
  .done3 {
    stroke: ${t.doneTaskBorderColor};
    fill: ${t.doneTaskBkgColor};
    stroke-width: 2;
  }

  .doneText0,
  .doneText1,
  .doneText2,
  .doneText3 {
    fill: ${t.taskTextDarkColor} !important;
  }

  /* Done task text displayed outside the bar sits against the diagram background,
     not against the done-task bar, so it must use the outside/contrast color. */
  .doneText0.taskTextOutsideLeft,
  .doneText0.taskTextOutsideRight,
  .doneText1.taskTextOutsideLeft,
  .doneText1.taskTextOutsideRight,
  .doneText2.taskTextOutsideLeft,
  .doneText2.taskTextOutsideRight,
  .doneText3.taskTextOutsideLeft,
  .doneText3.taskTextOutsideRight {
    fill: ${t.taskTextOutsideColor} !important;
  }


  /* Tasks on the critical line */

  .crit0,
  .crit1,
  .crit2,
  .crit3 {
    stroke: ${t.critBorderColor};
    fill: ${t.critBkgColor};
    stroke-width: 2;
  }

  .activeCrit0,
  .activeCrit1,
  .activeCrit2,
  .activeCrit3 {
    stroke: ${t.critBorderColor};
    fill: ${t.activeTaskBkgColor};
    stroke-width: 2;
  }

  .doneCrit0,
  .doneCrit1,
  .doneCrit2,
  .doneCrit3 {
    stroke: ${t.critBorderColor};
    fill: ${t.doneTaskBkgColor};
    stroke-width: 2;
    cursor: pointer;
    shape-rendering: crispEdges;
  }

  .milestone {
    transform: rotate(45deg) scale(0.8,0.8);
  }

  .milestoneText {
    font-style: italic;
  }
  .doneCritText0,
  .doneCritText1,
  .doneCritText2,
  .doneCritText3 {
    fill: ${t.taskTextDarkColor} !important;
  }

  /* Done-crit task text outside the bar — same reasoning as doneText above. */
  .doneCritText0.taskTextOutsideLeft,
  .doneCritText0.taskTextOutsideRight,
  .doneCritText1.taskTextOutsideLeft,
  .doneCritText1.taskTextOutsideRight,
  .doneCritText2.taskTextOutsideLeft,
  .doneCritText2.taskTextOutsideRight,
  .doneCritText3.taskTextOutsideLeft,
  .doneCritText3.taskTextOutsideRight {
    fill: ${t.taskTextOutsideColor} !important;
  }

  .vert {
    stroke: ${t.vertLineColor};
  }

  .vertText {
    font-size: 15px;
    text-anchor: middle;
    fill: ${t.vertLineColor} !important;
  }

  .activeCritText0,
  .activeCritText1,
  .activeCritText2,
  .activeCritText3 {
    fill: ${t.taskTextDarkColor} !important;
  }

  .titleText {
    text-anchor: middle;
    font-size: 18px;
    fill: ${t.titleColor||t.textColor};
    font-family: ${t.fontFamily};
  }
`,"getStyles")};export{qi as diagram};
