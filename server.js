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
  '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg', '.svg':'image/svg+xml', '.ico':'image/x-icon' };

function send(res, status, body, type){ res.writeHead(status, { 'Content-Type': type || 'application/json', 'Cache-Control': 'no-store' }); res.end(body); }

async function proxy(req, res, url){
  const apiPath = url.pathname.slice(3);                                  // strip "/tp"
  if (apiPath === '/health') return send(res, 200, JSON.stringify({ ok: true, token: !!token(), hotels: !!serpKey() }));
  if (!ALLOWED.includes(apiPath)) return send(res, 404, JSON.stringify({ error: 'not allowed' }));
  const tk = token();
  if (!tk) return send(res, 503, JSON.stringify({ error: 'No Travelpayouts token. Put it in travelpayouts.key next to server.js.' }));
  const target = 'https://api.travelpayouts.com' + apiPath + url.search;
  const hit = cache.get(target);
  if (hit && Date.now() - hit.t < CACHE_MS) return send(res, hit.status, hit.body);
  try {
    const r = await fetch(target, { headers: { 'X-Access-Token': tk, 'Accept-Encoding': 'gzip' } });
    const body = await r.text();
    if (r.ok) cache.set(target, { t: Date.now(), status: r.status, body });
    send(res, r.status, body);
  } catch (e) {
    send(res, 502, JSON.stringify({ error: 'Travelpayouts unreachable: ' + e.message }));
  }
}

/* Google Hotels through SerpApi: one search per city and date range, cached for 6 hours to save the free quota */
const hotelCache = new Map();
async function hotels(res, url){
  const key = serpKey();
  if (!key) return send(res, 503, JSON.stringify({ error: 'No SerpApi key. Put it in serpapi.key next to server.js.' }));
  const q = url.searchParams;
  const p = new URLSearchParams({ engine: 'google_hotels', q: (q.get('q')||'').slice(0,120), check_in_date: q.get('ci')||'', check_out_date: q.get('co')||'',
    adults: String(Math.min(9, +q.get('adults')||2)), currency: (q.get('currency')||'EUR').toUpperCase(), gl: 'de', hl: 'en', rating: '7' });
  const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(v || '');
  if (!isDate(p.get('check_in_date')) || !isDate(p.get('check_out_date')) || !p.get('q'))
    return send(res, 400, JSON.stringify({ error: 'q, ci and co are required' }));
  const ck = p.toString(), hit = hotelCache.get(ck);
  if (hit && Date.now() - hit.t < 6 * 3600 * 1000) return send(res, 200, hit.body);
  p.set('api_key', key);
  try {
    const r = await fetch('https://serpapi.com/search.json?' + p);
    const j = await r.json();
    if (!r.ok || j.error) return send(res, r.ok ? 502 : r.status, JSON.stringify({ error: j.error || ('SerpApi ' + r.status) }));
    // pass on only what the page needs (and never the key)
    const props = (j.properties || []).map(h => ({ name: h.name, type: h.type, link: h.link || null, description: h.description || '',
      night: h.rate_per_night && h.rate_per_night.extracted_lowest, total: h.total_rate && h.total_rate.extracted_lowest,
      rating: h.overall_rating || null, reviews: h.reviews || 0, stars: h.extracted_hotel_class || null,
      image: h.images && h.images[0] && (h.images[0].thumbnail || h.images[0].original_image) || null,
      gps: h.gps_coordinates || null, amenities: (h.amenities || []).slice(0, 6),
      source: h.prices && h.prices[0] && h.prices[0].source || null }));
    const body = JSON.stringify({ ok: true, properties: props });
    hotelCache.set(ck, { t: Date.now(), body });
    send(res, 200, body);
  } catch (e) { send(res, 502, JSON.stringify({ error: 'SerpApi unreachable: ' + e.message })); }
}

function serveFile(res, url){
  let p = decodeURIComponent(url.pathname);
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(ROOT, p));
  // stay inside the site folder, and never serve key files, git data or this script
  if (!file.startsWith(ROOT) || /\.key$|server\.js$|[\\/]\.git([\\/]|$)/i.test(file)) return send(res, 404, 'Not found', 'text/plain');
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

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method !== 'GET') return send(res, 405, 'Method not allowed', 'text/plain');
  if (url.pathname.startsWith('/tp/')) return proxy(req, res, url);
  if (url.pathname === '/hotels/search') return hotels(res, url);
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
