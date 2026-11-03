/* ============ Heybe — Claude travel assistant ============
   Calls the Claude API straight from the browser with the user's own key,
   using the official Anthropic JS SDK. Claude can call the tools below,
   which run here in the page (live Ryanair fares, airport lookup, links). */
(function(){
const $=s=>document.querySelector(s);
const SDK_URL='https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@1.3.0/+esm';
const MODEL='claude-opus-5-5';
const MAX_STEPS=12;                       // safety cap on tool round-trips per question

let client=null, history=[], busy=false;

/* ---------------- tools Claude can use ---------------- */
const TOOLS=[
  { name:'search_airports',
    description:'Look up airports or countries by name in any language (e.g. "Nürnberg", "ispanya", "London"). Returns IATA codes, and country codes like "C:ES" meaning every airport in that country. Use this to turn place names into codes before searching fares.',
    input_schema:{type:'object',properties:{query:{type:'string',description:'City, airport, country or code'}},required:['query']} },
  { name:'find_deals',
    description:'Live Ryanair fares (per person) from an origin to many destinations at once, inside flexible date windows. Returns the cheapest option per destination, sorted by price. Use for "where can I go", "cheapest places", "anywhere" or country-wide questions. Omit the return dates for one-way. Covers Ryanair only.',
    input_schema:{type:'object',properties:{
      from:{type:'string',description:'Origin IATA code (e.g. "NUE"), a country as "C:DE" for all its airports, or "ANY" for every city with a direct flight to `to` (then `to` must be an airport or country)'},
      to:{type:'string',description:'"ANY" for everywhere (default), a destination IATA code, or a country as "C:ES"'},
      depart_from:{type:'string',description:'Earliest departure date YYYY-MM-DD'},
      depart_to:{type:'string',description:'Latest departure date YYYY-MM-DD'},
      return_from:{type:'string',description:'Earliest return date YYYY-MM-DD (omit for one-way)'},
      return_to:{type:'string',description:'Latest return date YYYY-MM-DD'},
      min_nights:{type:'integer'}, max_nights:{type:'integer'},
      include_nearby:{type:'boolean',description:'Also search larger airports within 250 km of the origin'},
      max_results:{type:'integer',description:'Default 25'}},
      required:['from','depart_from','depart_to']} },
  { name:'route_calendar',
    description:'Cheapest one-way Ryanair price for every day of the given months on one route, in both directions. Use it to find the cheapest exact dates once a destination is chosen.',
    input_schema:{type:'object',properties:{
      from:{type:'string',description:'Origin IATA'}, to:{type:'string',description:'Destination IATA'},
      months:{type:'array',items:{type:'string'},description:'Months as YYYY-MM, e.g. ["2026-12"]'}},
      required:['from','to','months']} },
  { name:'find_multi_city',
    description:'Live Ryanair multi-city round trips that always end back home: HOME → city A (stay) → city B (stay) → HOME, or with last_stop set, HOME → ? [→ ?] → LAST_STOP (stay) → HOME. Every leg is a direct flight; the in-between cities are found automatically, or limited with must_visit. Use when the user wants to combine cities, hop between places, do a tour, or names the place they want to finish their trip in.',
    input_schema:{type:'object',properties:{
      home:{type:'string',description:'Start airport IATA code, e.g. "NUE".'},
      last_stop:{type:'string',description:'Optional fixed LAST city before flying home: airport code (e.g. "PMI") or country "C:ES". Then the route is HOME → ? [→ ?] → LAST_STOP → HOME and `stops` counts the cities found before it.'},
      stops:{type:'integer',description:'Cities found automatically: 1 or 2 (default 2)'},
      depart_from:{type:'string',description:'Earliest departure from home, YYYY-MM-DD'},
      depart_to:{type:'string',description:'Latest departure from home, YYYY-MM-DD'},
      home_by:{type:'string',description:'Latest date to be back home, YYYY-MM-DD'},
      min_nights:{type:'integer',description:'Minimum nights in each city (default 3)'},
      max_nights:{type:'integer',description:'Maximum nights in each city (default 5)'},
      must_visit:{type:'string',description:'Optional airport code or country code like "C:ES" that one of the two stops must be in'},
      max_results:{type:'integer',description:'Default 15'}},
      required:['home','depart_from','depart_to','home_by']} },
  { name:'get_my_trip',
    description:"The user's current plan saved in this site: origin, destination, preferred dates, flexibility, travellers, currency, plus fares and hotels they saved. Check it when the user says 'my trip', 'my dates' or asks for a recommendation without details.",
    input_schema:{type:'object',properties:{}} },
  { name:'make_links',
    description:'Ready-to-click booking/search links for specific flights. Call this for every option you recommend and include the links in your answer.',
    input_schema:{type:'object',properties:{options:{type:'array',items:{type:'object',properties:{
      from:{type:'string'}, to:{type:'string'}, depart:{type:'string',description:'YYYY-MM-DD'}, return:{type:'string',description:'YYYY-MM-DD, omit for one-way'}},
      required:['from','to','depart']}}},required:['options']} },
];
const SERVER_TOOLS=[{type:'web_search_20260209',name:'web_search',max_uses:5}];
let useWebSearch=true;

const toolLabel={search_airports:i=>`Looking up “${i.query}”`,
  find_deals:i=>`Checking live fares from ${i.from} to ${i.to||'anywhere'} (${i.depart_from}${i.return_from?' → '+i.return_from:''})`,
  find_multi_city:i=>`Building routes ${i.home} → ${i.stops===1?'?':'? → ?'}${i.last_stop?' → '+i.last_stop:''} → ${i.home} (${i.min_nights||3}–${i.max_nights||5} nights each)`,
  route_calendar:i=>`Reading daily prices ${i.from} ⇄ ${i.to}`, get_my_trip:()=>'Reading your saved trip',
  make_links:i=>`Preparing booking links`, web_search:i=>`Searching the web: “${(i&&i.query)||''}”`};

const today=()=>{ const d=new Date(); d.setHours(0,0,0,0); return d; };
const clampDate=s=>{ const d=H.parse(s); return (!d||isNaN(d))?H.fmt(today()):(d<today()?H.fmt(today()):s); };

async function runTool(name,input){
  const T=H.trip();
  if(name==='search_airports'){
    return AP.search(String(input.query||''),8).map(a=>a.isCountry?{code:a.code,country:a.country,airports:a.count}:{code:a.code,city:a.city,airport:a.name,country:a.country});
  }
  if(name==='get_my_trip'){
    const fares=Object.values(H.load('fares',{})).sort((a,b)=>a.price-b.price).slice(0,10);
    return {today:H.fmt(today()),trip:{from:T.from,to:T.to,from_name:H.cityOf(T.from),to_name:H.cityOf(T.to),preferred_departure:T.start,
      preferred_return:T.tripType==='rt'?T.end:null,flex_days:T.flex,
      passport:'Turkish',visa_filter_allowed_categories:VISA.selected().map(k=>VISA.CATS.find(c=>c.k===k).label),has_schengen_visa:true,adults:T.adults,children:T.children,currency:T.currency,min_nights:T.minNights||null},
      saved_fares:fares, saved_hotels:H.load('shortlist',[]).slice(0,10)};
  }
  if(name==='make_links'){
    return (input.options||[]).map(o=>{ const q={from:o.from,to:o.to,dep:o.depart,ret:o.return||null,adults:T.adults,children:T.children,cabin:T.cabin};
      return {...o,ryanair:RYANAIR.bookUrl(q),google_flights:FLIGHT_SITES[0].url(q),skyscanner:FLIGHT_SITES[1].url(q)}; });
  }
  if(name==='find_multi_city'){
    const r=await (input.last_stop?MULTI.viaLoop:MULTI.search)({from:String(input.home).toUpperCase(),last:input.last_stop?String(input.last_stop).toUpperCase():null,stops:input.stops===1?1:2,outFrom:clampDate(input.depart_from),outTo:clampDate(input.depart_to||input.depart_from),
      latest:clampDate(input.home_by),minN:input.min_nights||3,maxN:input.max_nights||5,currency:T.currency,must:input.must_visit?String(input.must_visit).toUpperCase():null});
    return {airline:'Ryanair (live), prices per person for all flights of the route',travellers:(T.adults||1)+(T.children||0),found:r.itineraries.length,
      routes:r.itineraries.slice(0,input.max_results||15).map(it=>({total_per_person:+it.total.toFixed(2),currency:it.cur,stops:it.stops,nights:it.nights,
        visa_per_stop:it.legs.slice(0,-1).map(l=>`${l.to}: ${VISA.info(l.to).label}`),
        legs:it.legs.map(l=>({from:l.from,to:l.to,depart:l.dep.replace('T',' ').slice(0,16),price:l.price,
          book:RYANAIR.bookUrl({from:l.from,to:l.to,dep:l.dep.slice(0,10),ret:null,adults:T.adults,children:T.children})}))})),
      ...(!r.itineraries.length?{note:'No combinations fit. Suggest more flexible dates, a later home_by, or fewer nights per city.'}:{})};
  }
  if(name==='route_calendar'){
    const months=(input.months||[]).slice(0,3).map(m=>m.slice(0,7)+'-01');
    const [out,back]=await Promise.all([RYANAIR.perDay(input.from,input.to,months,T.currency),RYANAIR.perDay(input.to,input.from,months,T.currency)]);
    const flat=o=>Object.fromEntries(Object.entries(o).sort().map(([d,v])=>[d,v.price]));
    const res={currency:(Object.values(out)[0]||Object.values(back)[0]||{}).cur||T.currency,outbound:flat(out),inbound:flat(back)};
    if(!Object.keys(res.outbound).length&&!Object.keys(res.inbound).length) res.note='Ryanair has no flights on this route in these months.';
    return res;
  }
  if(name==='find_deals'){
    const from=String(input.from||'').toUpperCase(), to=String(input.to||'ANY').toUpperCase();
    const fromCountry=H.isCountry(from), fromAny=from==='ANY';
    if(fromAny&&to==='ANY') throw new Error('from and to cannot both be ANY');
    const origins=fromAny?await RYANAIR.sourcesTo(to,clampDate(input.depart_from),clampDate(input.return_to||input.depart_to||input.depart_from),T.currency):fromCountry?AP.inCountry(from.slice(2),25).map(a=>a.code):[from,...(input.include_nearby?AP.near(from,250,5).map(a=>a.code):[])];
    const toAirport=(to!=='ANY'&&!H.isCountry(to))?to:null, toCC=H.isCountry(to)?to.slice(2):null;
    const rt=!!input.return_from;
    const p={outFrom:clampDate(input.depart_from),outTo:clampDate(input.depart_to||input.depart_from)};
    if(rt){ p.inFrom=clampDate(input.return_from); p.inTo=clampDate(input.return_to||input.return_from); }
    const queue=[...origins], got=[]; let failed=0;
    await Promise.all(Array.from({length:6},async()=>{ while(queue.length){ const o=queue.shift();
      try{ got.push(...await (rt?RYANAIR.roundTrips({from:o,to:toAirport,...p,minN:input.min_nights||1,maxN:input.max_nights||60,currency:T.currency})
                                :RYANAIR.oneWays({from:o,to:toAirport,outFrom:p.outFrom,outTo:p.outTo,currency:T.currency}))); }
      catch(e){ failed++; } } }));
    // all other airlines (cached Aviasales prices) when the local server is running
    if(await TP.available()){
      const qs=fromAny?(toAirport?[{from:null,to:toAirport}]:AP.inCountry(toCC,8).map(a=>({from:null,to:a.code}))):origins.slice(0,10).map(o=>({from:o,to:toAirport}));
      await pool(qs,4,async q=>{ got.push(...await (rt?TP.roundTrips({...q,...p,minN:input.min_nights||1,maxN:input.max_nights||60,currency:T.currency})
        :TP.oneWays({...q,outFrom:p.outFrom,outTo:p.outTo,currency:T.currency}))); });
    }
    const best=new Map();
    got.forEach(d=>{ const a=AP.byCode(d.dest); d.cc=a?a.cc:''; if(toCC&&d.cc!==toCC) return; if(!fromAny&&origins.includes(d.dest)) return;
      const k=(fromCountry||fromAny)?d.origin+'>'+d.dest:d.dest, c=best.get(k); if(!c||d.pp<c.pp) best.set(k,d); });
    const deals=[...best.values()].sort((a,b)=>a.pp-b.pp).slice(0,input.max_results||25).map(d=>({
      from:d.origin,to:d.dest,city:d.destCity,country:d.country,
      depart:d.outDep.replace('T',' ').slice(0,16),return:d.inDep?d.inDep.replace('T',' ').slice(0,16):null,
      nights:d.inDep?H.diff(H.parse(d.outDep.slice(0,10)),H.parse(d.inDep.slice(0,10))):null,price_per_person:d.pp,currency:d.cur,airline:AIRLINES[H.carrier(d.outFlight)]||H.carrier(d.outFlight),stops:Math.max(d.stops||0,d.rstops||0),
      price_type:d.src==='tp'?'recent Aviasales price (may change)':'live Ryanair price',book:d.src==='tp'?d.link:null,
      visa_turkish_passport:VISA.info(fromAny?d.origin:d.dest).label}));
    return {airline:'Ryanair (live) + other airlines (recent prices, when available)',origins_checked:origins,travellers:(T.adults||1)+(T.children||0),found:best.size,
      deals,...(failed===origins.length?{error:'Could not reach Ryanair'}:{}),...(!deals.length?{note:'No Ryanair flights match. Try other dates, include_nearby, or a different origin.'}:{})};
  }
  throw new Error('Unknown tool '+name);
}

/* ---------------- system prompt ---------------- */
function systemPrompt(){
  return `You are Heybe, a warm, practical travel-planning assistant inside the user's personal holiday-planner website.
Today is ${H.fmt(today())}. The user is usually based near ${H.cityOf(H.trip().from)} (${H.trip().from}); the site's saved trip is available through get_my_trip.

How to work:
- When asked for recommendations or prices, check real data with your tools first; never invent prices, dates or flight times. If the user gives no details, read get_my_trip and use its dates and flexibility.
- find_deals returns live Ryanair fares and, when the local server is running, all other airlines from recent Aviasales searches (marked price_type; they can change, so say so). route_calendar and find_multi_city are Ryanair only. Say so briefly, and point to Google Flights / Skyscanner links for other airlines (Lufthansa, Eurowings, Wizz Air, Pegasus, SunExpress, Turkish Airlines...).
- Multi-city ideas are welcome: when it fits (longer trips, "combine", "tour", "first X then Y", or simply to offer a more interesting option), use find_multi_city. The user must always end up back home, so every route starts and ends at their home airport. Present each route as a chain (e.g. NUE → Palma, 4 nights → Rabat, 5 nights → NUE) with the three flights and their own booking links (each leg is booked separately as a one-way).
- The user travels on a Turkish passport. Every result carries its visa status (from a list updated Nov 2026; e.g. Montenegro requires a visa since 1 Nov 2026). Respect the visa filter from get_my_trip: do not recommend places it excludes. The user holds a valid Schengen visa, so Schengen countries, Cyprus and Montenegro are reachable (status "OK with your Schengen visa"); remind them that Schengen visa days count toward the 90/180 rule and the visa must be valid for the whole trip. Mention the visa status of every place you recommend, and remind them to confirm entry rules with the embassy.
- Use web_search for context that makes a recommendation better (weather that time of year, events, entry rules), not for flight prices.
- Recommend 2–4 concrete options. For each: destination, exact dates and times, nights, price per person and the approximate total for the travellers, and one line on why it's a good pick. Call make_links for the options you recommend and include those links as markdown links.
- Prices exclude bags and seat selection; mention that once.
- Reply in the user's language (Turkish if they write Turkish). Keep it concise and skimmable: short headings or bullet points, no tables.`;
}

/* ---------------- Claude API loop ---------------- */
async function getClient(){
  if(client) return client;
  const key=H.load('apiKey','');
  if(!key) throw new Error('Add your Anthropic API key above first.');
  const mod=await import(SDK_URL);
  const Anthropic=mod.default||mod.Anthropic;
  client=new Anthropic({apiKey:key,dangerouslyAllowBrowser:true});   // personal page: the key is yours and stays in this browser
  return client;
}

async function ask(text){
  if(busy||!text.trim()) return;
  busy=true; $('#send').disabled=true;
  addMsg('user',text); history.push({role:'user',content:text});
  const steps=document.createElement('div'); steps.className='steps'; $('#chat').appendChild(steps); scroll();
  const thinking=addStep(steps,'Thinking…');
  try{
    const c=await getClient();
    for(let step=0; step<MAX_STEPS; step++){
      let res;
      try{
        res=await c.beta.messages.create({
          model:MODEL, max_tokens:16000,
          betas:['server-side-fallback-2026-07-01'], fallbacks:'default',
          output_config:{effort:'medium'},
          system:systemPrompt(),
          tools:useWebSearch?[...TOOLS,...SERVER_TOOLS]:TOOLS,
          messages:history,
        });
      }catch(e){
        // some accounts don't have web search enabled: retry once without it
        if(useWebSearch && /web_search/i.test(String(e&&e.message))){ useWebSearch=false; step--; continue; }
        throw e;
      }
      history.push({role:'assistant',content:res.content});   // keep every block (thinking, tool calls) unchanged
      // show server-side web searches
      res.content.filter(b=>b.type==='server_tool_use').forEach(b=>addStep(steps,toolLabel.web_search(b.input),'done'));
      if(res.stop_reason==='refusal'){ throw new Error('Claude declined to answer that request.'); }
      if(res.stop_reason==='pause_turn') continue;
      const calls=res.content.filter(b=>b.type==='tool_use');
      if(res.stop_reason!=='tool_use'||!calls.length){
        const txt=res.content.filter(b=>b.type==='text').map(b=>b.text).join('\n').trim();
        thinking.remove();
        addMsg('bot',txt||(res.stop_reason==='max_tokens'?'(The answer was cut off. Ask me to continue.)':'(no answer)'));
        return;
      }
      // run all requested tools in parallel, send all results back in one message
      const results=await Promise.all(calls.map(async b=>{
        const st=addStep(steps,(toolLabel[b.name]||(()=>b.name))(b.input||{}),'run');
        try{ const out=await runTool(b.name,b.input||{}); st.className='step done';
          return {type:'tool_result',tool_use_id:b.id,content:JSON.stringify(out)}; }
        catch(e){ st.className='step fail'; return {type:'tool_result',tool_use_id:b.id,content:'Error: '+e.message,is_error:true}; }
      }));
      history.push({role:'user',content:results});
    }
    thinking.remove(); addMsg('bot','I needed too many steps for that one. Could you narrow the question a little (dates, budget or region)?');
  }catch(e){
    thinking.remove();
    const m=String(e&&e.message||e);
    addMsg('err',/401|authentication|invalid x-api-key/i.test(m)?'Your API key was rejected. Check it in the box above.':m);
    // drop the unanswered turn so the conversation stays valid
    while(history.length&&!(history[history.length-1].role==='assistant'&&!history[history.length-1].content.some(b=>b.type==='tool_use'))) history.pop();
  }finally{ busy=false; $('#send').disabled=false; save(); }
}

/* ---------------- UI ---------------- */
function md(src){
  let s=H.esc(src);
  s=s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,(m,t,u)=>`<a href="${u}" target="_blank" rel="noopener">${t} ↗</a>`)
     .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g,(m,p,u)=>`${p}<a href="${u}" target="_blank" rel="noopener">link ↗</a>`)
     .replace(/\*\*([^*]+)\*\*/g,'<b>$1</b>').replace(/(^|\W)\*([^*\n]+)\*(?=\W|$)/g,'$1<i>$2</i>').replace(/`([^`]+)`/g,'<code>$1</code>');
  const out=[]; let list=null;
  s.split('\n').forEach(line=>{
    const h=line.match(/^#{1,4}\s+(.*)/), li=line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)/);
    if(li){ if(!list){ list=[]; } list.push(`<li>${li[1]}</li>`); return; }
    if(list){ out.push(`<ul>${list.join('')}</ul>`); list=null; }
    if(h) out.push(`<h4>${h[1]}</h4>`); else if(line.trim()) out.push(`<p>${line}</p>`);
  });
  if(list) out.push(`<ul>${list.join('')}</ul>`);
  return out.join('');
}
function addMsg(kind,text){ const d=document.createElement('div'); d.className='msg '+kind;
  if(kind==='bot') d.innerHTML=md(text); else d.textContent=text; $('#chat').appendChild(d); scroll(); return d; }
function addStep(box,label,state='run'){ const s=document.createElement('span'); s.className='step '+state; s.textContent=label; box.appendChild(s); scroll(); return s; }
function scroll(){ const c=$('#chat'); c.scrollTop=c.scrollHeight; }
function save(){ /* conversation lives in memory only; nothing sensitive stored besides the key */ }
function greet(){ addMsg('bot',`Merhaba! 👋 I'm your travel assistant. Tell me roughly **when**, **from where** and your **budget**, or just say *“Bana öneride bulun”* and I'll use your saved trip (${H.cityOf(H.trip().from)}, around ${H.nice(H.parse(H.trip().start))}) and check live fares.`); }

function keyState(){ const k=H.load('apiKey','');
  $('#keyState').innerHTML=k?`<span class="ok-key">✓ Key saved</span> (…${H.esc(k.slice(-4))}). You're ready to chat.`:'No key saved yet.'; }

document.addEventListener('DOMContentLoaded',()=>{
  keyState(); greet();
  $('#saveKey').onclick=()=>{ const v=$('#apiKey').value.trim(); if(!/^sk-ant-/.test(v)){ H.toast('That doesn’t look like an Anthropic key (sk-ant-…)'); return; }
    H.save('apiKey',v); client=null; $('#apiKey').value=''; keyState(); H.toast('Key saved 🔑'); };
  $('#forgetKey').onclick=()=>{ try{ localStorage.removeItem('heybe.apiKey'); }catch(e){} client=null; keyState(); H.toast('Key removed'); };
  $('#newChat').onclick=()=>{ if(busy) return; history=[]; $('#chat').innerHTML=''; greet(); };
  $('#composer').onsubmit=e=>{ e.preventDefault(); const t=$('#input').value; $('#input').value=''; ask(t); };
  $('#input').addEventListener('keydown',e=>{ if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); $('#composer').requestSubmit(); } });
  $('#chips').querySelectorAll('button').forEach(b=>b.onclick=()=>ask(b.textContent.replace(' ✨','')));
});
})();
