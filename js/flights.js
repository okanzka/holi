/* ============ Heybe — flights page ============ */
(function(){
const $=s=>document.querySelector(s);
let T, flex, tripType, selected=null;
let live={key:'',out:{},back:{},loading:false};          // route mode: Ryanair per-day prices
let any={key:'',deals:[],loading:false,error:null,origins:[]}; // anywhere mode

const RY_SITE={name:'Ryanair',color:'#073590',ab:'FR',url:o=>RYANAIR.bookUrl(o)};
const pax=()=>(T.adults||1)+(T.children||0);
const today=()=>{ const d=new Date(); d.setHours(0,0,0,0); return d; };

/* ---------- date window ---------- */
function range(){
  const s=H.parse(T.start), e=H.parse(T.end), t=today();
  let oF=H.add(s,-flex); if(oF<t) oF=t;
  let iF=H.add(e,-flex); if(iF<t) iF=t;
  return {outFrom:H.fmt(oF),outTo:H.fmt(H.add(s,flex)),inFrom:H.fmt(iF),inTo:H.fmt(H.add(e,flex))};
}
function monthsBetween(a,b){ const out=[]; let d=H.parse(a); d.setDate(1); const end=H.parse(b);
  while(d<=end){ out.push(H.fmt(d)); d=new Date(d.getFullYear(),d.getMonth()+1,1); } return out; }

/* ---------- estimate (used only where no real price exists) ---------- */
const DEP_W={0:7,1:1,2:-10,3:-9,4:-1,5:9,6:-4}, RET_W={0:10,1:4,2:-8,3:-8,4:0,5:3,6:-4};
function score(dep,ret,dOff,rOff,wantN){
  let s=50+DEP_W[dep.getDay()];
  if(ret){ s+=RET_W[ret.getDay()]+1.5*Math.abs(H.diff(dep,ret)-wantN); }
  return s+2*(Math.abs(dOff)+Math.abs(rOff||0));
}
const tier=s=>s<=40?'great':s<=50?'good':s<=60?'fair':'pricey';
const TIER_LABEL={great:'Likely cheapest',good:'Good bet',fair:'Average',pricey:'Likely pricey'};

const fareKey=(dep,ret)=>`${T.from}-${T.to}-${dep}-${ret||'ow'}-${T.cabin}`;
const fares=()=>H.load('fares',{});
const opts=(dep,ret,to)=>({from:T.from,to:to||T.to,dep,ret,adults:T.adults,children:T.children,cabin:T.cabin});

/* =====================================================================
   ANYWHERE MODE — live Ryanair round trips to every destination
   ===================================================================== */
async function loadAnywhere(){
  const r=range();
  const key=JSON.stringify([T.from,T.to,T.tripType,r,T.minNights,T.currency,T.nearby,T.direct]);
  if(any.key===key) return;
  any={key,deals:[],loading:true,error:null,origins:[]}; renderAnywhere();
  const fromCountry=H.isCountry(T.from), fromAny=T.from==='ANY';
  // From = Anywhere: every city with a direct flight to the destination becomes an origin
  const origins=fromAny ? await RYANAIR.sourcesTo(T.to,r.outFrom,r.inTo||r.outTo,T.currency)
    : fromCountry ? AP.inCountry(T.from.slice(2),25).map(a=>a.code)
    : [T.from,...(T.nearby?AP.near(T.from,250,5).map(a=>a.code):[])];
  if(any.key!==key) return;
  const toAirport=(T.to!=='ANY'&&!H.isCountry(T.to))?T.to:null;   // a single destination airport
  const toCC=H.isCountry(T.to)?T.to.slice(2):null;
  // ask Ryanair a few airports at a time
  const res=[]; const queue=[...origins];
  await Promise.all(Array.from({length:6},async()=>{ while(queue.length){ const o=queue.shift();
    try{ res.push({ok:true,v:await (T.tripType==='rt'
      ? RYANAIR.roundTrips({from:o,to:toAirport,...r,minN:T.minNights||1,maxN:60,currency:T.currency})
      : RYANAIR.oneWays({from:o,to:toAirport,outFrom:r.outFrom,outTo:r.outTo,currency:T.currency}))}); }
    catch(e){ res.push({ok:false}); } } }));
  // every other airline (Travelpayouts, cached prices) when the local server is running
  if(await TP.available()){
    const rt=T.tripType==='rt', p={...r,minN:T.minNights||1,maxN:60,currency:T.currency,direct:!!T.direct};
    const qs=fromAny?(toAirport?[{from:null,to:toAirport}]:AP.inCountry(toCC,8).map(a=>({from:null,to:a.code})))
      :origins.slice(0,fromCountry?10:origins.length).map(o=>({from:o,to:toAirport}));
    await pool(qs,4,async q=>{ res.push({ok:true,tp:true,v:await (rt?TP.roundTrips({...p,...q}):TP.oneWays({...q,outFrom:r.outFrom,outTo:r.outTo,currency:T.currency,direct:!!T.direct}))}); });
  }
  if(any.key!==key) return;                         // a newer search started
  // from one airport: cheapest per destination. From a country: cheapest per departure+destination pair
  const best=new Map(); let failed=0;
  res.forEach(x=>{ if(!x.ok){ failed++; return; }
    x.v.forEach(d=>{ const a=AP.byCode(d.dest); d.cc=a?a.cc:'';
      if(toCC && d.cc!==toCC) return;
      if(!fromAny && origins.includes(d.dest)) return;   // skip domestic hops inside the origin set
      const k=(fromCountry||fromAny)?d.origin+'>'+d.dest:d.dest, cur=best.get(k); if(!cur||d.pp<cur.pp) best.set(k,d); }); });
  const s=H.parse(T.start), e=H.parse(T.end);
  any.deals=[...best.values()].map(d=>{
    // the "place" shown for each deal: the destination normally, the departure city when From = Anywhere
    const pa=fromAny?AP.byCode(d.origin):null;
    d.key=d.origin+'>'+d.dest;
    d.pCode=fromAny?d.origin:d.dest; d.pCity=fromAny?(pa?pa.city||pa.name:d.origin):d.destCity; d.pCountry=fromAny?(pa?pa.country:''):d.country;
    if(fromAny) d.cc=pa?pa.cc:'';
    d.tag=fromAny?(H.isCountry(T.to)?'to '+d.dest:''):(d.origin!==T.from?'from '+d.origin:'');
    d.dep=d.outDep.slice(0,10); d.ret=d.inDep?d.inDep.slice(0,10):null;
    d.nights=d.ret?H.diff(H.parse(d.dep),H.parse(d.ret)):null;
    d.fit=Math.abs(H.diff(s,H.parse(d.dep)))+(d.ret?Math.abs(H.diff(e,H.parse(d.ret))):0);
    d.total=d.pp*pax(); return d; });
  any.origins=origins; any.loading=false;
  if(!any.deals.length&&failed===origins.length) any.error='Could not reach Ryanair. Check your internet connection and try again.';
  renderAnywhere();
}

function renderAnywhere(){
  const fromCountry=H.isCountry(T.from), fromAny=T.from==='ANY';
  $('#anyFrom').textContent=fromAny?`anywhere to ${H.cityOf(T.to)}`:H.cityOf(T.from)+(T.nearby&&!fromCountry?' & nearby':'')+(T.to!=='ANY'?' to '+H.cityOf(T.to):'');
  $('#dealsTitle').textContent=fromAny?'Every departure city':'Every destination';
  const r=range();
  const mainFrom=fromCountry?((AP.inCountry(T.from.slice(2),1)[0]||{}).code||'FRA'):T.from;
  $('#exploreSites').innerHTML=fromAny
    ? '<div class="empty" style="grid-column:1/-1">These "explore" sites only search outward from one city. Click 📅 on any departure city above to compare every airline for that route.</div>'
    : siteButtons(EXPLORE_SITES,{from:mainFrom,dep:T.start,ret:T.tripType==='rt'?T.end:null,adults:T.adults});
  if(any.loading){ $('#anyPicks').innerHTML=`<div class="loading" style="grid-column:1/-1">${fromAny?`Finding every city with flights to ${H.esc(H.cityOf(T.to))}…`:'Checking every destination…'}</div>`; $('#deals').innerHTML=''; $('#anySub').textContent=''; return; }
  if(any.error){ $('#anyPicks').innerHTML=`<div class="empty" style="grid-column:1/-1">${H.esc(any.error)}</div>`; $('#deals').innerHTML=''; return; }
  const visaOk=any.deals.filter(d=>VISA.pass(d.pCode));
  renderAlChips(visaOk);
  const all=visaOk.filter(alOk);
  const hidden=any.deals.length-all.length;
  const origNames=fromAny?`${any.origins.length} cities`:fromCountry?`${any.origins.length} airports in ${H.cityOf(T.from)}`:any.origins.join(', ');
  $('#anySub').textContent = all.length
    ? `${all.length} option${all.length>1?'s':''}${hidden?` (${hidden} hidden by the visa filter)`:''} found from ${origNames}${T.to!=='ANY'?' to '+H.cityOf(T.to):''}, leaving ${H.short(H.parse(r.outFrom))}–${H.short(H.parse(r.outTo))}${T.tripType==='rt'?`, returning ${H.short(H.parse(r.inFrom))}–${H.short(H.parse(r.inTo))}`:''}. Prices per person.`
    : '';
  if(!all.length){
    $('#anyPicks').innerHTML=`<div class="empty" style="grid-column:1/-1">No Ryanair flights from ${H.esc(origNames)}${T.to!=='ANY'?' to '+H.esc(H.cityOf(T.to)):''} in this window. ${T.nearby||fromCountry?'':'Tick <b>Also search nearby airports</b>, or '}use the all-airline sites below. 👇</div>`;
    $('#deals').innerHTML=''; return; }

  // top 3 picks: cheapest, then cheapest that's closest to your dates, then a "long stay" value pick
  const byPrice=[...all].sort((a,b)=>a.pp-b.pp);
  const picks=[byPrice[0]];
  const fitPick=[...all].sort((a,b)=>a.fit-b.fit||a.pp-b.pp).find(d=>!picks.includes(d)); if(fitPick) picks.push(fitPick);
  for(const d of byPrice){ if(picks.length>=3) break; if(!picks.includes(d)) picks.push(d); }
  const labels=['Cheapest','Closest to your dates','Great value'];
  $('#anyPicks').innerHTML=picks.map((d,i)=>`<div class="pick"><span class="rank">#${i+1}</span>
      <span class="badge ${i===1?'b-good':'b-great'}">${labels[i]}</span>
      <h3>${H.flag(d.cc)} ${H.esc(d.pCity)}${d.tag?` <span class="from-tag">${d.tag}</span>`:''}</h3>
      <div class="meta">${H.esc(d.pCountry)} · ${d.origin} → ${d.dest}</div>
      <div style="margin-top:6px">${VISA.badge(d.pCode)}</div>
      <div class="price">${H.money(d.pp,d.cur)}<span class="hint"> / person</span></div>
      <div class="meta">${H.nice(H.parse(d.dep))} ${H.time(d.outDep)}${d.ret?` → ${H.nice(H.parse(d.ret))} ${H.time(d.inDep)} · ${d.nights} nights`:''}</div>
      <div class="meta">${H.alLogo(H.carrier(d.outFlight),true)} <span class="fn">${H.esc([d.outFlight,d.inFlight].filter(Boolean).join(' / '))}</span> ${stopTag(d)}</div>
      <div class="meta">≈ ${H.money(d.total,d.cur)} for ${pax()} traveller${pax()>1?'s':''}</div>
      <div class="actions">
        <a class="btn primary sm" target="_blank" rel="noopener" href="${H.esc(dealBook(d))}">Book${d.src==='tp'?'':' on Ryanair'} ↗</a>
        <button class="btn ghost sm" data-route="${d.dest}" data-origin="${d.origin}">📅 All dates</button>
        <button class="btn ghost sm" data-hotel="${d.key}">🏨 Stays</button></div></div>`).join('');
  renderDealList();
  bindDealButtons($('#anyPicks'));
}

const alOf=d=>H.carrier(d.outFlight);
const alOk=d=>!any.alSel||!any.alSel.size||any.alSel.has(alOf(d));
function renderAlChips(list){
  const cnt={}; list.forEach(d=>{ const c=alOf(d); cnt[c]=(cnt[c]||0)+1; });
  const codes=Object.keys(cnt).sort((a,b)=>cnt[b]-cnt[a]);
  if(!codes.length){ $('#alChips').innerHTML=''; return; }
  const sel=any.alSel||new Set();
  $('#alChips').innerHTML='<span class="al-lbl">Airlines:</span>'+`<button type="button" class="chip${sel.size?'':' on'}" data-al="">All <small>${list.length}</small></button>`+
    codes.map(c=>`<button type="button" class="chip${sel.has(c)?' on':''}" data-al="${c}">${H.alLogo(c,true)} <small>${cnt[c]}</small></button>`).join('');
  $('#alChips').querySelectorAll('[data-al]').forEach(b=>b.onclick=()=>{ const c=b.dataset.al;
    if(!c) any.alSel=new Set(); else { any.alSel=any.alSel||new Set(); any.alSel.has(c)?any.alSel.delete(c):any.alSel.add(c); }
    renderAnywhere(); });
}
const dealBook=d=>d.src==='tp'?(d.link||FLIGHT_SITES[0].url({from:d.origin,to:d.dest,dep:d.dep,ret:d.ret,adults:T.adults,children:T.children,cabin:T.cabin}))
  :RYANAIR.bookUrl({from:d.origin,to:d.dest,dep:d.dep,ret:d.ret,adults:T.adults,children:T.children});
const stopTag=d=>{ const n=Math.max(d.stops||0,d.rstops||0);
  return (n?`<span class="stop-tag">${n} stop${n>1?'s':''}</span>`:'<span class="stop-tag direct">direct</span>')+
    (d.src==='tp'?'<span class="fn" title="Recent price found on Aviasales; the final price may differ"> · recent price</span>':'<span class="fn"> · live</span>'); };

function renderDealList(){
  const q=AP.norm($('#qDest').value.trim()), max=parseFloat($('#qMax').value), sort=$('#qSort').value;
  let L=any.deals.filter(d=>VISA.pass(d.pCode)&&alOk(d)&&(!q||AP.norm(`${d.pCity} ${d.pCountry} ${d.pCode}`).includes(q))&&(isNaN(max)||d.pp<=max));
  L.sort(sort==='fit'?(a,b)=>a.fit-b.fit||a.pp-b.pp:sort==='name'?(a,b)=>a.pCity.localeCompare(b.pCity):(a,b)=>a.pp-b.pp);
  if(!L.length){ $('#deals').innerHTML='<div class="empty">Nothing matches these filters.</div>'; return; }
  $('#deals').innerHTML=L.map(d=>`<div class="deal">
      <span class="fl">${H.flag(d.cc)||'✈️'}</span>
      <div><div class="t">${H.esc(d.pCity)}<small>${H.esc(d.pCountry)} · ${d.pCode}</small>${d.tag?`<span class="from-tag">${d.tag}</span>`:''} ${VISA.badge(d.pCode)}</div>
        <div class="s">${H.alLogo(H.carrier(d.outFlight),true)} ${stopTag(d)} 🛫 ${H.nice(H.parse(d.dep))} ${H.time(d.outDep)} <span class="fn">${H.esc(d.outFlight||'')}</span>${d.ret?` &nbsp;🛬 ${H.nice(H.parse(d.ret))} ${H.time(d.inDep)} <span class="fn">${H.esc(d.inFlight||'')}</span> · ${d.nights} nights`:' · one way'}</div></div>
      <div class="amt">${H.money(d.pp,d.cur)}<small>per person · ≈ ${H.money(d.total,d.cur)} total</small></div>
      <div class="acts">
        <a class="btn primary sm" target="_blank" rel="noopener" href="${H.esc(dealBook(d))}">Book ↗</a>
        <a class="btn ghost sm" target="_blank" rel="noopener" title="Compare all airlines on Google Flights" href="${H.esc(FLIGHT_SITES[0].url({from:d.origin,to:d.dest,dep:d.dep,ret:d.ret,adults:T.adults,children:T.children,cabin:T.cabin}))}">Compare ↗</a>
        <button class="btn ghost sm" data-route="${d.dest}" data-origin="${d.origin}" title="See every date combination">📅</button>
        <button class="btn ghost sm" data-hotel="${d.key}" title="Plan where to stay on these dates">🏨</button></div></div>`).join('');
  bindDealButtons($('#deals'));
}

function bindDealButtons(root){
  root.querySelectorAll('[data-route]').forEach(b=>b.onclick=()=>{
    const code=b.dataset.route, org=b.dataset.origin; setAirport($('#f').to,code); setAirport($('#f').from,org);
    H.setTrip({from:org,to:code,city:H.hotelCity(code)}); selected=null; render(); window.scrollTo({top:0,behavior:'smooth'});
  });
  root.querySelectorAll('[data-hotel]').forEach(b=>b.onclick=()=>{
    const d=any.deals.find(x=>x.key===b.dataset.hotel); if(!d) return;
    const ci=String(d.outArr||d.outDep).slice(0,10), co=d.ret||H.fmt(H.add(H.parse(d.dep),Math.max(1,H.diff(H.parse(T.start),H.parse(T.end)))));
    H.setTrip({city:d.destCity,chosen:{ci,co}});
    STAYS.start({cities:[STAYS.city(d.dest,ci,co)],flightPP:d.pp,cur:d.cur,label:`${d.origin} → ${d.destCity}`});
  });
}

/* =====================================================================
   ROUTE MODE — date grid for one destination
   ===================================================================== */
async function loadLive(){
  const r=range(), key=JSON.stringify([T.from,T.to,T.tripType,r,T.currency,T.direct]);
  if(live.key===key) return;
  live={key,out:{},back:{},loading:true};
  const [out,back]=await Promise.all([
    FARES.perDay(T.from,T.to,monthsBetween(r.outFrom,r.outTo),T.currency,!!T.direct),
    T.tripType==='rt'?FARES.perDay(T.to,T.from,monthsBetween(r.inFrom,r.inTo),T.currency,!!T.direct):Promise.resolve({})]);
  if(live.key!==key) return;
  live.out=out; live.back=back; live.loading=false; renderRoute();
}

function combos(){
  const s=H.parse(T.start), e=H.parse(T.end), wantN=T.tripType==='rt'?H.diff(s,e):0, out=[], t=today(), F=fares();
  for(let d=-flex; d<=flex; d++){
    const dep=H.add(s,d); if(dep<t) continue;
    const rets=T.tripType==='ow'?[null]:Array.from({length:2*flex+1},(_,i)=>H.add(e,i-flex));
    rets.forEach((ret,i)=>{
      const r=ret?i-flex:0, n=ret?H.diff(dep,ret):null;
      if(ret && n<Math.max(1,T.minNights||1)) return;
      const c={dep,ret,dOff:d,rOff:r,nights:n,score:score(dep,ret,d,r,wantN),ds:H.fmt(dep),rs:ret?H.fmt(ret):null};
      const o=live.out[c.ds], b=c.rs?live.back[c.rs]:null;
      if(o && (!c.rs || b)){ c.livePP=o.price+(b?b.price:0); c.liveCur=o.cur; c.liveTotal=c.livePP*pax();
        c.al=[...new Set([o.airline||'FR',b&&(b.airline||'FR')].filter(Boolean))]; c.ryan=o.src==='ryanair'&&(!b||b.src==='ryanair');
        c.legs=[o,b].filter(Boolean); c.srcName=c.al.map(x=>AIRLINES[x]||x).join(' + ')+(c.ryan?' (live)':''); }
      c.fare=F[fareKey(c.ds,c.rs)]||null;
      // best known real price for ranking
      const cands=[]; if(c.liveTotal!=null) cands.push({p:c.liveTotal,src:c.srcName,cur:c.liveCur,live:true}); if(c.fare) cands.push({p:c.fare.price,src:c.fare.site,cur:c.fare.cur});
      c.best=cands.sort((a,b)=>a.p-b.p)[0]||null;
      out.push(c);
    });
  }
  return out;
}
const shiftText=c=>{ const f=n=>n===0?'on plan':(n>0?'+':'')+n+'d'; return c.ret?`leave ${f(c.dOff)}, return ${f(c.rOff)}`:`${f(c.dOff)} from plan`; };

function renderRoute(){
  const C=combos(), hasLive=C.some(c=>c.liveTotal!=null);
  $('#liveTag').classList.toggle('hidden',!hasLive);
  // picks
  const priced=C.filter(c=>c.best).sort((a,b)=>a.best.p-b.best.p), est=C.filter(c=>!c.best).sort((a,b)=>a.score-b.score);
  const picks=priced.slice(0,3);
  for(const c of est){ if(picks.length>=3) break; if(picks.filter(p=>!p.best).some(p=>p.ds===c.ds||p.rs===c.rs)) continue; picks.push(c); }
  $('#picksSub').textContent = live.loading ? 'Checking live Ryanair prices…'
    : priced.length ? `${C.length} date combinations checked. ${hasLive?'Ryanair flies this route, so these are real prices':'Ranked by the fares you saved'}${picks.length>priced.length?', topped up with estimates':''}.`
    : `${C.length} date combinations checked. Ryanair doesn't fly this route, so these are estimates. Open the sites and save what you find.`;
  if(!C.length){ $('#picks').innerHTML='<div class="empty" style="grid-column:1/-1">No valid date combinations. Dates must be in the future.</div>'; }
  else $('#picks').innerHTML=picks.map((c,i)=>{
    const t=tier(c.score);
    const badge=c.best?`<span class="badge" style="background:var(--ocean)">${i===0?'Cheapest found':'Real price'}</span>`:`<span class="badge b-${t}">${TIER_LABEL[t]}</span>`;
    return `<div class="pick"><span class="rank">#${i+1}</span>${badge}
      <h3>${H.nice(c.dep)}${c.ret?' → '+H.nice(c.ret):''}</h3>
      <div class="meta">${c.ret?c.nights+' nights · ':''}${shiftText(c)}</div>
      ${c.best?`<div class="price">${H.money(c.best.p,c.best.cur)}</div><div class="meta">${c.best.live?c.al.map(x=>H.alLogo(x)).join('')+' ':''}${pax()} traveller${pax()>1?'s':''} · ${H.esc(c.best.src)}${c.best.live?` · ${H.money(c.livePP,c.liveCur)} pp`:''}</div>`:''}
      <div class="actions">
        ${c.ryan?`<a class="btn primary sm" target="_blank" rel="noopener" href="${H.esc(RYANAIR.bookUrl(opts(c.ds,c.rs)))}">Ryanair ↗</a>`:(c.legs||[]).map((l,i)=>l.link?`<a class="btn primary sm" target="_blank" rel="noopener" href="${H.esc(l.link)}">${i?'Return':'Outbound'} ↗</a>`:'').join('')}
        <a class="btn ${c.liveTotal!=null&&(c.ryan||(c.legs||[]).some(l=>l.link))?'ghost':'primary'} sm" target="_blank" rel="noopener" href="${H.esc(FLIGHT_SITES[0].url(opts(c.ds,c.rs)))}">Google Flights ↗</a>
        <button class="btn ghost sm" data-pick="${c.ds}|${c.rs||''}">All sites</button></div></div>`;
  }).join('');
  $('#picks').querySelectorAll('[data-pick]').forEach(b=>b.onclick=()=>{ const [d,r]=b.dataset.pick.split('|'); select(C.find(c=>c.ds===d&&(c.rs||'')===r)); });
  renderMatrix(C); renderFares();
  if(selected){ const c=C.find(c=>c.ds===selected.ds&&c.rs===selected.rs); c?showDetail(c,hasLive):$('#detail').classList.remove('show'); }
}

function renderMatrix(C){
  const m=$('#matrix');
  if(!C.length){ m.innerHTML='<tr><td class="na">No combinations</td></tr>'; return; }
  const min=Math.min(...C.filter(c=>c.best).map(c=>c.best.p));
  const cls=c=>c.best?(c.best.p===min?'c-best':'c-price'):'c-'+tier(c.score);
  const isSel=c=>selected&&selected.ds===c.ds&&selected.rs===c.rs?' sel':'';
  const txt=c=>c.best?`${H.money(c.best.p,c.best.cur)}<small>${c.nights?c.nights+'n · ':''}${c.best.live?H.esc(c.al.join('+')):H.esc(c.best.src)}</small>`
                     :`${c.nights?c.nights+' nights':H.dow(c.dep)}<small>${live.loading?'checking…':TIER_LABEL[tier(c.score)].replace('Likely ','')}</small>`;
  if(T.tripType==='ow'){
    m.innerHTML=`<tr>${C.map(c=>`<th class="${c.dOff===0?'want':''}">${H.nice(c.dep)}</th>`).join('')}</tr>
      <tr>${C.map(c=>`<td class="${cls(c)}${c.dOff===0?' target':''}${isSel(c)}" data-k="${c.ds}|">${txt(c)}</td>`).join('')}</tr>`;
  }else{
    const deps=[...new Set(C.map(c=>c.ds))].sort(), rets=[...new Set(C.map(c=>c.rs))].sort(), map={};
    C.forEach(c=>map[c.ds+'|'+c.rs]=c);
    m.innerHTML=`<tr><th class="corner">Leave ↓ / Return →</th>${rets.map(r=>`<th class="${r===T.end?'want':''}">${H.nice(H.parse(r))}</th>`).join('')}</tr>`+
      deps.map(d=>`<tr><th class="${d===T.start?'want':''}" style="text-align:right">${H.nice(H.parse(d))}</th>${rets.map(r=>{
        const c=map[d+'|'+r]; if(!c) return '<td class="na">·</td>';
        return `<td class="${cls(c)}${(c.dOff===0&&c.rOff===0)?' target':''}${isSel(c)}" data-k="${d}|${r}">${txt(c)}</td>`;
      }).join('')}</tr>`).join('');
  }
  m.querySelectorAll('td[data-k]').forEach(td=>td.onclick=()=>{ const [d,r]=td.dataset.k.split('|'); select(C.find(c=>c.ds===d&&(c.rs||'')===r)); });
}

function select(c){ selected={ds:c.ds,rs:c.rs}; renderRoute(); $('#detail').scrollIntoView({behavior:'smooth',block:'start'}); }
function showDetail(c,hasLive){
  const o=opts(c.ds,c.rs), sites=hasLive?[RY_SITE,...FLIGHT_SITES]:FLIGHT_SITES;
  $('#dTitle').innerHTML=`✈️ ${H.nice(c.dep)}${c.ret?' → '+H.nice(c.ret):''}`;
  $('#dSub').textContent=`${T.from} → ${T.to}${c.ret?' · '+c.nights+' nights':''} · ${shiftText(c)}`+
    (c.liveTotal!=null?` · Ryanair live: ${H.money(c.livePP,c.liveCur)} pp, ≈ ${H.money(c.liveTotal,c.liveCur)} total`:` · estimate: ${TIER_LABEL[tier(c.score)].toLowerCase()}`);
  $('#dSites').innerHTML=siteButtons(sites,o);
  $('#fSite').innerHTML=sites.map(s=>`<option>${s.name}</option>`).join('')+'<option>Airline website</option><option>Other</option>';
  $('#fPrice').value=c.fare?c.fare.price:''; $('#fNote').value=c.fare?c.fare.note||'':''; if(c.fare) $('#fSite').value=c.fare.site;
  $('#openAll').onclick=()=>openAll(sites,o);
  $('#useHotel').onclick=()=>{ H.setTrip({city:H.hotelCity(T.to),chosen:{ci:c.ds,co:c.rs||H.fmt(H.add(c.dep,Math.max(1,H.diff(H.parse(T.start),H.parse(T.end)))))}}); location.href='hotels.html'; };
  $('#fSave').onclick=()=>{
    const p=parseFloat($('#fPrice').value), F=fares(), k=fareKey(c.ds,c.rs);
    if(isNaN(p)){ if(F[k]){ delete F[k]; H.save('fares',F); H.toast('Fare removed'); renderRoute(); } else H.toast('Enter a price first'); return; }
    F[k]={price:p,site:$('#fSite').value,note:$('#fNote').value.trim(),from:T.from,to:T.to,dep:c.ds,ret:c.rs,cabin:T.cabin,cur:T.currency,at:Date.now()};
    H.save('fares',F); H.toast('Fare saved 🎉'); renderRoute();
  };
  $('#detail').classList.add('show');
}

function renderFares(){
  const all=Object.entries(fares()).filter(([k,f])=>f.from===T.from&&f.to===T.to).sort((a,b)=>a[1].price-b[1].price);
  if(!all.length){ $('#fares').innerHTML='<div class="empty">No fares saved yet. Click a date, open a site, and write down what you see. 🐚</div>'; return; }
  $('#fares').innerHTML=all.map(([k,f],i)=>{
    const d=H.parse(f.dep), r=f.ret?H.parse(f.ret):null;
    return `<div class="item${i===0?' best':''}"><div><div class="t">${i===0?'🏆 ':''}${H.nice(d)}${r?' → '+H.nice(r)+` · ${H.diff(d,r)} nights`:' (one way)'}</div>
      <div class="s">${H.esc(f.site)}${f.note?' · '+H.esc(f.note):''} · ${f.cabin.replace('_',' ')}</div></div>
      <div class="row"><span class="amt">${H.money(f.price,f.cur)}</span>
      <button class="x" data-del="${H.esc(k)}" title="Remove">✕</button></div></div>`;
  }).join('');
  $('#fares').querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>{ const F=fares(); delete F[b.dataset.del]; H.save('fares',F); renderRoute(); });
}

/* =====================================================================
   MULTI-CITY — HOME → A → B → HOME
   ===================================================================== */
let mc={key:'',res:null,loading:false,msg:'',err:null};
function mcParams(){
  const s=H.parse(T.start), e=H.parse(T.end);
  const via=T.tripType==='via';
  return {mode:via?'via':'mc',from:T.from,last:via?(T.viaLast||null):null,stops:via?(T.mcStops||1):2,outFrom:H.fmt(H.add(s,-flex)),outTo:H.fmt(H.add(s,flex)),latest:H.fmt(H.add(e,flex)),
    minN:T.mcMin||3,maxN:Math.max(T.mcMin||3,T.mcMax||5),currency:T.currency,must:via?(T.viaMid||null):(T.mcMust||null)};
}
async function loadMulti(){
  const p=mcParams(), key=JSON.stringify(p); if(mc.key===key) return;
  if(p.mode==='via'&&!p.last){ mc={key,res:null,loading:false,msg:'',err:'Pick your last stop before home (e.g. Mallorca) in the form above, then press Search.'}; renderMulti(); return; }
  mc={key,res:null,loading:true,msg:'Starting…',err:null}; renderMulti();
  try{ const r=await (p.mode==='via'?MULTI.viaLoop:MULTI.search)(p,m=>{ if(mc.key===key){ mc.msg=m; renderMulti(); } }); if(mc.key!==key) return; mc.res=r; mc.note=r.note||null; }
  catch(e){ if(mc.key!==key) return; mc.err='Could not reach Ryanair. Check your internet connection and try again.'; }
  mc.loading=false; renderMulti();
}
const legLine=(l,i)=>`<div class="mc-leg"><span class="n">${i+1}</span><span>${H.alLogo(H.carrier(l.flight))} ${H.nice(H.parse(l.dep.slice(0,10)))} ${H.time(l.dep)}</span>
  <b>${l.from} → ${l.to}</b><span class="p">${priceFmt(l.price)}</span>
  <a target="_blank" rel="noopener" title="Book this flight on Ryanair" href="${H.esc(RYANAIR.bookUrl({from:l.from,to:l.to,dep:l.dep.slice(0,10),ret:null,adults:T.adults,children:T.children}))}">Book ↗</a></div>`;
const chain=it=>`<div class="chain"><span>${it.legs[0].from}</span><i>✈</i>${it.stops.map((s,i)=>`<span>${H.flag((AP.byCode(it.legs[i].to)||{}).cc)} ${H.esc(s)} <small>${it.nights[i]}n</small> <span title="${H.esc(VISA.info(it.legs[i].to).label)}">${VISA.info(it.legs[i].to).icon}</span></span><i>✈</i>`).join('')}<span>${it.legs[it.legs.length-1].to}</span></div>`;
const nightsOf=it=>it.nights.reduce((a,b)=>a+b,0);
const mcVisaOk=it=>it.legs.slice(0,-1).every(l=>VISA.pass(l.to));

function mcSorted(){
  if(!mc.res) return [];
  const q=AP.norm($('#mcQ').value.trim()), max=parseFloat($('#mcMaxP').value), sort=$('#mcSort').value;
  let L=mc.res.itineraries.filter(it=>mcVisaOk(it)&&(!q||AP.norm(it.legs.slice(0,-1).map(l=>l.city+' '+l.country+' '+l.to).join(' ')).includes(q))&&(isNaN(max)||it.total<=max));
  const nights=nightsOf;
  L.sort(sort==='long'?(a,b)=>nights(b)-nights(a)||a.total-b.total:sort==='balanced'?(a,b)=>a.total/nights(a)-b.total/nights(b):(a,b)=>a.total-b.total);
  return L;
}
function renderMulti(){
  const p=mcParams();
  const via=p.mode==='via', nLegs=via?p.stops+2:3, lastName=via?H.cityOf(p.last):'';
  $('#mcIco').textContent=via?'🧭':'🔀';
  $('#mcTitle').textContent=via?`${H.cityOf(p.from)} → ${p.stops===2?'? → ?':'?'} → ${lastName} → ${H.cityOf(p.from)}`:'Two cities, one trip';
  $('#mcSub').innerHTML=via?`Start in <b>${H.esc(H.cityOf(p.from))}</b>, let the fares pick ${p.stops===1?'a city':'two cities'}${p.must?` (in ${H.esc(H.cityOf(p.must))})`:''}, then spend your last nights in <b>${H.esc(lastName)}</b> and fly home to ${H.esc(H.cityOf(p.from))}. Every leg is a direct flight.`:`Fly from <b>${H.esc(H.cityOf(T.from))}</b> to a first city, stay a few nights, hop to a second city, then fly home. Every leg is a direct flight, and you always end up back home.`;
  $('#mcWindow').textContent=`Leaving ${H.short(H.parse(p.outFrom))}–${H.short(H.parse(p.outTo))}, home by ${H.nice(H.parse(p.latest))}, ${p.minN}–${p.maxN} nights in each city${p.must?`, visiting ${H.cityOf(p.must)}`:''}. Prices per person, all ${nLegs} flights.`;
  if(mc.loading){ $('#mcPicks').innerHTML=`<div class="loading" style="grid-column:1/-1">${H.esc(mc.msg)}</div>`; $('#mcList').innerHTML=''; return; }
  if(mc.err){ $('#mcPicks').innerHTML=`<div class="empty" style="grid-column:1/-1">${H.esc(mc.err)}</div>`; $('#mcList').innerHTML=''; return; }
  const all=mc.res?mc.res.itineraries.filter(mcVisaOk):[];
  if(!all.length){ $('#mcPicks').innerHTML=`<div class="empty" style="grid-column:1/-1">${mc.note?H.esc(mc.note)+' ':''}${mc.res&&mc.res.itineraries.length?`All ${mc.res.itineraries.length} routes were hidden by the visa filter. Tick more visa types in the 🛂 Visa filter. `:''}No routes fit these dates. Try more flexibility (±3), a later "come back" date, or fewer nights per city.</div>`; $('#mcList').innerHTML=''; return; }
  // picks: cheapest, then the cheapest with two different cities, then the longest trip under the median price
  const L=mcSorted(), byPrice=[...all].sort((a,b)=>a.total-b.total), picks=[byPrice[0]];
  const used=it=>it.legs[0].to+'|'+it.legs[1].to;
  const cut=via?-2:-1;   // a fixed last stop is shared by every route, so compare only the cities picked by fares
  const fresh=it=>!picks.some(q=>q.legs.slice(0,cut).some(l=>it.legs.slice(0,cut).some(m=>m.to===l.to)));
  const second=byPrice.find(fresh); if(second) picks.push(second);
  const med=byPrice[Math.floor(byPrice.length/2)].total;
  const third=[...all].filter(it=>it.total<=med&&fresh(it)).sort((a,b)=>nightsOf(b)-nightsOf(a)||a.total-b.total)[0]; if(third) picks.push(third);
  const labels=['Cheapest route','Another great combo','Longest trip, still cheap'];
  $('#mcPicks').innerHTML=picks.map((it,i)=>`<div class="pick"><span class="rank">#${i+1}</span><span class="badge ${i===1?'b-good':'b-great'}">${labels[i]}</span>
      <h3>${it.stops.map(H.esc).join(' → ')}</h3>${chain(it)}
      <div class="price">${priceFmt(it.total,it.cur)}<span class="hint"> / person</span></div>
      <div class="meta">≈ ${priceFmt(it.total*pax(),it.cur)} for ${pax()} traveller${pax()>1?'s':''} · ${nightsOf(it)} nights · ${H.short(H.parse(it.start))} – ${H.short(H.parse(it.end))}</div>
      <div class="mc-legs">${it.legs.map(legLine).join('')}</div>
      <div class="actions"><button class="btn primary sm" data-mcstay="p${i}">🏨 Plan stays</button></div></div>`).join('');
  mcShown.p=picks; bindMcStays($('#mcPicks'));
  renderMcList(L);
}
function renderMcList(L){
  L=L||mcSorted();
  if(!L.length){ $('#mcList').innerHTML='<div class="empty">Nothing matches these filters.</div>'; return; }
  $('#mcList').innerHTML=`<p class="hint">${L.length} route${L.length>1?'s':''}</p>`+L.slice(0,60).map((it,i)=>`<div class="deal mc-row">
      <div style="grid-column:1/3">${chain(it)}<div class="mc-legs compact">${it.legs.map(legLine).join('')}</div></div>
      <div class="amt">${priceFmt(it.total,it.cur)}<small>per person · ${nightsOf(it)} nights<br>≈ ${priceFmt(it.total*pax(),it.cur)} total</small>
        <button class="btn ghost sm" style="margin-top:6px" data-mcstay="l${i}">🏨 Stays</button></div></div>`).join('');
  mcShown.l=L; bindMcStays($('#mcList'));
}
const mcShown={p:[],l:[]};
function bindMcStays(root){ root.querySelectorAll('[data-mcstay]').forEach(b=>b.onclick=()=>{
  const k=b.dataset.mcstay, it=mcShown[k[0]][+k.slice(1)]; if(!it) return;
  STAYS.start({cities:STAYS.fromLegs(it.legs),flightPP:it.total,cur:it.cur,label:[it.legs[0].from,...it.stops,it.legs[it.legs.length-1].to].join(' → ')}); }); }

/* =====================================================================
   FARE CALENDAR — week strip / month grid with the lowest fare per day
   ===================================================================== */
const cal={view:H.load('calView','week'),route:'',outAnchor:null,backAnchor:null,outMonth:null,backMonth:null,data:{},loaded:new Set(),pending:new Set()};
const WD=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
function priceFmt(n,cur){ try{ return new Intl.NumberFormat('en',{style:'currency',currency:cur||T.currency,maximumFractionDigits:0}).format(n); }catch(e){ return H.money(n,cur); } }
const legKey=(a,b)=>`${a}-${b}-${T.currency}-${T.direct?1:0}`;

/* make sure the months covering `dates` are loaded for leg a→b */
function ensureMonths(a,b,dates){
  const k=legKey(a,b); cal.data[k]=cal.data[k]||{};
  const months=[...new Set(dates.map(d=>d.slice(0,7)))].filter(m=>!cal.loaded.has(k+m)&&!cal.pending.has(k+m));
  if(!months.length) return;
  months.forEach(m=>cal.pending.add(k+m));
  FARES.perDay(a,b,months.map(m=>m+'-01'),T.currency,!!T.direct).then(res=>{
    Object.assign(cal.data[k],res); months.forEach(m=>{ cal.pending.delete(k+m); cal.loaded.add(k+m); }); renderCal(); });
}
function dayInfo(a,b,ds){
  const k=legKey(a,b), m=ds.slice(0,7);
  if(H.parse(ds)<today()) return {state:'past'};
  if(!cal.loaded.has(k+m)) return {state:'load'};
  const p=(cal.data[k]||{})[ds]; return p?{state:'ok',price:p.price,cur:p.cur,dep:p.dep,arr:p.arr,airline:p.airline||'FR',stops:p.stops||0,link:p.link||null,src:p.src||'ryanair'}:{state:'none'};
}
function dayBtn(a,b,ds,sel,disabled,extra=''){
  const d=H.parse(ds), info=dayInfo(a,b,ds);
  const pr=info.state==='ok'?`<span class="pr">${priceFmt(info.price,info.cur)}</span><span class="dal">${H.alLogo(info.airline)}${info.stops?`<i>${info.stops} stop</i>`:''}</span>`:info.state==='load'?'<span class="pr load"></span>':`<span class="pr none">${info.state==='past'?'':'no flight'}</span>`;
  return `<button type="button" class="day${ds===sel?' sel':''}${extra}" data-d="${ds}" ${disabled||info.state==='past'?'disabled':''}>
    <span class="dw">${H.dow(d)}</span><span class="dd">${d.getDate()} ${d.toLocaleDateString('en-GB',{month:'short'})}</span>${pr}</button>`;
}

function renderStrip(el,a,b,sel,anchor,minDate,which){
  const days=Array.from({length:7},(_,i)=>H.fmt(H.add(H.parse(anchor),i-3)));
  ensureMonths(a,b,days);
  const infos=days.map(ds=>dayInfo(a,b,ds)), priced=infos.filter(i=>i.state==='ok').map(i=>i.price), low=priced.length?Math.min(...priced):null;
  const canBack=H.add(H.parse(anchor),-3)>today();
  el.innerHTML=`<div class="strip"><button type="button" class="navb" data-shift="-7" ${canBack?'':'disabled'} aria-label="Previous week">‹</button>
    <div class="days">${days.map((ds,i)=>dayBtn(a,b,ds,sel,minDate&&ds<=minDate,(infos[i].state==='ok'&&infos[i].price===low)?' low':'')).join('')}</div>
    <button type="button" class="navb" data-shift="7" aria-label="Next week">›</button></div>`;
  el.querySelectorAll('[data-shift]').forEach(btn=>btn.onclick=()=>{ cal[which+'Anchor']=H.fmt(H.add(H.parse(anchor),+btn.dataset.shift)); renderCal(); });
  el.querySelectorAll('.day[data-d]').forEach(btn=>btn.onclick=()=>pickDay(which,btn.dataset.d));
}

function renderMonth(el,a,b,sel,month,minDate,which,rangeFrom,rangeTo){
  const first=H.parse(month+'-01'), n=new Date(first.getFullYear(),first.getMonth()+1,0).getDate();
  const days=Array.from({length:n},(_,i)=>H.fmt(H.add(first,i)));
  ensureMonths(a,b,days);
  const prices=days.map(ds=>dayInfo(a,b,ds)).filter(i=>i.state==='ok').map(i=>i.price).sort((x,y)=>x-y);
  const q1=prices[Math.floor(prices.length/3)], q2=prices[Math.floor(prices.length*2/3)];
  const tierOf=p=>p<=q1?' t1':p<=q2?' t2':' t3';
  const lead=(first.getDay()+6)%7;
  const prevOk=new Date(first.getFullYear(),first.getMonth(),1)>new Date(today().getFullYear(),today().getMonth(),1);
  el.innerHTML=`<div class="month"><div class="mh"><button type="button" data-m="-1" ${prevOk?'':'disabled'}>‹</button>
      <b>${first.toLocaleDateString('en-GB',{month:'long',year:'numeric'})}</b><button type="button" data-m="1">›</button></div>
    <div class="mgrid">${WD.map(w=>`<div class="wd">${w}</div>`).join('')}${'<div class="blank"></div>'.repeat(lead)}
    ${days.map(ds=>{ const i=dayInfo(a,b,ds); const inr=rangeFrom&&rangeTo&&ds>rangeFrom&&ds<rangeTo?' inrange':'';
      return dayBtn(a,b,ds,sel,minDate&&ds<=minDate,(i.state==='ok'?tierOf(i.price):'')+inr); }).join('')}</div></div>`;
  el.querySelectorAll('[data-m]').forEach(btn=>btn.onclick=()=>{ const d=new Date(first.getFullYear(),first.getMonth()+(+btn.dataset.m),1); cal[which+'Month']=H.fmt(d).slice(0,7); renderCal(); });
  el.querySelectorAll('.day[data-d]').forEach(btn=>btn.onclick=()=>pickDay(which,btn.dataset.d));
}

function pickDay(which,ds){
  const f=$('#f'); const patch={};
  if(which==='out'){
    patch.start=ds; cal.outAnchor=ds;
    if(T.tripType==='rt' && T.end<=ds){ const n=Math.max(1,H.diff(H.parse(T.start),H.parse(T.end))); patch.end=H.fmt(H.add(H.parse(ds),n)); cal.backAnchor=patch.end; cal.backMonth=patch.end.slice(0,7); }
  } else { patch.end=ds; cal.backAnchor=ds; }
  H.setTrip(patch); f.start.value=H.trip().start; f.end.value=H.trip().end;
  selected=null; $('#detail').classList.remove('show'); render();
}

function renderCal(){
  if(H.isDealMode(T)) return;
  const route=`${T.from}-${T.to}-${T.currency}`;
  if(cal.route!==route){ cal.route=route; cal.outAnchor=T.start; cal.backAnchor=T.end; cal.outMonth=T.start.slice(0,7); cal.backMonth=T.end.slice(0,7); }
  // keep the selected day in view
  if(Math.abs(H.diff(H.parse(cal.outAnchor),H.parse(T.start)))>3) cal.outAnchor=T.start;
  if(Math.abs(H.diff(H.parse(cal.backAnchor),H.parse(T.end)))>3) cal.backAnchor=T.end;
  const rt=T.tripType==='rt';
  document.querySelectorAll('#calView button').forEach(b=>b.classList.toggle('on',b.dataset.v===cal.view));
  $('#legOutRoute').textContent=`${H.cityOf(T.from)} (${T.from}) → ${H.cityOf(T.to)} (${T.to})`;
  $('#legBackRoute').textContent=`${H.cityOf(T.to)} (${T.to}) → ${H.cityOf(T.from)} (${T.from})`;
  $('#legBack').classList.toggle('hidden',!rt); $('#legs').classList.toggle('mview',cal.view==='month');
  if(cal.view==='week'){
    renderStrip($('#calOut'),T.from,T.to,T.start,cal.outAnchor,null,'out');
    if(rt) renderStrip($('#calBack'),T.to,T.from,T.end,cal.backAnchor,T.start,'back');
  }else{
    renderMonth($('#calOut'),T.from,T.to,T.start,cal.outMonth,null,'out',null,null);
    if(rt) renderMonth($('#calBack'),T.to,T.from,T.end,cal.backMonth,T.start,'back',T.start,T.end);
  }
  // summary bar
  const o=dayInfo(T.from,T.to,T.start), b=rt?dayInfo(T.to,T.from,T.end):null;
  const okO=o.state==='ok', okB=!rt||(b&&b.state==='ok'), loading=o.state==='load'||(b&&b.state==='load');
  const pp=okO&&okB?o.price+(b&&b.state==='ok'?b.price:0):null, cur=(okO&&o.cur)||T.currency;
  const nights=rt?H.diff(H.parse(T.start),H.parse(T.end)):null;
  const q=opts(T.start,rt?T.end:null);
  const sumAl=[...new Set([o,b].filter(x=>x&&x.state==='ok').map(x=>x.airline))];
  const allRyan=o.src==='ryanair'&&(!rt||(b&&b.src==='ryanair'));
  const legBtn=(x,i)=>!x||x.state!=='ok'?'':x.src==='ryanair'
    ?`<a class="btn primary sm" target="_blank" rel="noopener" href="${H.esc(RYANAIR.bookUrl(i?{from:T.to,to:T.from,dep:T.end,ret:null,adults:T.adults,children:T.children}:{from:T.from,to:T.to,dep:T.start,ret:null,adults:T.adults,children:T.children}))}">${i?'Return':'Outbound'} on Ryanair ↗</a>`
    :x.link?`<a class="btn primary sm" target="_blank" rel="noopener" href="${H.esc(x.link)}">${i?'Return':'Outbound'} ↗</a>`:'';
  $('#calSum').innerHTML=`
    <div class="it" style="flex-direction:row;align-items:center;gap:8px">${sumAl.map(x=>H.alLogo(x)).join('')||H.alLogo('FR')}<div class="it"><small>Airline</small><b>${H.esc(sumAl.map(x=>AIRLINES[x]||x).join(' + ')||'—')}</b></div></div>
    <div class="it"><small>Departure</small><b>${H.nice(H.parse(T.start))}${okO?' · '+H.time(o.dep):''}</b></div>
    ${rt?`<div class="it"><small>Return</small><b>${H.nice(H.parse(T.end))}${b&&b.state==='ok'?' · '+H.time(b.dep):''}</b></div><div class="it"><small>Stay</small><b>${nights} night${nights>1?'s':''}</b></div>`:''}
    <div class="it"><small>${pp!=null?`Per person ${priceFmt(pp,cur)}`:'Lowest price'}</small>
      <span class="tot">${pp!=null?priceFmt(pp*pax(),cur):loading?'…':'—'}</span>
      <small style="opacity:.8;text-transform:none;letter-spacing:0">${pp!=null?`total for ${pax()} traveller${pax()>1?'s':''}`:loading?'loading prices':'no fare found that day; compare on other sites →'}</small></div>
    <div class="row">
      ${pp!=null&&allRyan?`<a class="btn primary sm" target="_blank" rel="noopener" href="${H.esc(RYANAIR.bookUrl(q))}">Book on Ryanair ↗</a>`:pp!=null?[o,b].map(legBtn).join(''):''}
      <a class="btn ghost sm" target="_blank" rel="noopener" href="${H.esc(FLIGHT_SITES[0].url(q))}">Google Flights ↗</a>
      <a class="btn ghost sm" target="_blank" rel="noopener" href="${H.esc(FLIGHT_SITES[1].url(q))}">Skyscanner ↗</a>
      ${rt?'<button class="btn ghost sm" id="calStays">🏨 Stays</button>':''}
    </div>`;
  const cs=$('#calStays'); if(cs) cs.onclick=()=>STAYS.start({cities:[STAYS.city(T.to,(okO&&o.arr?String(o.arr):T.start).slice(0,10),T.end)],flightPP:pp,cur,label:`${T.from} → ${H.cityOf(T.to)}`});
}

/* =====================================================================
   page
   ===================================================================== */
function render(){
  T=H.trip(); flex=T.flex; tripType=T.tripType;
  const isMc=T.tripType==='mc'||T.tripType==='via';
  $('#multiMode').classList.toggle('hidden',!isMc);
  if(isMc){
    $('#anyMode').classList.add('hidden'); $('#routeMode').classList.add('hidden');
    $('#routeTitle').innerHTML=T.tripType==='via'?`${H.esc(H.cityOf(T.from))} <em>→ ? →</em> ${H.esc(T.viaLast?H.cityOf(T.viaLast):'last stop')} <em>→</em> home`:`${H.esc(H.cityOf(T.from))} <em>→ 2 cities →</em> home`;
    $('#routeSub').textContent=`${H.nice(H.parse(T.start))} – ${H.nice(H.parse(T.end))} · ±${T.flex} days · ${T.adults} adult${T.adults>1?'s':''}${T.children?' + '+T.children+' child':''}`;
    renderMulti(); loadMulti(); return;
  }
  const isAny=H.isDealMode(T);
  $('#anyMode').classList.toggle('hidden',!isAny); $('#routeMode').classList.toggle('hidden',isAny);
  $('#routeTitle').innerHTML=T.from==='ANY'?`anywhere 🌍 <em>→</em> ${H.esc(H.cityOf(T.to))}`:T.to==='ANY'?`${H.esc(H.cityOf(T.from))} <em>→</em> anywhere 🌍`:`${H.esc(H.cityOf(T.from))} <em>→</em> ${H.esc(H.cityOf(T.to))}`;
  $('#routeSub').textContent=`${H.nice(H.parse(T.start))}${T.tripType==='rt'?' – '+H.nice(H.parse(T.end)):' (one way)'} · ±${T.flex} days · ${T.adults} adult${T.adults>1?'s':''}${T.children?' + '+T.children+' child':''}`;
  if(isAny){ renderAnywhere(); loadAnywhere(); }
  else { const v=VISA.info(T.to); $('#routeSub').textContent+=` · ${v.icon} ${v.label} (Turkish passport)`; renderCal(); renderRoute(); loadLive(); }
}

document.addEventListener('DOMContentLoaded',()=>{
  const qp=new URLSearchParams(location.search), patch={};
  ['from','to','start','end'].forEach(k=>{ if(qp.get(k)) patch[k]=k.length<4?qp.get(k).toUpperCase():qp.get(k); });
  if(patch.to) patch.city=H.hotelCity(patch.to);
  if(/^(week|month)$/.test(qp.get('cal')||'')) cal.view=qp.get('cal');
  if(/^(rt|ow|mc|via)$/.test(qp.get('trip')||'')) patch.tripType=qp.get('trip');
  if(qp.get('visa')) patch.visaSel=qp.get('visa').split(',').filter(k=>VISA.ALL.includes(k));
  if(Object.keys(patch).length) H.setTrip(patch);
  const f=$('#f'); T=H.trip(); flex=T.flex; tripType=T.tripType;
  setAirport(f.from,T.from); setAirport(f.to,T.to);
  f.start.value=T.start; f.end.value=T.end; f.adults.value=T.adults; f.children.value=T.children; f.cabin.value=T.cabin;
  f.currency.value=T.currency; f.minNights.value=T.minNights||''; f.nearby.checked=!!T.nearby; f.direct.checked=!!T.direct;
  const pills=[...document.querySelectorAll('#flexPills button')], segs=[...document.querySelectorAll('#tripType button')];
  const paint=()=>{ pills.forEach(b=>b.classList.toggle('on',+b.dataset.v===flex)); segs.forEach(b=>b.classList.toggle('on',b.dataset.v===tripType));
    $('#endWrap').style.display=tripType==='ow'?'none':'';
    // multi-city starts and ends at home, so "To" and the swap button don't apply
    const mcOn=tripType==='mc', viaOn=tripType==='via';
    // multi-city and the via route start and end at home: the route row below replaces "To"
    f.to.closest('label').style.display=(mcOn||viaOn)?'none':''; $('#swap').style.display=(mcOn||viaOn)?'none':'';
    document.querySelectorAll('.via-only').forEach(el=>el.style.display=viaOn?'':'none'); $('#mcMustLbl').parentNode.style.display=viaOn?'none':'';
    f.nearby.closest('label').style.visibility=(mcOn||viaOn)?'hidden':'';
    $('#mcStopsWrap').style.display=viaOn?'':'none'; };
  pills.forEach(b=>b.onclick=()=>{flex=+b.dataset.v;paint();submit();});
  segs.forEach(b=>b.onclick=()=>{tripType=b.dataset.v;paint();submit();});
  paint();
  $('#swap').onclick=()=>{ const a=H.codeOf(f.from), b=H.codeOf(f.to);
    setAirport(f.from,b); setAirport(f.to,a); submit(); };
  f.start.onchange=()=>{ if(f.end.value<=f.start.value) f.end.value=H.fmt(H.add(H.parse(f.start.value),7)); };
  function submit(){
    const from=H.codeOf(f.from), to=H.codeOf(f.to);
    if(!from){ H.toast('Pick where you fly from, or choose 🌍 Anywhere'); f.from.focus(); return; }
    if(from==='ANY'&&(to==='ANY'||tripType==='mc')){ H.toast(tripType==='mc'?'Multi-city needs a home airport (e.g. NUE)':'Pick a city or country on at least one side'); f.from.focus(); return; }
    if(tripType==='via'&&(from==='ANY'||H.isCountry(from))){ H.toast('Pick your home airport in From (e.g. NUE)'); f.from.focus(); return; }
    if(tripType==='mc'&&H.isCountry(from)){ H.toast('Multi-city needs a home airport (e.g. NUE), not a whole country'); f.from.focus(); return; }
    if(!to&&tripType!=='mc'){ H.toast('Pick a destination, or choose 🌍 Anywhere'); f.to.focus(); return; }
    if(tripType!=='ow'&&f.end.value<=f.start.value){ H.toast('Return must be after departure'); return; }
    let viaPatch={};
    if(tripType==='via'){
      const vm=$('#viaMid').value.trim()?H.codeOf($('#viaMid')):'ANY', vl=$('#viaLast').value.trim()?H.codeOf($('#viaLast')):'';
      if(!vl||vl==='ANY'){ H.toast('Pick your last stop before home, e.g. Mallorca'); $('#viaLast').focus(); return; }
      if(vl===from){ H.toast('The last stop must be different from home'); $('#viaLast').focus(); return; }
      viaPatch={viaMid:vm&&vm!=='ANY'?vm:null,viaLast:vl};
    }
    H.setTrip({...viaPatch,from,to:to||T.to,city:H.hotelCity(to||T.to),start:f.start.value,end:f.end.value,flex,tripType,nearby:f.nearby.checked,
      adults:+f.adults.value||1,children:+f.children.value||0,cabin:f.cabin.value,currency:f.currency.value,minNights:+f.minNights.value||0,direct:f.direct.checked});
    selected=null; $('#detail').classList.remove('show'); render();
  }
  f.onsubmit=e=>{e.preventDefault();submit();};
  visaMultiSelect($('#visaMs'),()=>render());
  f.direct.addEventListener('change',submit);
  TP.available().then(ok=>{ document.body.classList.toggle('tp-on',ok);
    $('#tpBanner').classList.toggle('hidden',ok);
    if(!ok) $('#tpBanner').innerHTML=/^https?:$/.test(location.protocol)
      ?'⚠️ <b>Showing Ryanair only.</b> The local server is running but has no Travelpayouts key. Put your key in <code>travelpayouts.key</code> in the site folder and restart <code>start.bat</code>.'
      :'⚠️ <b>Showing Ryanair only.</b> You opened this page as a file. To see <b>every airline</b> (Pegasus, Wizz Air, SunExpress, THY…), close this tab and double-click <b><code>start.bat</code></b> in the site folder. The site then opens at <code>http://localhost:8080</code>.';
    $('#srcNote').innerHTML=ok
      ?'✈️ <b>All airlines</b>: Ryanair prices are <b>live</b>; other airlines (Pegasus, Wizz Air, SunExpress, THY, Lufthansa and more) come from <b>recent Aviasales searches</b> and can change. Multi-city routes still use Ryanair only. Always check the final price on the booking site.'
      :'⚠️ <b>Only Ryanair right now.</b> To add every airline, close this tab and double-click <code>start.bat</code> in the site folder. It opens the site at <code>http://localhost:8080</code>.';
    $('#calSrc').innerHTML=ok?'<span class="live-tag" style="background:#e3eefc;color:#1d4f91">All airlines</span>':H.alLogo('FR',true);
    if(ok){ any.key=''; live.key=''; cal.data={}; cal.loaded=new Set(); render(); } });   // filtering only: no new search needed
  document.querySelectorAll('#calView button').forEach(b=>b.onclick=()=>{ cal.view=b.dataset.v; H.save('calView',cal.view);
    cal.outMonth=T.start.slice(0,7); cal.backMonth=T.end.slice(0,7); renderCal(); });
  // multi-city controls
  setAirport($('#viaMid'),T.viaMid||'ANY');
  if(!T.viaLast&&T.to&&T.to!=='ANY'&&T.to!==T.from) H.setTrip({viaLast:T.to}); if(H.trip().viaLast) setAirport($('#viaLast'),H.trip().viaLast);
  $('#mcStops').value=T.mcStops||1; $('#mcMin').value=T.mcMin||3; $('#mcMax').value=T.mcMax||5; if(T.mcMust) setAirport($('#mcMust'),T.mcMust);
  $('#mcGo').onclick=()=>{ const mn=Math.max(1,+$('#mcMin').value||3), mx=Math.max(mn,+$('#mcMax').value||mn);
    $('#mcMin').value=mn; $('#mcMax').value=mx;
    const vm=$('#viaMid').value.trim()?H.codeOf($('#viaMid')):'ANY', vl=$('#viaLast').value.trim()?H.codeOf($('#viaLast')):'';
    if(T.tripType==='via'&&(!vl||vl==='ANY')){ H.toast('Pick your last stop, e.g. Mallorca'); $('#viaLast').focus(); return; }
    if(T.tripType==='via'&&vl===T.from){ H.toast('The last stop must be different from home'); return; }
    H.setTrip({viaMid:vm&&vm!=='ANY'?vm:null,viaLast:vl||null,mcStops:+$('#mcStops').value||1,mcMin:mn,mcMax:mx,mcMust:$('#mcMust').value.trim()?H.codeOf($('#mcMust'))||null:null}); render(); };
  $('#mcStops').addEventListener('change',()=>$('#mcGo').click());
  ['#viaMid','#viaLast'].forEach(s=>$(s).addEventListener('change',()=>{ if(tripType==='via'&&$('#viaLast').value.trim()) submit(); }));
  $('#mcSort').addEventListener('change',()=>{ if(!mc.loading&&mc.res) renderMcList(); });
  ['#mcQ','#mcMaxP'].forEach(s=>$(s).addEventListener('input',()=>{ if(!mc.loading&&mc.res) renderMcList(); }));
  ['#qDest','#qMax','#qSort'].forEach(s=>$(s).addEventListener('input',()=>{ if(!any.loading) renderDealList(); }));
  $('#clearFares').onclick=()=>{ if(!confirm('Remove all saved fares for this route?')) return;
    const F=fares(); for(const k in F) if(F[k].from===T.from&&F[k].to===T.to) delete F[k]; H.save('fares',F); renderRoute(); };
  render();
});
})();
