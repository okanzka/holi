/* ============ Heybe — trains page (Transitous timetables + live FlixTrain prices) ============ */
(function(){
const $=s=>document.querySelector(s);
const today=()=>H.fmt(new Date());
let st={trips:[],next:null,key:''};

/* a time shown in the station's own time zone */
const clock=(iso,tz)=>{ try{ return new Date(iso).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',timeZone:tz||undefined}); }catch(e){ return new Date(iso).toTimeString().slice(0,5); } };
const money=(n,cur)=>{ try{ return new Intl.NumberFormat('en',{style:'currency',currency:cur,maximumFractionDigits:2}).format(n); }catch(e){ return H.money(n,cur); } };

function tripRow(it,S){
  const tz=S.from.tz, tzTo=S.to.tz||tz, legs=it.legs.map(l=>`<span class="tr-leg" title="${H.esc(l.agency)}">${H.esc(l.name)}</span>`).join('<i>›</i>');
  const via=it.legs.slice(0,-1).map(l=>l.to).filter(Boolean);
  return `<div class="deal ride"><div><div class="t">${clock(it.dep,tz)} → ${clock(it.arr,tzTo)}</div>
      <div class="hint">${hm(it.mins)} · ${it.transfers?it.transfers+' change'+(it.transfers>1?'s':''):'Direct'}${via.length?' at '+via.map(H.esc).join(', '):''}</div>
      <div class="tr-legs">${legs}</div></div>
    <div class="amt"><small>${H.esc([...new Set(it.legs.map(l=>l.agency).filter(Boolean))].join(', '))}</small>
      <a class="btn primary sm" style="margin-top:6px" target="_blank" rel="noopener" href="${H.esc(TRANSIT.bookUrl(it))}">Check price ↗</a></div></div>`;
}
function renderTrips(msg){
  const S=H.load('train',{}), box=$('#trips');
  $('#later').classList.toggle('hidden',!st.next||!!msg);
  if(msg){ box.innerHTML=msg; return; }
  $('#tripsTitle').textContent=`Trains on ${H.nice(H.parse(S.date))}`;
  if(!st.trips.length){ box.innerHTML='<div class="empty">No trains found. Try another time, or a bigger station nearby.</div>'; return; }
  box.innerHTML=`<p class="hint">${H.esc(S.from.name)} → ${H.esc(S.to.name)}</p>`+st.trips.map(it=>tripRow(it,S)).join('');
}
async function loadTrips(more){
  const S=H.load('train',{}), key=JSON.stringify([S.from,S.to,S.date,S.time]);
  if(!more){ if(key===st.key) return; st={trips:[],next:null,key}; renderTrips('<div class="loading">Looking for trains…</div>'); }
  try{ const r=await TRANSIT.plan({from:S.from,to:S.to,time:new Date(`${S.date}T${S.time}`).toISOString(),cursor:more?st.next:null});
    if(st.key!==key) return;
    const seen=new Set(st.trips.map(t=>t.dep+t.arr));
    st.trips.push(...r.trips.filter(t=>!seen.has(t.dep+t.arr))); st.next=r.next; renderTrips(); }
  catch(e){ if(st.key===key) renderTrips('<div class="empty">Could not load trains. Check your internet connection and try again.</div>'); }
}
/* FlixTrain: FlixBus's own trains, with live prices, where both towns have them */
async function loadFlixTrain(){
  const S=H.load('train',{}), box=$('#flixtrain'), town=n=>n.replace(/\s*(Hbf|Hauptbahnhof|Central|Centrale|Station|Bahnhof).*$/i,'').split(/[,(]/)[0].trim();
  box.innerHTML='<div class="loading">Checking FlixTrain…</div>';
  try{
    const [a,b]=await Promise.all([FLIX.cities(town(S.from.name)),FLIX.cities(town(S.to.name))]);
    if(!a[0]||!b[0]||a[0].id===b[0].id){ box.innerHTML='<div class="empty">No FlixTrain for these towns.</div>'; return; }
    const r=(await FLIX.search({from:a[0].id,to:b[0].id,date:S.date,adults:1,currency:H.trip().currency})).filter(x=>x.modes.length&&x.modes.every(m=>m==='train'));
    if(!r.length){ box.innerHTML=`<div class="empty">No FlixTrain between ${H.esc(a[0].name)} and ${H.esc(b[0].name)} that day. <a href="bus.html?from=${encodeURIComponent(a[0].name)}&to=${encodeURIComponent(b[0].name)}&date=${S.date}">See buses ↗</a></div>`; return; }
    box.innerHTML=r.slice(0,8).map(x=>`<div class="deal ride"><div><div class="t">🚆 ${H.time(x.dep)} → ${H.time(x.arr)}</div>
        <div class="hint">${hm(x.mins)} · ${x.transfers?x.transfers+' change'+(x.transfers>1?'s':''):'Direct'}<br>${H.esc(x.fromSt)} → ${H.esc(x.toSt)}</div></div>
      <div class="amt">${money(x.price,x.cur)}<small>per person</small><a class="btn primary sm" style="margin-top:6px" target="_blank" rel="noopener" href="${H.esc(x.url)}">Book ↗</a></div></div>`).join('');
  }catch(e){ box.innerHTML='<div class="empty">Could not load FlixTrain prices.</div>'; }
}

document.addEventListener('DOMContentLoaded',()=>{
  const T=H.trip(), qp=new URLSearchParams(location.search);
  const S=Object.assign({date:T.start,time:'08:00'},H.load('train',{}));
  if(!S.date||S.date<today()) S.date=H.fmt(H.add(new Date(),7));
  const from=placeBox($('#from'),(q,s)=>TRANSIT.places(q,s)), to=placeBox($('#to'),(q,s)=>TRANSIT.places(q,s));
  if(S.from) from.set(S.from); if(S.to) to.set(S.to);
  $('#date').value=S.date; $('#time').value=S.time;
  async function submit(){
    const [a,b]=await Promise.all([from.get(),to.get()]);
    if(!a){ H.toast('Pick the station you leave from'); $('#from').focus(); return; }
    if(!b){ H.toast('Pick the station you go to'); $('#to').focus(); return; }
    if(a.lat===b.lat&&a.lon===b.lon){ H.toast('From and To are the same place'); $('#to').focus(); return; }
    if(!$('#date').value||$('#date').value<today()){ H.toast('Pick a date from today on'); $('#date').focus(); return; }
    H.save('train',{from:a,to:b,date:$('#date').value,time:$('#time').value||'08:00'});
    loadTrips(); loadFlixTrain();
  }
  $('#f').onsubmit=e=>{ e.preventDefault(); st.key=''; submit(); };
  $('#later').onclick=()=>loadTrips(true);
  // ?from=Malaga&to=Palma&date=2026-12-12 (e.g. from a train-or-bus gap in My flights)
  if(qp.get('from')&&qp.get('to')){ $('#from').value=qp.get('from'); $('#to').value=qp.get('to'); $('#from').place=null; $('#to').place=null;
    if(/^\d{4}-\d{2}-\d{2}$/.test(qp.get('date')||'')&&qp.get('date')>=today()) $('#date').value=qp.get('date');
    submit(); }
  else if(S.from&&S.to){ H.save('train',S); loadTrips(); loadFlixTrain(); }
});
})();
