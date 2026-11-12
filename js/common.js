/* ============ Heybe — shared helpers ============ */
const H = {
  parse(s){ if(!s) return null; const [y,m,d]=s.split('-').map(Number); return new Date(y,m-1,d); },
  fmt(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); },
  add(d,n){ const x=new Date(d); x.setDate(x.getDate()+n); return x; },
  diff(a,b){ return Math.round((b-a)/864e5); },
  nice(d){ return d.toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'}); },
  short(d){ return d.toLocaleDateString('en-GB',{day:'numeric',month:'short'}); },
  dow(d){ return d.toLocaleDateString('en-GB',{weekday:'short'}); },
  time(iso){ return iso?iso.slice(11,16):''; },
  load(k,def){ try{ const v=JSON.parse(localStorage.getItem('heybe.'+k)); return v ?? def; }catch(e){ return def; } },
  save(k,v){ try{ localStorage.setItem('heybe.'+k,JSON.stringify(v)); }catch(e){} },
  money(n,cur){ if(n==null||isNaN(n)) return '—'; return (cur||H.trip().currency||'EUR')+' '+Math.round(n).toLocaleString('en-US'); },
  esc(s){ return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); },
  toast(msg){ let t=document.querySelector('.toast'); if(!t){ t=document.createElement('div'); t.className='toast'; document.body.appendChild(t); }
    t.textContent=msg; t.classList.add('show'); clearTimeout(t._h); t._h=setTimeout(()=>t.classList.remove('show'),2600); },

  /* the current trip, shared by all pages */
  trip(){
    const today=new Date(); today.setHours(0,0,0,0);
    const def={ from:'NUE', to:'ANY', city:'', tripType:'rt',
      start:H.fmt(H.add(today,30)), end:H.fmt(H.add(today,37)), flex:2, nearby:true,
      adults:2, children:0, cabin:'economy', rooms:1, currency:'EUR', chosen:null, minNights:0 };
    const t=Object.assign(def, H.load('trip',{}));
    // a saved trip whose dates have passed moves to a week from today, keeping its length
    if(H.parse(t.start)<today){
      const len=Math.max(1,H.diff(H.parse(t.start),H.parse(t.end)||H.parse(t.start)));
      t.start=H.fmt(H.add(today,7)); t.end=H.fmt(H.add(today,7+len)); t.chosen=null;
      H.save('trip',t);
    }
    return t;
  },
  setTrip(patch){ const t=Object.assign(H.trip(),patch); H.save('trip',t); return t; },

  /* read the airport code from an autocomplete input (or a typed "NUE" / "Anywhere") */
  codeOf(input){
    const v=(input.value||'').trim();
    if(input.dataset.code && input.value===input.dataset.label) return input.dataset.code;
    if(/anywhere|her ?yer|🌍/i.test(v)) return 'ANY';
    const m=v.match(/^([A-Za-z]{3})\b/); if(m && AP.byCode(m[1].toUpperCase())) return m[1].toUpperCase();
    const hit=AP.search(v,1,false)[0]; return hit?hit.code:'';
  },
  cityOf(code){ if(code==='ANY') return 'Anywhere'; const a=AP.byCode(code); return a?(a.isCountry?a.country:a.city||a.name):code; },
  hotelCity(code){ return code==='ANY'?'':H.cityOf(code); },
  isCountry(code){ return /^C:[A-Z]{2}$/.test(code||''); },
  /* destination mode = list of deals (anywhere / a country / from a country) instead of a date grid */
  isDealMode(t){ return t.to==='ANY'||t.from==='ANY'||H.isCountry(t.to)||H.isCountry(t.from); },
  /* airline from a flight number ("FR7937" → FR); Ryanair fares without a number are FR */
  carrier(fn){ const m=String(fn||'').match(/^([A-Z0-9]{2})\s*\d/); return m?m[1]:'FR'; },
  /* airline of a fare: its own code when the source gives one (a fare can come without a flight number) */
  alOf(d){ return (d&&d.airline)||H.carrier(d&&d.outFlight); },
  /* Ryanair group fare (live Ryanair, or a Ryanair group airline found by Aviasales) */
  isRyanair(d){ const ry=['FR','RK','AL','RR','OE']; return d.src!=='tp'||ry.includes(H.alOf(d))||ry.includes(d.inAirline); },
  /* keep the cheapest fare per key in map m; when that is Ryanair, remember the cheapest other airline as .alt */
  keepBest(m,k,d){
    const cur=m.get(k), pool=[cur,cur&&cur.alt,d].filter(Boolean);
    const top=pool.reduce((a,b)=>b.pp<a.pp?b:a), other=pool.filter(x=>!H.isRyanair(x)).reduce((a,b)=>!a||b.pp<a.pp?b:a,null);
    pool.forEach(x=>{ delete x.alt; });
    if(other&&other!==top&&H.isRyanair(top)) top.alt=other;
    m.set(k,top);
  },
  /* trip details passed in the page address (?from=nue&to=ist&start=…): only known places and real dates are kept */
  urlPatch(qp){
    const patch={}, place=v=>{ const c=String(v||'').toUpperCase(); return c==='ANY'||AP.byCode(c)?c:''; };
    const day=v=>{ if(!/^\d{4}-\d{2}-\d{2}$/.test(v||'')) return ''; const d=H.parse(v); return H.fmt(d)===v?v:''; };
    ['from','to'].forEach(k=>{ const c=place(qp.get(k)); if(c) patch[k]=c; });
    ['start','end'].forEach(k=>{ const d=day(qp.get(k)); if(d) patch[k]=d; });
    return patch;
  },
  alLogo(code,withName){ code=code||'FR'; const n=AIRLINES[code]||code;
    return `<span class="al" title="${H.esc(n)}"><img src="https://images.kiwi.com/airlines/64/${code}.png" onerror="this.onerror=null;this.src='https://pics.avs.io/64/64/${code}.png'" alt="${H.esc(n)}" loading="lazy">${withName?`<b>${H.esc(n)}</b>`:''}</span>`; },
  flag(cc){ return /^[A-Za-z]{2}$/.test(cc||'')?`<img class="flag" src="https://flagcdn.com/w40/${cc.toLowerCase()}.png" alt="${cc}" loading="lazy">`:''; },
};

/* IATA airline codes → names (square logos from images.kiwi.com, pics.avs.io as fallback) */
const AIRLINES={FR:'Ryanair',RK:'Ryanair UK',AL:'Malta Air (Ryanair)',RR:'Buzz (Ryanair)',OE:'Lauda Europe (Ryanair)',
  W6:'Wizz Air',PC:'Pegasus',XQ:'SunExpress',TK:'Turkish Airlines',EW:'Eurowings',LH:'Lufthansa',U2:'easyJet',DE:'Condor',VY:'Vueling',
  VF:'AJet',GQ:'Sky Express',CA:'Air China',W4:'Wizz Air Malta',EI:'Aer Lingus',SK:'SAS',AZ:'ITA Airways',LO:'LOT',OU:'Croatia Airlines',JU:'Air Serbia',FZ:'flydubai',QR:'Qatar Airways',EK:'Emirates',KK:'AtlasGlobal',X3:'TUIfly',BY:'TUI',V7:'Volotea',EN:'Air Dolomiti','4U':'Germanwings',OS:'Austrian',LX:'SWISS',KL:'KLM',AF:'Air France',BA:'British Airways',IB:'Iberia',A3:'Aegean',TP:'TAP Portugal',
  EY:'Etihad Airways',UX:'Air Europa',SN:'Brussels Airlines',BT:'airBaltic',FB:'Bulgaria Air',RO:'TAROM',SU:'Aeroflot',MS:'EgyptAir',AT:'Royal Air Maroc',ET:'Ethiopian Airlines',SV:'Saudia',G9:'Air Arabia',J2:'Azerbaijan Airlines',PS:'UIA',H4:'HiSky',D8:'Norwegian',DY:'Norwegian',BJ:'Nouvelair',TU:'Tunisair',OR:'TUI'};

/* ---------- airport database + search ---------- */
const AP = (()=>{
  let list=null, map=null, countries=null;
  const dnOf=lang=>{ try{ const dn=new Intl.DisplayNames([lang],{type:'region'}); return c=>{ try{ return dn.of(c); }catch(e){ return c; } }; }catch(e){ return c=>c; } };
  const countryName=dnOf('en'), countryTr=dnOf('tr'), countryDe=dnOf('de');
  const norm=s=>String(s||'').toLowerCase().replace(/ı/g,'i').replace(/ß/g,'ss').normalize('NFD').replace(/[̀-ͯ]/g,'');
  function build(){
    if(list) return;
    list=(typeof AIRPORT_DB!=='undefined'?AIRPORT_DB:[]).map(a=>{
      const o={code:a[0],city:a[1],name:a[2],cc:a[3],size:a[4],kw:a[5],lat:a[6],lon:a[7],country:countryName(a[3])};
      o.ncity=norm(o.city); o.nname=norm(o.name); o.nkw=norm(o.kw); o.nall=norm(`${o.city} ${o.name} ${o.kw} ${o.country}`);
      return o; });
    map=new Map(list.map(a=>[a.code,a]));
    // one entry per country: code "C:ES"; searchable in English, Turkish and German
    const cm=new Map();
    list.forEach(a=>{ if(!cm.has(a.cc)) cm.set(a.cc,{code:'C:'+a.cc,cc:a.cc,country:a.country,isCountry:true,count:0,
        names:[a.country,countryTr(a.cc),countryDe(a.cc)].map(norm)});
      if(a.size!=='s') cm.get(a.cc).count++; });
    countries=[...cm.values()]; countries.forEach(c=>map.set(c.code,c));
  }
  const rank={l:0,m:1,s:2};
  return {
    norm, countryName,
    byCode(c){ build(); return map.get(c); },
    /* bigger airports of a country, large first */
    inCountry(cc,max=30){ build(); return list.filter(a=>a.cc===cc&&a.size!=='s').sort((x,y)=>rank[x.size]-rank[y.size]).slice(0,max); },
    search(q,limit=8){
      build(); const n=norm(q).trim(); if(!n) return [];
      const out=[];
      if(n.length>=2) for(const c of countries){
        if(c.names.some(x=>x.startsWith(n))) out.push([1,c]);
        else if(n.length>=4&&c.names.some(x=>x.includes(n))) out.push([7,c]);
      }
      for(const a of list){
        let s=null;
        if(a.ncity===n) s=-1/6;   // exact city name ("Kos") beats an airport code that happens to match
        else if(n.length===3 && a.code.toLowerCase()===n) s=0;
        else if(a.ncity.startsWith(n)) s=1;
        else if(a.nkw.split(',').some(k=>k.trim().startsWith(n))) s=1.5;   // keyword-only ("Palmaseca") ranks below a city
        else if(a.nname.startsWith(n)) s=2;
        else if(a.nall.includes(n)) s=3;
        if(s!==null) out.push([s*3+rank[a.size]-(a.nname.includes(n)?0.1:0),a]);   // tie: Venice -> VCE before TSF
      }
      return out.sort((x,y)=>x[0]-y[0]).slice(0,limit).map(x=>x[1]);
    },
    /* larger airports within km of a given airport */
    near(code,km=250,max=5){
      build(); const o=map.get(code); if(!o) return [];
      const R=6371, rad=x=>x*Math.PI/180;
      const dist=a=>{ const dLa=rad(a.lat-o.lat), dLo=rad(a.lon-o.lon);
        const h=Math.sin(dLa/2)**2+Math.cos(rad(o.lat))*Math.cos(rad(a.lat))*Math.sin(dLo/2)**2; return 2*R*Math.asin(Math.sqrt(h)); };
      return list.filter(a=>a.code!==code&&a.size!=='s').map(a=>({a,d:dist(a)})).filter(x=>x.d<=km)
        .sort((x,y)=>x.d-y.d).slice(0,max).map(x=>Object.assign({km:Math.round(x.d)},x.a));
    },
  };
})();

function airportLabel(code){
  if(code==='ANY') return '🌍 Anywhere';
  const a=AP.byCode(code); if(a&&a.isCountry) return `${a.country} — all airports`;
  return a?`${a.code} — ${a.city||a.name}, ${a.country}`:(code||'');
}

/* autocomplete for <input data-ac> ; add data-anywhere to offer "Anywhere" */
function setAirport(input,code){ input.value=airportLabel(code); input.dataset.code=code; input.dataset.label=input.value; }
function attachAutocomplete(input){
  const box=document.createElement('div'); box.className='ac-wrap';
  input.parentNode.insertBefore(box,input); box.appendChild(input);
  const ul=document.createElement('ul'); ul.className='ac'; box.appendChild(ul);
  let items=[], idx=-1;
  const anyOk=input.hasAttribute('data-anywhere');
  function show(){
    const q=input.value===input.dataset.label?'':input.value;
    items=AP.search(q,8);
    const anyItem={code:'ANY'};
    if(anyOk && (!q || /^(a|an|any|her|ev|wo)/i.test(q.trim()))) items=[anyItem,...items];
    if(!items.length){ ul.innerHTML=q?'<li class="none">No match — try a city, country or 3-letter code</li>':'<li class="none">Type a city, country, airport or code…</li>'; ul.classList.add('open'); return; }
    ul.innerHTML=items.map((a,i)=>a.code==='ANY'
      ? `<li data-i="${i}" class="any"><span class="cd">🌍</span><span><b>Anywhere</b><small>Every city with a direct flight, live prices</small></span></li>`
      : a.isCountry
      ? `<li data-i="${i}" class="any"><span class="cd">${H.flag(a.cc)||a.cc}</span><span><b>${H.esc(a.country)}</b><small>Whole country · ${a.count||'all'} airport${a.count===1?'':'s'}</small></span></li>`
      : `<li data-i="${i}"><span class="cd">${a.code}</span><span><b>${H.esc(a.city||a.name)}</b><small>${H.flag(a.cc)} ${H.esc(a.name)}, ${H.esc(a.country)}</small></span></li>`).join('');
    idx=-1; ul.classList.add('open');
  }
  function pick(i){ const a=items[i]; if(!a) return; setAirport(input,a.code); ul.classList.remove('open'); input.dispatchEvent(new Event('change',{bubbles:true})); }
  input.setAttribute('autocomplete','off');
  input.addEventListener('focus',()=>{ input.select(); show(); });
  input.addEventListener('input',show);
  input.addEventListener('keydown',e=>{
    if(!ul.classList.contains('open')) return;
    const lis=ul.querySelectorAll('li[data-i]');
    if(e.key==='ArrowDown'){ idx=Math.min(idx+1,lis.length-1); e.preventDefault(); }
    else if(e.key==='ArrowUp'){ idx=Math.max(idx-1,0); e.preventDefault(); }
    else if(e.key==='Enter'){ if(lis.length){ pick(idx<0?0:idx); e.preventDefault(); } return; }
    else if(e.key==='Escape'){ ul.classList.remove('open'); return; }
    lis.forEach((li,i)=>li.classList.toggle('hl',i===idx));
  });
  ul.addEventListener('mousedown',e=>{ const li=e.target.closest('li[data-i]'); if(li){ e.preventDefault(); pick(+li.dataset.i); } });
  input.addEventListener('blur',()=>setTimeout(()=>{ ul.classList.remove('open');
    if(input.value && input.value!==input.dataset.label){ const c=H.codeOf(input); if(c) setAirport(input,c); } },120));
}

/* ---------- network: every request times out, and a newer search cancels the older one ----------
   NET.begin(channel) aborts that channel's previous search and returns the signal for the new one;
   pass it down as `signal`, so cancelled searches stop sending requests instead of queueing up. */
const NET = {
  TIMEOUT:15000,
  _ctl:{},
  begin(ch){ this.cancel(ch); return (this._ctl[ch]=new AbortController()).signal; },
  cancel(ch){ if(this._ctl[ch]){ this._ctl[ch].abort(); delete this._ctl[ch]; } },
  check(signal){ if(signal&&signal.aborted) throw new Error('cancelled'); },
  FAILED:Symbol('failed'),   // set on a per-day result when a month could not be loaded (as opposed to: no flights)
  /* fetch + JSON body under one timer (a stalled body can hang too): {ok,status,data} */
  /* the local server (start.bat): same address when the page comes from it, else 127.0.0.1:8080 (page opened as a file, or inside Streamlit) */
  SERVER:/^https?:$/.test(location.protocol)?'':'http://127.0.0.1:8080',
  async json(url,opts={},ms=this.TIMEOUT){
    if(url.startsWith('/')) url=this.SERVER+url;
    const outer=opts.signal; this.check(outer);
    const ctl=new AbortController(), stop=()=>ctl.abort();
    const t=setTimeout(stop,ms); if(outer) outer.addEventListener('abort',stop,{once:true});
    try{ const r=await fetch(url,{...opts,signal:ctl.signal}); let data=null; try{ data=await r.json(); }catch(e){ if(ctl.signal.aborted) throw e; }
      return {ok:r.ok,status:r.status,data}; }
    catch(e){ if(outer&&outer.aborted) throw new Error('cancelled'); if(ctl.signal.aborted) throw new Error('Request timed out'); throw e; }
    finally{ clearTimeout(t); if(outer) outer.removeEventListener('abort',stop); }
  },
};

/* ---------- Ryanair live fares (public fare-finder API, allows browser access) ---------- */
const RYANAIR = {
  base:'https://services-api.ryanair.com/farfnd/v4',
  async get(path,params,signal){
    const u=this.base+path+'?'+new URLSearchParams(params);
    const r=await NET.json(u,{signal}); if(!r.ok) throw new Error('Ryanair '+r.status); return r.data||{};
  },
  /* cheapest round trip to every destination (or one, if `to` given) */
  async roundTrips({from,to,outFrom,outTo,inFrom,inTo,minN,maxN,currency,signal}){
    const p={departureAirportIataCode:from,outboundDepartureDateFrom:outFrom,outboundDepartureDateTo:outTo,
      inboundDepartureDateFrom:inFrom,inboundDepartureDateTo:inTo,durationFrom:minN||1,durationTo:maxN||30,currency,market:'en-gb',adultPaxCount:1};
    if(to) p.arrivalAirportIataCode=to;
    const d=await this.get('/roundTripFares',p,signal);
    return (d.fares||[]).map(f=>({origin:from,dest:f.outbound.arrivalAirport.iataCode,destCity:f.outbound.arrivalAirport.city.name,
      country:f.outbound.arrivalAirport.countryName,outDep:f.outbound.departureDate,outArr:f.outbound.arrivalDate,
      inDep:f.inbound.departureDate,inArr:f.inbound.arrivalDate,pp:f.summary.price.value,cur:f.summary.price.currencyCode,
      outFlight:f.outbound.flightNumber,inFlight:f.inbound.flightNumber}));
  },
  async oneWays({from,to,outFrom,outTo,currency,signal}){
    const p={departureAirportIataCode:from,outboundDepartureDateFrom:outFrom,outboundDepartureDateTo:outTo,currency,market:'en-gb'};
    if(to) p.arrivalAirportIataCode=to;
    const d=await this.get('/oneWayFares',p,signal);
    return (d.fares||[]).map(f=>({origin:from,dest:f.outbound.arrivalAirport.iataCode,destCity:f.outbound.arrivalAirport.city.name,
      country:f.outbound.arrivalAirport.countryName,outDep:f.outbound.departureDate,outArr:f.outbound.arrivalDate,
      pp:f.outbound.price.value,cur:f.outbound.price.currencyCode,outFlight:f.outbound.flightNumber}));
  },
  /* {YYYY-MM-DD: {price,cur,dep}} for each day in the given months */
  _pd:new Map(),   // cache: one request per route+month+currency per page load
  async perDay(from,to,months,currency,signal){
    NET.check(signal);
    const out={};
    await Promise.all(months.map(async m=>{
      const k=`${from}-${to}-${m.slice(0,7)}-${currency}`;
      if(!this._pd.has(k)) this._pd.set(k,(async()=>{ const r={};
        try{ const d=await this.get(`/oneWayFares/${from}/${to}/cheapestPerDay`,{outboundMonthOfDate:m.slice(0,7)+'-01',currency});
          (d.outbound&&d.outbound.fares||[]).forEach(f=>{ if(f.price&&!f.unavailable&&!f.soldOut) r[f.day]={price:f.price.value,cur:f.price.currencyCode,dep:f.departureDate,arr:f.arrivalDate}; });
        }catch(e){ this._pd.delete(k); r[NET.FAILED]=true; } return r; })());
      Object.assign(out,await this._pd.get(k));
    }));
    NET.check(signal);
    return out;
  },
  /* airports with direct Ryanair flights to `to` (an airport, or "C:XX" = its 8 biggest airports) in the window.
     Routes run both ways, so the airport's own route map tells us where flights come from. */
  async sourcesTo(to,outFrom,latest,currency,signal){
    const targets=H.isCountry(to)?AP.inCountry(to.slice(2),8).map(a=>a.code):[to];
    const nets=await Promise.all(targets.map(c=>this.oneWays({from:c,outFrom,outTo:latest,currency,signal}).catch(()=>[])));
    NET.check(signal);
    return [...new Set(nets.flat().map(d=>d.dest))].filter(c=>!targets.includes(c)).slice(0,60);
  },
  bookUrl(o){
    const p=new URLSearchParams({adults:o.adults,teens:0,children:o.children||0,infants:0,dateOut:o.dep,dateIn:o.ret||'',isConnectedFlight:false,
      isReturn:!!o.ret,discount:0,originIata:o.from,destinationIata:o.to,tpAdults:o.adults,tpTeens:0,tpChildren:o.children||0,tpInfants:0,
      tpStartDate:o.dep,tpEndDate:o.ret||'',tpOriginIata:o.from,tpDestinationIata:o.to});
    return 'https://www.ryanair.com/gb/en/trip/flights/select?'+p;
  },
};

/* "explore everywhere" pages on other sites for a date window */
const EXPLORE_SITES = [
  { name:'Skyscanner Everywhere', color:'#0770e3', ab:'S', url(o){ const y=s=>s.slice(2).replace(/-/g,'');
      return `https://www.skyscanner.net/transport/flights-from/${o.from.toLowerCase()}/${y(o.dep)}/${o.ret?y(o.ret)+'/':''}?adultsv2=${o.adults}&rtn=${o.ret?1:0}`; } },
  { name:'Google Flights Explore', color:'#4285f4', ab:'G', url(o){
      return `https://www.google.com/travel/explore?q=${encodeURIComponent(`flights from ${o.from} on ${o.dep}${o.ret?' returning '+o.ret:''}`)}`; } },
  { name:'Kayak Explore', color:'#ff690f', ab:'K', url(o){
      return `https://www.kayak.com/explore/${o.from}-anywhere/${o.dep.replace(/-/g,'')}${o.ret?','+o.ret.replace(/-/g,''):''}`; } },
  { name:'Kiwi.com Anywhere', color:'#00a991', ab:'Ki', url(o){
      const a=AP.byCode(o.from), slug=s=>AP.norm(s).replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
      const place=a?`${slug(a.city||a.name)}-${slug(a.country)}`:o.from.toLowerCase();
      return `https://www.kiwi.com/en/search/results/${place}/anywhere/${o.dep}/${o.ret||'no-return'}`; } },
  { name:'Wizz Air map', color:'#c6007e', ab:'W', url(o){ return `https://www.wizzair.com/en-gb/flights/fare-finder`; } },
];

/* ---------- deep-link builders ---------- */
const FLIGHT_SITES = [
  { name:'Google Flights', color:'#4285f4', ab:'G', url(o){
      const q = o.ret ? `Flights from ${o.from} to ${o.to} on ${o.dep} through ${o.ret}` : `One way flights from ${o.from} to ${o.to} on ${o.dep}`;
      return `https://www.google.com/travel/flights?q=${encodeURIComponent(q+` for ${o.adults} adults`+(o.children?` and ${o.children} children`:'')+(o.cabin!=='economy'?` ${o.cabin.replace('_',' ')} class`:''))}`; } },
  { name:'Skyscanner', color:'#0770e3', ab:'S', url(o){
      const y=s=>s.slice(2).replace(/-/g,'');
      const cab={economy:'economy',premium_economy:'premiumeconomy',business:'business',first:'first'}[o.cabin];
      return `https://www.skyscanner.net/transport/flights/${o.from.toLowerCase()}/${o.to.toLowerCase()}/${y(o.dep)}/${o.ret?y(o.ret)+'/':''}?adultsv2=${o.adults}${o.children?'&childrenv2='+Array(o.children).fill(8).join('|'):''}&cabinclass=${cab}&rtn=${o.ret?1:0}`; } },
  { name:'Kayak', color:'#ff690f', ab:'K', url(o){ return kayakish('https://www.kayak.com/flights',o); } },
  { name:'Momondo', color:'#7b2a90', ab:'M', url(o){ return kayakish('https://www.momondo.com/flight-search',o); } },
  { name:'Cheapflights', color:'#1a73a8', ab:'C', url(o){ return kayakish('https://www.cheapflights.com/flight-search',o); } },
  { name:'Kiwi.com', color:'#00a991', ab:'Ki', url(o){
      const d=s=>s.split('-').reverse().join('-');
      return `https://www.kiwi.com/deep?from=${o.from}&to=${o.to}&departure=${d(o.dep)}${o.ret?'&return='+d(o.ret):'&return=no-return'}&adults=${o.adults}&children=${o.children}`; } },
  { name:'Expedia', color:'#191e3b', ab:'E', url(o){
      const d=s=>{const [y,m,dd]=s.split('-');return `${m}/${dd}/${y}`;};
      let u=`https://www.expedia.com/Flights-Search?trip=${o.ret?'roundtrip':'oneway'}&leg1=from:${o.from},to:${o.to},departure:${d(o.dep)}TANYT`;
      if(o.ret) u+=`&leg2=from:${o.to},to:${o.from},departure:${d(o.ret)}TANYT`;
      const cab={economy:'coach',premium_economy:'premium',business:'business',first:'first'}[o.cabin];
      return u+`&passengers=adults:${o.adults},children:${o.children}&options=cabinclass:${cab}&mode=search`; } },
  { name:'Trip.com', color:'#287dfa', ab:'T', url(o){
      const cab={economy:'y',premium_economy:'s',business:'c',first:'f'}[o.cabin];
      return `https://www.trip.com/flights/showfarefirst?dcity=${o.from.toLowerCase()}&acity=${o.to.toLowerCase()}&ddate=${o.dep}${o.ret?'&rdate='+o.ret+'&triptype=rt':'&triptype=ow'}&class=${cab}&quantity=${o.adults}&searchboxarg=t`; } },
];
function kayakish(base,o){
  const cab={economy:'',premium_economy:'/premium',business:'/business',first:'/first'}[o.cabin];
  const pax=`${o.adults}adults`+(o.children?`/children-${Array(o.children).fill('11').join('-')}`:'');
  return `${base}/${o.from}-${o.to}/${o.dep}${o.ret?'/'+o.ret:''}${cab}/${pax}?sort=price_a`;
}

const HOTEL_SITES = [
  { name:'Booking.com', color:'#003580', ab:'B', url(o){
      let u=`https://www.booking.com/searchresults.html?ss=${encodeURIComponent(o.city)}&checkin=${o.ci}&checkout=${o.co}&group_adults=${o.adults}&group_children=${o.children}&no_rooms=${o.rooms}&order=price`;
      if(o.stars) u+=`&nflt=${encodeURIComponent(o.stars.split(',').map(s=>'class='+s).join(';'))}`;
      return u; } },
  { name:'Google Hotels', color:'#34a853', ab:'G', url(o){
      return `https://www.google.com/travel/search?q=${encodeURIComponent(`hotels in ${o.city} ${o.ci} to ${o.co} ${o.adults} adults`)}`; } },
  { name:'Airbnb', color:'#ff385c', ab:'A', url(o){
      return `https://www.airbnb.com/s/${encodeURIComponent(o.city)}/homes?checkin=${o.ci}&checkout=${o.co}&adults=${o.adults}&children=${o.children}`; } },
  { name:'Hotels.com', color:'#d32f2f', ab:'H', url(o){
      return `https://www.hotels.com/Hotel-Search?destination=${encodeURIComponent(o.city)}&startDate=${o.ci}&endDate=${o.co}&adults=${o.adults}&rooms=${o.rooms}&sort=PRICE_LOW_TO_HIGH`; } },
  { name:'Expedia', color:'#191e3b', ab:'E', url(o){
      return `https://www.expedia.com/Hotel-Search?destination=${encodeURIComponent(o.city)}&startDate=${o.ci}&endDate=${o.co}&adults=${o.adults}&rooms=${o.rooms}&sort=PRICE_LOW_TO_HIGH`; } },
  { name:'Agoda', color:'#5c2d91', ab:'Ag', url(o){
      const los=H.diff(H.parse(o.ci),H.parse(o.co));
      return `https://www.agoda.com/search?textToSearch=${encodeURIComponent(o.city)}&checkIn=${o.ci}&los=${los}&rooms=${o.rooms}&adults=${o.adults}&children=${o.children}&sort=priceLowToHigh`; } },
  { name:'Kayak Hotels', color:'#ff690f', ab:'K', url(o){
      return `https://www.kayak.com/hotels/${encodeURIComponent(o.city)}/${o.ci}/${o.co}/${o.adults}adults${o.rooms>1?'/'+o.rooms+'rooms':''}?sort=price_a`; } },
];

function siteButtons(sites,o){
  return sites.map(s=>`<a class="site" href="${H.esc(s.url(o))}" target="_blank" rel="noopener">
      <span class="dot" style="background:${s.color}">${s.ab}</span><span>${s.name}<small>Open search ↗</small></span></a>`).join('');
}
function openAll(sites,o){
  let blocked=false;
  sites.forEach(s=>{ const w=window.open(s.url(o),'_blank','noopener'); if(w===null) blocked=true; });
  if(blocked) H.toast('Your browser blocked some tabs — allow pop-ups for this page');
}

/* ---------- shared chrome ---------- */
function decorateHero(){
  const page=document.body.dataset.page;
  document.querySelectorAll('.nav a.link').forEach(a=>{ if(a.dataset.page===page){ a.classList.add('active'); a.setAttribute('aria-current','page'); } });
  themeButton();
  // the nav is clear glass over the hero and frosts once the hero has scrolled away under it
  const nav=document.querySelector('.nav'), hero=document.querySelector('.hero');
  if(nav){
    const set=()=>{ const edge=hero?hero.offsetHeight-nav.offsetHeight:0; nav.classList.toggle('scrolled',window.scrollY>edge-8); };
    window.addEventListener('scroll',set,{passive:true}); window.addEventListener('resize',set); set();
  }
}

/* Light by default; the sun/moon button in the nav switches, and the choice is remembered.
   The switch cross-fades (View Transitions where supported) so the brightness never jumps. */
function themeButton(){
  const ul=document.querySelector('.nav ul'); if(!ul) return;
  const root=document.documentElement, meta=document.querySelector('meta[name=theme-color]');
  const li=document.createElement('li');
  li.innerHTML=`<button type="button" class="theme-btn">
    <svg class="sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/></svg>
    <svg class="moon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.4 14.6A8.5 8.5 0 0 1 9.4 3.6a8.5 8.5 0 1 0 11 11z"/></svg></button>`;
  ul.appendChild(li);
  const btn=li.firstElementChild;
  const label=()=>{ const dark=root.dataset.theme==='dark'; btn.setAttribute('aria-label',dark?'Switch to light mode':'Switch to dark mode'); btn.title=btn.getAttribute('aria-label'); btn.setAttribute('aria-pressed',dark); };
  const apply=dark=>{
    if(dark) root.dataset.theme='dark'; else delete root.dataset.theme;
    if(meta) meta.content=dark?'#000000':'#f2f5f9';
    try{ localStorage.setItem('heybe.theme',dark?'dark':'light'); }catch(e){}
    label();
  };
  label();
  btn.onclick=()=>{
    const dark=root.dataset.theme!=='dark';
    const calm=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;
    if(document.startViewTransition&&!calm) document.startViewTransition(()=>apply(dark)); else apply(dark);
  };
}

/* Segmented controls get one thumb that slides (spring easing in CSS) to whichever button is .on.
   Pages toggle .on themselves and some re-render their .seg, so a single observer keeps every thumb in place. */
function segThumbs(){
  if(typeof MutationObserver==='undefined') return;
  const place=seg=>{
    let th=seg.querySelector(':scope > .seg-thumb');
    const fresh=!th;
    if(fresh){ th=document.createElement('span'); th.className='seg-thumb'; th.setAttribute('aria-hidden','true'); seg.prepend(th); }
    const on=seg.querySelector(':scope > button.on'), vis=!!(on&&on.offsetWidth);
    // only touch the class when it changes, otherwise the observer below would loop
    if(seg.classList.contains('has-thumb')!==vis) seg.classList.toggle('has-thumb',vis);   // hidden seg: buttons keep their own .on look
    if(!vis){ th.style.opacity='0'; return; }
    if(fresh||th.style.opacity==='0') th.style.transition='none';      // first placement: no slide in from 0,0
    th.style.opacity='1';
    th.style.width=on.offsetWidth+'px'; th.style.height=on.offsetHeight+'px';
    th.style.transform=`translate(${on.offsetLeft}px,${on.offsetTop}px)`;
    if(th.style.transition){ void th.offsetWidth; th.style.transition=''; }
  };
  const all=()=>document.querySelectorAll('.seg').forEach(place);
  all();
  new MutationObserver(ms=>{
    const segs=new Set();
    ms.forEach(m=>{
      const t=m.target.nodeType===1?m.target:null; if(!t) return;
      const s=t.closest('.seg'); if(s) segs.add(s);
      t.querySelectorAll('.seg').forEach(x=>segs.add(x));                 // also catches a hidden parent being shown
    });
    segs.forEach(place);
  }).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});
  if(typeof ResizeObserver!=='undefined') new ResizeObserver(all).observe(document.body);
}
document.addEventListener('DOMContentLoaded',()=>{ decorateHero(); segThumbs(); document.querySelectorAll('input[data-ac]').forEach(attachAutocomplete); });

/* ---------- multi-city round trips: HOME → A (stay) → B (stay) → HOME, live Ryanair fares ---------- */
/* run fn over items, n at a time; a failed item is skipped. With a signal: stop starting new items once it is aborted, then throw "cancelled" */
async function pool(items,n,fn,signal){ const q=[...items], out=[];
  await Promise.all(Array.from({length:n},async()=>{ while(q.length&&!(signal&&signal.aborted)){ const it=q.shift(); try{ out.push(await fn(it)); }catch(e){} } }));
  NET.check(signal); return out; }
const MULTI = {
  /* START → stop(s) → END, every leg a direct Ryanair flight, live fares.
     opts: {from, to (end airport, default = from), stops (1 or 2, default 2), outFrom, outTo, latest, minN, maxN, currency, must}
     dates YYYY-MM-DD. must: optional airport code or "C:XX" country that one of the stops has to be in. */
  async search(o,progress=()=>{}){
    const minN=Math.max(1,o.minN||3), maxN=Math.max(minN,o.maxN||5);
    const end=o.to&&o.to!=='ANY'?o.to:o.from, stops=o.stops===1?1:2;
    const t=new Date(); t.setHours(0,0,0,0);
    const outFrom=H.parse(o.outFrom)<t?H.fmt(t):o.outFrom;
    progress(`Finding every city you can fly to from ${o.from}…`);
    const [endNetList,leg1]=await Promise.all([
      RYANAIR.oneWays({from:end,outFrom,outTo:o.latest,currency:o.currency,signal:o.signal}),      // route map of the END airport
      RYANAIR.oneWays({from:o.from,outFrom,outTo:o.outTo,currency:o.currency,signal:o.signal})]);  // cheapest first leg per city
    const endNet=new Set(endNetList.map(d=>d.dest));   // cities with a direct flight to the end airport
    const ccOf=c=>{ const a=AP.byCode(c); return a?a.cc:''; };
    const match=c=>H.isCountry(o.must)?ccOf(c)===o.must.slice(2):c===o.must;
    const months=[]; { let d=H.parse(outFrom); d.setDate(1); while(d<=H.parse(o.latest)){ months.push(H.fmt(d)); d=new Date(d.getFullYear(),d.getMonth()+1,1); } }
    // cheapest flight home from `city`, leaving `minN..maxN` days after `day`
    const bestHome=(prices,day)=>{ let best=null;
      for(let n=minN;n<=maxN;n++){ const ds=H.fmt(H.add(day,n)); if(ds>o.latest) break;
        const p=prices[ds]; if(p&&(!best||p.price<best.price)) best={...p,day:ds}; } return best; };
    const lastLeg=(c,b)=>({from:c,to:end,city:H.cityOf(end),country:'',dep:b.dep,arr:b.arr,price:b.price});
    const leg=d=>({from:d.origin,to:d.dest,city:d.destCity,country:d.country,dep:d.outDep,arr:d.outArr,price:d.pp,flight:d.outFlight});
    const res=[];

    if(stops===1){
      const As=leg1.filter(a=>a.dest!==end&&endNet.has(a.dest)&&(!o.must||match(a.dest)));
      progress(`Checking flights on to ${end} from ${As.length} cities…`);
      const back={}; await pool(As,6,async a=>{ back[a.dest]=await RYANAIR.perDay(a.dest,end,months,o.currency,o.signal); },o.signal);
      As.forEach(a=>{ const b=bestHome(back[a.dest]||{},H.parse(a.outDep.slice(0,10))); if(!b) return;
        res.push({legs:[leg(a),lastLeg(a.dest,b)],stops:[a.destCity],nights:[H.diff(H.parse(a.outDep.slice(0,10)),H.parse(b.day))],
          total:a.pp+b.price,cur:a.cur,start:a.outDep.slice(0,10),end:b.day}); });
      res.sort((x,y)=>x.total-y.total);
      return {itineraries:res,checked:{first_stops:As.length,second_stops:0}};
    }

    progress(`Checking onward flights from ${leg1.length} cities…`);
    const leg2=(await pool(leg1.filter(a=>a.dest!==end),6,async a=>{
      const d1=H.parse(a.outDep.slice(0,10)), f=H.add(d1,minN), to=H.add(d1,maxN), lim=H.add(H.parse(o.latest),-minN);
      const last=to<lim?to:lim; if(f>last) return {a,opts:[]};
      const r=await RYANAIR.oneWays({from:a.dest,outFrom:H.fmt(f),outTo:H.fmt(last),currency:o.currency,signal:o.signal});
      return {a,opts:r.filter(b=>b.dest!==end&&b.dest!==o.from&&b.dest!==a.dest&&endNet.has(b.dest))};
    },o.signal));
    const Bs=[...new Set(leg2.flatMap(x=>x.opts.map(b=>b.dest)))];
    progress(`Checking flights on to ${end} from ${Bs.length} cities…`);
    const back={}; await pool(Bs,6,async b=>{ back[b]=await RYANAIR.perDay(b,end,months,o.currency,o.signal); },o.signal);
    leg2.forEach(({a,opts})=>opts.forEach(b=>{
      if(o.must&&!match(a.dest)&&!match(b.dest)) return;
      const d2=H.parse(b.outDep.slice(0,10)), h=bestHome(back[b.dest]||{},d2); if(!h) return;
      res.push({legs:[leg(a),leg(b),lastLeg(b.dest,h)],stops:[a.destCity,b.destCity],
        nights:[H.diff(H.parse(a.outDep.slice(0,10)),d2),H.diff(d2,H.parse(h.day))],
        total:a.pp+b.pp+h.price,cur:a.cur,start:a.outDep.slice(0,10),end:h.day});
    }));
    res.sort((x,y)=>x.total-y.total);
    return {itineraries:res,checked:{first_stops:leg1.length,second_stops:Bs.length}};
  },
};

/* HOME → ? [→ ?] → LAST STOP → HOME. The user picks the last stop (airport or "C:XX" country);
   the city/cities before it are found from live fares. Every leg is a direct Ryanair flight. */
MULTI.viaLoop = async function(o,progress=()=>{}){
  const minN=Math.max(1,o.minN||3), maxN=Math.max(minN,o.maxN||5), k=o.stops===2?2:1;
  const t=new Date(); t.setHours(0,0,0,0);
  const outFrom=H.parse(o.outFrom)<t?H.fmt(t):o.outFrom;
  const ccOf=c=>{ const a=AP.byCode(c); return a?a.cc:''; };
  const match=c=>H.isCountry(o.must)?ccOf(c)===o.must.slice(2):c===o.must;
  const months=[]; { let d=H.parse(outFrom); d.setDate(1); while(d<=H.parse(o.latest)){ months.push(H.fmt(d)); d=new Date(d.getFullYear(),d.getMonth()+1,1); } }
  const win=(day)=>{ const f=H.add(day,minN), to=H.add(day,maxN), lim=H.parse(o.latest); return f>lim?null:[H.fmt(f),H.fmt(to<lim?to:lim)]; };
  const pick=(prices,day,last)=>{ let best=null; for(let n=minN;n<=maxN;n++){ const ds=H.fmt(H.add(day,n)); if(ds>last) break;
      const p=prices[ds]; if(p&&(!best||p.price<best.price)) best={...p,day:ds}; } return best; };
  const leg=d=>({from:d.origin,to:d.dest,city:d.destCity,country:d.country,dep:d.outDep,arr:d.outArr,price:d.pp});
  const legP=(a,b,p)=>({from:a,to:b,city:H.cityOf(b),country:'',dep:p.dep,arr:p.arr,price:p.price});

  progress(`Finding every city you can fly to from ${o.from}…`);
  const [homeNet,leg1]=await Promise.all([
    RYANAIR.oneWays({from:o.from,outFrom,outTo:o.latest,currency:o.currency,signal:o.signal}),
    RYANAIR.oneWays({from:o.from,outFrom,outTo:o.outTo,currency:o.currency,signal:o.signal})]);
  // last-stop airports: must have a direct flight back home
  const homeSet=new Set(homeNet.map(d=>d.dest));
  const ends=H.isCountry(o.last)?[...homeSet].filter(c=>ccOf(c)===o.last.slice(2)):(homeSet.has(o.last)?[o.last]:[]);
  if(!ends.length) return {itineraries:[],checked:{},note:`No direct Ryanair flight from ${H.cityOf(o.last)} back to ${H.cityOf(o.from)} in these dates.`};
  const endSet=new Set(ends);
  const As=leg1.filter(a=>!endSet.has(a.dest)&&(k===2||!o.must||match(a.dest)));
  const homeBack={}; // last stop → home, per day
  const res=[];

  if(k===1){
    progress(`Checking flights from ${As.length} cities to ${H.cityOf(o.last)}…`);
    const hops=await pool(As,6,async a=>{ const w=win(H.parse(a.outDep.slice(0,10))); if(!w) return {a,opts:[]};
      const r=await RYANAIR.oneWays({from:a.dest,outFrom:w[0],outTo:w[1],currency:o.currency,signal:o.signal}); return {a,opts:r.filter(x=>endSet.has(x.dest))}; },o.signal);
    progress(`Checking flights home to ${o.from}…`);
    await pool(ends,6,async e=>{ homeBack[e]=await RYANAIR.perDay(e,o.from,months,o.currency,o.signal); },o.signal);
    hops.forEach(({a,opts})=>opts.forEach(x=>{
      const d2=H.parse(x.outDep.slice(0,10)), h=pick(homeBack[x.dest]||{},d2,o.latest); if(!h) return;
      res.push({legs:[leg(a),leg(x),legP(x.dest,o.from,h)],stops:[a.destCity,x.destCity],
        nights:[H.diff(H.parse(a.outDep.slice(0,10)),d2),H.diff(d2,H.parse(h.day))],total:a.pp+x.pp+h.price,cur:a.cur,start:a.outDep.slice(0,10),end:h.day});
    }));
  } else {
    progress(`Checking onward flights from ${As.length} cities…`);
    const hops=await pool(As,6,async a=>{ const w=win(H.parse(a.outDep.slice(0,10))); if(!w) return {a,opts:[]};
      const r=await RYANAIR.oneWays({from:a.dest,outFrom:w[0],outTo:w[1],currency:o.currency,signal:o.signal});
      return {a,opts:r.filter(b=>b.dest!==o.from&&b.dest!==a.dest&&!endSet.has(b.dest)&&(!o.must||match(a.dest)||match(b.dest)))}; },o.signal);
    const Bs=[...new Set(hops.flatMap(h=>h.opts.map(b=>b.dest)))];
    progress(`Checking which of ${Bs.length} cities fly to ${H.cityOf(o.last)}…`);
    // which last-stop airports each B reaches (one request per B), then daily prices for those pairs
    const reach={}; await pool(Bs,6,async b=>{ const r=await RYANAIR.oneWays({from:b,outFrom,outTo:o.latest,currency:o.currency,signal:o.signal}); reach[b]=r.filter(x=>endSet.has(x.dest)).map(x=>x.dest); },o.signal);
    const pairs=Bs.flatMap(b=>(reach[b]||[]).map(e=>[b,e])).slice(0,90);
    progress(`Reading daily prices for ${pairs.length} connections…`);
    const pd={}; await pool(pairs,6,async([b,e])=>{ pd[b+'>'+e]=await RYANAIR.perDay(b,e,months,o.currency,o.signal); },o.signal);
    await pool(ends,6,async e=>{ homeBack[e]=await RYANAIR.perDay(e,o.from,months,o.currency,o.signal); },o.signal);
    hops.forEach(({a,opts})=>opts.forEach(b=>{
      const d2=H.parse(b.outDep.slice(0,10));
      (reach[b.dest]||[]).forEach(e=>{
        const x=pick(pd[b.dest+'>'+e]||{},d2,o.latest); if(!x) return;
        const d3=H.parse(x.day), h=pick(homeBack[e]||{},d3,o.latest); if(!h) return;
        res.push({legs:[leg(a),leg(b),legP(b.dest,e,x),legP(e,o.from,h)],stops:[a.destCity,b.destCity,H.cityOf(e)],
          nights:[H.diff(H.parse(a.outDep.slice(0,10)),d2),H.diff(d2,d3),H.diff(d3,H.parse(h.day))],
          total:a.pp+b.pp+x.price+h.price,cur:a.cur,start:a.outDep.slice(0,10),end:h.day});
      });
    }));
  }
  res.sort((x,y)=>x.total-y.total);
  return {itineraries:res,checked:{first_stops:As.length,last_stops:ends.length}};
};

/* ---------- all airlines: Travelpayouts (Aviasales Data API) through the local server ----------
   Prices are cached from recent searches (not live) but cover every airline.
   Only works when the site is opened from server.js (http://localhost:8080). */
const TP = {
  _ok:null,
  async available(){
    if(this._ok!==null) return this._ok;
    try{ const r=await NET.json('/tp/health',{},5000); this._ok=!!(r.data&&r.data.token); }catch(e){ this._ok=false; }
    return this._ok;
  },
  async get(p,params,signal){
    const clean=Object.fromEntries(Object.entries(params).filter(([k,v])=>v!==null&&v!==undefined&&v!==''));
    const r=await NET.json('/tp'+p+'?'+new URLSearchParams(clean),{signal}); const j=r.data||{};
    if(!r.ok||j.success===false) throw new Error(j.error||('Travelpayouts '+r.status)); return j.data;
  },
  months(a,b){ const out=[]; let d=H.parse(a); d.setDate(1); const e=H.parse(b); while(d<=e){ out.push(H.fmt(d).slice(0,7)); d=new Date(d.getFullYear(),d.getMonth()+1,1); } return out; },
  /* Travelpayouts row → the same shape as RYANAIR results */
  norm(x,cur){
    const dest=x.destination_airport||x.destination, org=x.origin_airport||x.origin, a=AP.byCode(dest);
    return {src:'tp',origin:org,dest,destCity:a?(a.city||a.name):dest,country:a?a.country:'',
      outDep:x.departure_at,outArr:null,inDep:x.return_at||null,pp:x.price,cur:(cur||'EUR').toUpperCase(),
      airline:x.airline,outFlight:x.airline+(x.flight_number||''),inFlight:x.return_at?x.airline:null,
      stops:x.transfers||0,rstops:x.return_transfers||0,link:x.link?'https://www.aviasales.com'+x.link:null};
  },
  inRange:(iso,a,b)=>{ const d=String(iso||'').slice(0,10); return d>=a&&d<=b; },
  days(a,b){ const out=[]; for(let d=H.parse(a), e=H.parse(b); d<=e&&out.length<10; d=H.add(d,1)) out.push(H.fmt(d)); return out; },
  /* Without a destination the month search returns only the overall cheapest fares, so most airlines never appear.
     Asking each departure day for the cheapest fare per destination (unique=true) fills those in.
     A day that fails is skipped: the month search already gave a result. */
  async everywhere(base,outFrom,outTo,signal){
    const rows=await Promise.all(this.days(outFrom,outTo).map(d=>
      this.get('/aviasales/v3/prices_for_dates',{...base,departure_at:d,unique:'true'},signal).catch(()=>[])));
    NET.check(signal);
    return rows.flat().filter(Boolean);
  },
  async roundTrips({from,to,outFrom,outTo,inFrom,inTo,minN,maxN,currency,direct,signal}){
    const out=[];
    for(const m1 of this.months(outFrom,outTo)) for(const m2 of this.months(inFrom,inTo)){
      const rows=await this.get('/aviasales/v3/prices_for_dates',{origin:from||'',destination:to||'',departure_at:m1,return_at:m2,
        one_way:'false',direct:direct?'true':'false',sorting:'price',unique:'false',limit:1000,currency:(currency||'EUR').toLowerCase()},signal);
      (rows||[]).forEach(x=>{ if(!this.inRange(x.departure_at,outFrom,outTo)||!this.inRange(x.return_at,inFrom,inTo)) return;
        const n=H.diff(H.parse(x.departure_at.slice(0,10)),H.parse(x.return_at.slice(0,10)));
        if(n<(minN||1)||n>(maxN||60)) return; out.push(this.norm(x,currency)); });
    }
    if(!to) for(const m2 of this.months(inFrom,inTo)){
      const rows=await this.everywhere({origin:from||'',return_at:m2,one_way:'false',direct:direct?'true':'false',sorting:'price',limit:1000,currency:(currency||'EUR').toLowerCase()},outFrom,outTo,signal);
      rows.forEach(x=>{ if(!x.return_at||!this.inRange(x.departure_at,outFrom,outTo)||!this.inRange(x.return_at,inFrom,inTo)) return;
        const n=H.diff(H.parse(x.departure_at.slice(0,10)),H.parse(x.return_at.slice(0,10)));
        if(n<(minN||1)||n>(maxN||60)) return; out.push(this.norm(x,currency)); });
    }
    return out;
  },
  async oneWays({from,to,outFrom,outTo,currency,direct,signal}){
    const out=[];
    for(const m of this.months(outFrom,outTo)){
      const rows=await this.get('/aviasales/v3/prices_for_dates',{origin:from||'',destination:to||'',departure_at:m,one_way:'true',
        direct:direct?'true':'false',sorting:'price',unique:'false',limit:1000,currency:(currency||'EUR').toLowerCase()},signal);
      (rows||[]).forEach(x=>{ if(this.inRange(x.departure_at,outFrom,outTo)) out.push(this.norm(x,currency)); });
    }
    if(!to) (await this.everywhere({origin:from||'',one_way:'true',direct:direct?'true':'false',sorting:'price',limit:1000,currency:(currency||'EUR').toLowerCase()},outFrom,outTo,signal))
      .forEach(x=>{ if(this.inRange(x.departure_at,outFrom,outTo)) out.push(this.norm(x,currency)); });
    return out;
  },
  /* Round trips glued from two one-way tickets (the one-way data is much richer than the round-trip data, and
     mixing airlines is often cheapest). outs: one-way deals from home; backs: {dest:{day:{price,dep,airline,flight,stops}}}.
     Returns the cheapest pair per destination that fits the return window and the night limits. */
  combine(outs,backs,{inFrom,inTo,minN,maxN}){
    const best=new Map();
    outs.forEach(o=>{ const dep=String(o.outDep).slice(0,10), back=backs[o.dest]||{};
      Object.entries(back).forEach(([day,b])=>{ if(!b||!this.inRange(day,inFrom,inTo)) return;
        const n=H.diff(H.parse(dep),H.parse(day)); if(n<(minN||1)||n>(maxN||60)) return;
        const pp=o.pp+b.price, cur=best.get(o.dest); if(cur&&cur.pp<=pp) return;
        best.set(o.dest,{...o,pp,inDep:b.dep||day,inFlight:b.flight||null,inAirline:b.airline||null,rstops:b.stops||0,mixed:true,link:null}); }); });
    return [...best.values()];
  },
  async mixedRoundTrips({from,to,outFrom,outTo,inFrom,inTo,minN,maxN,currency,direct,signal}){
    if(!from) return [];
    const outs=await this.oneWays({from,to,outFrom,outTo,currency,direct,signal});
    const cheapest=new Map(); outs.forEach(o=>{ const c=cheapest.get(o.dest); if(c==null||o.pp<c) cheapest.set(o.dest,o.pp); });
    const dests=[...cheapest.keys()].sort((a,b)=>cheapest.get(a)-cheapest.get(b)).slice(0,40);   // cheapest 40 places only
    const backs={}, months=this.months(inFrom,inTo);
    await pool(dests,6,async d=>{ backs[d]=await this.perDay(d,from,months,currency,direct,signal); },signal);
    return this.combine(outs.filter(o=>backs[o.dest]),backs,{inFrom,inTo,minN,maxN});
  },
  /* cheapest one-way per day for a route: {YYYY-MM-DD:{price,cur,dep,airline,flight,stops,link}} */
  async perDay(from,to,months,currency,direct,signal){
    const res={};
    await Promise.all(months.map(async m=>{ try{
      const data=await this.get('/aviasales/v3/grouped_prices',{origin:from,destination:to,departure_at:m.slice(0,7),group_by:'departure_at',
        one_way:'true',direct:direct?'true':'false',currency:(currency||'EUR').toLowerCase()},signal);
      Object.entries(data||{}).forEach(([day,x])=>{ res[day]={price:x.price,cur:(currency||'EUR').toUpperCase(),dep:x.departure_at,arr:null,
        airline:x.airline,flight:x.airline+(x.flight_number||''),stops:x.transfers||0,link:x.link?'https://www.aviasales.com'+x.link:null,src:'tp'}; });
    }catch(e){} }));
    NET.check(signal);
    return res;
  },
};

/* cheapest fare per day from every source we have: Ryanair (live) + all airlines (Travelpayouts, cached) */
const FARES = {
  async perDay(from,to,months,currency,direct,signal){
    const [ry,tp]=await Promise.all([
      RYANAIR.perDay(from,to,months,currency,signal).then(r=>{ Object.values(r).forEach(v=>{ v.airline='FR'; v.stops=0; v.src='ryanair'; }); return r; }),
      TP.available().then(ok=>ok?TP.perDay(from,to,months,currency,direct,signal):{}) ]);
    const out={...tp};
    Object.entries(ry).forEach(([d,v])=>{ if(!out[d]||v.price<=out[d].price) out[d]=v; });   // live Ryanair wins ties
    if(ry[NET.FAILED]&&!Object.keys(out).length) out[NET.FAILED]=true;   // nothing at all, and Ryanair did not answer
    return out;
  },
};
