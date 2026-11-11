/* ============ Heybe — hotels page ============ */
(function(){
const $=s=>document.querySelector(s);
let S, selected=null;

function initState(){
  const T=H.trip(), sig=[T.city,T.start,T.end,T.chosen&&T.chosen.ci,T.chosen&&T.chosen.co].join('|');
  const saved=H.load('hotel',null);
  if(saved && saved.sig===sig) return saved;
  const s={sig, city:T.city, ci:T.chosen?T.chosen.ci:T.start, co:T.chosen?T.chosen.co:T.end,
    flex:T.chosen?0:Math.min(T.flex,2), adults:T.adults, children:T.children, rooms:T.rooms||1, budget:'', stars:[]};
  H.save('hotel',s); return s;
}
const save=()=>H.save('hotel',S);
const opts=(ci,co)=>({city:S.city,ci,co,adults:S.adults,children:S.children,rooms:S.rooms,stars:S.stars.join(',')});
const weekendNights=(ci,n)=>{ let w=0; for(let i=0;i<n;i++){ const d=H.add(ci,i).getDay(); if(d===5||d===6) w++; } return w; };
function tier(s){ return s<=45?'great':s<=52?'good':s<=60?'fair':'pricey'; }

function combos(){
  const a=H.parse(S.ci), b=H.parse(S.co), want=H.diff(a,b), out=[];
  const today=new Date(); today.setHours(0,0,0,0);
  for(let d=-S.flex; d<=S.flex; d++) for(let r=-S.flex; r<=S.flex; r++){
    const ci=H.add(a,d), co=H.add(b,r), n=H.diff(ci,co);
    if(ci<today||n<1) continue;
    const w=weekendNights(ci,n);
    out.push({ci,co,cis:H.fmt(ci),cos:H.fmt(co),n,w,d,r,score:40+25*(w/n)+2*(Math.abs(d)+Math.abs(r))+1.5*Math.abs(n-want)});
  }
  return out;
}

function render(){
  $('#title').innerHTML=`Stays in <em>${H.esc(S.city||'…')}</em>`;
  $('#sub').textContent=`${H.nice(H.parse(S.ci))} – ${H.nice(H.parse(S.co))} · ${S.adults} adult${S.adults>1?'s':''}${S.children?' + '+S.children+' child':''} · ${S.rooms} room${S.rooms>1?'s':''}`;
  const T=H.trip();
  if(T.chosen){ $('#sync').style.display=''; $('#sync').innerHTML=`🔗 Synced with your chosen flight: <b>${H.nice(H.parse(T.chosen.ci))} → ${H.nice(H.parse(T.chosen.co))}</b>. <a href="flights.html">Change flight</a>`; }
  const C=combos(); renderMatrix(C); renderShortlist();
  if(selected){ const c=C.find(c=>c.cis===selected.cis&&c.cos===selected.cos); c?showDetail(c):$('#detail').classList.remove('show'); }
}

function renderMatrix(C){
  const m=$('#matrix');
  if(!C.length){ m.innerHTML='<tr><td class="na">No valid dates. Check-in must be in the future and before check-out.</td></tr>'; return; }
  const cis=[...new Set(C.map(c=>c.cis))].sort(), cos=[...new Set(C.map(c=>c.cos))].sort(), map={};
  C.forEach(c=>map[c.cis+'|'+c.cos]=c);
  const best=Math.min(...C.map(c=>c.score));
  m.innerHTML=`<tr><th class="corner">Check-in ↓ / out →</th>${cos.map(o=>`<th class="${o===S.co?'want':''}">${H.nice(H.parse(o))}</th>`).join('')}</tr>`+
    cis.map(i=>`<tr><th class="${i===S.ci?'want':''}" style="text-align:right">${H.nice(H.parse(i))}</th>${cos.map(o=>{
      const c=map[i+'|'+o]; if(!c) return '<td class="na">·</td>';
      const sel=selected&&selected.cis===c.cis&&selected.cos===c.cos?' sel':'';
      return `<td class="c-${tier(c.score)}${c.d===0&&c.r===0?' target':''}${sel}" data-k="${i}|${o}">${c.n} night${c.n>1?'s':''}<small>${c.w?c.w+' wknd':'no wknd'}${c.score===best?' · 👍':''}</small></td>`;
    }).join('')}</tr>`).join('');
  m.querySelectorAll('td[data-k]').forEach(td=>td.onclick=()=>{
    const [i,o]=td.dataset.k.split('|'); selected={cis:i,cos:o}; render(); $('#detail').scrollIntoView({behavior:'smooth'});
  });
}

function showDetail(c){
  const o=opts(c.cis,c.cos);
  $('#dTitle').textContent=`🏨 ${H.nice(c.ci)} → ${H.nice(c.co)}`;
  $('#dSub').textContent=`${S.city} · ${c.n} night${c.n>1?'s':''} (${c.w} weekend) · ${S.adults} adults${S.children?', '+S.children+' children':''} · ${S.rooms} room${S.rooms>1?'s':''}${S.stars.length?' · '+S.stars.join('/')+'★ on Booking':''}`;
  $('#dSites').innerHTML=siteButtons(HOTEL_SITES,o);
  const hf=$('#hf'); hf.site.innerHTML=HOTEL_SITES.map(s=>`<option>${s.name}</option>`).join('')+'<option>Hotel website</option><option>Other</option>';
  $('#openAll').onclick=()=>openAll(HOTEL_SITES,o);
  hf.onsubmit=e=>{ e.preventDefault();
    const L=H.load('shortlist',[]);
    L.push({id:Date.now(),city:S.city,name:hf.name.value.trim(),site:hf.site.value,price:+hf.price.value,rating:hf.rating.value?+hf.rating.value:null,
      area:hf.area.value.trim(),link:hf.link.value.trim(),ci:c.cis,co:c.cos,nights:c.n,cur:H.trip().currency});
    H.save('shortlist',L); hf.reset(); H.toast('Added to shortlist 💖'); renderShortlist();
  };
  $('#detail').classList.add('show');
}

function renderShortlist(){
  const by=$('#sortBy').value;
  const L=H.load('shortlist',[]).filter(h=>h.city.toLowerCase()===String(S.city).toLowerCase());
  L.forEach(h=>{ h.pn=h.price/h.nights; h.val=h.rating?h.rating/h.pn:0; });
  L.sort(by==='price'?(a,b)=>a.pn-b.pn:by==='rating'?(a,b)=>(b.rating||0)-(a.rating||0):(a,b)=>b.val-a.val);
  $('#slSub').textContent=L.length?`${L.length} place${L.length>1?'s':''} in ${S.city}.${S.budget?` Budget: ${H.money(+S.budget)} / night.`:''}`:'';
  if(!L.length){ $('#shortlist').innerHTML=`<div class="empty">Nothing saved for ${H.esc(S.city)} yet. Pick dates above, browse the sites, and save your favourites. 🌺</div>`; return; }
  $('#shortlist').innerHTML=L.map((h,i)=>{
    const over=S.budget&&h.pn>+S.budget;
    const safeLink=/^https?:\/\//i.test(h.link)?h.link:'';
    return `<div class="item${i===0?' best':''}"><div>
      <div class="t">${i===0?'🏆 ':''}${H.esc(h.name)}${h.rating?`<span class="stay-pill">⭐ ${h.rating}</span>`:''}${over?'<span class="stay-pill" style="background:var(--r-bg);color:var(--r-fg)">over budget</span>':''}</div>
      <div class="s">${H.esc(h.site)}${h.area?' · '+H.esc(h.area):''} · ${H.short(H.parse(h.ci))} → ${H.short(H.parse(h.co))} (${h.nights} nights)</div></div>
      <div class="row"><div><div class="amt">${H.money(h.pn,h.cur)}<span class="hint"> /night</span></div><div class="hint" style="text-align:right">${H.money(h.price,h.cur)} total</div></div>
      ${safeLink?`<a class="btn ghost sm" href="${H.esc(safeLink)}" target="_blank" rel="noopener">↗</a>`:''}
      <button class="x" data-del="${h.id}" title="Remove">✕</button></div></div>`;
  }).join('');
  $('#shortlist').querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>{
    H.save('shortlist',H.load('shortlist',[]).filter(h=>String(h.id)!==b.dataset.del)); renderShortlist(); });
}

document.addEventListener('DOMContentLoaded',()=>{
  S=initState(); const f=$('#f');
  f.city.value=S.city; f.ci.value=S.ci; f.co.value=S.co; f.adults.value=S.adults; f.children.value=S.children; f.rooms.value=S.rooms; f.budget.value=S.budget;
  const pills=[...document.querySelectorAll('#flexPills button')], stars=[...document.querySelectorAll('#stars button')];
  const paint=()=>{ pills.forEach(b=>b.classList.toggle('on',+b.dataset.v===S.flex)); stars.forEach(b=>b.classList.toggle('on',S.stars.includes(b.dataset.v))); };
  pills.forEach(b=>b.onclick=()=>{S.flex=+b.dataset.v;paint();save();render();});
  stars.forEach(b=>b.onclick=()=>{ const v=b.dataset.v; S.stars=S.stars.includes(v)?S.stars.filter(x=>x!==v):[...S.stars,v].sort(); paint(); save(); render(); });
  paint();
  f.ci.onchange=()=>{ if(f.co.value<=f.ci.value) f.co.value=H.fmt(H.add(H.parse(f.ci.value),3)); };
  f.onsubmit=e=>{ e.preventDefault();
    if(f.co.value<=f.ci.value){ H.toast('Check-out must be after check-in'); return; }
    Object.assign(S,{city:f.city.value.trim(),ci:f.ci.value,co:f.co.value,adults:+f.adults.value||1,children:+f.children.value||0,rooms:+f.rooms.value||1,budget:f.budget.value});
    save(); selected=null; render(); };
  $('#sortBy').onchange=renderShortlist;
  render();
});
})();
