/* Regressions found in the end-to-end check of Nov 2026: pop-up warning, logos, airline names, stale fares, MCP links. */
const test = require('node:test');
const assert = require('node:assert');
const { load } = require('./load');

const store = new Map();
const localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };

test('"Open all sites" does not warn about blocked tabs when the browser opened them', () => {
  // a real browser returns null from window.open whenever 'noopener' is passed
  const window = { open: (u, t, f) => /noopener/.test(f || '') ? null : {} };
  const { H, openAll } = load('airports.js', 'common.js', { window });
  let warned = false; H.toast = () => { warned = true; };
  openAll([{ url: () => 'https://a.example' }, { url: () => 'https://b.example' }], {});
  assert.equal(warned, false);
});

test('airline logos come from a source that still serves them', () => {
  const { H } = load('airports.js', 'common.js');
  const html = H.alLogo('TK');
  assert.match(html, /pics\.avs\.io\/64\/64\/TK\.png/);
  assert.doesNotMatch(html, /kiwi\.com/);
});

test('airlines seen in live results have names, not just codes', () => {
  const { AIRLINES } = load('airports.js', 'common.js');
  for (const c of ['XC', 'AC', 'AY', 'AA', 'KM', '4Y', 'ZQ']) assert.ok(AIRLINES[c], 'no name for ' + c);
});

test('a Ryanair day does not keep another airline\'s fare from an earlier search', async () => {
  const { FARES, RYANAIR, TP } = load('airports.js', 'common.js');
  const cached = { '2026-12-20': { price: 40, cur: 'EUR' } };       // the per-day cache hands back the same objects
  RYANAIR.perDay = async () => cached;
  TP.available = async () => true;
  TP.perDay = async () => ({ '2026-12-20': { price: 50, airline: 'PC', src: 'tp' } });
  assert.equal((await FARES.perDay('NUE', 'AYT', [], 'EUR', false))['2026-12-20'].alt.airline, 'PC');
  TP.perDay = async () => ({});                                       // e.g. "direct only": Pegasus no longer fits
  assert.equal((await FARES.perDay('NUE', 'AYT', [], 'EUR', true))['2026-12-20'].alt, undefined);
});

const tools = () => load('airports.js', 'common.js', 'visa.js', 'assistant-tools.js', { localStorage });

test('MCP find_multi_city links each leg to the airline that flies it', async () => {
  const { MULTI, HEYBE_TOOLS } = tools();
  MULTI.search = async () => ({ itineraries: [{ total: 90, cur: 'EUR', stops: 1, nights: [3], legs: [
    { from: 'NUE', to: 'AYT', dep: '2027-05-01T10:00', price: 60, src: 'tp', airline: 'PC', link: 'https://www.aviasales.com/x' },
    { from: 'AYT', to: 'NUE', dep: '2027-05-04T10:00', price: 30, src: 'ryanair', airline: 'FR' }] }] });
  const r = await HEYBE_TOOLS.run('find_multi_city', { home: 'NUE', depart_from: '2027-05-01', home_by: '2027-05-10', stops: 1 });
  assert.equal(r.routes[0].legs[0].book, 'https://www.aviasales.com/x');
  assert.match(r.routes[0].legs[1].book, /ryanair\.com/);
  assert.doesNotMatch(r.airline, /^Ryanair \(live\),/);
});

test('MCP find_deals names the airline of an all-airline fare without a flight number', async () => {
  const { RYANAIR, TP, HEYBE_TOOLS } = tools();
  RYANAIR.oneWays = async () => [];
  TP.available = async () => true;
  TP.oneWays = async () => [{ origin: 'NUE', dest: 'AYT', destCity: 'Antalya', country: 'Turkey', outDep: '2027-05-01T10:00',
    pp: 80, cur: 'EUR', airline: 'PC', outFlight: 'PC', src: 'tp', link: 'https://www.aviasales.com/y' }];
  const r = await HEYBE_TOOLS.run('find_deals', { from: 'NUE', to: 'AYT', depart_from: '2027-05-01' });
  assert.equal(r.deals[0].airline, 'Pegasus');
});

test('the local server serves only the site, not tests, tools or notes', () => {
  const { resolveFile } = require('../server.js');
  for (const p of ['/tests/load.js', '/mcp/holi-mcp.js', '/.claude/settings.json', '/PRODUCT.md', '/streamlit_app.py', '/package.json', '/README.md', '/start.bat'])
    assert.strictEqual(resolveFile(p), null, p + ' should not be served');
  for (const p of ['/', '/index.html', '/hotels.html', '/things.html', '/help.html', '/flights.html', '/css/style.css', '/js/common.js', '/background-image/raw.webp'])
    assert.notStrictEqual(resolveFile(p), null, p + ' should be served');
});

test('airlines MW and A4 have names', () => {
  const { AIRLINES } = load('airports.js', 'common.js');
  assert.equal(AIRLINES.MW, 'Malta Air');
  assert.equal(AIRLINES.A4, 'Azimuth');
});
