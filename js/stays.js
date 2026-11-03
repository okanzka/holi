/* ============ Heybe — stay planner ============
   Pick a flight option → one stay per city of that trip (5–6 suggestions each),
   choose one per city, then see the total accommodation (and trip) cost.
   Suggestions with prices come from Google Hotels via SerpApi through server.js
   (key in serpapi.key). Without it, every city still gets ready-made search links
   and a box to enter the place and price you picked.                              */
const STAYS = {
  KEY:'stayPlan',
  plan(){ return H.load(this.KEY,null); },
  save(p){ H.save(this.KEY,p); },
  clear(){ try{ localStorage.removeItem('heybe.'+this.KEY); }catch(e){} },

  /* every flight except the last one lands in a city where you sleep */
  fromLegs(legs){
    const out=[];
    for(let i=0;i<legs.length-1;i++){
      const l=legs[i], n=legs[i+1], ci=String(l.arr||l.dep).slice(0,10), co=String(n.dep).slice(0,10);
      if(co<=ci) continue;
      const a=AP.byCode(l.to);
      out.push({code:l.to,city:a?(a.city||a.name):(l.city||l.to),cc:a?a.cc:'',ci,co,nights:H.diff(H.parse(ci),H.parse(co))});
    }
    return out;
  },
  city(code,ci,co){ const a=AP.byCode(code); return {code,city:a?(a.city||a.name):code,cc:a?a.cc:'',ci,co,nights:H.diff(H.parse(ci),H.parse(co))}; },

  /* save the plan and open the hotels page */
  start({cities,flightPP,cur,label}){
    if(!cities||!cities.length){ H.toast('No nights to book on this trip'); return; }
    const t=H.trip();
    this.save({cities,flightPP:flightPP||null,cur:cur||t.currency,label:label||cities.map(c=>c.city).join(' → '),
      adults:t.adults||1,children:t.children||0,picks:[],step:0,kind:'both',created:Date.now()});
    location.href='hotels.html#stays';
  },

  _svc:null,
  async available(){
    if(this._svc!==null) return this._svc;
    if(!/^https?:$/.test(location.protocol)) return (this._svc=false);
    try{ this._svc=!!(await (await fetch('/tp/health')).json()).hotels; }catch(e){ this._svc=false; }
    return this._svc;
  },
  async search(c,adults,cur){
    const ck='hotels:'+[c.city,c.ci,c.co,adults,cur].join('|'), hit=H.load(ck,null);
    if(hit&&Date.now()-hit.t<6*3600e3) return hit.list;               // save the free search quota
    const r=await fetch('/hotels/search?'+new URLSearchParams({q:`hostels and hotels in ${c.city}`,ci:c.ci,co:c.co,adults,currency:cur}));
    const j=await r.json(); if(!r.ok||!j.ok) throw new Error(j.error||'Hotel search failed');
    H.save(ck,{t:Date.now(),list:j.properties}); return j.properties;
  },
  isHostel(p){ return /hostel|backpack|dorm|bunk|auberge|albergue|ostello|jugendherberge|youth/i.test((p.name||'')+' '+(p.description||'')+' '+(p.type||'')); },
  /* 5–6 suggestions: cheapest well-rated ones, mixing hostels and hotels when "both" */
  pick6(props,kind,nights){
    const L=(props||[]).filter(p=>(p.total||p.night)&&(p.rating==null||p.rating>=3.5)).map(p=>({...p,hostel:STAYS.isHostel(p),
      tot:p.total||p.night*nights}));
    const hs=L.filter(p=>p.hostel).sort((a,b)=>a.tot-b.tot), ht=L.filter(p=>!p.hostel).sort((a,b)=>a.tot-b.tot);
    if(kind==='hostel') return hs.slice(0,6);
    if(kind==='hotel') return ht.slice(0,6);
    const mix=[...hs.slice(0,3),...ht.slice(0,6)].slice(0,6);
    return mix.length<6?[...mix,...hs.slice(3)].slice(0,6):mix.sort((a,b)=>a.tot-b.tot);
  },
  links(c,adults){
    const q=encodeURIComponent(c.city);
    return [
      {name:'Hostelworld',color:'#f25621',ab:'Hw',url:`https://www.hostelworld.com/search?search_keywords=${q}&date_from=${c.ci}&date_to=${c.co}&number_of_guests=${adults}`},
      {name:'Booking: hostels',color:'#003580',ab:'B',url:`https://www.booking.com/searchresults.html?ss=${q}&checkin=${c.ci}&checkout=${c.co}&group_adults=${adults}&no_rooms=1&order=price&nflt=${encodeURIComponent('ht_id=203')}`},
      {name:'Booking: hotels',color:'#003580',ab:'B',url:`https://www.booking.com/searchresults.html?ss=${q}&checkin=${c.ci}&checkout=${c.co}&group_adults=${adults}&no_rooms=1&order=price&nflt=${encodeURIComponent('ht_id=204')}`},
      {name:'Google Hotels',color:'#34a853',ab:'G',url:`https://www.google.com/travel/search?q=${encodeURIComponent(`hostels and hotels in ${c.city} ${c.ci} to ${c.co}`)}`},
      {name:'Airbnb',color:'#ff385c',ab:'A',url:`https://www.airbnb.com/s/${q}/homes?checkin=${c.ci}&checkout=${c.co}&adults=${adults}`},
    ];
  },
};

/* ---------- the step-by-step wizard on the hotels page ---------- */
function renderStayWizard(box){
  const P=STAYS.plan();
  if(!P){ box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  const title=document.getElementById('title');
  if(title) title.innerHTML=`Stays for <em>${H.esc(P.cities.map(c=>c.city).join(' & '))}</em>`;
  const n=P.cities.length, step=Math.min(P.step||0,n), done=P.picks.filter(Boolean).length;
  const money=(v)=>H.money(v,P.cur), pax=(P.adults||1)+(P.children||0);
  const stepChips=P.cities.map((c,i)=>{ const pk=P.picks[i];
    return `<button type="button" class="st-chip${i===step?' on':''}${pk?' ok':''}" data-step="${i}">
      <span class="n">${pk?'✓':i+1}</span><span><b>${H.flag(c.cc)} ${H.esc(c.city)}</b><small>${H.short(H.parse(c.ci))} → ${H.short(H.parse(c.co))} · ${c.nights}n</small></span></button>`; }).join('<i class="st-arrow">→</i>')
    +`<i class="st-arrow">→</i><button type="button" class="st-chip${step>=n?' on':''}" data-step="${n}"><span class="n">Σ</span><span><b>Total</b><small>${done}/${n} chosen</small></span></button>`;

  let body='';
  if(step<n){
    const c=P.cities[step], kind=P.kind||'both';
    body=`<div class="st-head"><div><h3>Where to stay in ${H.flag(c.cc)} ${H.esc(c.city)}</h3>
        <p class="sub" style="margin:0">${H.nice(H.parse(c.ci))} → ${H.nice(H.parse(c.co))} · ${c.nights} night${c.nights>1?'s':''} · ${P.adults} adult${P.adults>1?'s':''}${P.children?` + ${P.children} child`:''}</p></div>
        <div class="seg" id="stKind"><button type="button" data-k="both" class="${kind==='both'?'on':''}">Both</button><button type="button" data-k="hostel" class="${kind==='hostel'?'on':''}">Hostels</button><button type="button" data-k="hotel" class="${kind==='hotel'?'on':''}">Hotels</button></div></div>
      <div class="st-grid" id="stGrid"><div class="loading" style="grid-column:1/-1">Looking for places to stay in ${H.esc(c.city)}…</div></div>
      <div class="st-own"><b>Found somewhere yourself?</b>
        <div class="sites" style="margin:10px 0">${STAYS.links(c,P.adults).map(s=>`<a class="site" href="${H.esc(s.url)}" target="_blank" rel="noopener"><span class="dot" style="background:${s.color}">${s.ab}</span><span>${s.name}<small>${c.nights} nights ↗</small></span></a>`).join('')}</div>
        <form class="row" id="stManual"><input name="name" placeholder="Place name" required style="flex:2;min-width:180px"><input name="total" type="number" min="0" step="1" placeholder="Total for ${c.nights} nights" required style="flex:1;min-width:150px"><input name="link" type="url" placeholder="Link (optional)" style="flex:2;min-width:180px"><button class="btn primary sm">Use this</button></form>
        <p class="hint" style="margin-top:8px"><a href="#" id="stSkip">No booking needed here (friends, night bus…) → skip</a></p></div>`;
  }else{
    const stays=P.picks.reduce((s,p)=>s+(p?p.total:0),0), fl=P.flightPP?P.flightPP*pax:null;
    body=`<h3>Your trip, all costs</h3>
      <div class="list">${P.cities.map((c,i)=>{ const p=P.picks[i];
        return `<div class="item${p?'':' missing'}"><div><div class="t">${H.flag(c.cc)} ${H.esc(c.city)} · ${c.nights} night${c.nights>1?'s':''}</div>
          <div class="s">${p?`${p.total===0&&!p.link?'🚌 No booking':p.manual?'🏠 Your pick':p.hostel?'🛏️ Hostel':'🏨 Hotel'} ·${p.link?`<a href="${H.esc(p.link)}" target="_blank" rel="noopener">${H.esc(p.name)} ↗</a>`:H.esc(p.name)}${p.rating?` · ⭐ ${(+p.rating).toFixed(1)}`:''}`:'Not chosen yet'} · ${H.short(H.parse(c.ci))} → ${H.short(H.parse(c.co))}</div></div>
          <div class="row"><span class="amt">${p?money(p.total):'—'}</span><button class="btn ghost sm" data-step="${i}">${p?'Change':'Choose'}</button></div></div>`; }).join('')}</div>
      <div class="st-total">
        <div><small>Stays</small><b>${money(stays)}</b></div>
        ${fl!=null?`<div><small>Flights (${pax} traveller${pax>1?'s':''})</small><b>${money(fl)}</b></div><div class="grand"><small>Whole trip</small><b>${money(stays+fl)}</b><span>${money((stays+fl)/pax)} per person</span></div>`
          :`<div class="grand"><small>Per person</small><b>${money(stays/pax)}</b></div>`}
      </div>
      <p class="hint">Stay prices are for the whole stay as shown when you chose them; flight prices are from the option you picked. Confirm both when booking.</p>`;
  }
  box.innerHTML=`<div class="row"><h2 style="margin:0"><span class="ico">🧳</span>Stay planner</h2><span class="spacer"></span>
      <span class="hint">${H.esc(P.label)}</span><button class="btn ghost sm" id="stClear">✕ Clear plan</button></div>
    <div class="st-steps">${stepChips}</div>${body}`;

  // events
  const go=i=>{ const p=STAYS.plan(); p.step=i; STAYS.save(p); renderStayWizard(box); box.scrollIntoView({behavior:'smooth',block:'start'}); };
  box.querySelectorAll('[data-step]').forEach(b=>b.onclick=()=>go(+b.dataset.step));
  box.querySelector('#stClear').onclick=()=>{ if(confirm('Clear this stay plan?')){ STAYS.clear(); renderStayWizard(box); } };
  const choose=pick=>{ const p=STAYS.plan(); p.picks[p.step]=pick;
    const next=p.cities.findIndex((_,i)=>i>p.step&&!p.picks[i]); p.step=next>=0?next:p.cities.length;
    STAYS.save(p); H.toast(`${pick.name} chosen ✓`); renderStayWizard(box); box.scrollIntoView({behavior:'smooth',block:'start'}); };
  if(step<n){
    const c=P.cities[step];
    box.querySelectorAll('#stKind [data-k]').forEach(b=>b.onclick=()=>{ const p=STAYS.plan(); p.kind=b.dataset.k; STAYS.save(p); renderStayWizard(box); });
    box.querySelector('#stManual').onsubmit=e=>{ e.preventDefault(); const f=e.target;
      choose({name:f.name.value.trim(),total:+f.total.value,link:/^https?:\/\//i.test(f.link.value)?f.link.value:'',manual:true}); };
    box.querySelector('#stSkip').onclick=e=>{ e.preventDefault(); choose({name:'No booking needed',total:0}); };
    fillSuggestions(box.querySelector('#stGrid'),c,P,choose);
  }
}

async function fillSuggestions(grid,c,P,choose){
  if(!(await STAYS.available())){
    grid.innerHTML=`<div class="empty" style="grid-column:1/-1">🔑 Automatic suggestions with prices need a free <b>SerpApi</b> key (Google Hotels data).
      Put it in <code>serpapi.key</code> in the site folder and restart <code>start.bat</code>.<br>Until then, open one of the sites below, pick a place, and enter it here; the totals still work.</div>`;
    return;
  }
  let props;
  try{ props=await STAYS.search(c,P.adults,P.cur); }
  catch(e){ grid.innerHTML=`<div class="empty" style="grid-column:1/-1">Could not load suggestions: ${H.esc(e.message)}. Use the sites below instead.</div>`; return; }
  const list=STAYS.pick6(props,P.kind||'both',c.nights);
  if(!list.length){ grid.innerHTML=`<div class="empty" style="grid-column:1/-1">No priced ${P.kind==='hostel'?'hostels':P.kind==='hotel'?'hotels':'places'} found for these dates. Try another filter or the sites below.</div>`; return; }
  const cur=P.cur, pick=P.picks[P.cities.indexOf(c)];
  grid.innerHTML=list.map((h,i)=>`<div class="st-card${pick&&pick.name===h.name?' chosen':''}">
      <div class="st-img"${h.image?` style="background-image:url('${H.esc(h.image)}'),linear-gradient(135deg,var(--lagoon),var(--sun-l))"`:''}><span class="st-type">${h.hostel?'🛏️ Hostel':'🏨 Hotel'}</span></div>
      <div class="st-body"><b class="st-name">${H.esc(h.name)}</b>
        <div class="s">${h.stars?'★'.repeat(Math.min(5,h.stars))+' · ':''}${h.rating?`⭐ ${(+h.rating).toFixed(1)}${h.reviews?` (${h.reviews.toLocaleString('en-US')})`:''}`:'no rating yet'}</div>
        <div class="st-price"><b>${H.money(h.tot,cur)}</b><span>${H.money(h.tot/c.nights,cur)} / night${h.source?` · ${H.esc(h.source)}`:''}</span></div>
        <div class="row" style="gap:6px;margin-top:8px"><button class="btn primary sm" data-i="${i}">Choose</button>${h.link?`<a class="btn ghost sm" href="${H.esc(h.link)}" target="_blank" rel="noopener">View ↗</a>`:''}</div></div></div>`).join('');
  grid.querySelectorAll('[data-i]').forEach(b=>b.onclick=()=>{ const h=list[+b.dataset.i];
    choose({name:h.name,total:Math.round(h.tot),link:h.link||'',rating:h.rating,hostel:h.hostel,image:h.image}); });
}
