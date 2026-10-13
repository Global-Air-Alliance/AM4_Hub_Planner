/* AM4 Hub Planner – which routes from your hub earn the most, and with which aircraft
 * Page: globalairall.net/tools/am4hub.html (website repository, Bootstrap Studio)
 * Needs: ../shared_resources/am4.js (aircraft list, game data, formatting) loaded first.
 * All visible texts generated here come from AM4.strings() – the page can override (and
 * Linguise can translate) every text via <div id="am4-strings">.
 */
(function(){
'use strict';
if(!window.AM4){console.error('AM4 Hub Planner: shared_resources/am4.js is missing');return}
const {AIRCRAFT:AC,nf,num,fpd,money,esc,tpl}=AM4;
const $=id=>document.getElementById(id);

const S=AM4.strings({
  pickCountry:'– Select country –',
  pickCountryFirst:'– select country first –',
  pickAirport:'– Select airport –',
  unavailable:'unavailable',
  dataError:'Game data could not be loaded. Please reload the page.',
  capSingle:'Best single aircraft and route whose purchase price fits your capital.',
  capPerRoute:'Spreads the capital across up to “Max. Number of Aircraft”, each on its own route.',
  capMulti:'Spreads the capital across up to “Max. Number of Aircraft”; high-demand routes can get several aircraft of the same type that share the demand.',
  hubHint:'Select the country and airport of your hub. All destinations with demand from this hub are calculated.',
  runway:'Runway',
  rwyEasy:'Runway length does not matter in Easy mode, so “Base” has no effect.',
  rwyBase:'Base ticked: the runway of {hub} ({rwy} ft) is ignored; only the destination runway counts.',
  rwyNormal:'The shorter runway of hub ({rwy} ft) and destination counts.',
  lessThanDay:'< 1 day',
  oneDay:'{n} day',
  nDays:'{n} days',
  errCapitalTitle:'Capital missing',
  errCapitalText:'Enter your available capital in $.',
  errDemandTitle:'Demand unavailable',
  errDemandText:'The demand data for this hub could not be loaded. Reload the page and try again.',
  noRouteTitle:'No profitable route found',
  noRouteText:'From {hub}, no aircraft can be operated profitably with {cap} of capital. Enter more capital or, if {hub} is your base with an upgraded runway, tick “Base”.',
  staff:'Staff',
  maintenance:'Maintenance',
  fuel:'Fuel',
  co2:'CO₂',
  winTitle:'🏆 {hub} → {dest} with {ac}',
  demand:'Demand',
  configuration:'Configuration',
  depDay:'Departures/Day',
  profitDays:'Profit {d} days',
  profitDay:'Profit/Day',
  acPrice:'A/C Price',
  remaining:'Remaining Capital',
  payback:'Payback',
  planTitleOne:'🛫 Fleet plan from {hub}: {n} aircraft on 1 route',
  planTitle:'🛫 Fleet plan from {hub}: {n} aircraft on {r} routes',
  investment:'Investment',
  invPayback:'Investment Payback',
  colDest:'Destination',
  colAircraft:'Aircraft',
  colCfgPerAc:'Config Y/J/F per A/C',
  colDepPerAc:'Dep/D per A/C',
  colRev:'Revenue',
  colCost:'Costs',
  colProfit:'Profit',
  colInvest:'Investment',
  total:'Σ Total',
  nAircraft:'{n} aircraft',
  listInfo:'{p} profitable routes (of {t} destinations with demand)',
  listMatches:' · {n} matches',
  noMatch:'No matches. Change the search term.',
  noProfitList:'No profitable route. Enter more capital or check “Base”.',
  more:'Show more routes ({n} of {m})',
  detail:'Costs for {d} days with {ac}, flight time {h} h per flight:',
  alternatives:'Alternatives',
  colConfig:'Config',
  colDep:'Dep/D'
});

const PAGE=100;           // rows per page in the route list
let AP=null, gameMode='realism', capMode='single';
let routes=[], listSort={k:'profit',asc:false}, shown=PAGE, openRow=null, lastP=null;
const CAP_DESC={single:S.capSingle,perRoute:S.capPerRoute,multi:S.capMulti};

// ---------- Formatting ----------
const cfgTags=r=>`<span class="tag tag-y">${r.sY}Y</span> <span class="tag tag-j">${r.sJ}J</span> <span class="tag tag-f">${r.sF}F</span>`;
function paybackTxt(days){
  if(!isFinite(days))return '–';
  if(days<1)return esc(S.lessThanDay);
  return esc(tpl(Math.round(days)===1?S.oneDay:S.nDays,{n:nf(days)}));
}

// ---------- Game formulas (according to abc8747/am4) ----------
function ticketPrices(d,easy){
  return easy
    ?{y:Math.floor(1.10*(0.4*d+170))-2,j:Math.floor(1.08*(0.8*d+560))-2,f:Math.floor(1.06*(1.2*d+1200))-2}
    :{y:Math.floor(1.10*(0.3*d+150))-2,j:Math.floor(1.08*(0.6*d+500))-2,f:Math.floor(1.06*(0.9*d+1000))-2};
}

// One aircraft type on one route with the given remaining demand (per day)
function evalAc(ac,rt,p,remY,remJ,remF){
  const mult=p.easy?1.5:1;
  const tripH=rt.d/(ac.speed*mult);
  const fpdN=tripH<=p.fh?Math.max(1,Math.min(p.maxF,Math.floor(p.fh/tripH))):p.fh/tripH;
  let c=ac.cap;
  const sF=Math.max(0,Math.min(Math.floor(remF/fpdN),Math.floor(c/3)));c-=sF*3;
  const sJ=Math.max(0,Math.min(Math.floor(remJ/fpdN),Math.floor(c/2)));c-=sJ*2;
  const sY=Math.max(0,c); // remaining seats as economy
  const tY=Math.min(fpdN*sY,remY),tJ=Math.min(fpdN*sJ,remJ),tF=Math.min(fpdN*sF,remF);
  if(tY+tJ+tF<1)return null;
  const pr=rt.prices;
  const revDay=tY*pr.y+tJ*pr.j+tF*pr.f;
  const dist=Math.ceil(rt.d*100)/100;
  const fuelDay=fpdN*dist*ac.fuel*p.fuelP/1000;
  const co2Flight=dist*ac.co2*((tY+2*tJ+3*tF)/fpdN)+(sY+sJ+sF);
  const co2Day=fpdN*co2Flight*p.co2P/1000;
  const aCheckFlight=ac.checkCost*(p.easy?1:2)*Math.ceil(tripH*mult)/ac.maint;
  const wearFlight=ac.cost/1000*0.0075;
  const maintDay=fpdN*(aCheckFlight+wearFlight);
  const staffDay=ac.pilots*p.sP+ac.crew*p.sC+ac.eng*p.sE+ac.tech*p.sT;
  const costDay=fuelDay+co2Day+maintDay+staffDay;
  const profitDay=revDay-costDay;
  return{ac,rt,fpd:fpdN,tripH,sY,sJ,sF,tY,tJ,tF,revDay,fuelDay,co2Day,maintDay,staffDay,costDay,profitDay,
    profit:profitDay*p.days,payback:profitDay>0?ac.cost/profitDay:Infinity};
}

// All permitted, profitable types of a route, best first
function routeOptions(rt,p,remY,remJ,remF,maxCost){
  const out=[];
  for(const ac of AC){
    if(ac.cost>maxCost||ac.range<rt.d||ac.rwy>rt.rwyLimit)continue;
    const r=evalAc(ac,rt,p,remY,remJ,remF);
    if(r&&r.profitDay>0)out.push(r);
  }
  return out.sort((a,b)=>b.profit-a.profit);
}

// ---------- Capital allocation ----------
// One option = n aircraft of the same type on one route (sharing the demand)
function mkOpt(r,n){return{rt:r.rt,ac:r.ac,n,unit:r,profit:r.profit*n,cost:r.ac.cost*n}}
function sumPlan(items){return items.reduce((s,x)=>({profit:s.profit+x.profit,cost:s.cost+x.cost,n:s.n+x.n}),{profit:0,cost:0,n:0})}

// Options per route: one aircraft only, or (multi) n identical aircraft as long as one more increases the profit
function routeGroupOptions(rt,p,multi,K){
  const out=rt.opts.map(r=>mkOpt(r,1));
  if(multi){
    for(const r1 of rt.opts){
      let prev=r1.profit;
      for(let n=2;n<=K&&r1.ac.cost*n<=p.cap;n++){
        const r=evalAc(r1.ac,rt,p,rt.y/n,rt.j/n,rt.f/n);
        if(!r||r.profitDay<=0||r.profit*n<=prev)break;
        out.push(mkOpt(r,n));prev=r.profit*n;
      }
    }
  }
  // Pareto front: cheaper or more profitable than all others
  out.sort((a,b)=>a.cost-b.cost||b.profit-a.profit);
  const front=[];let best=-Infinity;
  for(const o of out)if(o.profit>best){front.push(o);best=o.profit}
  return front.slice(-255);
}

// Multiple-choice knapsack: at most one option per route,
// sum of purchase prices ≤ capital and number of aircraft ≤ K
function planFleet(cands,p,multi){
  const cap=p.cap,K=p.maxAc;
  const groups=cands.map(rt=>routeGroupOptions(rt,p,multi,K)).filter(g=>g.length);
  if(!groups.length)return[];
  const nOpts=groups.reduce((s,g)=>s+g.length,0);
  // Resolution of the capital adapted to computing time and memory
  const B=Math.max(200,Math.min(4000,Math.floor(1.5e8/(nOpts*K)),Math.floor(6e7/(groups.length*(K+1)))));
  const W=B+1,Sz=(K+1)*W,unit=cap/B,wOf=o=>Math.max(1,Math.ceil(o.cost/unit-1e-9));
  // dp[k*W+c] = best profit with exactly k aircraft and capital units ≤ c
  let dp=new Float64Array(Sz).fill(-Infinity),nd=new Float64Array(Sz);
  for(let c=0;c<W;c++)dp[c]=0;
  const choice=groups.map(()=>new Uint8Array(Sz));
  groups.forEach((g,gi)=>{
    nd.set(dp);
    const ch=choice[gi];
    g.forEach((o,oi)=>{
      const w=wOf(o),n=o.n;if(w>B||n>K)return;
      for(let k=K;k>=n;k--){
        const bo=(k-n)*W,bn=k*W;
        for(let c=B;c>=w;c--){const v=dp[bo+c-w]+o.profit;if(v>nd[bn+c]){nd[bn+c]=v;ch[bn+c]=oi+1}}
      }
    });
    [dp,nd]=[nd,dp];
  });
  let k=0;for(let x=1;x<=K;x++)if(dp[x*W+B]>dp[k*W+B])k=x;
  const pick=[];let c=B;
  for(let gi=groups.length-1;gi>=0&&k>0;gi--){
    const ch=choice[gi][k*W+c];
    if(ch){const o=groups[gi][ch-1];pick.push(o);c-=wOf(o);k-=o.n}
  }
  // Fill rounding remainders with exact prices (respecting the number limit)
  let left=cap-sumPlan(pick).cost,slots=K-sumPlan(pick).n;
  const used=new Set(pick.map(o=>o.rt.i));
  while(slots>0){
    let best=null;
    for(const g of groups){if(used.has(g[0].rt.i))continue;for(const o of g)if(o.cost<=left&&o.n<=slots&&(!best||o.profit>best.profit))best=o}
    if(!best)break;
    pick.push(best);used.add(best.rt.i);left-=best.cost;slots-=best.n;
  }
  return pick;
}

// ---------- Calculation ----------
function getParams(){
  const v=id=>Math.max(0,+$(id).value||0);
  return{cap:AM4.parseAmount($('capital').value),basis:$('basis').checked,easy:gameMode==='easy',
    fuelP:v('fuelPrice'),co2P:v('co2Price'),days:Math.max(1,v('days')),fh:Math.min(24,Math.max(1,v('flightHours'))),
    sP:v('salPilot'),sC:v('salCrew'),sE:v('salEng'),sT:v('salTech'),
    maxF:Math.max(1,Math.floor(v('maxFlights'))),maxAc:Math.max(1,Math.floor(v('maxAc')))};
}

function buildRoutes(hub,dv,p){
  const list=[];
  for(const b of AP){
    if(b.i===hub.i)continue;
    const {y,j,f}=AM4.demand(dv,b.i);
    if(y+j+f===0)continue;
    const d=AM4.distance(hub,b);
    if(d<100)continue;
    const rwyLimit=p.easy?Infinity:(p.basis?b.rwy:Math.min(hub.rwy,b.rwy));
    list.push({i:b.i,ap:b,d,y,j,f,rwyLimit,prices:ticketPrices(d,p.easy)});
  }
  return list;
}

async function calculate(){
  const hi=$('hubAirport').value;
  if(hi===''){hubHint();return}
  const p=getParams();
  if(p.cap<=0){$('summary').innerHTML=errCard(S.errCapitalTitle,S.errCapitalText);return}
  const btn=$('calcBtn');btn.disabled=true;btn.classList.add('is-busy');
  try{
    const hub=AP[+hi];
    const dv=await AM4.loadDemand(hub.i);
    await new Promise(r=>setTimeout(r,20)); // let the display update
    const rts=buildRoutes(hub,dv,p);
    for(const rt of rts){rt.opts=routeOptions(rt,p,rt.y,rt.j,rt.f,p.cap);rt.best=rt.opts[0]||null}
    routes=rts;lastP=p;
    const cands=rts.filter(rt=>rt.best);
    renderSummary(hub,cands,p);
    listSort={k:'profit',asc:false};shown=PAGE;openRow=null;
    renderList();
    $('listArea').hidden=false;
  }catch(e){
    console.error(e);
    $('summary').innerHTML=errCard(S.errDemandTitle,S.errDemandText);
  }finally{btn.disabled=false;btn.classList.remove('is-busy')}
}

// ---------- Output ----------
function errCard(t,m){return`<div class="am4-card err-card"><h2>⚠️ ${esc(t)}</h2><p>${esc(m)}</p></div>`}

function costBlock(staff,maint,fuel,co2){
  return`<div class="costs">
    <div><b>${money(staff)}</b>${esc(S.staff)}</div>
    <div><b>${money(maint)}</b>${esc(S.maintenance)}</div>
    <div><b>${money(fuel)}</b>${esc(S.fuel)}</div>
    <div><b>${money(co2)}</b>${esc(S.co2)}</div>
  </div>`;
}
const costOf=(x,days)=>costBlock(x.staffDay*days,x.maintDay*days,x.fuelDay*days,x.co2Day*days);

function renderSummary(hub,cands,p){
  const el=$('summary');
  if(!cands.length){
    el.innerHTML=errCard(S.noRouteTitle,tpl(S.noRouteText,{hub:hub.iata,cap:money(p.cap)}));
    return;
  }
  const dvs=p.days,daysTxt=tpl(S.profitDays,{d:nf(dvs)});
  if(capMode==='single'){
    const w=cands.reduce((b,rt)=>rt.best.profit>b.profit?rt.best:b,cands[0].best);
    el.innerHTML=`<div class="am4-card winner-card">
      <h2>${esc(tpl(S.winTitle,{hub:hub.iata,dest:w.rt.ap.iata,ac:w.ac.name}))}</h2>
      <p style="margin-bottom:.85rem">${esc(w.rt.ap.name)}, ${esc(w.rt.ap.country)} · ${nf(w.rt.d)} km · ${esc(S.demand)} ${nf(w.rt.y)} Y / ${nf(w.rt.j)} J / ${nf(w.rt.f)} F</p>
      <div class="stats">
        <div class="stat"><div class="val">${w.sY}Y / ${w.sJ}J / ${w.sF}F</div><div class="lbl">${esc(S.configuration)}</div></div>
        <div class="stat"><div class="val">${fpd(w.fpd)}</div><div class="lbl">${esc(S.depDay)}</div></div>
        <div class="stat"><div class="val pos">${money(w.profit)}</div><div class="lbl">${esc(daysTxt)}</div></div>
        <div class="stat"><div class="val">${money(w.profitDay)}</div><div class="lbl">${esc(S.profitDay)}</div></div>
        <div class="stat"><div class="val">${money(w.ac.cost)}</div><div class="lbl">${esc(S.acPrice)}</div></div>
        <div class="stat"><div class="val">${money(p.cap-w.ac.cost)}</div><div class="lbl">${esc(S.remaining)}</div></div>
        <div class="stat"><div class="val">${paybackTxt(w.payback)}</div><div class="lbl">${esc(S.payback)}</div></div>
      </div>
      ${costOf(w,dvs)}
    </div>`;
    return;
  }
  // Several aircraft
  let plan=planFleet(cands,p,false);
  if(capMode==='multi'){const m=planFleet(cands,p,true);if(sumPlan(m).profit>sumPlan(plan).profit)plan=m}
  plan.sort((a,b)=>b.profit-a.profit);
  const tot=sumPlan(plan);
  const nRoutes=plan.length;
  const sumK=k=>plan.reduce((s,x)=>s+x.unit[k]*x.n,0);
  const title=tpl(nRoutes===1?S.planTitleOne:S.planTitle,{hub:hub.iata,n:nf(tot.n),r:nf(nRoutes)});
  el.innerHTML=`<div class="am4-card plan-card">
    <h2>${esc(title)}</h2>
    <div class="stats">
      <div class="stat"><div class="val pos">${money(tot.profit)}</div><div class="lbl">${esc(daysTxt)}</div></div>
      <div class="stat"><div class="val">${money(tot.profit/dvs)}</div><div class="lbl">${esc(S.profitDay)}</div></div>
      <div class="stat"><div class="val">${money(tot.cost)}</div><div class="lbl">${esc(S.investment)}</div></div>
      <div class="stat"><div class="val">${money(p.cap-tot.cost)}</div><div class="lbl">${esc(S.remaining)}</div></div>
      <div class="stat"><div class="val">${paybackTxt(tot.profit>0?tot.cost/(tot.profit/dvs):Infinity)}</div><div class="lbl">${esc(S.invPayback)}</div></div>
    </div>
    ${costBlock(sumK('staffDay')*dvs,sumK('maintDay')*dvs,sumK('fuelDay')*dvs,sumK('co2Day')*dvs)}
    <div class="table-wrap"><table class="am4-table">
      <thead><tr><th>${esc(S.colDest)}</th><th>km</th><th>${esc(S.colAircraft)}</th><th>${esc(S.colCfgPerAc)}</th><th>${esc(S.colDepPerAc)}</th><th>${esc(S.colRev)}</th><th>${esc(S.colCost)}</th><th>${esc(S.colProfit)}</th><th>${esc(S.colInvest)}</th></tr></thead>
      <tbody>${plan.map(e=>`<tr>
        <td class="t">${esc(e.rt.ap.iata)} · ${esc(e.rt.ap.name)}<small>${esc(e.rt.ap.country)}</small></td>
        <td>${nf(e.rt.d)}</td>
        <td class="t">${e.n}× ${esc(e.ac.name)}</td>
        <td>${cfgTags(e.unit)}</td>
        <td>${fpd(e.unit.fpd)}</td>
        <td>${money(e.unit.revDay*e.n*dvs)}</td><td>${money(e.unit.costDay*e.n*dvs)}</td><td class="pos">${money(e.profit)}</td><td>${money(e.cost)}</td>
      </tr>`).join('')}
      <tr class="total"><td class="t">${esc(S.total)}</td><td></td><td class="t">${esc(tpl(S.nAircraft,{n:nf(tot.n)}))}</td><td></td><td></td>
        <td>${money(sumK('revDay')*dvs)}</td><td>${money(sumK('costDay')*dvs)}</td>
        <td class="pos">${money(tot.profit)}</td><td>${money(tot.cost)}</td></tr>
      </tbody></table></div>
  </div>`;
}

// ---------- Route list ----------
const SORTERS={
  dest:rt=>rt.ap.iata,d:rt=>rt.d,rwy:rt=>rt.ap.rwy,ac:rt=>rt.best?rt.best.ac.name:'',
  fpd:rt=>rt.best?rt.best.fpd:-1,rev:rt=>rt.best?rt.best.revDay:-Infinity,cost:rt=>rt.best?rt.best.costDay:-Infinity,
  profit:rt=>rt.best?rt.best.profit:-Infinity,price:rt=>rt.best?rt.best.ac.cost:-Infinity,
  payback:rt=>rt.best?rt.best.payback:Infinity
};

function renderList(){
  const q=$('search').value.trim().toLowerCase();
  let list=routes.filter(rt=>rt.best);
  if(q)list=list.filter(rt=>[rt.ap.iata,rt.ap.name,rt.ap.full,rt.ap.country,rt.best.ac.name,rt.best.ac.sn].some(s=>s.toLowerCase().includes(q)));
  const f=SORTERS[listSort.k],dir=listSort.asc?1:-1;
  list.sort((a,b)=>{const va=f(a),vb=f(b);return(typeof va==='string'?va.localeCompare(vb):va-vb)*dir});
  document.querySelectorAll('#routeTable th.s').forEach(th=>th.classList.toggle('sorted',th.dataset.k===listSort.k));
  const total=routes.length,prof=routes.filter(rt=>rt.best).length;
  $('listInfo').textContent=tpl(S.listInfo,{p:nf(prof),t:nf(total)})+(q?tpl(S.listMatches,{n:nf(list.length)}):'');
  const tb=$('tbody'),days=lastP.days;
  if(!list.length){tb.innerHTML=`<tr><td colspan="12" class="empty">${esc(q?S.noMatch:S.noProfitList)}</td></tr>`;$('moreBtn').hidden=true;return}
  const page=list.slice(0,shown);
  tb.innerHTML=page.map(rt=>{
    const b=rt.best;
    const row=`<tr class="rt" tabindex="0" data-i="${rt.i}">
      <td class="t">${esc(rt.ap.iata)} · ${esc(rt.ap.name)}<small>${esc(rt.ap.country)}</small></td>
      <td>${nf(rt.d)}</td><td>${nf(rt.ap.rwy)}</td>
      <td><span class="tag tag-y">${nf(rt.y)}</span> <span class="tag tag-j">${nf(rt.j)}</span> <span class="tag tag-f">${nf(rt.f)}</span></td>
      <td class="t">${esc(b.ac.name)}</td><td>${cfgTags(b)}</td><td>${fpd(b.fpd)}</td>
      <td>${money(b.revDay*days)}</td><td>${money(b.costDay*days)}</td><td class="pos">${money(b.profit)}</td>
      <td>${money(b.ac.cost)}</td><td>${paybackTxt(b.payback)}</td></tr>`;
    return row+(openRow===rt.i?detailRow(rt,days):'');
  }).join('');
  $('moreBtn').hidden=list.length<=shown;
  $('moreBtn').textContent=tpl(S.more,{n:nf(Math.min(PAGE,list.length-shown)),m:nf(list.length-shown)});
}

function detailRow(rt,days){
  const b=rt.best,alts=rt.opts.slice(0,6);
  return`<tr class="detail"><td colspan="12">
    <b>${esc(rt.ap.full)}</b> · ${esc(rt.ap.iata)}/${esc(rt.ap.icao)} · ${esc(tpl(S.detail,{d:nf(days),ac:b.ac.name,h:num(b.tripH,1)}))}
    ${costOf(b,days)}
    <table class="am4-table alt"><thead><tr><th>${esc(S.alternatives)}</th><th>${esc(S.colConfig)}</th><th>${esc(S.colDep)}</th><th>${esc(S.colProfit)}</th><th>${esc(S.acPrice)}</th><th>${esc(S.payback)}</th></tr></thead><tbody>
    ${alts.map(o=>`<tr><td class="t">${esc(o.ac.name)}</td><td>${cfgTags(o)}</td><td>${fpd(o.fpd)}</td><td class="pos">${money(o.profit)}</td><td>${money(o.ac.cost)}</td><td>${paybackTxt(o.payback)}</td></tr>`).join('')}
    </tbody></table>
  </td></tr>`;
}

// ---------- Hub selection ----------
function hubHint(){
  const hi=$('hubAirport').value,el=$('hubInfo');
  if(!AP)return;
  el.className='hint no-translate';
  if(hi===''){el.textContent=S.hubHint;$('calcBtn').disabled=true;return}
  const h=AP[+hi],basis=$('basis').checked;
  let rw;
  if(gameMode==='easy')rw=S.rwyEasy;
  else if(basis)rw=tpl(S.rwyBase,{hub:h.iata,rwy:nf(h.rwy)});
  else rw=tpl(S.rwyNormal,{rwy:nf(h.rwy)});
  el.innerHTML=`✈️ <b>${esc(h.iata)}</b> · ${esc(h.full)} · ${esc(S.runway)} ${nf(h.rwy)} ft<br>${esc(rw)}`;
  $('calcBtn').disabled=false;
  AM4.loadDemand(h.i).catch(()=>{});
}

$('hubCountry').addEventListener('change',()=>{
  const c=$('hubCountry').value,s=$('hubAirport');
  if(!c){s.replaceChildren(AM4.option('',S.pickCountryFirst));s.disabled=true;hubHint();return}
  AM4.fillAirports(s,AP,c,S.pickAirport);
  hubHint();
});
$('hubAirport').addEventListener('change',hubHint);
$('basis').addEventListener('change',hubHint);

function toggle(id,cb){$(id).addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;
  $(id).querySelectorAll('button').forEach(x=>x.classList.toggle('active',x===b));cb(b.dataset.v)})}
function syncBasis(){const off=gameMode==='easy';$('basis').disabled=off;$('basis').closest('.check').classList.toggle('off',off)}
toggle('gameToggle',v=>{gameMode=v;syncBasis();hubHint()});
toggle('capToggle',v=>{capMode=v;$('capDesc').textContent=CAP_DESC[v];$('maxAc').disabled=v==='single'});
$('capDesc').textContent=CAP_DESC[capMode];

// Capital: show in the visitor's number format
const capEl=$('capital');
capEl.value=nf(AM4.parseAmount(capEl.value));
capEl.addEventListener('blur',()=>{const n=AM4.parseAmount(capEl.value);if(n>0)capEl.value=nf(n)});
$('calcBtn').addEventListener('click',calculate);
$('search').addEventListener('input',()=>{shown=PAGE;renderList()});
$('moreBtn').addEventListener('click',()=>{shown+=PAGE;renderList()});
document.querySelectorAll('#routeTable th.s').forEach(th=>th.addEventListener('click',()=>{
  const k=th.dataset.k;
  listSort=listSort.k===k?{k,asc:!listSort.asc}:{k,asc:k==='dest'||k==='payback'||k==='ac'};
  renderList();
}));
function toggleRow(tr){const i=+tr.dataset.i;openRow=openRow===i?null:i;renderList()}
$('tbody').addEventListener('click',e=>{const tr=e.target.closest('tr.rt');if(tr)toggleRow(tr)});
$('tbody').addEventListener('keydown',e=>{const tr=e.target.closest('tr.rt');if(tr&&(e.key==='Enter'||e.key===' ')){e.preventDefault();toggleRow(tr)}});

AM4.loadAirports().then(ap=>{
  AP=ap;
  AM4.fillCountries($('hubCountry'),AP,S.pickCountry);
  hubHint();
}).catch(()=>{
  $('hubCountry').replaceChildren(AM4.option('',S.unavailable));
  $('hubInfo').className='hint warn no-translate';
  $('hubInfo').textContent=S.dataError;
});
})();
