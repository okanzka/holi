/* ============ Heybe — things to do ============
   Top 10 sights for every city of the trip. Free, no key, straight from the browser:
   Wikipedia finds the articles around the city centre (five points, so big cities are covered too),
   Wikidata keeps the ones that are sights (museums, castles, churches, parks…) and ranks them by how many
   Wikipedia languages write about them, a good stand-in for "most famous". Kept for a week on this device. */
const THINGS = {
  KEY:'thingsCities', TTL:7*864e5, N:10,
  WP:'https://en.wikipedia.org/w/api.php', SPARQL:'https://query.wikidata.org/sparql',
  /* sight types (an item counts when it, or the class it belongs to, is one of these) */
  TYPES:'Q570116 Q33506 Q207694 Q4989906 Q16970 Q2977 Q23413 Q16560 Q22698 Q174782 Q12280 Q44539 Q32815 Q839954 Q12518 Q57821 Q1107656 Q483453 Q167346 Q43501 Q2281788 Q1081138 Q15243209 Q24354 Q153562 Q40080 Q34038 Q9259 Q1785071 Q160742 Q108325 Q56242215 Q1060829 Q15206070 Q2319498 Q46169 Q11303 Q194195 Q44613 Q120560 Q1370598 Q860861 Q2087181 Q17715832 Q1440300 Q811979 Q1076486 Q47521 Q1144661'.split(' '),
  /* never a sight on its own: cities and towns (incl. ancient ones like Byzantium), streets, capitals */
  NOT:'Q486972 Q15661340 Q148837 Q515 Q79007 Q1549591 Q5119'.split(' '),
  OFFSETS:[[0,0],[.03,0],[-.03,0],[0,.045],[0,-.045]],   // ~3 km around the centre in each direction

  /* the trip's cities: destination, then every stay of the stay plan, then cities added here (no repeats) */
  cities(){
    const t=H.trip(), P=typeof STAYS!=='undefined'?STAYS.plan():null, out=[], seen=new Set();
    const add=(city,cc)=>{ city=String(city||'').trim(); const k=city.toLowerCase(); if(city&&!seen.has(k)){ seen.add(k); out.push({city,cc:cc||''}); } };
    const a=t.to&&t.to!=='ANY'?AP.byCode(t.to):null;
    add(t.city||(a?H.cityOf(t.to):''),a&&a.cc);                      // with "Anywhere", city = the destination picked from the deals
    ((P&&P.cities)||[]).forEach(c=>add(c.city,c.cc));
    H.load(this.KEY,[]).forEach(c=>add(c));
    return out;
  },
  addCity(city){ const l=H.load(this.KEY,[]); if(!l.some(c=>c.toLowerCase()===city.toLowerCase())) H.save(this.KEY,[...l,city]); },
  removeCity(city){ H.save(this.KEY,H.load(this.KEY,[]).filter(c=>c.toLowerCase()!==city.toLowerCase())); },

  query(ids){
    const v=a=>a.map(x=>'wd:'+x).join(' ');
    return `SELECT DISTINCT ?item ?links WHERE { VALUES ?item { ${v(ids)} } VALUES ?type { ${v(this.TYPES)} }
      ?item wdt:P31/wdt:P279? ?type; wikibase:sitelinks ?links.
      MINUS { ?item wdt:P31/wdt:P279? ?bad. VALUES ?bad { ${v(this.NOT)} } } } ORDER BY DESC(?links) LIMIT ${this.N*2}`;
  },
  /* SPARQL rows -> [{id, links}], most famous first, no repeats, top N */
  rank(rows,n=this.N){
    const best=new Map();
    (rows||[]).forEach(b=>{ const id=String(b.item&&b.item.value||'').split('/').pop(), l=+(b.links&&b.links.value)||0;
      if(/^Q\d+$/.test(id)&&(!best.has(id)||best.get(id)<l)) best.set(id,l); });
    return [...best].map(([id,links])=>({id,links})).sort((a,b)=>b.links-a.links).slice(0,n);
  },
  wp(p,signal){ return NET.json(this.WP+'?'+new URLSearchParams({format:'json',formatversion:'2',origin:'*',...p}),{signal},15000).then(r=>{ if(!r.ok||!r.data) throw new Error('Wikipedia is not answering'); return r.data; }); },

  /* -> [{title, desc, img, url, map, links}] (empty when the city has no sights we know of) */
  async top(city,signal){
    const ck='things.'+city.toLowerCase(), hit=H.load(ck,null);
    if(hit&&Date.now()-hit.t<this.TTL) return hit.list;
    const r=await this.wp({action:'query',titles:city,redirects:'1',prop:'coordinates'},signal);
    const c=r.query&&r.query.pages&&r.query.pages[0]&&(r.query.pages[0].coordinates||[])[0];
    if(!c) return [];
    const pages=(await Promise.all(this.OFFSETS.map(([a,b])=>this.wp({action:'query',generator:'geosearch',ggscoord:`${c.lat+a}|${c.lon+b}`,
      ggsradius:'10000',ggslimit:'500',prop:'pageprops',ppprop:'wikibase_item'},signal).then(x=>(x.query&&x.query.pages)||[])))).flat();
    const title=new Map(); pages.forEach(p=>{ const q=p.pageprops&&p.pageprops.wikibase_item; if(q&&!title.has(q)) title.set(q,p.title); });
    if(!title.size) return [];
    const s=await NET.json(this.SPARQL,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({query:this.query([...title.keys()]),format:'json'}),signal},30000);
    if(!s.ok||!s.data) throw new Error('Wikidata is busy, try again in a minute');
    const top=this.rank(s.data.results&&s.data.results.bindings);
    if(!top.length) return [];
    const d=await this.wp({action:'query',titles:top.map(x=>title.get(x.id)).join('|'),prop:'pageimages|description|coordinates',
      piprop:'thumbnail',pithumbsize:'480',pilimit:'50'},signal);
    const info=new Map(((d.query&&d.query.pages)||[]).map(p=>[p.title,p]));
    const list=top.map(x=>{ const t=title.get(x.id), p=info.get(t)||{}, g=(p.coordinates||[])[0];
      return {title:t,desc:p.description||'',img:(p.thumbnail&&p.thumbnail.source)||null,links:x.links,
        url:'https://en.wikipedia.org/wiki/'+encodeURIComponent(t.replace(/ /g,'_')),
        map:'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(g?`${g.lat},${g.lon}`:`${t}, ${city}`)}; });
    H.save(ck,{t:Date.now(),list});
    return list;
  },
};

/* ---------- page ---------- */
document.addEventListener('DOMContentLoaded',()=>{
  const root=document.getElementById('things'); if(!root) return;
  const $=s=>document.querySelector(s), chips=$('#cityChips');
  const voyage=c=>'https://en.wikivoyage.org/wiki/'+encodeURIComponent(c.replace(/ /g,'_'));
  const card=(x,i)=>`<a class="st-card th-card" href="${H.esc(x.url)}" target="_blank" rel="noopener">
      <div class="st-img"${x.img?` style="background-image:url('${H.esc(x.img)}'),linear-gradient(135deg,var(--lagoon),var(--sun-l))"`:''}><span class="st-type">#${i+1}</span></div>
      <div class="st-body"><b class="st-name">${H.esc(x.title)}</b>${x.desc?`<div class="s">${H.esc(x.desc)}</div>`:''}
        <div class="row th-links"><span>Wikipedia ↗</span><span class="th-map" data-map="${H.esc(x.map)}">📍 Map</span></div></div></a>`;
  async function fill(sec,c){
    const grid=sec.querySelector('.st-grid');
    grid.innerHTML=`<div class="loading" style="grid-column:1/-1">Finding the top sights in ${H.esc(c.city)}…</div>`;
    try{
      const list=await THINGS.top(c.city);
      grid.innerHTML=list.length?list.map(card).join('')
        :`<div class="empty" style="grid-column:1/-1">No well-known sights found for ${H.esc(c.city)}. <a href="${voyage(c.city)}" target="_blank" rel="noopener">See it on Wikivoyage ↗</a></div>`;
    }catch(e){ grid.innerHTML=`<div class="empty" style="grid-column:1/-1">${H.esc(e.message)}. <a href="#" data-retry>Try again</a> · <a href="${voyage(c.city)}" target="_blank" rel="noopener">Wikivoyage ↗</a></div>`;
      grid.querySelector('[data-retry]').onclick=ev=>{ ev.preventDefault(); fill(sec,c); }; }
  }
  function render(){
    const list=THINGS.cities(), own=new Set(H.load(THINGS.KEY,[]).map(c=>c.toLowerCase()));
    chips.innerHTML=list.map(c=>`<span class="chip on">${H.flag(c.cc)} ${H.esc(c.city)}${own.has(c.city.toLowerCase())?` <button type="button" class="th-x" data-del="${H.esc(c.city)}" aria-label="Remove ${H.esc(c.city)}">✕</button>`:''}</span>`).join('');
    root.innerHTML=list.length?'':`<section class="card"><div class="empty">No cities yet. Plan a trip on <a href="index.html">Flights</a>, or add a city above.</div></section>`;
    list.forEach(c=>{ const sec=document.createElement('section'); sec.className='card';
      sec.innerHTML=`<div class="row"><h2 style="margin:0">${H.flag(c.cc)} Top 10 in ${H.esc(c.city)}</h2><span class="spacer"></span><a class="btn ghost sm" href="${voyage(c.city)}" target="_blank" rel="noopener">Travel guide ↗</a></div>
        <p class="sub" style="margin-top:6px">Most famous first.</p><div class="st-grid"></div>`;
      root.appendChild(sec); fill(sec,c); });
  }
  chips.onclick=e=>{ const b=e.target.closest('[data-del]'); if(b){ THINGS.removeCity(b.dataset.del); render(); } };
  root.onclick=e=>{ const m=e.target.closest('[data-map]'); if(m){ e.preventDefault(); window.open(m.dataset.map,'_blank','noopener'); } };
  $('#addCity').onsubmit=e=>{ e.preventDefault(); const v=e.target.city.value.trim(); if(!v) return; THINGS.addCity(v); e.target.reset(); render(); };
  render();
});
