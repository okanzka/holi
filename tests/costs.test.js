/* Total trip cost: buses, trains and other costs saved next to the flights and stays. */
const test = require('node:test');
const assert = require('node:assert');
const { load } = require('./load');

const store = () => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };

test('costs add up for everyone; per-person prices count each traveller; other currencies stay out', () => {
  const { COSTS } = load('airports.js', 'common.js', { localStorage: store() });
  COSTS.add({ kind: 'bus', title: 'Berlin → Munich', price: 80.97, cur: 'EUR' });            // FlixBus: all passengers
  COSTS.add({ kind: 'train', title: 'FlixTrain', price: 19.99, cur: 'EUR', pp: true });     // per person
  COSTS.add({ kind: 'other', title: 'Airport taxi', price: 30, cur: 'GBP' });
  const s = COSTS.sum('EUR', 2);
  assert.strictEqual(s.total, 120.95);
  assert.deepStrictEqual(Array.from(s.other, c => c.title), ['Airport taxi']);
  assert.strictEqual(s.items.length, 3);
});

test('a bad price is refused, and a cost can be removed', () => {
  const { COSTS } = load('airports.js', 'common.js', { localStorage: store() });
  assert.strictEqual(COSTS.add({ title: 'x', price: 'abc', cur: 'EUR' }), null);
  assert.strictEqual(COSTS.add({ title: 'x', price: -5, cur: 'EUR' }), null);
  const id = COSTS.add({ title: '  Ferry  ', price: '12,50', cur: 'EUR' });
  assert.ok(id);
  assert.strictEqual(COSTS.list()[0].title, 'Ferry');
  assert.strictEqual(COSTS.list()[0].price, 12.5);
  COSTS.remove(id);
  assert.strictEqual(COSTS.list().length, 0);
});
