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

/* ---------------- tools Claude can use (js/assistant-tools.js) ---------------- */
const {TOOLS,run:runTool,label:toolLabel,today}=HEYBE_TOOLS;
const SERVER_TOOLS=[{type:'web_search_20260209',name:'web_search',max_uses:5}];
let useWebSearch=true;

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
