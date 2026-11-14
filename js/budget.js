/* ============ Heybe — trip budget: flight + stay as one total ============ */
const BUDGET = {
  /* rough cheapest double room or private hostel room per night, EUR (Nov 2026). Only a fallback,
     always shown as "estimate"; a live price replaces it when the local server finds one. */
  NIGHT:{ ES:60, PT:55, IT:70, FR:75, GB:90, IE:95, NL:95, BE:75, LU:100, DE:70, AT:75, CH:120, CZ:50, SK:45, HU:45, PL:40,
    SI:60, HR:60, RS:40, BA:35, ME:45, AL:35, MK:30, XK:35, GR:55, BG:35, RO:40, MD:35, UA:30, TR:40, CY:60, MT:65,
    DK:100, SE:85, NO:100, FI:85, IS:130, EE:50, LV:45, LT:45, MA:35, TN:35, EG:30, JO:55, IL:110, GE:30, AM:35, AZ:40, AE:80 },
  DEFAULT:60,
  estimate(cc,cur){ return cur==='EUR' ? (this.NIGHT[cc]||this.DEFAULT) : null; },   // no exchange rates: no made-up price
  rooms(t){ return Math.max(t.rooms||1, Math.ceil((t.adults||1)/2)); },
  nights(d,t){ if(d.nights) return d.nights;
    const plan=Math.round((Date.parse(t.end)-Date.parse(t.start))/864e5);
    return Math.max(1, t.minNights||plan||1); },
  /* d: a deal with .total (flight, every traveller) · stay: {night} or null · t: the trip */
  total(d,stay,t){ const nights=this.nights(d,t);
    const s=stay&&stay.night ? Math.round(stay.night*nights*this.rooms(t)) : null;
    return { stay:s, total:Math.round(d.total+(s||0)), nights }; },
  /* average of the 3 cheapest priced places: one dorm-bed price alone would make the stay look too cheap */
  cheapNight(props){ const n=(props||[]).map(p=>p.night).filter(x=>x>0).sort((a,b)=>a-b).slice(0,3);
    return n.length?Math.round(n.reduce((a,b)=>a+b,0)/n.length):null; },
};
