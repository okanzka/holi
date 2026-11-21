/* ============ Heybe — trains page (Transitous timetables + live FlixTrain prices): one way, round trip, or anywhere ============ */
(function(){
const $=s=>document.querySelector(s);
const today=()=>H.fmt(new Date());
const S=()=>H.load('train',{});
let st={out:{trips:[],next:null,key:''},back:{trips:[],next:null,key:''}}, anyKey='';

/* a time shown in the station's own time zone */
const clock=(iso,tz)=>{ try{ return new Date(iso).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',timeZone:tz||undefined}); }catch(e){ return new Date(iso).toTimeString().slice(0,5); } };
const money=(n,cur)=>{ try{ return new Intl.NumberFormat('en',{style:'currency',currency:cur,maximumFractionDigits:2}).format(n); }catch(e){ return H.money(n,cur); } };
/* the town of a station, for FlixBus's city search: "Nürnberg Hbf" → "Nürnberg" */
const town=n=>String(n||'').replace(/\s*(Hbf|Hauptbahnhof|Central|Centrale|Centraal|Station|Bahnhof|Gare|Stazione).*$/i,'').split(/[,(]/)[0].trim();

function tripRow(it,a,b){
  const legs=it.legs.map(l=>`<span class="tr-leg" title="${H.esc(l.agency)}">${H.esc(l.name)}</span>`).join('<i>›</i>');
  const via=it.legs.slice(0,-1).map(l=>l.to).filter(Boolean);
  return `<div class="deal ride"><div><div class="t">${clock(it.dep,a.tz)} → ${clock(it.arr,b.tz||a.tz)}</div>
      <div class="hint">${hm(it.mins)} · ${it.transfers?it.transfers+' change'+(it.transfers>1?'s':''):'Direct'}${via.length?' at '+via.map(H.esc).join(', '):''}</div>
      <div class="tr-legs">${legs}</div></div>
    <div class="amt"><small>${H.esc([...new Set(it.legs.map(l=>l.agency).filter(Boolean))].join(', '))}</small>
      <a class="btn primary sm" style="margin-top:6px" target="_blank" rel="noopener" href="${H.esc(TRANSIT.bookUrl(it))}">Check price ↗</a></div></div>`;
}
/* dir 'out' or 'back' (round trip): its list, title and "Later trains" button */
function renderTrips(dir,msg){
  const s=S(), D=st[dir], back=dir==='back', [a,b]=back?[s.to,s.from]:[s.from,s.to], date=back?s.backDate:s.date;
  const box=$(back?'#tripsBack':'#trips');
  $(back?'#laterBack':'#later').classList.toggle('hidden',!D.next||!!msg);
  $(back?'#tripsBackTitle':'#tripsTitle').textContent=`${back?'Back':'Trains'} on ${H.nice(H.parse(date))}`;
  if(msg){ box.innerHTML=msg; return; }
  if(!D.trips.length){ box.innerHTML='<div class="empty">No trains found. Try another time, or a bigger station nearby.</div>'; return; }
  box.innerHTML=`<p class="hint">${H.esc(a.name)} → ${H.esc(b.name)}</p>`+D.trips.map(it=>tripRow(it,a,b)).join('');
}
async function loadTrips(dir,more){
  const s=S(), back=dir==='back', [a,b]=back?[s.to,s.from]:[s.from,s.to], date=back?s.backDate:s.date, time=back?s.backTime:s.time;
  const key=JSON.stringify([a,b,date,time]);
  if(!more){ if(key===st[dir].key) return; st[dir]={trips:[],next:null,key}; renderTrips(dir,'<div class="loading">Looking for trains…</div>'); }
  try{ const r=await TRANSIT.plan({from:a,to:b,time:new Date(`${date}T${time||'08:00'}`).toISOString(),cursor:more?st[dir].next:null});
    if(st[dir].key!==key) return;
    const seen=new Set(st[dir].trips.map(t=>t.dep+t.arr));
    st[dir].trips.push(...r.trips.filter(t=>!seen.has(t.dep+t.arr))); st[dir].next=r.next; renderTrips(dir); }
  catch(e){ if(st[dir].key===key) renderTrips(dir,'<div class="empty">Could not load trains. Check your internet connection and try again.</div>'); }
}
/* FlixTrain: FlixBus's own trains, with live prices, where both towns have them (both ways on a round trip) */
async function loadFlixTrain(){
  const s=S(), box=$('#flixtrain'), rt=s.trip==='rt', cur=H.trip().currency;
  box.innerHTML='<div class="loading">Checking FlixTrain…</div>';
  try{
    const [a,b]=await Promise.all([FLIX.cities(town(s.from.name)),FLIX.cities(town(s.to.name))]);
    if(!a[0]||!b[0]||a[0].id===b[0].id){ box.innerHTML='<div class="empty">No FlixTrain for these towns.</div>'; return; }
    const trains=l=>l.filter(x=>x.modes.length&&x.modes.every(m=>m==='train'));
    const [out,back]=await Promise.all([FLIX.search({from:a[0].id,to:b[0].id,date:s.date,adults:1,currency:cur}).then(trains),
      rt?FLIX.search({from:b[0].id,to:a[0].id,date:s.backDate,adults:1,currency:cur}).then(trains):Promise.resolve([])]);
    const row=x=>`<div class="deal ride"><div><div class="t">🚆 ${H.time(x.dep)} → ${H.time(x.arr)}</div>
        <div class="hint">${hm(x.mins)} · ${x.transfers?x.transfers+' change'+(x.transfers>1?'s':''):'Direct'}<br>${H.esc(x.fromSt)} → ${H.esc(x.toSt)}</div></div>
      <div class="amt">${money(x.price,x.cur)}<small>per person</small><a class="btn primary sm" style="margin-top:6px" target="_blank" rel="noopener" href="${H.esc(x.url)}">Book ↗</a></div></div>`;
    const part=(l,title,date,x,y)=>`<p class="hint">${title} · ${H.esc(H.nice(H.parse(date)))}</p>`+(l.length?l.slice(0,6).map(row).join('')
      :`<div class="empty">No FlixTrain that day. <a href="bus.html?from=${encodeURIComponent(x)}&to=${encodeURIComponent(y)}&date=${date}">See buses ↗</a></div>`);
    if(!out.length&&!back.length&&!rt){ box.innerHTML=`<div class="empty">No FlixTrain between ${H.esc(a[0].name)} and ${H.esc(b[0].name)} that day. <a href="bus.html?from=${encodeURIComponent(a[0].name)}&to=${encodeURIComponent(b[0].name)}&date=${s.date}">See buses ↗</a></div>`; return; }
    box.innerHTML=part(out,`${H.esc(a[0].name)} → ${H.esc(b[0].name)}`,s.date,a[0].name,b[0].name)+(rt?part(back,`${H.esc(b[0].name)} → ${H.esc(a[0].name)}`,s.backDate,b[0].name,a[0].name):'');
  }catch(e){ box.innerHTML='<div class="empty">Could not load FlixTrain prices.</div>'; }
}
/* anywhere: places FlixTrain goes from this town, with FlixBus's usual price; a card opens that route's timetable */
async function loadAnywhere(go){
  const s=S(), key=JSON.stringify([s.from.name,s.date,H.trip().currency]); if(key===anyKey) return; anyKey=key;
  const box=$('#anyPicks');
  $('#anyTitle').textContent=`${s.from.name} → anywhere by train`;
  $('#anySub').textContent=`Places FlixTrain goes from ${town(s.from.name)}, with its usual one-way price. Other trains have no prices here, so open a place to see every train that day.`;
  box.innerHTML='<div class="loading" style="grid-column:1/-1">Finding places FlixTrain goes…</div>';
  try{
    const c=(await FLIX.cities(town(s.from.name)))[0];
    const reach=c?(await FLIX.reachable(c.id,H.trip().currency)).filter(r=>r.train).sort((x,y)=>x.min-y.min):[];
    if(anyKey!==key) return;
    if(!reach.length){ box.innerHTML='<div class="empty" style="grid-column:1/-1">No FlixTrain from this town. Pick a place in To to see every train.</div>'; return; }
    box.innerHTML=reach.slice(0,18).map((r,i)=>`<div class="pick"><span class="rank">#${i+1}</span>${i===0?'<span class="badge b-great">Cheapest</span>':''}
        <h3>${H.flag(r.country)} ${H.esc(r.name)}</h3><div class="meta">${H.esc(countryName(r.country))} · 🚆 from ${hm(r.mins)}</div>
        <div class="price">${money(r.min,r.cur)}<span class="hint"> usual lowest, one way</span></div>
        <div class="actions"><button class="btn primary sm" type="button" data-go="${i}">🕒 See trains</button>
          <a class="btn ghost sm" target="_blank" rel="noopener" href="${H.esc(FLIX.bookUrl({from:c.id,to:r.id,date:s.date,adults:1}))}">Book FlixTrain ↗</a></div></div>`).join('');
    box.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>go(reach[+b.dataset.go]));
  }catch(e){ if(anyKey===key) box.innerHTML='<div class="empty" style="grid-column:1/-1">Could not load places. Check your internet connection and try again.</div>'; }
}
function show(){
  const s=S(), any=!!(s.to&&s.to.any), rt=s.trip==='rt';
  $('#anyBox').classList.toggle('hidden',!any); $('#routeBox').classList.toggle('hidden',any);
  document.querySelectorAll('#routeBox .rt-only').forEach(el=>el.classList.toggle('hidden',!rt));
}
function run(go){ const s=S(); show(); if(s.to.any){ loadAnywhere(go); return; } loadTrips('out'); if(s.trip==='rt') loadTrips('back'); loadFlixTrain(); }

document.addEventListener('DOMContentLoaded',()=>{
  const T=H.trip(), qp=new URLSearchParams(location.search);
  const s0=Object.assign({date:T.start,time:'08:00',backDate:T.end,backTime:'08:00',trip:'ow'},S());
  if(!s0.date||s0.date<today()) s0.date=H.fmt(H.add(new Date(),7));
  if(!s0.backDate||s0.backDate<s0.date) s0.backDate=H.fmt(H.add(H.parse(s0.date),3));
  const finder=(q,sig)=>TRANSIT.places(q,sig);
  const from=placeBox($('#from'),finder), to=placeBox($('#to'),finder,{anywhere:'Places FlixTrain goes from here, with prices'});
  if(s0.from) from.set(s0.from); if(s0.to) to.set(s0.to);
  $('#date').value=s0.date; $('#time').value=s0.time; $('#backDate').value=s0.backDate; $('#backTime').value=s0.backTime;
  let trip=s0.trip;
  const segs=[...document.querySelectorAll('#tripType button')];
  const paint=()=>{ segs.forEach(b=>b.classList.toggle('on',b.dataset.v===trip)); document.querySelectorAll('#f .rt-only').forEach(el=>el.style.display=trip==='rt'?'':'none'); };
  segs.forEach(b=>b.onclick=()=>{ trip=b.dataset.v; paint(); if(S().from) submit(); }); paint(); show();
  $('#date').onchange=()=>{ if($('#backDate').value<$('#date').value) $('#backDate').value=H.fmt(H.add(H.parse($('#date').value),3)); };
  async function submit(){
    const [a,b]=await Promise.all([from.get(),to.get()]);
    if(!a||a.any){ H.toast('Pick the station you leave from'); $('#from').focus(); return; }
    if(!b){ H.toast('Pick the station you go to, or 🌍 Anywhere'); $('#to').focus(); return; }
    if(!b.any&&a.lat===b.lat&&a.lon===b.lon){ H.toast('From and To are the same place'); $('#to').focus(); return; }
    if(!$('#date').value||$('#date').value<today()){ H.toast('Pick a date from today on'); $('#date').focus(); return; }
    if(trip==='rt'&&!b.any&&`${$('#backDate').value}T${$('#backTime').value}`<=`${$('#date').value}T${$('#time').value}`){ H.toast('Come back after you leave'); $('#backDate').focus(); return; }
    H.save('train',{from:a,to:b,date:$('#date').value,time:$('#time').value||'08:00',backDate:$('#backDate').value,backTime:$('#backTime').value||'08:00',trip});
    run(go);
  }
  /* from an Anywhere card: find that town's station and show its trains */
  async function go(r){ const p=(await TRANSIT.places(r.name).catch(()=>[]))[0]; if(!p){ H.toast('Could not find a station for '+r.name); return; }
    to.set(p); await submit(); window.scrollTo({top:$('#routeBox').offsetTop-80,behavior:'smooth'}); }
  $('#f').onsubmit=e=>{ e.preventDefault(); st.out.key=''; st.back.key=''; anyKey=''; submit(); };
  $('#later').onclick=()=>loadTrips('out',true); $('#laterBack').onclick=()=>loadTrips('back',true);
  // ?from=Malaga&to=Palma&date=2026-12-12 (e.g. from a train-or-bus gap in My flights)
  if(qp.get('from')&&qp.get('to')){ $('#from').value=qp.get('from'); $('#to').value=qp.get('to'); $('#from').place=null; $('#to').place=null;
    if(/^\d{4}-\d{2}-\d{2}$/.test(qp.get('date')||'')&&qp.get('date')>=today()) $('#date').value=qp.get('date');
    trip='ow'; paint(); submit(); }
  else if(s0.from&&s0.to){ H.save('train',s0); run(go); }
});
})();
