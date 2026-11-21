/* Flights page: each tab (round trip, multi-city, meet up, my flights…) keeps its own search. */
const test = require('node:test');
const assert = require('node:assert');
const { load } = require('./load');

const store = () => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };
const later = n => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

test('a tab gets back its own search after another tab was used', () => {
  const { TABS } = load('airports.js', 'common.js', { localStorage: store() });
  TABS.save('rt', { from: 'NUE', to: 'IST', start: later(10), end: later(15), flex: 1, adults: 3 });
  TABS.save('meet', { from: 'NUE', to: 'ANY', meetFrom: 'BER', start: later(20), end: later(23), flex: 2 });
  const rt = TABS.patch('rt');
  assert.strictEqual(rt.to, 'IST');
  assert.strictEqual(rt.start, later(10));
  assert.strictEqual(rt.flex, 1);
  assert.ok(!('adults' in rt));                       // people, cabin, currency stay shared
  assert.strictEqual(TABS.patch('meet').meetFrom, 'BER');
});

test('a tab never used shows the defaults', () => {
  const { TABS } = load('airports.js', 'common.js', { localStorage: store() });
  TABS.save('rt', { from: 'IST', to: 'FCO', start: later(10), end: later(15), flex: 0 });
  const p = TABS.patch('legs');
  assert.strictEqual(p.from, 'NUE');
  assert.strictEqual(p.to, 'ANY');
  assert.strictEqual(p.flex, 2);
  assert.strictEqual(p.start, later(30));
  assert.strictEqual(p.end, later(37));
  assert.strictEqual(p.legs.length, 0);
});

test('saved dates that have passed move on, keeping the trip length', () => {
  const { TABS } = load('airports.js', 'common.js', { localStorage: store() });
  TABS.save('rt', { from: 'NUE', to: 'IST', start: '2020-01-01', end: '2020-01-05', flex: 1 });
  const p = TABS.patch('rt');
  assert.strictEqual(p.start, later(7));
  assert.strictEqual(p.end, later(11));
});
