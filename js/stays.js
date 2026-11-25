/* ============ Heybe — stay planner ============
   Pick a flight option → one stay per city of that trip (12 suggestions each, more on request),
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

  /* everything the trip needs booking: each flight, then each chosen stay (plain text; escape when drawing) */
  bookItems(P){
    const ok=u=>/^https?:\/\//i.test(u||''), out=[];
    (P.flights||[]).forEach((f,i)=>{ if(ok(f.url)) out.push({key:'f'+i,kind:'flight',title:`${f.from} → ${f.to}${f.ret?' · return':''}`,
      sub:H.short(H.parse(f.dep))+(f.ret?' → '+H.short(H.parse(f.ret)):''),url:f.url}); });
    P.cities.forEach((c,i)=>{ const p=P.picks[i]; if(!p||(!p.total&&!p.link)) return;
      const url=ok(p.link)?p.link:`https://www.booking.com/searchresults.html?ss=${encodeURIComponent(p.name+' '+c.city)}&checkin=${c.ci}&checkout=${c.co}&group_adults=${P.adults||1}&group_children=${P.children||0}&no_rooms=1`;
      out.push({key:'s'+i,kind:'stay',cc:c.cc,title:p.name,sub:`${c.city} · ${H.short(H.parse(c.ci))} → ${H.short(H.parse(c.co))}`,url}); });
    return out;
  },

  /* save the plan and open the hotels page; `flights` = [{from,to,dep,ret?,url}] to book with the stays */
  start({cities,flightPP,cur,label,flights}){
    if(!cities||!cities.length){ H.toast('No nights to book on this trip'); return; }
    const t=H.trip();
    this.save({cities,flightPP:flightPP||null,cur:cur||t.currency,label:label||cities.map(c=>c.city).join(' → '),flights:flights||[],booked:{},
      adults:t.adults||1,children:t.children||0,picks:[],step:0,kind:'both',created:Date.now()});
    location.href='hotels.html#stays';
  },

  _svc:null,
  async available(){
    if(this._svc!==null) return this._svc;
    // two sources: Google Hotels (needs the SerpApi key) and the free one (Wikidata + Xotelo, no key)
    try{ const d=(await NET.json('/tp/health',{},5000)).data||{}; this._svc=(d.hotels||d.freeHotels)?{serp:!!d.hotels,free:!!d.freeHotels}:false; }catch(e){ this._svc=false; }
    return this._svc;
  },
  async search(c,adults,cur){
    const ck='stays2:'+[c.city,c.ci,c.co,adults,cur].join('|'), hit=H.load(ck,null);
    if(hit&&Date.now()-hit.t<6*3600e3) return hit.list;               // save the free search quota
    const svc=(await this.available())||{};
    const ask=(path,q)=>NET.json(path+'?'+new URLSearchParams({q,ci:c.ci,co:c.co,adults,currency:cur}),{},60000)
      .then(r=>{ const j=r.data||{}; if(!r.ok||!j.ok) throw new Error(j.error||'Hotel search failed'); return j.properties||[]; });
    const res=await Promise.allSettled([svc.serp?ask('/hotels/search',`hostels and hotels in ${c.city}`):Promise.reject(new Error('Hotel search is not set up')),
      svc.free?ask('/hotels/free',c.city):Promise.reject(new Error('Hotel search is not set up'))]);
    const ok=res.filter(r=>r.status==='fulfilled');
    if(!ok.length) throw res[0].reason;                                 // one source failing is fine, both is an error
    const list=this.merge(...ok.map(r=>r.value));
    if(ok.length===res.length||list.length) H.save(ck,{t:Date.now(),list});
    return list;
  },
  /* one list from several sources: the same place is kept once, with its cheapest price and whatever details either source has */
  merge(...lists){
    const m=new Map(), key=p=>AP.norm(p.name).replace(/[^a-z0-9]/g,''), cost=p=>p.total||p.night||Infinity;
    lists.flat().forEach(p=>{ const k=key(p), o=m.get(k);
      if(!o){ m.set(k,{...p}); return; }
      const [win,lose]=cost(p)<cost(o)?[p,o]:[o,p], out={...win};
      for(const f in lose) if(out[f]==null||out[f]==='') out[f]=lose[f];
      m.set(k,out); });
    return [...m.values()];
  },
  isHostel(p){ return /hostel|backpack|dorm|bunk|auberge|albergue|ostello|jugendherberge|youth/i.test((p.name||'')+' '+(p.description||'')+' '+(p.type||'')); },
  /* [lat,lon] of a place, or null (both hotel sources send gps:{latitude,longitude}) */
  ll(p){ const g=p&&p.gps; if(!g) return null;
    const a=parseFloat(g.latitude??g.lat), b=parseFloat(g.longitude??g.lng??g.lon);
    return Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a)<=90&&Math.abs(b)<=180&&(a||b)?[a,b]:null; },
  /* great-circle distance in km */
  km(a,b){ const r=Math.PI/180, s1=Math.sin((b[0]-a[0])*r/2), s2=Math.sin((b[1]-a[1])*r/2);
    return 12742*Math.asin(Math.sqrt(s1*s1+Math.cos(a[0]*r)*Math.cos(b[0]*r)*s2*s2)); },
  /* the middle of the places (median, so one far-away place does not pull it), when the city centre is unknown */
  mid(list){ const pts=list.map(p=>this.ll(p)).filter(Boolean); if(!pts.length) return null;
    const med=a=>{ a=a.slice().sort((x,y)=>x-y); const m=a.length>>1, v=a.length%2?a[m]:(a[m-1]+a[m])/2; return Math.round(v*1e6)/1e6; };
    return [med(pts.map(p=>p[0])),med(pts.map(p=>p[1]))]; },
  /* the city centre from the local server (OpenStreetMap), remembered per city; null when unknown */
  async centre(q){
    const k='geo:'+q.toLowerCase(), hit=H.load(k,null);
    if(hit) return hit.lat!=null?[hit.lat,hit.lon]:null;
    try{ const r=await NET.json('/geo/city?'+new URLSearchParams({q}),{},12000), d=r.data||{};
      if(!r.ok||!d.ok) return null; H.save(k,{lat:d.lat,lon:d.lon}); return d.lat!=null?[d.lat,d.lon]:null; }catch(e){ return null; }
  },
  /* Leaflet, loaded only when a map is shown */
  _lf:null,
  leaflet(){
    if(window.L) return Promise.resolve(window.L);
    if(this._lf) return this._lf;
    const base='https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/';
    const css=document.createElement('link');
    Object.assign(css,{rel:'stylesheet',href:base+'leaflet.min.css',integrity:'sha384-c6Rcwz4e4CITMbu/NBmnNS8yN2sC3cUElMEMfP3vqqKFp7GOYaaBBCqmaWBjmkjb',crossOrigin:'anonymous'});
    document.head.appendChild(css);
    return this._lf=new Promise((ok,no)=>{ const s=document.createElement('script');
      Object.assign(s,{src:base+'leaflet.min.js',integrity:'sha384-NElt3Op+9NBMCYaef5HxeJmU4Xeard/Lku8ek6hoPTvYkQPh3zLIrJP7KiRocsxO',crossOrigin:'anonymous'});
      s.onload=()=>ok(window.L); s.onerror=()=>{ this._lf=null; s.remove(); no(new Error('The map could not load')); };
      document.head.appendChild(s); });
  },
  _map:null,
  /* up to `max` suggestions: cheapest well-rated ones, mixing hostels and hotels when "both" */
  pick(props,kind,nights,max=12){
    const half=Math.ceil(max/2);
    const all=(props||[]).filter(p=>p.rating==null||p.rating>=3.5).map(p=>({...p,hostel:STAYS.isHostel(p),tot:p.total||(p.night?p.night*nights:null)}))
      .filter(p=>kind==='hostel'?p.hostel:kind==='hotel'?!p.hostel:true);
    const priced=all.filter(p=>p.tot), unpriced=all.filter(p=>!p.tot).sort((a,b)=>(b.rating||0)-(a.rating||0));
    const hs=priced.filter(p=>p.hostel).sort((a,b)=>a.tot-b.tot), ht=priced.filter(p=>!p.hostel).sort((a,b)=>a.tot-b.tot);
    let list=kind==='both'?[...hs.slice(0,half),...ht].slice(0,max):[...hs,...ht].slice(0,max);
    if(kind==='both'&&list.length<max) list=[...list,...hs.slice(half)].slice(0,max);
    list.sort((a,b)=>a.tot-b.tot);
    // some places have no rate on the given dates: fill up with the best-rated of those
    if(list.length<max){
      const h2=unpriced.filter(p=>p.hostel), o2=unpriced.filter(p=>!p.hostel);
      const extra=kind==='both'?[...h2.slice(0,2),...o2,...h2.slice(2)]:unpriced;
      list=[...list,...extra.slice(0,max-list.length).map(p=>({...p,noPrice:true}))];
    }
    return list;
  },
  /* hotels page: every kind of place, cheapest first; a max per night drops the priced places above it */
  /* -> {site,url}: the site that gave the cheapest price (Booking.com if unknown), searched for this place with the dates filled in */
  book(p,o){
    const src=String(p.source||'').toLowerCase().replace(/\.com$|\s.*$/,'');
    const s=HOTEL_SITES.find(x=>src&&x.name.toLowerCase().replace(/\.com$|\s.*$/,'')===src&&x.name!=='Google Hotels')||HOTEL_SITES[0];
    return {site:s.name,url:s.url({...o,city:[p.name,o.city].filter(Boolean).join(', '),stars:''})};
  },
  live(props,nights,budget){
    const max=+budget||0;
    return this.pick(props,'both',nights,24).filter(p=>!max||p.noPrice||(p.night||p.tot/nights)<=max);
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
  if(!P){
    if(!COSTS.list().length){ box.classList.add('hidden'); return; }
    const t=H.trip(), pax=(t.adults||1)+(t.children||0), G=COSTS.sum(t.currency,pax);
    box.classList.remove('hidden');
    box.innerHTML=`<div class="row"><h2 style="margin:0"><span class="ico">🧾</span>Trip cost</h2></div>
      <p class="sub" style="margin-top:6px">Buses, trains and other costs you added. Plan stays with 🏨 on a flight to see flights and stays here too.</p>
      ${costsBlock(G,t.currency)}
      <div class="st-total"><div class="grand"><small>Total</small><b>${H.money(G.total,t.currency)}</b><span>${H.money(G.total/pax,t.currency)} per person</span></div></div>`;
    wireCosts(box,t.currency,()=>renderStayWizard(box));
    return;
  }
  box.classList.remove('hidden');
  const title=document.getElementById('title');
  // only when the stay planner was opened on purpose; a plain hotel search keeps its own city in the title
  if(title&&location.hash==='#stays') title.innerHTML=`Stays for <em>${H.esc(P.cities.map(c=>c.city).join(' & '))}</em>`;
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
        <p class="sub" style="margin:0">${H.nice(H.parse(c.ci))} → ${H.nice(H.parse(c.co))} · ${c.nights} night${c.nights>1?'s':''}${typeof WX!=='undefined'?' '+WX.badge({dest:c.code,dep:c.ci,ret:c.co}):''} · ${P.adults} adult${P.adults>1?'s':''}${P.children?` + ${P.children} child`:''}</p></div>
        <div class="seg" id="stKind"><button type="button" data-k="both" class="${kind==='both'?'on':''}">Both</button><button type="button" data-k="hostel" class="${kind==='hostel'?'on':''}">Hostels</button><button type="button" data-k="hotel" class="${kind==='hotel'?'on':''}">Hotels</button></div></div>
      <div class="st-map hidden" id="stMap"></div>
      <div class="st-grid" id="stGrid"><div class="loading" style="grid-column:1/-1">Looking for places to stay in ${H.esc(c.city)}…</div></div>
      <div class="st-own"><b>Found somewhere yourself?</b>
        <div class="sites" style="margin:10px 0">${STAYS.links(c,P.adults).map(s=>`<a class="site" href="${H.esc(s.url)}" target="_blank" rel="noopener"><span class="dot" style="background:${s.color}">${s.ab}</span><span>${s.name}<small>${c.nights} nights ↗</small></span></a>`).join('')}</div>
        <form class="row" id="stManual"><input name="name" placeholder="Place name" required style="flex:2;min-width:180px"><input name="total" type="number" min="0" step="1" placeholder="Total for ${c.nights} nights" required style="flex:1;min-width:150px"><input name="link" type="url" placeholder="Link (optional)" style="flex:2;min-width:180px"><button class="btn primary sm">Use this</button></form>
        <p class="hint" style="margin-top:8px"><a href="#" id="stSkip">No booking needed here (friends, night bus…) → skip</a></p></div>`;
  }else{
    const stays=P.picks.reduce((s,p)=>s+(p?p.total:0),0), fl=P.flightPP?P.flightPP*pax:null, G=COSTS.sum(P.cur,pax), all=stays+G.total+(fl||0);
    body=`<h3>Your trip, all costs</h3>
      <div class="list">${P.cities.map((c,i)=>{ const p=P.picks[i];
        return `<div class="item${p?'':' missing'}"><div><div class="t">${H.flag(c.cc)} ${H.esc(c.city)} · ${c.nights} night${c.nights>1?'s':''}</div>
          <div class="s">${p?`${p.total===0&&!p.link?'🚌 No booking':p.manual?'🏠 Your pick':p.hostel?'🛏️ Hostel':'🏨 Hotel'} ·${p.link?`<a href="${H.esc(p.link)}" target="_blank" rel="noopener">${H.esc(p.name)} ↗</a>`:H.esc(p.name)}${p.rating?` · ⭐ ${(+p.rating).toFixed(1)}`:''}`:'Not chosen yet'} · ${H.short(H.parse(c.ci))} → ${H.short(H.parse(c.co))}</div></div>
          <div class="row"><span class="amt">${p?money(p.total):'—'}</span><button class="btn ghost sm" data-step="${i}">${p?'Change':'Choose'}</button></div></div>`; }).join('')}</div>
      ${costsBlock(G,P.cur)}
      <div class="st-total">
        <div><small>Stays</small><b>${money(stays)}</b></div>
        ${G.items.length?`<div><small>Buses, trains &amp; other</small><b>${money(G.total)}</b></div>`:''}
        ${fl!=null?`<div><small>Flights (${pax} traveller${pax>1?'s':''})</small><b>${money(fl)}</b></div>`:''}
        <div class="grand"><small>${fl!=null||G.items.length?'Whole trip':'Per person'}</small><b>${money(fl!=null||G.items.length?all:all/pax)}</b>${fl!=null||G.items.length?`<span>${money(all/pax)} per person</span>`:''}</div>
      </div>
      <p class="hint">Stay prices are for the whole stay as shown when you chose them; flight prices are from the option you picked. Confirm both when booking.</p>
      <div class="row end" style="margin-top:12px"><a class="btn ocean sm" href="things.html">🎟️ Things to do in ${P.cities.length>1?'these cities':H.esc(P.cities[0].city)} →</a></div>`;
    const B=STAYS.bookItems(P), bk=P.booked||{}, left=B.filter(x=>!bk[x.key]).length;
    if(B.length) body+=`<h3 style="margin-top:22px">Book your trip</h3>
      <p class="sub" style="margin:0 0 10px">Each link opens the airline or stay site with your dates filled in. Book one by one, or everything at once.</p>
      <div class="list">${B.map(x=>{ const on=!!bk[x.key];
        return `<div class="item"><div><div class="t">${x.kind==='flight'?'✈️':H.flag(x.cc)||'🏨'} ${H.esc(x.title)}${on?'<span class="stay-pill">Booked ✓</span>':''}</div><div class="s">${x.kind==='flight'?'Flight':'Stay'} · ${H.esc(x.sub)}</div></div>
          <div class="row"><a class="btn ${on?'ghost':'primary'} sm" href="${H.esc(x.url)}" target="_blank" rel="noopener">Book ↗</a><button type="button" class="btn ghost sm" data-booked="${x.key}">${on?'Undo':'Mark booked'}</button></div></div>`; }).join('')}</div>
      <div class="row" style="margin-top:12px"><button type="button" class="btn ocean" id="stBookAll"${left?'':' disabled'}>${left?`Book all ${left} at once ↗`:'All booked ✓'}</button><span class="hint">Opens one tab per booking. Allow pop-ups if your browser asks.</span></div>`;
  }
  box.innerHTML=`<div class="row"><h2 style="margin:0"><span class="ico">🧳</span>Stay planner</h2><span class="spacer"></span>
      <span class="hint">${H.esc(P.label)}</span><button class="btn ghost sm" id="stClear">✕ Clear plan</button></div>
    <div class="st-steps">${stepChips}</div>${body}`;
  if(step<n&&typeof WX!=='undefined'){ const c=P.cities[step]; WX.fill(box,[{dest:c.code,dep:c.ci,ret:c.co}]); }

  // events
  const go=i=>{ const p=STAYS.plan(); p.step=i; STAYS.save(p); renderStayWizard(box); box.scrollIntoView({behavior:'smooth',block:'start'}); };
  box.querySelectorAll('[data-step]').forEach(b=>b.onclick=()=>go(+b.dataset.step));
  box.querySelector('#stClear').onclick=()=>{ if(confirm('Clear this stay plan?')){ STAYS.clear(); renderStayWizard(box); } };
  const choose=pick=>{ const p=STAYS.plan(); p.picks[p.step]=pick; if(p.booked) delete p.booked['s'+p.step];   // a new place is not booked yet
    const next=p.cities.findIndex((_,i)=>i>p.step&&!p.picks[i]); p.step=next>=0?next:p.cities.length;
    STAYS.save(p); H.toast(`${pick.name} chosen ✓`); renderStayWizard(box); box.scrollIntoView({behavior:'smooth',block:'start'}); };
  if(step<n){
    const c=P.cities[step];
    box.querySelectorAll('#stKind [data-k]').forEach(b=>b.onclick=()=>{ const p=STAYS.plan(); p.kind=b.dataset.k; STAYS.save(p); renderStayWizard(box); });
    box.querySelector('#stManual').onsubmit=e=>{ e.preventDefault(); const f=e.target;
      choose({name:f.name.value.trim(),total:+f.total.value,link:/^https?:\/\//i.test(f.link.value)?f.link.value:'',manual:true}); };
    box.querySelector('#stSkip').onclick=e=>{ e.preventDefault(); choose({name:'No booking needed',total:0}); };
    fillSuggestions(box.querySelector('#stGrid'),c,P,choose);
  }else{
    wireCosts(box,P.cur,()=>renderStayWizard(box));
    box.querySelectorAll('[data-booked]').forEach(b=>b.onclick=()=>{ const p=STAYS.plan(), k=b.dataset.booked;
      p.booked=p.booked||{}; if(p.booked[k]) delete p.booked[k]; else p.booked[k]=true; STAYS.save(p); renderStayWizard(box); });
    const all=box.querySelector('#stBookAll');
    if(all) all.onclick=()=>{ const p=STAYS.plan(), bk=p.booked||{};
      const blocked=H.openLinks(STAYS.bookItems(p).filter(x=>!bk[x.key]).map(x=>x.url));
      H.toast(blocked?`Your browser blocked ${blocked} tab${blocked>1?'s':''}. Allow pop-ups for this page and try again`:'Opened every booking site. Mark each one booked when done ✓'); };
  }
}

/* buses, trains and other costs: one line each with ✕, and a field to add another (e.g. a transfer) */
function costsBlock(G,cur){
  const ic={bus:'🚌',train:'🚆',other:'🧾'};
  return `<h3 style="margin-top:18px">Buses, trains &amp; other</h3>
    <div class="list">${G.items.map(c=>`<div class="item"><div><div class="t">${ic[c.kind]||'🧾'} ${H.esc(c.title)}</div>
        <div class="s">${H.esc(c.sub||'')}${c.pp?`${c.sub?' · ':''}per person`:''}${c.cur!==cur?` · <b>other currency, not in the total</b>`:''}</div></div>
      <div class="row"><span class="amt">${H.money(c.price,c.cur)}</span><button type="button" class="btn ghost sm" data-cost-del="${H.esc(c.id)}" title="Remove" aria-label="Remove">✕</button></div></div>`).join('')
      ||'<div class="empty">Nothing yet. Press ➕ Trip cost on a ride on Buses or Trains, or add a cost here.</div>'}</div>
    <form class="row" id="costAdd" style="margin-top:8px"><input name="title" placeholder="Other cost, e.g. airport transfer" required maxlength="120" style="flex:2;min-width:180px">
      <input name="price" inputmode="decimal" placeholder="Price for everyone (${H.esc(cur)})" required style="flex:1;min-width:150px"><button class="btn ghost sm">+ Add</button></form>`;
}
function wireCosts(box,cur,rerender){
  box.querySelectorAll('[data-cost-del]').forEach(b=>b.onclick=()=>{ COSTS.remove(b.dataset.costDel); rerender(); });
  const f=box.querySelector('#costAdd');
  if(f) f.onsubmit=e=>{ e.preventDefault();
    const el=f.elements;   // not f.title: that is the form's own title
    if(!COSTS.add({kind:'other',title:el.title.value,price:el.price.value,cur})){ H.toast('Enter a price, e.g. 49.90'); el.price.focus(); return; }
    rerender(); };
}

async function fillSuggestions(grid,c,P,choose){
  if(!(await STAYS.available())){
    grid.innerHTML=location.protocol==='about:'
      ? `<div class="empty" style="grid-column:1/-1">ℹ️ Hotel suggestions with prices need the local server, so they show only on the computer running <code>start.bat</code>.<br>Here, open one of the sites below, pick a place, and enter it; the totals still work.</div>`
      : `<div class="empty" style="grid-column:1/-1">Automatic suggestions with prices need the local server. Close the <code>start.bat</code> window and open it again.<br>Until then, open one of the sites below, pick a place, and enter it here; the totals still work.</div>`;
    return;
  }
  const ctrP=STAYS.centre(c.city+(c.cc?', '+c.cc:''));                 // asked while the hotels load
  let props;
  try{ props=await STAYS.search(c,P.adults,P.cur); }
  catch(e){ grid.innerHTML=`<div class="empty" style="grid-column:1/-1">Could not load suggestions: ${H.esc(e.message)}. Use the sites below instead.</div>`; return; }
  const kind=P.kind||'both', short=STAYS.pick(props,kind,c.nights,12), full=STAYS.pick(props,kind,c.nights,36);
  if(!short.length){ grid.innerHTML=`<div class="empty" style="grid-column:1/-1">No ${kind==='hostel'?'hostels':kind==='hotel'?'hotels':'places'} found for these dates. Try another filter or the sites below.</div>`; return; }
  drawSuggestions(grid,c,P,choose,short,full,await ctrP);
}

/* the cards; with more places than fit, a button at the end shows them all */
function drawSuggestions(grid,c,P,choose,list,full,ctr){
  const cur=P.cur, pick=P.picks[P.cities.indexOf(c)], more=full.length-list.length, mid=ctr||STAYS.mid(full);
  const far=h=>{ const ll=STAYS.ll(h); if(!ll||!mid) return ''; const d=STAYS.km(ll,mid);
    return `<div class="s">📍 ${d<1?Math.round(d*20)*50+' m':d.toFixed(1)+' km'} to ${ctr?'the centre':'the middle of these places'}</div>`; };
  grid.innerHTML=list.map((h,i)=>`<div class="st-card${pick&&pick.name===h.name?' chosen':''}" data-card="${i}">
      <div class="st-img"${h.image?` style="background-image:url('${H.esc(h.image)}'),linear-gradient(135deg,var(--lagoon),var(--sun-l))"`:''}><span class="st-type">${h.hostel?'🛏️ Hostel':'🏨 Hotel'}</span></div>
      <div class="st-body"><b class="st-name">${H.esc(h.name)}</b>
        <div class="s">${h.stars?'★'.repeat(Math.min(5,h.stars))+' · ':''}${h.rating?`⭐ ${(+h.rating).toFixed(1)}${h.reviews?` (${h.reviews.toLocaleString('en-US')})`:''}`:'no rating yet'}</div>${far(h)}
        ${h.noPrice
          ?`<div class="st-price"><span>No price found for these dates. Check it, then enter the total:</span></div>
            <div class="row" style="gap:6px;margin-top:6px"><input type="number" min="0" step="1" placeholder="Total ${H.esc(cur)}" data-p="${i}" style="width:110px;padding:8px 10px">
            <button class="btn primary sm" data-i="${i}">Choose</button><a class="btn ghost sm" href="${H.esc(h.link||`https://www.google.com/travel/search?q=${encodeURIComponent(h.name+' '+c.city)}`)}" target="_blank" rel="noopener">Check price ↗</a></div>`
          :`<div class="st-price"><b>${H.money(h.tot,cur)}</b><span>${H.money(h.tot/c.nights,cur)} / night${h.source?` · ${H.esc(h.source)}`:''}</span></div>
            <div class="row" style="gap:6px;margin-top:8px"><button class="btn primary sm" data-i="${i}">Choose</button>${h.link?`<a class="btn ghost sm" href="${H.esc(h.link)}" target="_blank" rel="noopener">View ↗</a>`:''}</div>`}
      </div></div>`).join('')
    +(more>0?`<div style="grid-column:1/-1;text-align:center"><button type="button" class="btn ghost sm" data-more>Show ${more} more place${more>1?'s':''}</button></div>`:'');
  const mb=grid.querySelector('[data-more]'); if(mb) mb.onclick=()=>drawSuggestions(grid,c,P,choose,full,full,ctr);
  drawStayMap(grid.parentNode.querySelector('#stMap'),grid,list,c,P,mid,!!ctr);
  grid.querySelectorAll('[data-i]').forEach(b=>b.onclick=()=>{ const i=+b.dataset.i, h=list[i];
    let total=h.tot;
    if(h.noPrice){ const inp=grid.querySelector(`[data-p="${i}"]`); total=parseFloat(inp.value);
      if(!(total>=0)){ H.toast('Enter the total price you found first'); inp.focus(); return; } }
    choose({name:h.name,total:Math.round(total),link:h.link||'',rating:h.rating,hostel:h.hostel,image:h.image}); });
}

/* one map with every suggestion as a price pin (per night) and the centre; a pin click shows its card */
async function drawStayMap(box,grid,list,c,P,ctr,known){
  if(!box) return;
  if(STAYS._map){ STAYS._map.remove(); STAYS._map=null; }
  const pts=list.map((h,i)=>({h,i,ll:STAYS.ll(h)})).filter(x=>x.ll);
  if(!pts.length){ box.classList.add('hidden'); return; }
  let L; try{ L=await STAYS.leaflet(); }catch(e){ box.classList.add('hidden'); return; }
  if(!box.isConnected||!grid.isConnected) return;                       // the planner moved on while the map loaded
  box.classList.remove('hidden');
  box.innerHTML=`<div class="st-map-canvas"></div><div class="st-map-key"><span class="st-key hotel">Hotel</span><span class="st-key hostel">Hostel</span><span class="st-key cheap">Cheapest</span>
    <span class="hint">Prices per night · ⭐ ${known?'city centre':'middle of these places'}</span></div>`;
  const m=STAYS._map=L.map(box.firstElementChild,{scrollWheelZoom:false});
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'}).addTo(m);
  const prices=pts.filter(x=>!x.h.noPrice).map(x=>x.h.tot).sort((a,b)=>a-b), cut=prices.length?prices[Math.min(2,prices.length-1)]:-1;
  const pin=(html,cls)=>L.divIcon({className:'st-pin-wrap',html:`<span class="st-pin ${cls}">${html}</span>`,iconSize:null});
  if(ctr) L.marker(ctr,{icon:pin(`⭐ ${known?'Centre':'Middle'}`,'centre'),zIndexOffset:-1000,keyboard:false,interactive:false}).addTo(m);
  pts.forEach(({h,i,ll})=>{
    const cls=(h.hostel?'hostel':'hotel')+(!h.noPrice&&h.tot<=cut?' cheap':'');
    L.marker(ll,{icon:pin(h.noPrice?'?':H.esc(H.money(h.tot/c.nights,P.cur)),cls),title:h.name,riseOnHover:true}).addTo(m)
      .on('click',()=>{ const card=grid.querySelector(`[data-card="${i}"]`); if(!card) return;
        card.scrollIntoView({behavior:'smooth',block:'center'}); card.classList.remove('flash'); void card.offsetWidth; card.classList.add('flash'); });
  });
  m.fitBounds(L.latLngBounds([...pts.map(x=>x.ll),...(ctr?[ctr]:[])]),{padding:[36,36],maxZoom:16});
}
