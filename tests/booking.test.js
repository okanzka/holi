/* Booking: every flight and stay of a planned trip gets a link, and "Book all" opens them together. */
const test = require('node:test');
const assert = require('node:assert');
const { load } = require('./load');

const plan = () => ({
  cities: [
    { code: 'BCN', city: 'Barcelona', cc: 'ES', ci: '2027-03-01', co: '2027-03-04', nights: 3 },
    { code: 'LIS', city: 'Lisbon', cc: 'PT', ci: '2027-03-04', co: '2027-03-06', nights: 2 },
    { code: 'OPO', city: 'Porto', cc: 'PT', ci: '2027-03-06', co: '2027-03-07', nights: 1 },
  ],
  flights: [
    { from: 'NUE', to: 'BCN', dep: '2027-03-01', url: 'https://www.ryanair.com/x' },
    { from: 'BCN', to: 'LIS', dep: '2027-03-04', url: 'javascript:alert(1)' },          // unsafe link is dropped
    { from: 'OPO', to: 'NUE', dep: '2027-03-07', url: 'https://www.google.com/travel/flights?q=y' },
  ],
  picks: [
    { name: 'Casa Bonita', total: 300, link: 'https://hotel.example/casa' },
    { name: 'Lisbon Lodge', total: 120, link: '' },                                    // no link: Booking search by name
    { name: 'No booking needed', total: 0 },                                           // skipped city
  ],
  adults: 2, children: 1,
});

test('a trip plan lists each flight and each stay to book, with safe links', () => {
  const { STAYS } = load('airports.js', 'common.js', 'stays.js');
  const L = STAYS.bookItems(plan());
  assert.deepStrictEqual(Array.from(L, x => x.key), ['f0', 'f2', 's0', 's1']);
  assert.deepStrictEqual(Array.from(L, x => x.kind), ['flight', 'flight', 'stay', 'stay']);
  assert.equal(L[0].url, 'https://www.ryanair.com/x');
  assert.equal(L[2].url, 'https://hotel.example/casa');
  const u = new URL(L[3].url);
  assert.equal(u.hostname, 'www.booking.com');
  assert.equal(u.searchParams.get('ss'), 'Lisbon Lodge Lisbon');
  assert.equal(u.searchParams.get('checkin'), '2027-03-04');
  assert.equal(u.searchParams.get('checkout'), '2027-03-06');
  assert.equal(u.searchParams.get('group_adults'), '2');
  assert.equal(u.searchParams.get('group_children'), '1');
});

test('an older plan without flights still lists its stays', () => {
  const { STAYS } = load('airports.js', 'common.js', 'stays.js');
  const p = plan(); delete p.flights;
  assert.deepStrictEqual(Array.from(STAYS.bookItems(p), x => x.key), ['s0', 's1']);
});

test('opening several links reports how many the browser blocked', () => {
  const opened = [];
  const window = { open: (u) => { opened.push(u); return opened.length === 2 ? null : {}; } };
  const { H } = load('airports.js', 'common.js', { window });
  assert.equal(H.openLinks(['https://a.example', 'https://b.example', 'https://c.example']), 1);
  assert.deepStrictEqual(opened, ['https://a.example', 'https://b.example', 'https://c.example']);
  assert.equal(H.openLinks(['javascript:alert(1)']), 0);
  assert.equal(opened.length, 3);                                                      // unsafe link never opened
});
