/* My flights: direct flights the user picked (not always connected), best dates as one trip. */
const test = require('node:test');
const assert = require('node:assert');
const { load } = require('./load');

const map = o => Object.fromEntries(Object.entries(o).map(([d, p]) => [d, { price: p, cur: 'EUR' }]));
const trip = { start: '2027-05-01', end: '2027-05-09', flex: 1 };

test('first flight leaves around start, last one around end, the middle one anywhere between', () => {
  const { LEGS } = load('airports.js', 'common.js');
  const w = LEGS.windows([{}, {}, {}], trip);
  assert.strictEqual(w[0].allowed.join(), '2027-04-30,2027-05-01,2027-05-02');
  assert.strictEqual(w[2].allowed.join(), '2027-05-08,2027-05-09,2027-05-10');
  assert.strictEqual(w[1].allowed.length, 11);
  assert.strictEqual(w[1].target, '2027-05-05');
});

test('a flight with its own day stays within ±flex of it', () => {
  const { LEGS } = load('airports.js', 'common.js');
  const w = LEGS.windows([{}, { day: '2027-05-04' }], trip);
  assert.strictEqual(w[1].allowed.join(), '2027-05-03,2027-05-04,2027-05-05');
});

test('the cheapest plan keeps the order and the nights between flights', () => {
  const { LEGS } = load('airports.js', 'common.js');
  const w = LEGS.windows([{}, {}, {}], trip);
  const maps = [map({ '2027-05-02': 20 }), map({ '2027-05-02': 5, '2027-05-03': 9, '2027-05-06': 30 }), map({ '2027-05-08': 40 })];
  const p = LEGS.plan(maps, w, 1, 0);
  assert.strictEqual(p.map(x => x.day).join(), '2027-05-02,2027-05-03,2027-05-08');   // 05-02 for flight 2 would leave no night
  assert.strictEqual(LEGS.plan(maps, w, 0, 0)[1].day, '2027-05-02');
  assert.strictEqual(LEGS.plan(maps, w, 7, 0), null);
});

test('packages: cheapest first, then evenly spaced ones, no duplicates', () => {
  const { LEGS } = load('airports.js', 'common.js');
  const w = LEGS.windows([{}, {}, {}], trip);
  const maps = [map({ '2027-05-01': 20 }), map({ '2027-05-02': 10, '2027-05-05': 30 }), map({ '2027-05-09': 40 })];
  const ps = LEGS.packages(maps, w, 1);
  assert.strictEqual(ps[0].label, 'Cheapest');
  assert.strictEqual(ps[0].total, 70);
  assert.ok(ps.some(p => p.flights[1].day === '2027-05-05'));
  assert.strictEqual(new Set(ps.map(p => p.flights.map(f => f.day).join())).size, ps.length);
});

test('search names the flights with no direct fare instead of building a trip', async () => {
  const ok = data => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(data) });
  const fetch = url => { const m = url.match(/oneWayFares\/(\w+)\/(\w+)\/cheapestPerDay/);
    if (m && m[1] === 'NUE') return ok({ outbound: { fares: [{ day: '2027-05-01', price: { value: 30, currencyCode: 'EUR' }, departureDate: '2027-05-01T09:00:00' }] } });
    return ok(m ? { outbound: { fares: [] } } : {}); };
  const { LEGS } = load('airports.js', 'common.js', { fetch, URL });
  const r = await LEGS.search({ legs: [{ from: 'NUE', to: 'BCN' }, { from: 'MAD', to: 'NUE' }], ...trip, gap: 1, currency: 'EUR' });
  assert.strictEqual(r.packages.length, 0);
  assert.strictEqual(r.missing.join(), '1');
});
