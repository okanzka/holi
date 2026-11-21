/* ============ Heybe — weather on the destination cards ============
   Free, no key, straight from the browser (Open-Meteo). For a trip that starts within 16 days: the real forecast
   for the stay days. Later: "typical" weather = the same dates in the last 3 years, averaged (measured, not a forecast).
   Few calls for every deal on screen (many places per call); kept in memory for this visit. */
const WX = {
  FC:'https://api.open-meteo.com/v1/forecast', ARCHIVE:'https://archive-api.open-meteo.com/v1/archive',
  YEARS:3,                                    // typical = average of this many past years
  HORIZON:15,                                 // forecast covers today + 15 days
  CHUNK:40,                                   // places per call
  cache:new Map(),                            // 'f|BJV|2026-11-25' -> {t, c} (forecast) or 'c|…' -> {t, p, cl} (typical, averaged)
  tried:new Set(),                            // same keys: asked once, so a gap or a failed call is not asked again

  /* the stay days that count: dep up to the day before ret, at least 3 and at most 7 */
  stayDays(dep,ret){
    const a=H.parse(dep), n=ret?Math.round((H.parse(ret)-a)/864e5):0, k=Math.min(7,Math.max(3,n));
    return Array.from({length:k},(_,i)=>H.fmt(H.add(a,i)));
  },
  /* forecast ('f') when the trip starts inside the horizon (later days dropped), else typical ('c'); null if past */
  plan(dep,ret,today=H.fmt(new Date())){
    if(!dep||dep<today) return null;
    const last=H.fmt(H.add(H.parse(today),this.HORIZON)), days=this.stayDays(dep,ret);
    return dep<=last?{mode:'f',days:days.filter(d=>d<=last)}:{mode:'c',days};
  },
  icon(x){
    if(x.c!=null){ const c=x.c;
      return c<=1?'☀️':c===2?'⛅':c===3?'☁️':c<=48?'🌫️':c<=67||(c>=80&&c<=82)?'🌧️':c<=77||c===85||c===86?'🌨️':'⛈️'; }
    return x.p>=5?'🌧️':x.p>=1?'🌦️':x.cl>=70?'☁️':x.cl>=30?'⛅':'☀️';
  },
  /* {t: average high, i: most common icon, typ} once every counted day is loaded, else null */
  summary(code,dep,ret,today){
    const pl=this.plan(dep,ret,today); if(!pl||!pl.days.length) return null;
    const rows=pl.days.map(d=>this.cache.get(pl.mode+'|'+code+'|'+d));
    if(rows.some(r=>!r||r.t==null)) return null;
    const n={}; rows.forEach(r=>{ const i=this.icon(r); n[i]=(n[i]||0)+1; });
    return {t:Math.round(rows.reduce((s,r)=>s+r.t,0)/rows.length),i:Object.keys(n).sort((a,b)=>n[b]-n[a])[0],typ:pl.mode==='c'};
  },
  inner(s){ return `${s.i} ${s.typ?'~':''}${s.t}°C${s.typ?' <small>typical</small>':''}`; },
  title(s){ return s.typ?'Typical weather: these dates in the last 3 years, averaged (not a forecast) · Open-Meteo':'Forecast: average high over your stay · Open-Meteo'; },
  /* the badge for a deal: filled when loaded, else an empty slot that fill() completes; nothing without coordinates */
  badge(d,today){
    const a=AP.byCode(d.dest); if(!a||a.lat==null||!this.plan(d.dep,d.ret,today)) return '';
    const s=this.summary(d.dest,d.dep,d.ret,today), key=H.esc(`${d.dest}|${d.dep}|${d.ret||''}`);
    return s?`<span class="wx" data-wx="${key}" title="${H.esc(this.title(s))}">${this.inner(s)}</span>`:`<span class="wx" data-wx="${key}"></span>`;
  },
  /* fetch what the deals need: one forecast call and YEARS archive calls (per CHUNK places), quiet on failure */
  async load(deals,today=H.fmt(new Date())){
    const need={f:new Map(),c:new Map()};                 // mode -> code -> [days]
    (deals||[]).forEach(d=>{ const a=AP.byCode(d.dest), pl=a&&a.lat!=null&&this.plan(d.dep,d.ret,today); if(!pl) return;
      const m=need[pl.mode], days=pl.days.filter(x=>!this.tried.has(pl.mode+'|'+d.dest+'|'+x)); if(!days.length) return;
      m.set(d.dest,[...(m.get(d.dest)||[]),...days]); });
    const jobs=[];
    for(const mode of ['f','c']){ const codes=[...need[mode].keys()];
      for(let i=0;i<codes.length;i+=this.CHUNK) jobs.push(this.fetchSet(mode,codes.slice(i,i+this.CHUNK),need[mode],today)); }
    await Promise.all(jobs);
  },
  async fetchSet(mode,codes,need,today=H.fmt(new Date())){
    const all=codes.flatMap(c=>need.get(c)).sort(), from=all[0], to=all[all.length-1];
    codes.forEach(c=>need.get(c).forEach(d=>this.tried.add(mode+'|'+c+'|'+d)));
    const aps=codes.map(c=>AP.byCode(c)), at={latitude:aps.map(a=>a.lat).join(','),longitude:aps.map(a=>a.lon).join(',')};
    const get=async(url,q)=>{ try{ const r=await NET.json(url+'?'+new URLSearchParams({...at,...q}),{},20000);
      return r.ok&&r.data?(Array.isArray(r.data)?r.data:[r.data]):null; }catch(e){ return null; } };
    if(mode==='f'){
      const list=await get(this.FC,{start_date:from,end_date:to,daily:'temperature_2m_max,weather_code',timezone:'auto'}); if(!list) return;
      list.forEach((x,i)=>{ const dl=x&&x.daily, code=codes[i]; if(!dl||!code) return;
        (dl.time||[]).forEach((d,j)=>{ const t=dl.temperature_2m_max&&dl.temperature_2m_max[j]; if(t!=null) this.cache.set('f|'+code+'|'+d,{t,c:(dl.weather_code||[])[j]}); }); });
      return;
    }
    /* typical: the same window 1..YEARS years before the latest past year, day j of each year -> trip day j */
    const back=H.parse(from).getFullYear()-H.parse(today).getFullYear()+1;
    const shift=(d,k)=>{ const x=H.parse(d); x.setFullYear(x.getFullYear()-k); return H.fmt(x); };
    const years=await Promise.all(Array.from({length:this.YEARS},(_,i)=>get(this.ARCHIVE,{start_date:shift(from,back+i),end_date:shift(to,back+i),daily:'temperature_2m_max,precipitation_sum,cloud_cover_mean'})));
    const sum=new Map();                                  // key -> {t, p, cl, n}
    years.forEach(list=>(list||[]).forEach((x,i)=>{ const dl=x&&x.daily, code=codes[i]; if(!dl||!code) return;
      (dl.time||[]).forEach((_,j)=>{ const t=dl.temperature_2m_max&&dl.temperature_2m_max[j]; if(t==null) return;
        const k='c|'+code+'|'+H.fmt(H.add(H.parse(from),j)), o=sum.get(k)||{t:0,p:0,cl:0,n:0};
        o.t+=t; o.p+=(dl.precipitation_sum||[])[j]||0; o.cl+=(dl.cloud_cover_mean||[])[j]||0; o.n++; sum.set(k,o); }); }));
    sum.forEach((o,k)=>this.cache.set(k,{t:o.t/o.n,p:o.p/o.n,cl:o.cl/o.n}));
  },
  /* load for the deals, then complete the empty badges under root */
  async fill(root,deals){
    await this.load(deals);
    if(!root) return;
    root.querySelectorAll('[data-wx]:empty').forEach(el=>{ const [c,dep,ret]=el.dataset.wx.split('|'), s=this.summary(c,dep,ret||null);
      if(s){ el.innerHTML=this.inner(s); el.title=this.title(s); } });
  },
};
