/* Hotels page: live results for any city, cut to the nightly budget. */
const test = require('node:test');
const assert = require('node:assert');
const { load } = require('./load');

const P = [
  { name: 'Cheap Inn', type: 'Hotel', night: 60, rating: 4.1 },
  { name: 'Mid Hotel', type: 'Hotel', night: 120, rating: 4.4 },
  { name: 'Posh Palace', type: 'Hotel', night: 300, rating: 4.8 },
  { name: 'No Rate Hotel', type: 'Hotel', night: null, rating: 4.6 },
];

test('live list is cheapest first, unpriced places last', () => {
  const { STAYS } = load('airports.js', 'common.js', 'stays.js');
  const L = STAYS.live(P, 3, '');
  assert.deepStrictEqual(Array.from(L, p => p.name), ['Cheap Inn', 'Mid Hotel', 'Posh Palace', 'No Rate Hotel']);
  assert.equal(L[0].tot, 180);
});

test('a max per night drops places above it but keeps unpriced ones', () => {
  const { STAYS } = load('airports.js', 'common.js', 'stays.js');
  assert.deepStrictEqual(Array.from(STAYS.live(P, 2, '150'), p => p.name), ['Cheap Inn', 'Mid Hotel', 'No Rate Hotel']);
});

test('nothing in, nothing out', () => {
  const { STAYS } = load('airports.js', 'common.js', 'stays.js');
  assert.deepStrictEqual(Array.from(STAYS.live([], 2, '')), []);
  assert.deepStrictEqual(Array.from(STAYS.live(null, 2, '100')), []);
});
