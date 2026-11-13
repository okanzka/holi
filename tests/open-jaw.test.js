/* A → ? → last stop → B: the last flight goes to B instead of back to A. */
const test = require('node:test');
const assert = require('node:assert');
const { load } = require('./load');

const ok = data => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(data) });
const row = (o, d, day, price) => ({ origin: o, destination: d, departure_at: `2027-01-${day}T10:00:00+01:00`, price, airline: 'PC', flight_number: '1', transfers: 0 });
function fakeFetch(asked, backFrom, backTo){
  const rows = { NUE: [row('NUE', 'IST', '02', 50)], IST: [row('IST', 'FCO', '05', 30)] };
  return url => { const u = new URL(url), q = u.searchParams;
    if (url.includes('ryanair')) return ok(url.includes('cheapestPerDay') ? { outbound: { fares: [] } } : { fares: [] });
    if (u.pathname === '/tp/health') return ok({ token: true });
    if (u.pathname.endsWith('/prices_for_dates') && !q.get('departure_at').slice(8)) return ok({ success: true, data: rows[q.get('origin')] || [] });
    if (u.pathname.endsWith('/grouped_prices')) { asked.push(q.get('origin') + '>' + q.get('destination'));
      if (q.get('origin') === backFrom && q.get('destination') === backTo)
        return ok({ success: true, data: { '2027-01-09': { price: 60, airline: 'U2', flight_number: '2', departure_at: '2027-01-09T08:00:00+01:00', transfers: 0 } } }); }
    return ok({ success: true, data: [] }); };
}
const opts = { from: 'NUE', last: 'FCO', stops: 1, outFrom: '2027-01-01', outTo: '2027-01-03', latest: '2027-01-14', minN: 3, maxN: 5, currency: 'EUR' };

test('open jaw: the trip ends at B, not back home', async () => {
  const asked = [];
  const { MULTI } = load('airports.js', 'common.js', { fetch: fakeFetch(asked, 'FCO', 'BCN'), URL });
  const r = await MULTI.viaLoop({ ...opts, end: 'BCN' });
  assert.strictEqual(r.itineraries.length, 1);
  assert.deepStrictEqual(Array.from(r.itineraries[0].legs, l => l.to), ['IST', 'FCO', 'BCN']);
  assert.strictEqual(r.itineraries[0].total, 140);
  assert.ok(!asked.includes('FCO>NUE'), 'no flight home is looked up');
});

test('open jaw: no flight from the last stop to B says so', async () => {
  const { MULTI } = load('airports.js', 'common.js', { fetch: fakeFetch([], 'FCO', 'NUE'), URL });
  const r = await MULTI.viaLoop({ ...opts, end: 'BCN' });
  assert.strictEqual(r.itineraries.length, 0);
  assert.match(r.note, /Barcelona/);
});

test('without B the route still flies home', async () => {
  const { MULTI } = load('airports.js', 'common.js', { fetch: fakeFetch([], 'FCO', 'NUE'), URL });
  const r = await MULTI.viaLoop(opts);
  assert.deepStrictEqual(Array.from(r.itineraries[0].legs, l => l.to), ['IST', 'FCO', 'NUE']);
});
