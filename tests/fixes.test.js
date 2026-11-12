/* Regressions found while testing the app by hand: server crashes, wrong airline labels, URL parameters, missing airlines. */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { load } = require('./load');
const server = require('../server.js');

test('a malformed address is refused instead of crashing the server', () => {
  assert.equal(typeof server.resolveFile, 'function');
  assert.strictEqual(server.resolveFile('/%'), null);
  assert.strictEqual(server.resolveFile('/%E0%A4%A'), null);
  assert.strictEqual(server.resolveFile('/serpapi.key'), null);
  assert.strictEqual(server.resolveFile('/server.js'), null);
  assert.strictEqual(server.resolveFile('/../holi-other/index.html'), null);
  assert.strictEqual(server.resolveFile('/'), path.join(__dirname, '..', 'index.html'));
});

test('webp photos (the hero image) are served as images', () => {
  assert.equal(server.TYPES['.webp'], 'image/webp');
});

test('trip details in the page address are cleaned up before use', () => {
  const { H } = load('airports.js', 'common.js');
  const p = s => ({ ...H.urlPatch(new URLSearchParams(s)) });
  assert.deepStrictEqual(p('from=nue&to=ist'), { from: 'NUE', to: 'IST' });
  assert.deepStrictEqual(p('from=c:es&to=any'), { from: 'C:ES', to: 'ANY' });
  assert.deepStrictEqual(p('from=zzz&start=garbage&end=2027-01-05'), { end: '2027-01-05' });   // unknown airport and bad date are ignored
  assert.deepStrictEqual(p('start=2027-13-45'), {});
});

test('a fare without a flight number keeps its own airline, not Ryanair', () => {
  const { H } = load('airports.js', 'common.js');
  assert.equal(H.alOf({ airline: 'PC', outFlight: 'PC' }), 'PC');
  assert.equal(H.alOf({ outFlight: 'W61234' }), 'W6');
  assert.equal(H.alOf({ outFlight: 'FR 7937' }), 'FR');
  assert.equal(H.alOf({}), 'FR');                       // Ryanair fares come without a number
});

/* Travelpayouts: a fake server that records the queries and answers with one row per query */
function tpFetch(){
  const f = async url => { const q = new URL(url, 'http://x').searchParams; f.qs.push(Object.fromEntries(q));
    const day = q.get('departure_at').length === 7 ? q.get('departure_at') + '-11' : q.get('departure_at');
    const row = { origin: 'NUE', destination: q.get('unique') === 'true' ? 'SAW' : 'PMI', airline: q.get('unique') === 'true' ? 'PC' : 'FR',
      flight_number: '1', departure_at: day + 'T06:00:00+01:00', price: 30, transfers: 0 };
    if (q.get('one_way') === 'false') row.return_at = '2027-01-18T09:00:00+01:00';
    return { ok: true, status: 200, json: async () => ({ success: true, data: [row] }) }; };
  f.qs = []; return f;
}

test('"anywhere" one-way search also asks for the cheapest fare per destination on each day, so more airlines show up', async () => {
  const fetch = tpFetch();
  const { TP } = load('airports.js', 'common.js', { fetch });
  const r = await TP.oneWays({ from: 'NUE', to: null, outFrom: '2027-01-10', outTo: '2027-01-12', currency: 'EUR' });
  const daily = fetch.qs.filter(q => q.unique === 'true').map(q => q.departure_at).sort();
  assert.deepStrictEqual(daily, ['2027-01-10', '2027-01-11', '2027-01-12']);
  assert.ok(r.some(d => d.airline === 'PC' && d.dest === 'SAW'), 'the extra airline is in the results');
  assert.ok(r.some(d => d.airline === 'FR'), 'the month search is still used');
});

test('"anywhere" round trips get the per-day search too; a single route does not need it', async () => {
  let fetch = tpFetch();
  let { TP } = load('airports.js', 'common.js', { fetch });
  const win = { outFrom: '2027-01-10', outTo: '2027-01-11', inFrom: '2027-01-17', inTo: '2027-01-19', currency: 'EUR' };
  const r = await TP.roundTrips({ from: 'NUE', to: null, ...win });
  assert.equal(fetch.qs.filter(q => q.unique === 'true').length, 2);
  assert.ok(r.some(d => d.airline === 'PC'));
  fetch = tpFetch(); ({ TP } = load('airports.js', 'common.js', { fetch }));
  await TP.roundTrips({ from: 'NUE', to: 'PMI', ...win });
  assert.equal(fetch.qs.filter(q => q.unique === 'true').length, 0);
});

test('each destination keeps the cheapest non-Ryanair fare next to a cheaper Ryanair one', () => {
  const { H } = load('airports.js', 'common.js');
  const best = new Map();
  [{ dest: 'SAW', pp: 50, src: 'ryanair' },
   { dest: 'SAW', pp: 90, src: 'tp', airline: 'W6' },
   { dest: 'SAW', pp: 80, src: 'tp', airline: 'PC' },
   { dest: 'SAW', pp: 70, src: 'tp', airline: 'FR' },        // Ryanair found by Aviasales is still Ryanair
   { dest: 'BCN', pp: 60, src: 'tp', airline: 'VY' },
   { dest: 'BCN', pp: 99, src: 'tp', airline: 'W6' }].forEach(d => H.keepBest(best, d.dest, d));
  assert.equal(best.get('SAW').pp, 50);
  assert.equal(best.get('SAW').alt.airline, 'PC');
  assert.equal(best.get('BCN').airline, 'VY');
  assert.equal(best.get('BCN').alt, undefined);                // the best is not Ryanair: nothing to add
  assert.ok(H.isRyanair({ src: 'ryanair' }) && H.isRyanair({ src: 'tp', airline: 'RK' }) && !H.isRyanair({ src: 'tp', airline: 'W6' }));
});

test('round trips are built from two one-way fares: cheapest per destination, inside the windows and night limits', () => {
  const { TP, H } = load('airports.js', 'common.js');
  const outs = [
    { src: 'tp', origin: 'NUE', dest: 'AYT', outDep: '2026-12-05T08:00:00+01:00', pp: 65, airline: 'PC', outFlight: 'PC1', cur: 'EUR' },
    { src: 'tp', origin: 'NUE', dest: 'AYT', outDep: '2026-12-09T08:00:00+01:00', pp: 40, airline: 'XQ', outFlight: 'XQ2', cur: 'EUR' },
    { src: 'tp', origin: 'NUE', dest: 'BUD', outDep: '2026-12-02T08:00:00+01:00', pp: 30, airline: 'W6', outFlight: 'W63', cur: 'EUR' },
  ];
  const backs = {
    AYT: { '2026-12-12': { price: 50, dep: '2026-12-12T10:00:00+03:00', airline: 'PC', flight: 'PC9', stops: 0 },   // 3 nights after the 9th: too short
           '2026-12-19': { price: 70, dep: '2026-12-19T10:00:00+03:00', airline: 'PC', flight: 'PC8', stops: 1 },
           '2026-12-31': { price: 10, dep: '2026-12-31T10:00:00+03:00', airline: 'PC', flight: 'PC7', stops: 0 } },  // outside the return window
    BUD: {},
  };
  const r = TP.combine(outs, backs, { inFrom: '2026-12-10', inTo: '2026-12-20', minN: 7, maxN: 14 });
  assert.equal(r.length, 1);                                        // BUD has no way back
  const a = r[0];
  assert.equal(a.dest, 'AYT'); assert.equal(a.pp, 110);              // XQ 40 on the 9th + PC 70 on the 19th
  assert.equal(a.airline, 'XQ'); assert.equal(a.inAirline, 'PC'); assert.equal(a.inFlight, 'PC8');
  assert.equal(a.rstops, 1); assert.ok(a.mixed); assert.equal(a.inDep.slice(0, 10), '2026-12-19');
  assert.ok(H.isRyanair({ src: 'tp', airline: 'PC', inAirline: 'FR' }));   // a Ryanair leg makes it a Ryanair trip
  assert.ok(!H.isRyanair(a));
});

test('opened as a file or inside Streamlit, the page asks the local server at 127.0.0.1:8080', async () => {
  const urls = [];
  const fakeFetch = async u => { urls.push(u); return { ok: true, status: 200, json: async () => ({ ok: true, token: true }) }; };
  const { NET, TP } = load('airports.js', 'common.js', { fetch: fakeFetch });   // the test sandbox runs as file:
  await NET.json('/tp/health');
  await NET.json('https://services-api.ryanair.com/x');
  assert.deepStrictEqual(urls, ['http://127.0.0.1:8080/tp/health', 'https://services-api.ryanair.com/x']);
  TP._ok = null; assert.strictEqual(await TP.available(), true);
});

test('the local server lets only local pages (file, Streamlit on localhost) read its answers', () => {
  const ok = o => server.corsOrigin(o);
  assert.equal(ok('null'), 'null');                          // a page opened as a file
  assert.equal(ok('http://localhost:8501'), 'http://localhost:8501');   // Streamlit run locally
  assert.equal(ok('http://127.0.0.1:8501'), 'http://127.0.0.1:8501');
  assert.equal(ok('https://evil.example'), null);
  assert.equal(ok('http://localhost.evil.example'), null);
  assert.equal(ok(undefined), null);
});
