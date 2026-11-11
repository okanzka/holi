/* ============ Heybe — local server ============
   Serves the site at http://localhost:8080 and forwards a few read-only
   Travelpayouts (Aviasales Data API) price requests, adding your API token.
   The token never reaches the browser: it is read from the file
   "travelpayouts.key" next to this script (or the TRAVELPAYOUTS_TOKEN variable).

   Start:  node server.js      (or double-click start.bat)
   Needs:  Node.js 18+ (no packages to install)                                  */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = +process.env.PORT || 8080;
const ROOT = __dirname;
const KEY_FILE = path.join(ROOT, 'travelpayouts.key');

/* optional: SerpApi key (Google Hotels prices for the stay planner) in serpapi.key */
function serpKey(){
  if (process.env.SERPAPI_KEY) return process.env.SERPAPI_KEY.trim();
  try { return fs.readFileSync(path.join(ROOT, 'serpapi.key'), 'utf8').trim(); } catch (e) { return ''; }
}

function token(){
  if (process.env.TRAVELPAYOUTS_TOKEN) return process.env.TRAVELPAYOUTS_TOKEN.trim();
  try { return fs.readFileSync(KEY_FILE, 'utf8').trim(); } catch (e) { return ''; }
}

/* only these read-only price endpoints are forwarded */
const ALLOWED = ['/aviasales/v3/prices_for_dates', '/aviasales/v3/grouped_prices', '/aviasales/v3/get_latest_prices'];
const cache = new Map();            // url -> {t, status, body}
const CACHE_MS = 10 * 60 * 1000;

const TYPES = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8',
  '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.svg':'image/svg+xml', '.ico':'image/x-icon' };

function send(res, status, body, type){ res.writeHead(status, { 'Content-Type': type || 'application/json', 'Cache-Control': 'no-store' }); res.end(body); }

/* the request handlers return {status, body} so mcp/holi-mcp.js can reuse them without HTTP */
const out = (status, obj) => ({ status, body: typeof obj === 'string' ? obj : JSON.stringify(obj) });

async function tpGet(apiPath, search){                                    // apiPath without the "/tp" prefix
  if (apiPath === '/health') return out(200, { ok: true, token: !!token(), hotels: !!serpKey(), freeHotels: true });
  if (!ALLOWED.includes(apiPath)) return out(404, { error: 'not allowed' });
  const tk = token();
  if (!tk) return out(503, { error: 'No Travelpayouts token. Put it in travelpayouts.key next to server.js.' });
  const target = 'https://api.travelpayouts.com' + apiPath + (search || '');
  const hit = cache.get(target);
  if (hit && Date.now() - hit.t < CACHE_MS) return out(hit.status, hit.body);
  try {
    const r = await fetch(target, { headers: { 'X-Access-Token': tk, 'Accept-Encoding': 'gzip' }, signal: AbortSignal.timeout(15000) });
    const body = await r.text();
    if (r.ok) cache.set(target, { t: Date.now(), status: r.status, body });
    return out(r.status, body);
  } catch (e) {
    return out(502, { error: 'Travelpayouts unreachable: ' + e.message });
  }
}

/* Google Hotels through SerpApi: one search per city and date range, cached for 6 hours to save the free quota */
const hotelCache = new Map();
async function hotelSearch(q){                                           // q: URLSearchParams with q, ci, co, adults, currency
  const key = serpKey();
  if (!key) return out(503, { error: 'No SerpApi key. Put it in serpapi.key next to server.js.' });
  const p = new URLSearchParams({ engine: 'google_hotels', q: (q.get('q')||'').slice(0,120), check_in_date: q.get('ci')||'', check_out_date: q.get('co')||'',
    adults: String(Math.min(9, +q.get('adults')||2)), currency: (q.get('currency')||'EUR').toUpperCase(), gl: 'de', hl: 'en', rating: '7' });
  const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(v || '');
  if (!isDate(p.get('check_in_date')) || !isDate(p.get('check_out_date')) || !p.get('q'))
    return out(400, { error: 'q, ci and co are required' });
  const ck = p.toString(), hit = hotelCache.get(ck);
  if (hit && Date.now() - hit.t < 6 * 3600 * 1000) return out(200, hit.body);
  p.set('api_key', key);
  try {
    const r = await fetch('https://serpapi.com/search.json?' + p, { signal: AbortSignal.timeout(25000) });
    const j = await r.json();
    if (!r.ok || j.error) return out(r.ok ? 502 : r.status, { error: j.error || ('SerpApi ' + r.status) });
    // pass on only what the page needs (and never the key)
    const props = (j.properties || []).map(h => ({ name: h.name, type: h.type, link: h.link || null, description: h.description || '',
      night: h.rate_per_night && h.rate_per_night.extracted_lowest, total: h.total_rate && h.total_rate.extracted_lowest,
      rating: h.overall_rating || null, reviews: h.reviews || 0, stars: h.extracted_hotel_class || null,
      image: h.images && h.images[0] && (h.images[0].thumbnail || h.images[0].original_image) || null,
      gps: h.gps_coordinates || null, amenities: (h.amenities || []).slice(0, 6),
      source: h.prices && h.prices[0] && h.prices[0].source || null }));
    const body = JSON.stringify({ ok: true, properties: props });
    hotelCache.set(ck, { t: Date.now(), body });
    return out(200, body);
  } catch (e) { return out(502, { error: 'SerpApi unreachable: ' + e.message }); }
}

/* Free hotel and hostel prices, no key needed: Wikidata turns the city name into its TripAdvisor place id,
   Xotelo lists the places there and gives each one's nightly rate on the booking sites. Cached for 6 hours. */
const freeCache = new Map(), freePlace = new Map();
const XO_CUR = ['USD', 'GBP', 'EUR', 'CAD', 'CHF', 'AUD', 'JPY', 'CNY', 'INR', 'THB', 'BRL', 'HKD', 'RUB', 'BZD'];
async function getJson(url, ms){
  const r = await fetch(url, { headers: { 'User-Agent': 'heybe-trip-planner/1.0' }, signal: AbortSignal.timeout(ms) });
  return r.json();
}
/* TripAdvisor place ids of the cities people fly to most; each one was checked against Xotelo (its hotels are in that city) */
const TA_PLACE = { lisbon:189158, porto:189180, faro:189116, madrid:187514, barcelona:187497, palmademallorca:187463, mallorca:187463, malaga:187438,
  alicante:1064230, valencia:187529, seville:187443, sevilla:187443, ibiza:187460, rome:187791, milan:187849, venice:187870, naples:187785, bologna:187801,
  bergamo:187830, pisa:187899, florence:187895, paris:187147, nice:187234, marseille:187253, london:186338, manchester:187069, edinburgh:186525,
  dublin:186605, amsterdam:188590, brussels:188644, berlin:187323, munich:187309, hamburg:187331, nuremberg:187310, nurnberg:187310, frankfurt:187337,
  cologne:187371, vienna:190454, prague:274707, budapest:274887, krakow:274772, warsaw:274856, gdansk:274725, athens:189400, thessaloniki:189473,
  sofia:294452, bucharest:294458, zagreb:294454, split:295370, dubrovnik:295371, belgrade:294472, tirana:294446, sarajevo:294450, skopje:295110,
  istanbul:293974, antalya:297962, izmir:298006, bodrum:298658, marmaris:298033, ankara:298656, copenhagen:189541, stockholm:189852, oslo:190479,
  helsinki:189934, riga:274967, vilnius:274951, tallinn:274958, valletta:190328, malta:190328, marrakech:293734, zurich:188113, geneva:188057,
  larnaca:190379, paphos:190384, tbilisi:294195, baku:293934, dubai:295424 };
const plain = s => String(s).toLowerCase().replace(/ı/g, 'i').normalize('NFD').replace(/[^a-z]/g, '');
/* -> { key, checked }: checked = from the table above; a Wikidata match is checked against the hotel list later */
async function tripadvisorPlace(city){
  const k = plain(city);
  if (TA_PLACE[k]) return { key: 'g' + TA_PLACE[k], checked: true };
  if (freePlace.has(k)) return freePlace.get(k);
  const wd = 'https://www.wikidata.org/w/api.php?';
  const s = await getJson(wd + new URLSearchParams({ action: 'wbsearchentities', search: city, language: 'en', type: 'item', limit: '5', format: 'json' }), 10000);
  const ids = (s.search || []).map(x => x.id);
  let key = null;
  if (ids.length) {
    const e = await getJson(wd + new URLSearchParams({ action: 'wbgetentities', ids: ids.join('|'), props: 'claims', format: 'json' }), 10000);
    for (const id of ids) {                                               // first match that is a place on TripAdvisor
      const c = e.entities && e.entities[id] && e.entities[id].claims && e.entities[id].claims.P3134;
      const m = String(c && c[0] && c[0].mainsnak && c[0].mainsnak.datavalue && c[0].mainsnak.datavalue.value || '').match(/^g?(\d+)$/);
      if (m) { key = { key: 'g' + m[1], checked: false }; break; }
    }
  }
  freePlace.set(k, key);
  return key;
}
async function hotelFree(q){                                             // q: URLSearchParams with q (city), ci, co, adults, currency
  const city = (q.get('q') || '').trim().slice(0, 80), ci = q.get('ci') || '', co = q.get('co') || '';
  const cur = (q.get('currency') || 'EUR').toUpperCase(), adults = String(Math.min(9, Math.max(1, +q.get('adults') || 2)));
  const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(v);
  if (!city || !isDate(ci) || !isDate(co) || co <= ci) return out(400, { error: 'q, ci and co are required; co must be after ci' });
  const empty = out(200, { ok: true, properties: [] });
  if (!XO_CUR.includes(cur)) return empty;                                // this source has no prices in that currency
  const ck = [city.toLowerCase(), ci, co, adults, cur].join('|'), hit = freeCache.get(ck);
  if (hit && Date.now() - hit.t < 6 * 3600 * 1000) return out(200, hit.body);
  try {
    const place = await tripadvisorPlace(city);
    if (!place) return empty;
    const xo = 'https://data.xotelo.com/api/';
    const l = await getJson(xo + 'list?' + new URLSearchParams({ location_key: place.key, limit: '60', sort: 'best_value' }), 15000);
    if (l.error || !l.result) return out(502, { error: (l.error && l.error.message) || 'Xotelo list failed' });
    // a Wikidata match can be a different place with the same name: the hotel pages must name this city
    if (!place.checked && !(l.result.list || []).slice(0, 3).some(h => plain(String(h.url).split('-Reviews-')[1] || '').includes(plain(city)))) return empty;
    // every hostel on the list (they are few) and the best-value hotels: 18 rate lookups at most
    const all = l.result.list || [], isHostel = h => /hostel/i.test(h.accommodation_type || '');
    const picked = [...all.filter(isHostel).slice(0, 8), ...all.filter(h => !isHostel(h))].slice(0, 18);
    const nights = Math.round((Date.parse(co) - Date.parse(ci)) / 864e5);
    const props = [];
    for (let i = 0; i < picked.length; i += 9) props.push(...await Promise.all(picked.slice(i, i + 9).map(async h => {
      let best = null;
      try {
        const r = await getJson(xo + 'rates?' + new URLSearchParams({ hotel_key: h.key, chk_in: ci, chk_out: co, currency: cur, adults }), 12000);
        (r.result && r.result.rates || []).forEach(x => { const n = x.rate + (x.tax || 0); if (x.rate > 0 && (!best || n < best.n)) best = { n, name: x.name }; });
      } catch (e) {}                                                      // no rate: the place is still listed, without a price
      const rs = h.review_summary || {};
      return { name: h.name, type: h.accommodation_type || 'Hotel', link: h.url || null, description: '',
        night: best ? Math.round(best.n) : null, total: best ? Math.round(best.n * nights) : null,
        rating: rs.rating || null, reviews: rs.count || 0, stars: null, image: h.image || null,
        gps: h.geo || null, amenities: [], source: best ? best.name : null };
    })));
    const body = JSON.stringify({ ok: true, properties: props });
    freeCache.set(ck, { t: Date.now(), body });
    return out(200, body);
  } catch (e) { return out(502, { error: 'Free hotel search unreachable: ' + e.message }); }
}

/* Live fares for every airline (Google Flights through SerpApi): one search per date pair, cached for an hour */
const flightCache = new Map();
async function flightLive(q){                                            // q: URLSearchParams with from, to, dep, ret?, adults, currency
  const from = (q.get('from') || '').toUpperCase(), to = (q.get('to') || '').toUpperCase(), dep = q.get('dep') || '', ret = q.get('ret') || '';
  const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(v), isAp = v => /^[A-Z]{3}$/.test(v);
  if (!isAp(from) || !isAp(to) || !isDate(dep) || (ret && (!isDate(ret) || ret < dep)))
    return out(400, { error: 'from, to (airport codes) and dep are required; ret must be after dep' });
  const key = serpKey();
  if (!key) return out(503, { error: 'No SerpApi key. Put it in serpapi.key next to server.js.' });
  const p = new URLSearchParams({ engine: 'google_flights', departure_id: from, arrival_id: to, outbound_date: dep, type: ret ? '1' : '2',
    adults: String(Math.min(9, Math.max(1, +q.get('adults') || 1))), currency: (q.get('currency') || 'EUR').toUpperCase().slice(0, 3), hl: 'en', gl: 'de' });
  if (ret) p.set('return_date', ret);
  const ck = p.toString(), hit = flightCache.get(ck);
  if (hit && Date.now() - hit.t < 3600 * 1000) return out(200, hit.body);
  p.set('api_key', key);
  try {
    const r = await fetch('https://serpapi.com/search.json?' + p, { signal: AbortSignal.timeout(30000) });
    const j = await r.json();
    if (!r.ok || j.error) return out(r.ok ? 502 : r.status, { error: j.error || ('SerpApi ' + r.status) });
    const flights = [...(j.best_flights || []), ...(j.other_flights || [])].filter(f => f.price).map(f => ({
      price: f.price, duration: f.total_duration || null, stops: Math.max(0, (f.flights || []).length - 1),
      airlines: [...new Set((f.flights || []).map(l => l.airline).filter(Boolean))],
      logo: (f.flights || [])[0] && f.flights[0].airline_logo || null,
      legs: (f.flights || []).map(l => ({ from: l.departure_airport && l.departure_airport.id, to: l.arrival_airport && l.arrival_airport.id,
        dep: l.departure_airport && l.departure_airport.time, arr: l.arrival_airport && l.arrival_airport.time, airline: l.airline, no: l.flight_number })),
    })).sort((a, b) => a.price - b.price);
    const pi = j.price_insights || {};
    const body = JSON.stringify({ ok: true, flights, roundTrip: !!ret, link: j.search_metadata && j.search_metadata.google_flights_url || null,
      level: pi.price_level || null, typical: pi.typical_price_range || null, at: Date.now() });
    flightCache.set(ck, { t: Date.now(), body });
    return out(200, body);
  } catch (e) { return out(502, { error: 'SerpApi unreachable: ' + e.message }); }
}

/* how much of the monthly SerpApi quota is left (the account page itself is free) */
async function serpUsage(){
  const key = serpKey();
  if (!key) return out(503, { error: 'No SerpApi key.' });
  try {
    const r = await fetch('https://serpapi.com/account.json?api_key=' + encodeURIComponent(key), { signal: AbortSignal.timeout(10000) });
    const j = await r.json();
    if (!r.ok || j.error) return out(502, { error: j.error || ('SerpApi ' + r.status) });
    const left = j.total_searches_left != null ? j.total_searches_left : j.plan_searches_left;
    return out(200, { ok: true, used: j.this_month_usage, limit: j.searches_per_month, left });
  } catch (e) { return out(502, { error: 'SerpApi unreachable: ' + e.message }); }
}

/* address path -> file on disk, or null when it must not be served */
function resolveFile(pathname){
  let p;
  try { p = decodeURIComponent(pathname); } catch (e) { return null; }      // malformed, e.g. "/%"
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(ROOT, p));
  // stay inside the site folder, and never serve key files, git data or this script
  if (!file.startsWith(ROOT + path.sep) || /\.key$|server\.js$|[\\/]\.git([\\/]|$)/i.test(file)) return null;
  return file;
}
function serveFile(res, url){
  const file = resolveFile(url.pathname);
  if (!file) return send(res, 404, 'Not found', 'text/plain');
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'Not found', 'text/plain');
    send(res, 200, data, TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream');
  });
}

const SITE = `http://localhost:${PORT}/flights.html`;
function openBrowser(){
  if (process.env.NO_OPEN) return;
  const { exec } = require('child_process');
  const cmd = process.platform === 'win32' ? `start "" "${SITE}"` : process.platform === 'darwin' ? `open "${SITE}"` : `xdg-open "${SITE}"`;
  exec(cmd, () => {});
}

module.exports = { tpGet, hotelSearch, hotelFree, flightLive, serpUsage, resolveFile, TYPES };
if (require.main !== module) return;                                      // required as a library: don't start the server

const reply = (res, p) => p.then(r => send(res, r.status, r.body));
const server = http.createServer((req, res) => {
  let url;
  try { url = new URL(req.url, 'http://localhost'); } catch (e) { return send(res, 400, 'Bad request', 'text/plain'); }
  if (req.method !== 'GET') return send(res, 405, 'Method not allowed', 'text/plain');
  if (url.pathname.startsWith('/tp/')) return reply(res, tpGet(url.pathname.slice(3), url.search));
  if (url.pathname === '/hotels/search') return reply(res, hotelSearch(url.searchParams));
  if (url.pathname === '/hotels/free') return reply(res, hotelFree(url.searchParams));
  if (url.pathname === '/flights/live') return reply(res, flightLive(url.searchParams));
  if (url.pathname === '/serpapi/usage') return reply(res, serpUsage());
  serveFile(res, url);
});
server.on('error', e => {
  if (e.code === 'EADDRINUSE') {
    console.log(`\n  ℹ️  Heybe is already running. Opening ${SITE}\n`);
    openBrowser();
    setTimeout(() => process.exit(0), 1500);
  } else { console.error(e); process.exit(1); }
});
server.listen(PORT, process.env.HOST || '127.0.0.1', () => {
  console.log(`\n  🌴 Heybe is running:  ${SITE}\n`);
  console.log(token() ? '  ✅ Travelpayouts token found: all airlines enabled' : '  ⚠️  No token found in travelpayouts.key: only Ryanair prices will show');
  console.log('\n  Keep this window open while you use the site. Press Ctrl+C to stop.\n');
  openBrowser();   // open only once the server is ready
});
