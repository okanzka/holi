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

test('Book opens the site with the cheapest price, for this place and these dates', () => {
  const { STAYS } = load('airports.js', 'common.js', 'stays.js');
  const o = { city: 'Lisbon', ci: '2027-03-01', co: '2027-03-04', adults: 2, children: 0, rooms: 1 };
  const agoda = STAYS.book({ name: 'Cheap Inn', source: 'Agoda.com' }, o);
  assert.equal(agoda.site, 'Agoda');
  assert.match(agoda.url, /^https:\/\/www\.agoda\.com\/search\?textToSearch=Cheap%20Inn%2C%20Lisbon&checkIn=2027-03-01&los=3&rooms=1&adults=2/);
  const exp = STAYS.book({ name: 'Mid Hotel', source: 'Expedia' }, o);
  assert.equal(exp.site, 'Expedia');
  assert.match(exp.url, /destination=Mid%20Hotel%2C%20Lisbon&startDate=2027-03-01&endDate=2027-03-04/);
  // an unknown or missing source falls back to Booking.com, still with the place and dates
  for (const source of ['Trip.com', null]) {
    const b = STAYS.book({ name: 'Posh Palace', source }, o);
    assert.equal(b.site, 'Booking.com');
    assert.match(b.url, /ss=Posh%20Palace%2C%20Lisbon&checkin=2027-03-01&checkout=2027-03-04&group_adults=2/);
  }
});
