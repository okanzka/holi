/* Meet-up: you and a friend fly from two cities to one place, then each flies home. */
const test = require('node:test');
const assert = require('node:assert');
const { load } = require('./load');

const fare = p => ({ price: p, cur: 'EUR' });
const map = o => Object.fromEntries(Object.entries(o).map(([d, p]) => [d, fare(p)]));
const win = { start: '2027-03-10', end: '2027-03-14', flex: 2 };

test('same arrival and return days come first, even when a split plan is cheaper', () => {
  const { MEET } = load('airports.js', 'common.js');
  const aOut = map({ '2027-03-10': 50 }), aBack = map({ '2027-03-14': 50 });
  const bOut = map({ '2027-03-10': 90, '2027-03-11': 20 }), bBack = map({ '2027-03-14': 40 });
  const r = MEET.combos(aOut, aBack, bOut, bBack, win);
  assert.strictEqual(r[0].gap, 0);
  assert.strictEqual(r[0].total, 230);
  assert.strictEqual(r[1].gapOut, 1);   // friend lands a day later
  assert.strictEqual(r[1].total, 160);
});

test('gaps beyond the flexibility and plans with no night together are left out', () => {
  const { MEET } = load('airports.js', 'common.js');
  const aOut = map({ '2027-03-10': 10 }), aBack = map({ '2027-03-11': 10 });
  const bOut = map({ '2027-03-11': 10 }), bBack = map({ '2027-03-12': 10 });
  assert.strictEqual(MEET.combos(aOut, aBack, bOut, bBack, { start: "2027-03-10", end: "2027-03-11", flex: 1 }).length, 0);
  assert.strictEqual(MEET.combos(map({ '2027-03-10': 1 }), map({ '2027-03-14': 1 }), map({ '2027-03-12': 1 }), map({ '2027-03-14': 1 }),
    { ...win, flex: 1 }).length, 0);   // friend 2 days later, only ±1 allowed
});

test('days before today are skipped', () => {
  const { MEET } = load('airports.js', 'common.js');
  const r = MEET.combos(map({ '2027-03-09': 1, '2027-03-10': 5 }), map({ '2027-03-14': 1 }), map({ '2027-03-10': 1 }), map({ '2027-03-14': 1 }),
    { ...win, today: '2027-03-10' });
  assert.ok(r.every(c => c.a.out.day >= '2027-03-10'));
});

test('search to a fixed city asks all four legs and returns same-day plans first', async () => {
  const asked = [];
  const ok = data => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(data) });
  const fares = { 'NUE-BCN': { '2027-03-10': 40 }, 'BCN-NUE': { '2027-03-14': 45 }, 'BER-BCN': { '2027-03-10': 60, '2027-03-11': 30 }, 'BCN-BER': { '2027-03-14': 55 } };
  const fetch = url => { const m = url.match(/oneWayFares\/(\w+)\/(\w+)\/cheapestPerDay/);
    if (m) { asked.push(m[1] + '-' + m[2]); const f = fares[m[1] + '-' + m[2]] || {};
      return ok({ outbound: { fares: Object.entries(f).map(([day, v]) => ({ day, price: { value: v, currencyCode: 'EUR' }, departureDate: day + 'T09:00:00' })) } }); }
    return ok({}); };
  const { MEET } = load('airports.js', 'common.js', { fetch, URL });
  const r = await MEET.search({ a: 'NUE', b: 'BER', to: 'BCN', start: '2027-03-10', end: '2027-03-14', flex: 1, currency: 'EUR' });
  assert.deepStrictEqual([...new Set(asked)].sort(), ['BCN-BER', 'BCN-NUE', 'BER-BCN', 'NUE-BCN']);
  assert.strictEqual(r.results[0].gap, 0);
  assert.strictEqual(r.results[0].total, 200);
  assert.strictEqual(r.results[0].dest, 'BCN');
  assert.ok(r.results.some(c => c.gapOut === 1 && c.total === 170));
});
