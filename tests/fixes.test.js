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
