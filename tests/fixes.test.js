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

test('one-route view: the airline filter picks the day\'s other-airline fare or hides the day', () => {
  const { H } = load('airports.js', 'common.js');
  const pc = { price: 80, airline: 'PC', src: 'tp' }, w6 = { price: 90, airline: 'W6', src: 'tp' };
  const ry = { price: 50, airline: 'FR', src: 'ryanair', alt: pc };
  assert.strictEqual(H.pickFare(ry, {}), ry);                                   // no filter: cheapest
  assert.strictEqual(H.pickFare(ry, { noRyanair: true }), pc);                 // Without Ryanair: the other airline
  assert.strictEqual(H.pickFare({ price: 50, airline: 'FR', src: 'ryanair' }, { noRyanair: true }), null);   // nothing else that day
  assert.strictEqual(H.pickFare(ry, { sel: new Set(['PC']) }), pc);            // ticked Pegasus only
  assert.strictEqual(H.pickFare(ry, { sel: new Set(['W6']) }), null);
  assert.strictEqual(H.pickFare(w6, { noRyanair: true, sel: new Set(['W6']) }), w6);
  assert.strictEqual(H.pickFare(undefined, {}), null);
});

test('Airlines menu: "All airlines" ticks every box; unticking boxes maps back to the filter', () => {
  const { H } = load('airports.js', 'common.js');
  const codes = ['FR', 'PC', 'W6', 'U2'];
  const ticked = st => codes.filter(c => H.alTicked(c, st));
  assert.deepStrictEqual(ticked({ noRyanair: false, sel: new Set() }), codes);                  // All airlines: all ticked
  assert.deepStrictEqual(ticked({ noRyanair: true, sel: new Set() }), ['PC', 'W6', 'U2']);     // Without Ryanair
  let st = H.alFromTicks(codes, codes);                                                          // everything ticked = All
  assert.deepStrictEqual([st.noRyanair, st.sel.size], [false, 0]);
  st = H.alFromTicks(codes, ['PC', 'W6', 'U2']);                                                 // Ryanair unticked = Without Ryanair
  assert.deepStrictEqual([st.noRyanair, st.sel.size], [true, 0]);
  st = H.alFromTicks(codes, ['PC']);                                                             // Pegasus only
  assert.deepStrictEqual([st.noRyanair, [...st.sel]], [true, ['PC']]);
  st = H.alFromTicks(codes, ['FR', 'PC']);
  assert.deepStrictEqual([st.noRyanair, [...st.sel].sort()], [false, ['FR', 'PC']]);
  st = H.alFromTicks(codes, []);                                                                 // nothing ticked: show nothing
  assert.deepStrictEqual(ticked(st), []);
  assert.strictEqual(H.pickFare({ price: 9, airline: 'PC', src: 'tp' }, st), null);
});

// fake network: Ryanair has nothing, Travelpayouts has Pegasus NUE → IST → NUE (direct)
function tpOnlyFetch(){
  const ok = data => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(data) });
  const f = url => { f.urls.push(url); const u = new URL(url), q = u.searchParams;
    if (url.includes('ryanair')) return ok(url.includes('cheapestPerDay') ? { outbound: { fares: [] } } : { fares: [] });
    if (u.pathname === '/tp/health') return ok({ token: true });
    if (u.pathname.endsWith('/prices_for_dates') && q.get('origin') === 'NUE' && !q.get('departure_at').slice(8))
      return ok({ success: true, data: [{ origin: 'NUE', destination: 'IST', departure_at: '2027-01-02T10:00:00+01:00', price: 50, airline: 'PC', flight_number: '1', transfers: 0 }] });
    if (u.pathname.endsWith('/grouped_prices') && q.get('origin') === 'IST' && q.get('destination') === 'NUE')
      return ok({ success: true, data: { '2027-01-06': { price: 70, airline: 'PC', flight_number: '2', departure_at: '2027-01-06T08:00:00+03:00', transfers: 0 } } });
    return ok({ success: true, data: [] }); };
  f.urls = []; return f;
}

test('multi-city: other airlines (Travelpayouts) fill the legs, not only Ryanair', async () => {
  const fetch = tpOnlyFetch();
  const { MULTI } = load('airports.js', 'common.js', { fetch, URL });
  const r = await MULTI.search({ from: 'NUE', stops: 1, outFrom: '2027-01-01', outTo: '2027-01-03', latest: '2027-01-10', minN: 3, maxN: 5, currency: 'EUR' });
  assert.strictEqual(r.itineraries.length, 1);
  const it = r.itineraries[0];
  assert.deepStrictEqual(Array.from(it.legs, l => l.airline), ['PC', 'PC']);
  assert.strictEqual(it.total, 120);
  assert.ok(fetch.urls.every(u => !u.includes('prices_for_dates') || !/departure_at=\d{4}-\d\d-\d\d(&|$)/.test(u) || /origin=NUE/.test(u)), 'no per-day "everywhere" calls from every stop');
});

test('multi-city: the airline filter swaps a Ryanair leg for the same-day other airline, or drops the trip', () => {
  const { H } = load('airports.js', 'common.js');
  const pc = { price: 80, airline: 'PC', src: 'tp' };
  const it = { total: 90, legs: [{ price: 40, airline: 'PC', src: 'tp', dep: '2027-01-02' }, { price: 50, airline: 'FR', src: 'ryanair', dep: '2027-01-05', alt: { ...pc, dep: '2027-01-05' } }] };
  assert.strictEqual(H.filterTrip(it, {}), it);                                       // no filter: unchanged
  const nr = H.filterTrip(it, { noRyanair: true });
  assert.deepStrictEqual([nr.total, nr.legs[1].airline], [120, 'PC']);
  assert.strictEqual(H.filterTrip({ total: 9, legs: [{ price: 9, airline: 'FR', src: 'ryanair' }] }, { noRyanair: true }), null);
});

test('multi-city: 3 cities in a row (NUE → IST → ATH → FCO → NUE)', async () => {
  const ok = data => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(data) });
  const row = (o, d, day, price) => ({ origin: o, destination: d, departure_at: `2027-01-${day}T10:00:00+01:00`, price, airline: 'PC', flight_number: '1', transfers: 0 });
  const rows = { NUE: [row('NUE', 'IST', '02', 50), row('NUE', 'FCO', '02', 999)], IST: [row('IST', 'ATH', '05', 30)], ATH: [row('ATH', 'FCO', '08', 40)] };
  const fetch = url => { const u = new URL(url), q = u.searchParams;
    if (url.includes('ryanair')) return ok(url.includes('cheapestPerDay') ? { outbound: { fares: [] } } : { fares: [] });
    if (u.pathname === '/tp/health') return ok({ token: true });
    if (u.pathname.endsWith('/prices_for_dates') && !q.get('departure_at').slice(8)) return ok({ success: true, data: rows[q.get('origin')] || [] });
    if (u.pathname.endsWith('/grouped_prices') && q.get('origin') === 'FCO' && q.get('destination') === 'NUE')
      return ok({ success: true, data: { '2027-01-11': { price: 60, airline: 'PC', flight_number: '2', departure_at: '2027-01-11T08:00:00+01:00', transfers: 0 } } });
    return ok({ success: true, data: [] }); };
  const { MULTI } = load('airports.js', 'common.js', { fetch, URL });
  const r = await MULTI.search({ from: 'NUE', stops: 3, outFrom: '2027-01-01', outTo: '2027-01-03', latest: '2027-01-14', minN: 3, maxN: 5, currency: 'EUR' });
  assert.strictEqual(r.itineraries.length, 1);
  const it = r.itineraries[0];
  assert.deepStrictEqual(Array.from(it.legs, l => l.to), ['IST', 'ATH', 'FCO', 'NUE']);
  assert.deepStrictEqual(Array.from(it.nights), [3, 3, 3]);
  assert.strictEqual(it.total, 180);
});

test('multi-city: a cheaper Ryanair fare does not throw away another airline on a different day', () => {
  const { H, MLEGS } = load('airports.js', 'common.js');
  const fr = { dest: 'BCN', pp: 20, outDep: '2027-01-02T08:00', src: 'ryanair', airline: 'FR' };
  const u2 = { dest: 'BCN', pp: 60, outDep: '2027-01-04T08:00', src: 'tp', airline: 'U2' };
  const r = MLEGS.merge([fr], [u2]);
  assert.deepStrictEqual(Array.from(r, x => x.airline).sort(), ['FR', 'U2']);
  const sameDay = MLEGS.merge([fr], [{ ...u2, outDep: '2027-01-02T12:00' }]);
  assert.strictEqual(sameDay.length, 1);
  assert.strictEqual(sameDay[0].alt.airline, 'U2');
});

test('via: a last stop named by the user is checked directly, not only through the list of places from home', async () => {
  const ok = data => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(data) });
  const row = (o, d, day, price) => ({ origin: o, destination: d, departure_at: `2027-01-${day}T10:00:00+01:00`, price, airline: 'PC', flight_number: '1', transfers: 0 });
  const rows = { NUE: [row('NUE', 'IST', '02', 50)], IST: [row('IST', 'FCO', '05', 30)] };
  const fetch = url => { const u = new URL(url), q = u.searchParams;
    if (url.includes('ryanair')) return ok(url.includes('cheapestPerDay') ? { outbound: { fares: [] } } : { fares: [] });
    if (u.pathname === '/tp/health') return ok({ token: true });
    if (u.pathname.endsWith('/prices_for_dates') && !q.get('departure_at').slice(8)) return ok({ success: true, data: rows[q.get('origin')] || [] });
    if (u.pathname.endsWith('/grouped_prices') && q.get('origin') === 'FCO' && q.get('destination') === 'NUE')
      return ok({ success: true, data: { '2027-01-09': { price: 60, airline: 'U2', flight_number: '2', departure_at: '2027-01-09T08:00:00+01:00', transfers: 0 } } });
    return ok({ success: true, data: [] }); };
  const { MULTI } = load('airports.js', 'common.js', { fetch, URL });
  const r = await MULTI.viaLoop({ from: 'NUE', last: 'FCO', stops: 1, outFrom: '2027-01-01', outTo: '2027-01-03', latest: '2027-01-14', minN: 3, maxN: 5, currency: 'EUR' });
  assert.strictEqual(r.itineraries.length, 1);
  assert.deepStrictEqual(Array.from(r.itineraries[0].legs, l => l.to), ['IST', 'FCO', 'NUE']);
});

test('multi-city: the flight home keeps the cheapest other airline in the whole window, and the filter moves the dates', () => {
  const { H } = load('airports.js', 'common.js');
  const prices = { '2027-01-05': { price: 20, src: 'ryanair', airline: 'FR', dep: '2027-01-05T09:00' },
                   '2027-01-06': { price: 70, src: 'tp', airline: 'U2', dep: '2027-01-06T09:00' } };
  const h = H.homeFare(prices, H.parse('2027-01-02'), 3, 5, '2027-01-14');
  assert.deepStrictEqual([h.day, h.airline, h.alt.airline, h.alt.day], ['2027-01-05', 'FR', 'U2', '2027-01-06']);
  const it = { total: 70, start: '2027-01-02', end: '2027-01-05', nights: [3],
    legs: [{ price: 50, airline: 'PC', src: 'tp', dep: '2027-01-02T10:00' }, { price: 20, airline: 'FR', src: 'ryanair', dep: '2027-01-05T09:00', alt: { price: 70, airline: 'U2', src: 'tp', dep: '2027-01-06T09:00' } }] };
  const f = H.filterTrip(it, { noRyanair: true });
  assert.deepStrictEqual([f.total, f.end, Array.from(f.nights)], [120, '2027-01-06', [4]]);
});

test('multi-city "Without Ryanair" searches without Ryanair from the start (no Ryanair requests, no Ryanair legs)', async () => {
  const ok = data => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(data) });
  const urls = [];
  const fetch = url => { urls.push(url); const u = new URL(url), q = u.searchParams;
    if (url.includes('ryanair')) return ok({ fares: [] });
    if (u.pathname === '/tp/health') return ok({ token: true });
    if (u.pathname.endsWith('/prices_for_dates')) return ok({ success: true, data: [
      { origin: q.get('origin'), destination: 'BCN', departure_at: '2027-01-02T10:00:00+01:00', price: 10, airline: 'FR', flight_number: '1', transfers: 0 },
      { origin: q.get('origin'), destination: 'BCN', departure_at: '2027-01-03T10:00:00+01:00', price: 40, airline: 'U2', flight_number: '2', transfers: 0 }] });
    if (u.pathname.endsWith('/grouped_prices')) return ok({ success: true, data: {
      '2027-01-06': { price: 5, airline: 'FR', flight_number: '3', departure_at: '2027-01-06T08:00:00+01:00', transfers: 0 },
      '2027-01-07': { price: 50, airline: 'VY', flight_number: '4', departure_at: '2027-01-07T08:00:00+01:00', transfers: 0 } } });
    return ok({ success: true, data: [] }); };
  const { MLEGS } = load('airports.js', 'common.js', { fetch, URL });
  const ow = await MLEGS.oneWays({ from: 'NUE', outFrom: '2027-01-01', outTo: '2027-01-03', currency: 'EUR', noRy: true }, true);
  assert.deepStrictEqual(Array.from(ow, x => x.airline), ['U2']);
  const pd = await MLEGS.perDay('BCN', 'NUE', ['2027-01-01'], 'EUR', undefined, true);
  assert.deepStrictEqual(Object.keys(pd), ['2027-01-07']);
  assert.ok(!urls.some(u => u.includes('ryanair')), 'no Ryanair requests');
});

test('every page script parses (a broken flights.js would leave the page dead)', () => {
  const fs = require('fs'), vm = require('vm');
  for (const f of fs.readdirSync(path.join(__dirname, '..', 'js')).filter(f => f.endsWith('.js')))
    assert.doesNotThrow(() => new vm.Script(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), { filename: f }), f);
});
