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
  if (apiPath === '/health') return send(res, 200, JSON.stringify({ ok: true, token: !!token() }));
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

function serveFile(res, url){
  let p = decodeURIComponent(url.pathname);
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(ROOT, p));
  // stay inside the site folder, and never serve the key or this script
  if (!file.startsWith(ROOT) || /travelpayouts\.key$|server\.js$/i.test(file)) return send(res, 404, 'Not found', 'text/plain');
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
  serveFile(res, url);
});
server.on('error', e => {
  if (e.code === 'EADDRINUSE') {
    console.log(`\n  ℹ️  Heybe is already running. Opening ${SITE}\n`);
    openBrowser();
    setTimeout(() => process.exit(0), 1500);
  } else { console.error(e); process.exit(1); }
});
server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  🌴 Heybe is running:  ${SITE}\n`);
  console.log(token() ? '  ✅ Travelpayouts token found: all airlines enabled' : '  ⚠️  No token found in travelpayouts.key: only Ryanair prices will show');
  console.log('\n  Keep this window open while you use the site. Press Ctrl+C to stop.\n');
  openBrowser();   // open only once the server is ready
});
