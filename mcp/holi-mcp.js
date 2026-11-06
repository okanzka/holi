#!/usr/bin/env node
/* ============ Heybe — MCP server ============
   Exposes Heybe's travel tools (live Ryanair fares, all-airline Travelpayouts prices,
   multi-city routes, Google Hotels prices, booking links) to any MCP client:
   the agent hub, Claude Code (`claude mcp add holi -- node <path>/mcp/holi-mcp.js`), etc.

   Transport: stdio, newline-delimited JSON-RPC 2.0. No packages needed (Node 18+).
   Keys: same as server.js (travelpayouts.key / serpapi.key or their env variables).
   Optional env: HOLI_CURRENCY (default EUR), HOLI_ADULTS (default 1).                 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const readline = require('readline');
const { tpGet, hotelSearch } = require('../server.js');

const ROOT = path.join(__dirname, '..');
const VERSION = '1.0.0';

/* ---------- load the browser scripts into a sandbox ---------- */
function loadSite(){
  const noop = () => {};
  const store = new Map();                                                 // in-memory localStorage
  const localStorage = { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
  // the page calls the local server with relative URLs; answer those in-process
  const siteFetch = async (url, opts) => {
    const u = String(url);
    if (u.startsWith('/tp/')) { const x = new URL(u, 'http://local'); const r = await tpGet(x.pathname.slice(3), x.search);
      return new Response(r.body, { status: r.status, headers: { 'Content-Type': 'application/json' } }); }
    return fetch(u, opts);
  };
  const log = (...a) => console.error(...a);                               // stdout is reserved for JSON-RPC
  const ctx = vm.createContext({
    console: { log, info: log, warn: log, error: log, debug: log }, Intl, Date, Math, JSON, URL, URLSearchParams,
    Promise, setTimeout, clearTimeout, fetch: siteFetch, localStorage,
    document: { addEventListener: noop, querySelector: () => null, querySelectorAll: () => [], body: { dataset: {} } },
    location: { protocol: 'http:', search: '', hash: '' },
  });
  const src = ['airports.js', 'common.js', 'visa.js', 'assistant-tools.js']
    .map(f => fs.readFileSync(path.join(ROOT, 'js', f), 'utf8')).join('\n;\n');
  vm.runInContext(src, ctx, { filename: 'heybe-site.js' });
  const site = vm.runInContext('({H, HEYBE_TOOLS})', ctx);
  site.H.setTrip({ currency: (process.env.HOLI_CURRENCY || 'EUR').toUpperCase(), adults: Math.max(1, +process.env.HOLI_ADULTS || 1), children: 0 });
  return site;
}
const { H, HEYBE_TOOLS } = loadSite();

/* ---------- tool list ---------- */
const SITE_TOOLS = HEYBE_TOOLS.TOOLS.filter(t => t.name !== 'get_my_trip');   // the saved trip lives in the browser
const EXTRA_TOOLS = [
  { name: 'search_hotels',
    description: 'Google Hotels prices (rating 7+) for one city and date range: name, type, price per night and total, rating, stars, amenities, link. Needs the SerpApi key.',
    input_schema: { type: 'object', properties: {
      city: { type: 'string', description: 'City or area, e.g. "Lisbon" or "Palma de Mallorca old town"' },
      check_in: { type: 'string', description: 'YYYY-MM-DD' }, check_out: { type: 'string', description: 'YYYY-MM-DD' },
      adults: { type: 'integer', description: 'Default 2' }, currency: { type: 'string', description: 'Default EUR' },
      max_results: { type: 'integer', description: 'Default 10' } },
      required: ['city', 'check_in', 'check_out'] } },
  { name: 'today',
    description: "Today's date (YYYY-MM-DD). Use it to turn relative dates like \"next month\" into exact dates before searching.",
    input_schema: { type: 'object', properties: {} } },
];
const TOOLS = [...SITE_TOOLS, ...EXTRA_TOOLS].map(t => ({ name: t.name, description: t.description, inputSchema: t.input_schema }));

async function callTool(name, input){
  if (name === 'today') return { today: H.fmt(HEYBE_TOOLS.today()) };
  if (name === 'search_hotels') {
    const r = await hotelSearch(new URLSearchParams({ q: input.city || '', ci: input.check_in || '', co: input.check_out || '',
      adults: String(input.adults || 2), currency: input.currency || 'EUR' }));
    const j = JSON.parse(r.body);
    if (r.status !== 200) throw new Error(j.error || 'Hotel search failed (' + r.status + ')');
    return { city: input.city, check_in: input.check_in, check_out: input.check_out,
      hotels: j.properties.slice(0, input.max_results || 10).map(({ image, gps, ...h }) => h) };
  }
  if (!SITE_TOOLS.some(t => t.name === name)) throw new Error('Unknown tool ' + name);
  return HEYBE_TOOLS.run(name, input);
}

/* ---------- JSON-RPC over stdio ---------- */
const write = msg => process.stdout.write(JSON.stringify(msg) + '\n');
const ok = (id, result) => write({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => write({ jsonrpc: '2.0', id, error: { code, message } });

async function handle(msg){
  const { id, method, params } = msg;
  const isRequest = id !== undefined && id !== null;
  switch (method) {
    case 'initialize':
      return ok(id, { protocolVersion: (params && params.protocolVersion) || '2025-06-18', capabilities: { tools: {} },
        serverInfo: { name: 'holi', version: VERSION },
        instructions: 'Heybe travel tools: turn place names into codes with search_airports, then find_deals / route_calendar / find_multi_city for fares, search_hotels for hotels, make_links for booking links. Ryanair prices are live; other airlines are recent Aviasales prices.' });
    case 'ping': return ok(id, {});
    case 'tools/list': return ok(id, { tools: TOOLS });
    case 'tools/call': {
      const name = params && params.name;
      try {
        const res = await callTool(name, (params && params.arguments) || {});
        return ok(id, { content: [{ type: 'text', text: JSON.stringify(res) }] });
      } catch (e) {
        return ok(id, { content: [{ type: 'text', text: 'Error: ' + (e && e.message || e) }], isError: true });
      }
    }
    default:
      if (isRequest) return fail(id, -32601, 'Method not found: ' + method);  // notifications are ignored
  }
}

if (require.main === module) {
  const rl = readline.createInterface({ input: process.stdin });
  const pending = new Set();
  rl.on('line', line => {
    if (!line.trim()) return;
    let msg; try { msg = JSON.parse(line); } catch (e) { return fail(null, -32700, 'Parse error'); }
    const p = handle(msg).catch(e => msg.id != null && fail(msg.id, -32603, String(e && e.message || e)));
    pending.add(p); p.finally(() => pending.delete(p));
  });
  rl.on('close', () => Promise.allSettled([...pending]).then(() => process.exit(0)));   // finish running calls first
}
module.exports = { TOOLS, callTool };
