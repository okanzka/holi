/* ============ Heybe — buses page (FlixBus live prices, also FlixTrain) ============ */
(function(){
const $=s=>document.querySelector(s);
const today=()=>H.fmt(new Date());
let st={rides:{},day:null,key:'',loading:false};   // rides per day (YYYY-MM-DD → list), the day shown

const days=(date,flex)=>Array.from({length:2*flex+1},(_,i)=>H.fmt(H.add(H.parse(date),i-flex))).filter(d=>d>=today());
const money=(n,cur)=>{ try{ return new Intl.NumberFormat('en',{style:'currency',currency:cur,maximumFractionDigits:2}).format(n); }catch(e){ return H.money(n,cur); } };
const cheapest=l=>l&&l.length?l.reduce((a,x)=>x.price<a.price?x:a):null;

function renderDays(){
  const S=H.load('bus',{}), list=days(S.date,S.flex||0);
  $('#days').innerHTML=list.map(d=>{ const l=st.rides[d], c=cheapest(l);
    const txt=l===undefined?'…':l===null?'—':c?money(c.price,c.cur):'none';
    return `<button type="button" class="day${d===st.day?' on':''}${d===S.date?' wish':''}" data-d="${d}"${c?'':' disabled'}><small>${H.esc(H.nice(H.parse(d)))}</small><b>${txt}</b></button>`; }).join('');
  // mark the cheapest day
  const prices=list.map(d=>cheapest(st.rides[d])).filter(Boolean).map(c=>c.price), min=Math.min(...prices);
  $('#days').querySelectorAll('button[data-d]').forEach(b=>{ const c=cheapest(st.rides[b.dataset.d]); if(c&&c.price===min&&prices.length>1) b.classList.add('best');
    b.onclick=()=>{ st.day=b.dataset.d; renderDays(); renderRides(); }; });
}
function rideRow(r){
  const icons=r.modes.map(m=>m==='train'?'🚆':'🚌').join(''), seats=r.seats!=null&&r.seats<=5?` · <b style="color:var(--pricey)">${r.seats} seat${r.seats>1?'s':''} left</b>`:'';
  return `<div class="deal ride"><div><div class="t">${icons} ${H.time(r.dep)} → ${H.time(r.arr)}${r.arr.slice(0,10)>r.dep.slice(0,10)?' <small>+1</small>':''}</div>
      <div class="hint">${hm(r.mins)} · ${r.transfers?r.transfers+' change'+(r.transfers>1?'s':''):'Direct'}${seats}<br>${H.esc(r.fromSt)} → ${H.esc(r.toSt)}</div></div>
    <div class="amt">${money(r.price,r.cur)}<small>${(n=>n>1?`all ${n} passengers · ${money(r.price/n,r.cur)} each`:'per person')(H.load('bus',{}).adults||1)}</small>
      <a class="btn primary sm" style="margin-top:6px" target="_blank" rel="noopener" href="${H.esc(r.url)}">Book ↗</a></div></div>`;
}
function renderRides(){
  const box=$('#rides'), S=H.load('bus',{});
  if(st.loading&&!st.rides[st.day]){ box.innerHTML='<div class="loading">Looking for rides…</div>'; return; }
  const l=st.rides[st.day];
  $('#ridesTitle').textContent=st.day?`Rides on ${H.nice(H.parse(st.day))}`:'Rides';
  if(l===null){ box.innerHTML='<div class="empty">Could not load rides. Check your internet connection and try again.</div>'; return; }
  if(!l||!l.length){ box.innerHTML='<div class="empty">No rides on this day. Pick another day above.</div>'; return; }
  const sort=$('#sort').value, L=[...l].sort(sort==='dep'?(a,b)=>a.dep.localeCompare(b.dep):sort==='mins'?(a,b)=>a.mins-b.mins||a.price-b.price:(a,b)=>a.price-b.price);
  box.innerHTML=`<p class="hint">${L.length} ride${L.length>1?'s':''} · ${H.esc(S.from.name)} → ${H.esc(S.to.name)}</p>`+L.map(rideRow).join('');
}
async function search(){
  const S=H.load('bus',{}); if(!S.from||!S.to) return;
  const key=JSON.stringify([S.from.id,S.to.id,S.date,S.flex,S.adults,H.trip().currency]); if(key===st.key) return;
  const list=days(S.date,S.flex||0);
  st={rides:{},day:list.includes(S.date)?S.date:list[0],key,loading:true}; renderDays(); renderRides();
  await Promise.all(list.map(async d=>{
    try{ const r=await FLIX.search({from:S.from.id,to:S.to.id,date:d,adults:S.adults,currency:H.trip().currency}); if(st.key===key) st.rides[d]=r; }
    catch(e){ if(st.key===key) st.rides[d]=null; }
    if(st.key===key){ renderDays(); if(d===st.day) renderRides(); } }));
  if(st.key!==key) return;
  st.loading=false;
  // the wished day has nothing: show the cheapest day instead
  if(!(st.rides[st.day]||[]).length){ const best=list.filter(d=>cheapest(st.rides[d])).sort((a,b)=>cheapest(st.rides[a]).price-cheapest(st.rides[b]).price)[0]; if(best) st.day=best; }
  renderDays(); renderRides();
}

document.addEventListener('DOMContentLoaded',async()=>{
  const T=H.trip(), qp=new URLSearchParams(location.search);
  const S=Object.assign({date:T.start,flex:1,adults:T.adults||1},H.load('bus',{}));
  if(!S.date||S.date<today()) S.date=H.fmt(H.add(new Date(),7));
  const from=placeBox($('#from'),(q,s)=>FLIX.cities(q,s)), to=placeBox($('#to'),(q,s)=>FLIX.cities(q,s));
  if(S.from) from.set(S.from); if(S.to) to.set(S.to);
  $('#date').value=S.date; $('#adults').value=S.adults;
  let flex=S.flex;
  const pills=[...document.querySelectorAll('#flexPills button')], paint=()=>pills.forEach(b=>b.classList.toggle('on',+b.dataset.v===flex));
  pills.forEach(b=>b.onclick=()=>{ flex=+b.dataset.v; paint(); if(H.load('bus',{}).from) submit(); }); paint();
  async function submit(){
    const [a,b]=await Promise.all([from.get(),to.get()]);
    if(!a){ H.toast('Pick the city you leave from'); $('#from').focus(); return; }
    if(!b){ H.toast('Pick the city you go to'); $('#to').focus(); return; }
    if(a.id===b.id){ H.toast('From and To are the same city'); $('#to').focus(); return; }
    if(!$('#date').value||$('#date').value<today()){ H.toast('Pick a date from today on'); $('#date').focus(); return; }
    H.save('bus',{from:a,to:b,date:$('#date').value,flex,adults:Math.max(1,Math.min(9,+$('#adults').value||1))});
    search();
  }
  $('#f').onsubmit=e=>{ e.preventDefault(); st.key=''; submit(); };
  $('#sort').onchange=renderRides;
  // ?from=Berlin&to=Munich&date=2026-12-12 (e.g. from a train-or-bus gap in My flights)
  if(qp.get('from')&&qp.get('to')){ $('#from').value=qp.get('from'); $('#to').value=qp.get('to'); $('#from').place=null; $('#to').place=null;
    if(/^\d{4}-\d{2}-\d{2}$/.test(qp.get('date')||'')&&qp.get('date')>=today()) $('#date').value=qp.get('date');
    submit(); }
  else if(S.from&&S.to){ H.save('bus',S); search(); }
});
})();
