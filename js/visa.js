/* ============ Heybe — visa rules for Turkish passport holders ============
   Source: Wikipedia "Visa requirements for Turkish citizens" (revision reviewed 1 Nov 2026),
   cross-checked with news on Montenegro (visa required from 1 Nov 2026).
   Rules change often: always confirm with the destination's embassy before booking.

   Status codes:  free = no visa | id = no visa, Turkish ID card also accepted
                  voa = visa on arrival | evisa = apply online before travel
                  eta = online travel authorization | req = visa required (default for unlisted countries) */
const VISA_DATA = {
  // no visa needed: [status, max stay in days]
  AL:['free',90], AO:['free',30], AG:['free',180], AR:['free',90], BS:['free',240], BB:['free',180], BY:['free',30],
  BZ:['free',90], BO:['free',90], BA:['free',90], BW:['free',90], BR:['free',90], BN:['free',30], CL:['free',90],
  CO:['free',90], CR:['free',90], DM:['free',21], DO:['free',90], EC:['free',90], SV:['free',90], GQ:['free',90],
  SZ:['free',30], FJ:['free',120], GM:['free',90], GT:['free',90], HT:['free',90], HN:['free',90], ID:['free',30],
  IR:['free',90], JM:['free',90], JP:['free',90], JO:['free',90], KZ:['free',30], KG:['free',90], MY:['free',90],
  MU:['free',90], FM:['free',30], MN:['free',30], MA:['free',90], MK:['free',90], NI:['free',90], OM:['free',30],
  PA:['free',90], PY:['free',90], PE:['free',183], PH:['free',30], QA:['free',90], LC:['free',42], VC:['free',90],
  ST:['free',15], SG:['free',30], ZA:['free',30], SR:['free',90], SY:['free',90], TH:['free',60], TT:['free',90],
  TN:['free',90], UY:['free',90], UZ:['free',30], VU:['free',120], VE:['free',90], ZM:['free',90], XK:['free',90],
  MO:['free',30], PS:['free',null],
  // Turkish ID card is enough
  AZ:['id',90], GE:['id',360], MD:['id',90], RS:['id',90], UA:['id',90],
  // visa on arrival
  BD:['voa',30], KM:['voa',45], EG:['voa',30], GW:['voa',90], LB:['voa',30], LR:['voa',90], MV:['voa',30], MH:['voa',90],
  PW:['voa',30], WS:['voa',90], SN:['voa',30], SD:['voa',30], TL:['voa',30], TO:['voa',31], TV:['voa',30],
  // e-visa (several also offer a visa on arrival)
  AM:['evisa',120], BH:['evisa',14], BJ:['evisa',30], BT:['evisa',90], BF:['evisa',null], BI:['evisa',30], KH:['evisa',30],
  CM:['evisa',null], TD:['evisa',null], CD:['evisa',7], CI:['evisa',90], CU:['evisa',90], DJ:['evisa',90], ET:['evisa',90],
  GA:['evisa',90], GN:['evisa',90], GY:['evisa',null], IQ:['evisa',30], KW:['evisa',90], LA:['evisa',30], LY:['evisa',null],
  MG:['evisa',90], MW:['evisa',30], MR:['evisa',30], MZ:['evisa',30], MM:['evisa',28], NA:['evisa',90], NP:['evisa',90],
  NG:['evisa',30], PK:['evisa',90], PG:['evisa',60], RU:['evisa',30], RW:['evisa',30], SA:['evisa',90], SL:['evisa',30],
  SO:['evisa',30], SS:['evisa',null], TZ:['evisa',90], TG:['evisa',15], UG:['evisa',90], VN:['evisa',null], ZW:['evisa',30],
  TW:['evisa',null],
  // electronic travel authorization
  KE:['eta',90], KR:['eta',90], MX:['eta',180], KN:['eta',90], SC:['eta',90], LK:['eta',30],
};
/* airport-level exceptions (territories that share an ISO code with another state) */
const VISA_AIRPORT = { ECN:['id',null] };   // Northern Cyprus (Ercan): Turkish ID card is enough
/* visa-free for holders of a Schengen residence permit / valid Schengen visa:
   the Schengen area (Bulgaria and Romania included), the microstates reached through it,
   Cyprus (recognises Schengen documents) and Montenegro (accepts a valid Schengen visa or permit) */
const SCHENGEN_OK = new Set(['AT','BE','BG','HR','CZ','DK','EE','FI','FR','DE','GR','HU','IS','IT','LV','LI','LT','LU','MT','NL',
  'NO','PL','PT','RO','SK','SI','ES','SE','CH','AD','MC','SM','VA','CY','ME']);

const VISA = {
  /* filter categories, in the order shown in the multi-select */
  CATS:[
    {k:'free',  icon:'✅',label:'Visa-free',              hint:'incl. Turkish ID card countries'},
    {k:'schengen',icon:'✅',label:'Schengen (my Schengen visa)',hint:'Schengen area, Cyprus, Montenegro'},
    {k:'evisa', icon:'🟡',label:'e-Visa',                 hint:'apply online before you go'},
    {k:'voa',   icon:'🟡',label:'Visa on arrival',        hint:'get it at the airport'},
    {k:'eta',   icon:'🟡',label:'Online authorization (eTA)',hint:'e.g. South Korea, Kenya'},
    {k:'req',   icon:'⛔',label:'Visa required',          hint:'consulate visa needed'},
  ],
  LABEL:{free:'Visa-free',id:'Visa-free (ID card OK)',schengen:'OK with your Schengen visa',voa:'Visa on arrival',evisa:'e-Visa',eta:'Online authorization (eTA)',req:'Visa required'},
  ICON:{free:'✅',id:'✅',schengen:'✅',voa:'🟡',evisa:'🟡',eta:'🟡',req:'⛔'},
  ALL:['free','schengen','evisa','voa','eta','req'],
  /* code: airport IATA or ISO country code */
  info(code){
    const a=AP.byCode(code); const cc=a?a.cc:code;
    let [s,days]=VISA_AIRPORT[code]||VISA_DATA[cc]||['req',null];
    if(cc==='TR') s='free';                                  // own country
    if(s==='req'&&SCHENGEN_OK.has(cc)) s='schengen';           // reachable with a Schengen visa
    return {s,days,cc,cat:s==='id'?'free':s,label:VISA.LABEL[s]+(days&&!['req','schengen'].includes(s)?` · ${days} days`:''),icon:VISA.ICON[s]};
  },
  selected(){ const v=H.trip().visaSel; return Array.isArray(v)&&v.length?v:VISA.ALL; },
  /* does this place pass the user's visa filter? */
  pass(code){ const sel=VISA.selected(); return sel.length===VISA.ALL.length||sel.includes(VISA.info(code).cat); },
  badge(code){ const v=VISA.info(code); return `<span class="visa v-${v.s}" title="${H.esc(v.label)} (Turkish passport)">${v.icon} ${H.esc(VISA.LABEL[v.s])}</span>`; },
  summary(sel){ sel=sel||VISA.selected(); if(sel.length===VISA.ALL.length) return 'All countries';
    if(!sel.length) return 'Nothing selected';
    const names=VISA.CATS.filter(c=>sel.includes(c.k)).map(c=>c.label.replace(' (my Schengen visa)','').replace('Online authorization (eTA)','eTA'));
    return names.length>2?names.slice(0,2).join(', ')+` +${names.length-2}`:names.join(', '); },
};

/* multi-select dropdown: <div data-visa-ms></div> ; calls onChange(selectedArray) */
function visaMultiSelect(host,onChange){
  host.classList.add('ms');
  host.innerHTML=`<button type="button" class="ms-btn"><span class="ms-val"></span><span class="ms-car">▾</span></button>
    <div class="ms-pop"><div class="ms-quick"><button type="button" data-p="nov">No visa needed</button><button type="button" data-p="easy">+ easy visas</button><button type="button" data-p="all">All</button></div>
    ${VISA.CATS.map(c=>`<label class="ms-opt"><input type="checkbox" value="${c.k}"><span>${c.icon} <b>${c.label}</b><small>${c.hint}</small></span></label>`).join('')}</div>`;
  const btn=host.querySelector('.ms-btn'), boxes=[...host.querySelectorAll('input')];
  const paint=()=>{ const sel=VISA.selected(); boxes.forEach(b=>b.checked=sel.includes(b.value)); host.querySelector('.ms-val').textContent=VISA.summary(sel); };
  const commit=sel=>{ H.setTrip({visaSel:sel}); paint(); onChange&&onChange(sel); };
  btn.onclick=e=>{ e.stopPropagation(); host.classList.toggle('open'); };
  boxes.forEach(b=>b.onchange=()=>{ const sel=boxes.filter(x=>x.checked).map(x=>x.value); commit(sel.length?sel:VISA.ALL); });
  host.querySelectorAll('[data-p]').forEach(p=>p.onclick=()=>commit({nov:['free','schengen'],easy:['free','schengen','evisa','voa','eta'],all:VISA.ALL}[p.dataset.p]));
  document.addEventListener('click',e=>{ if(!host.contains(e.target)) host.classList.remove('open'); });
  paint();
}
