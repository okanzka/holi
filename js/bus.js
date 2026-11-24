/* ============ Heybe — buses page (FlixBus live prices, also FlixTrain): one way, round trip, or anywhere ============ */
(function(){
const $=s=>document.querySelector(s);
const today=()=>H.fmt(new Date());
const blank=()=>({rides:{},day:null});
let st={out:blank(),back:blank(),key:'',loading:false}, anyKey='';

const S=()=>H.load('bus',{});
const days=(date,flex)=>Array.from({length:2*flex+1},(_,i)=>H.fmt(H.add(H.parse(date),i-flex))).filter(d=>d>=today());
const money=(n,cur)=>{ try{ return new Intl.NumberFormat('en',{style:'currency',currency:cur,maximumFractionDigits:2}).format(n); }catch(e){ return H.money(n,cur); } };
const cheapest=l=>l&&l.length?l.reduce((a,x)=>x.price<a.price?x:a):null;
const placeName=p=>p?p.name:'';
const each=(r,n)=>n>1?`all ${n} passengers · ${money(r.price/n,r.cur)} each`:'per person';

/* ---------- one route: cheapest day strip and rides, for the way there and (round trip) the way back ---------- */
function renderDays(dir){
  const s=S(), D=st[dir], list=days(dir==='out'?s.date:s.back,s.flex||0), el=$(dir==='out'?'#days':'#daysBack');
  el.innerHTML=list.map(d=>{ const l=D.rides[d], c=cheapest(l);
    const txt=l===undefined?'…':l===null?'—':c?money(c.price,c.cur):'none';
    return `<button type="button" class="day${d===D.day?' on':''}${d===(dir==='out'?s.date:s.back)?' wish':''}" data-d="${d}"${c?'':' disabled'}><small>${H.esc(H.nice(H.parse(d)))}</small><b>${txt}</b></button>`; }).join('');
  const prices=list.map(d=>cheapest(D.rides[d])).filter(Boolean).map(c=>c.price), min=Math.min(...prices);
  el.querySelectorAll('button[data-d]').forEach(b=>{ const c=cheapest(D.rides[b.dataset.d]); if(c&&c.price===min&&prices.length>1) b.classList.add('best');
    b.onclick=()=>{ D.day=b.dataset.d; renderDays(dir); renderRides(dir); renderSum(); }; });
}
function rideRow(r){
  const icons=r.modes.map(m=>m==='train'?'🚆':'🚌').join(''), seats=r.seats!=null&&r.seats<=5?` · <b style="color:var(--pricey)">${r.seats} seat${r.seats>1?'s':''} left</b>`:'';
  return `<div class="deal ride"><div><div class="t">${icons} ${H.time(r.dep)} → ${H.time(r.arr)}${r.arr.slice(0,10)>r.dep.slice(0,10)?' <small>+1</small>':''}</div>
      <div class="hint">${hm(r.mins)} · ${r.transfers?r.transfers+' change'+(r.transfers>1?'s':''):'Direct'}${seats}<br>${H.esc(r.fromSt)} → ${H.esc(r.toSt)}</div></div>
    <div class="amt">${money(r.price,r.cur)}<small>${each(r,S().adults||1)}</small>
      <a class="btn primary sm" style="margin-top:6px" target="_blank" rel="noopener" href="${H.esc(r.url)}">Book ↗</a>
      ${COSTS.button({kind:r.modes.every(m=>m==='train')?'train':'bus',title:`${r.fromSt} → ${r.toSt}`,sub:`FlixBus · ${H.nice(H.parse(r.dep.slice(0,10)))} ${H.time(r.dep)}`,price:r.price,cur:r.cur})}</div></div>`;
}
function renderRides(dir){
  const s=S(), D=st[dir], box=$(dir==='out'?'#rides':'#ridesBack'), back=dir==='back';
  const [a,b]=back?[s.to,s.from]:[s.from,s.to];
  $(back?'#ridesBackTitle':'#ridesTitle').textContent=D.day?`${back?'Back':'Rides'} on ${H.nice(H.parse(D.day))}`:back?'Rides back':'Rides';
  if(st.loading&&D.rides[D.day]===undefined){ box.innerHTML='<div class="loading">Looking for rides…</div>'; return; }
  const l=D.rides[D.day];
  if(l===null){ box.innerHTML='<div class="empty">Could not load rides. Check your internet connection and try again.</div>'; return; }
  if(!l||!l.length){ box.innerHTML='<div class="empty">No rides on this day. Pick another day above.</div>'; return; }
  const sort=$('#sort').value, L=[...l].sort(sort==='dep'?(x,y)=>x.dep.localeCompare(y.dep):sort==='mins'?(x,y)=>x.mins-y.mins||x.price-y.price:(x,y)=>x.price-y.price);
  // the 10 best first, so the way back stays close on a phone
  const all=D.showAll||L.length<=10;
  box.innerHTML=`<p class="hint">${L.length} ride${L.length>1?'s':''} · ${H.esc(placeName(a))} → ${H.esc(placeName(b))}</p>`+(all?L:L.slice(0,10)).map(rideRow).join('')
    +(all?'':`<div class="row end"><button type="button" class="btn ghost sm" data-all>Show all ${L.length} rides</button></div>`);
  const more=box.querySelector('[data-all]'); if(more) more.onclick=()=>{ D.showAll=true; renderRides(dir); };
}
/* round trip: the cheapest ride each way on the days picked, and the total */
function renderSum(){
  const s=S(), box=$('#rtSum'), rt=s.trip==='rt';
  box.classList.toggle('hidden',!rt);
  $('#daysTitle').textContent=rt?'Cheapest day there':'Cheapest per day';
  if(!rt) return;
  const o=cheapest(st.out.rides[st.out.day]), b=cheapest(st.back.rides[st.back.day]);
  if(!o||!b){ box.innerHTML=`<div class="${st.loading?'loading':'empty'}">${st.loading?'Looking for rides both ways…':'No round trip on these days. Pick other days below.'}</div>`; return; }
  const n=s.adults||1;
  box.innerHTML=`<div class="row" style="align-items:baseline;flex-wrap:wrap;gap:6px 14px"><h2 style="margin:0"><span class="ico">🔁</span>Round trip from ${money(o.price+b.price,o.cur)}</h2>
    <span class="hint">${n>1?`all ${n} passengers · ${money((o.price+b.price)/n,o.cur)} each`:'per person'}</span></div>
    <p class="sub" style="margin-top:6px">${H.esc(placeName(s.from))} → ${H.esc(placeName(s.to))} on <b>${H.esc(H.nice(H.parse(st.out.day)))}</b> from ${money(o.price,o.cur)},
      back on <b>${H.esc(H.nice(H.parse(st.back.day)))}</b> from ${money(b.price,b.cur)}. Pick other days below to compare.</p>`;
}
async function searchRoute(){
  const s=S(); if(!s.from||!s.to||s.to.any) return;
  const rt=s.trip==='rt', key=JSON.stringify([s.from.id,s.to.id,s.date,rt?s.back:'',s.flex,s.adults,H.trip().currency]); if(key===st.key) return;
  const outDays=days(s.date,s.flex||0), backDays=rt?days(s.back,s.flex||0):[];
  st={out:{rides:{},day:outDays.includes(s.date)?s.date:outDays[0]},back:{rides:{},day:backDays.includes(s.back)?s.back:backDays[0]},key,loading:true};
  ['out',...(rt?['back']:[])].forEach(d=>{ renderDays(d); renderRides(d); }); renderSum();
  const jobs=[...outDays.map(d=>['out',d,s.from,s.to]),...backDays.map(d=>['back',d,s.to,s.from])];
  await Promise.all(jobs.map(async([dir,d,a,b])=>{
    try{ const r=await FLIX.search({from:a.id,to:b.id,date:d,adults:s.adults,currency:H.trip().currency}); if(st.key===key) st[dir].rides[d]=r; }
    catch(e){ if(st.key===key) st[dir].rides[d]=null; }
    if(st.key===key){ renderDays(dir); if(d===st[dir].day) renderRides(dir); renderSum(); } }));
  if(st.key!==key) return;
  st.loading=false;
  // the wished day has nothing: show the cheapest day instead
  ['out','back'].forEach(dir=>{ const D=st[dir], ds=Object.keys(D.rides);
    if(ds.length&&!(D.rides[D.day]||[]).length){ const best=ds.filter(d=>cheapest(D.rides[d])).sort((x,y)=>cheapest(D.rides[x]).price-cheapest(D.rides[y]).price)[0]; if(best) D.day=best; } });
  ['out',...(rt?['back']:[])].forEach(d=>{ renderDays(d); renderRides(d); }); renderSum();
}

/* ---------- anywhere: FlixBus's popular places from this city, with live prices for the day(s) ---------- */
async function searchAnywhere(go){
  const s=S(), rt=s.trip==='rt', key=JSON.stringify([s.from.id,s.date,rt?s.back:'',s.adults,H.trip().currency]); if(key===anyKey) return;
  anyKey=key;
  const box=$('#anyPicks'), cur=H.trip().currency;
  $('#anyTitle').textContent=`${placeName(s.from)} → anywhere by bus`;
  $('#anySub').textContent=`The cheapest places ${rt?'there and back':'to go'} from ${placeName(s.from)}, leaving ${H.nice(H.parse(s.date))}${rt?`, back ${H.nice(H.parse(s.back))}`:''}. Live prices${(s.adults||1)>1?` for all ${s.adults} passengers`:', per person'}.`;
  box.innerHTML='<div class="loading" style="grid-column:1/-1">Finding places you can reach…</div>';
  try{
    const reach=(await FLIX.reachable(s.from.id,cur)).sort((a,b)=>a.min-b.min).slice(0,14);
    if(anyKey!==key) return;
    if(!reach.length){ box.innerHTML='<div class="empty" style="grid-column:1/-1">No FlixBus places found from this city.</div>'; return; }
    box.innerHTML=`<div class="loading" style="grid-column:1/-1">Checking live prices for ${reach.length} places…</div>`;
    const found=[]; const q=[...reach];
    await Promise.all(Array.from({length:4},async()=>{ while(q.length&&anyKey===key){ const c=q.shift();
      try{ const there=cheapest(await FLIX.search({from:s.from.id,to:c.id,date:s.date,adults:s.adults,currency:cur}));
        const back=there&&rt?cheapest(await FLIX.search({from:c.id,to:s.from.id,date:s.back,adults:s.adults,currency:cur})):null;
        if(there&&(!rt||back)) found.push({c,there,back,total:there.price+(back?back.price:0)}); }catch(e){} } }));
    if(anyKey!==key) return;
    found.sort((a,b)=>a.total-b.total);
    if(!found.length){ box.innerHTML='<div class="empty" style="grid-column:1/-1">No rides on these days. Try other dates.</div>'; return; }
    box.innerHTML=found.map((f,i)=>`<div class="pick"><span class="rank">#${i+1}</span>${i===0?'<span class="badge b-great">Cheapest</span>':''}
        <h3>${H.flag(f.c.country)} ${H.esc(f.c.name)}</h3><div class="meta">${H.esc(countryName(f.c.country))} · ${f.c.train&&!f.c.bus?'🚆 FlixTrain':f.c.train?'🚌 Bus · 🚆 FlixTrain':'🚌 Bus'} · ${hm(f.there.mins)}${f.there.transfers?` · ${f.there.transfers} change${f.there.transfers>1?'s':''}`:' · direct'}</div>
        <div class="price">${money(f.total,f.there.cur)}<span class="hint"> ${rt?'there and back':'one way'}</span></div>
        <div class="meta">${H.time(f.there.dep)} → ${H.time(f.there.arr)} on ${H.short(H.parse(s.date))}${f.back?` · back ${H.time(f.back.dep)} on ${H.short(H.parse(s.back))}`:''}</div>
        <div class="actions"><button class="btn primary sm" type="button" data-go="${i}">See all rides</button><a class="btn ghost sm" target="_blank" rel="noopener" href="${H.esc(f.there.url)}">Book ↗</a></div></div>`).join('');
    box.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>go(found[+b.dataset.go].c));
  }catch(e){ if(anyKey===key) box.innerHTML='<div class="empty" style="grid-column:1/-1">Could not load places. Check your internet connection and try again.</div>'; }
}

function show(){
  const s=S(), any=!!(s.to&&s.to.any), rt=s.trip==='rt';
  $('#anyBox').classList.toggle('hidden',!any); $('#routeBox').classList.toggle('hidden',any);
  document.querySelectorAll('#routeBox .rt-only').forEach(el=>el.classList.toggle('hidden',!rt));
}

document.addEventListener('DOMContentLoaded',()=>{
  const T=H.trip(), qp=new URLSearchParams(location.search);
  const s0=Object.assign({date:T.start,back:T.end,flex:1,adults:T.adults||1,trip:'ow'},S());
  if(!s0.date||s0.date<today()) s0.date=H.fmt(H.add(new Date(),7));
  if(!s0.back||s0.back<=s0.date) s0.back=H.fmt(H.add(H.parse(s0.date),3));
  const finder=(q,sig)=>FLIX.cities(q,sig);
  const from=placeBox($('#from'),finder), to=placeBox($('#to'),finder,{anywhere:'The cheapest places FlixBus goes from here'});
  if(s0.from) from.set(s0.from); if(s0.to) to.set(s0.to);
  $('#date').value=s0.date; $('#back').value=s0.back; $('#adults').value=s0.adults;
  let flex=s0.flex, trip=s0.trip;
  const pills=[...document.querySelectorAll('#flexPills button')], segs=[...document.querySelectorAll('#tripType button')];
  const paint=()=>{ pills.forEach(b=>b.classList.toggle('on',+b.dataset.v===flex)); segs.forEach(b=>b.classList.toggle('on',b.dataset.v===trip));
    document.querySelectorAll('#f .rt-only').forEach(el=>el.style.display=trip==='rt'?'':'none'); };
  pills.forEach(b=>b.onclick=()=>{ flex=+b.dataset.v; paint(); if(S().from) submit(); });
  segs.forEach(b=>b.onclick=()=>{ trip=b.dataset.v; paint(); if(S().from) submit(); });
  paint(); show();   // before any search too: no empty 'back' cards on a one-way page
  $('#date').onchange=()=>{ if($('#back').value<=$('#date').value) $('#back').value=H.fmt(H.add(H.parse($('#date').value),3)); };
  async function submit(){
    const [a,b]=await Promise.all([from.get(),to.get()]);
    if(!a||a.any){ H.toast('Pick the city you leave from'); $('#from').focus(); return; }
    if(!b){ H.toast('Pick the city you go to, or 🌍 Anywhere'); $('#to').focus(); return; }
    if(a.id===b.id){ H.toast('From and To are the same city'); $('#to').focus(); return; }
    if(!$('#date').value||$('#date').value<today()){ H.toast('Pick a date from today on'); $('#date').focus(); return; }
    if(trip==='rt'&&$('#back').value<=$('#date').value){ H.toast('Come back after you leave'); $('#back').focus(); return; }
    H.save('bus',{from:a,to:b,date:$('#date').value,back:$('#back').value,trip,flex,adults:Math.max(1,Math.min(9,+$('#adults').value||1))});
    show(); if(b.any) searchAnywhere(go); else searchRoute();
  }
  /* from an Anywhere card: search that place with the same dates */
  function go(c){ to.set({id:c.id,name:c.name,country:c.country}); submit(); window.scrollTo({top:$('#routeBox').offsetTop-80,behavior:'smooth'}); }
  $('#f').onsubmit=e=>{ e.preventDefault(); st.key=''; anyKey=''; submit(); };
  $('#sort').onchange=()=>{ renderRides('out'); if(S().trip==='rt') renderRides('back'); };
  // ?from=Berlin&to=Munich&date=2026-12-12 (e.g. from a train-or-bus gap in My flights)
  if(qp.get('from')&&qp.get('to')){ $('#from').value=qp.get('from'); $('#to').value=qp.get('to'); $('#from').place=null; $('#to').place=null;
    if(/^\d{4}-\d{2}-\d{2}$/.test(qp.get('date')||'')&&qp.get('date')>=today()) $('#date').value=qp.get('date');
    trip='ow'; paint(); submit(); }
  else if(s0.from&&s0.to){ H.save('bus',s0); show(); if(s0.to.any) searchAnywhere(go); else searchRoute(); }
});
})();
