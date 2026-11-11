/* Free hotel and hostel prices without a key: Wikidata (city -> TripAdvisor id) + Xotelo (places and their rates). */
const test = require('node:test');
const assert = require('node:assert');
const { load } = require('./load');
const { hotelFree } = require('../server.js');

function fakeWeb(page = 'Coimbra_Coimbra_District'){
  const f = async url => { url = String(url); f.urls.push(url); const u = new URL(url);
    let body = {};
    if (u.searchParams.get('action') === 'wbsearchentities') body = { search: [{ id: 'Q1' }, { id: 'Q597' }] };
    else if (u.searchParams.get('action') === 'wbgetentities') body = { entities: { Q1: { claims: {} },
      Q597: { claims: { P3134: [{ mainsnak: { datavalue: { value: '189158' } } }] } } } };
    else if (u.pathname === '/api/list') body = { error: null, result: { list: [
      { name: 'Grand Hotel', key: 'g189158-d1', accommodation_type: 'Hotel', url: 'https://www.tripadvisor.com/Hotel_Review-g1-d1-Reviews-Name-' + page + '.html?h1', review_summary: { rating: 4.5, count: 900 }, image: 'https://img/1.jpg' },
      { name: 'Sunny Hostel', key: 'g189158-d2', accommodation_type: 'Hostel', url: 'https://www.tripadvisor.com/Hotel_Review-g1-d1-Reviews-Name-' + page + '.html?h2', review_summary: { rating: 4.8, count: 120 } },
      { name: 'No Rates Inn', key: 'g189158-d3', accommodation_type: 'Hotel', url: 'https://www.tripadvisor.com/Hotel_Review-g1-d1-Reviews-Name-' + page + '.html?h3', review_summary: { rating: 4, count: 10 } }] } };
    else if (u.pathname === '/api/rates') body = { error: null, result: { rates: {
      'g189158-d1': [{ name: 'Booking.com', rate: 120, tax: 10 }, { name: 'Agoda.com', rate: 110, tax: null }],
      'g189158-d2': [{ name: 'Trip.com', rate: 30, tax: null }], 'g189158-d3': [] }[u.searchParams.get('hotel_key')] } };
    return { ok: true, status: 200, json: async () => body }; };
  f.urls = []; return f;
}
const q = o => new URLSearchParams({ q: 'Lisbon', ci: '2027-03-10', co: '2027-03-13', adults: '2', currency: 'EUR', ...o });

test('free search finds the city, lists hotels and hostels, and takes the cheapest booking site for each', async () => {
  global.fetch = fakeWeb();
  const r = await hotelFree(q());
  assert.equal(r.status, 200);
  const list = JSON.parse(r.body).properties;
  assert.deepStrictEqual(list.map(x => x.name), ['Sunny Hostel', 'Grand Hotel', 'No Rates Inn']);   // hostels are looked up first
  const p = ['Grand Hotel', 'Sunny Hostel', 'No Rates Inn'].map(n => list.find(x => x.name === n));
  assert.deepStrictEqual([p[0].night, p[0].total, p[0].source], [110, 330, 'Agoda.com']);   // 3 nights, cheapest site
  assert.deepStrictEqual([p[1].night, p[1].total, p[1].type], [30, 90, 'Hostel']);
  assert.equal(p[2].night, null);                                                           // listed, but no price for these dates
  assert.equal(p[0].rating, 4.5);
  assert.ok(global.fetch.urls.some(u => u.includes('location_key=g189158')));
  assert.ok(!global.fetch.urls.some(u => u.includes('wikidata')), 'a well-known city needs no look-up');
});

test('a city outside the built-in list is found through Wikidata, and a namesake elsewhere is not used', async () => {
  global.fetch = fakeWeb();
  const r = await hotelFree(q({ q: 'Coimbra' }));
  assert.equal(JSON.parse(r.body).properties.length, 3);
  assert.ok(global.fetch.urls.some(u => u.includes('wikidata')));
  global.fetch = fakeWeb('Springfield_Illinois');                    // the id found belongs to another place
  assert.deepStrictEqual(JSON.parse((await hotelFree(q({ q: 'Aveiro' }))).body), { ok: true, properties: [] });
});

test('the same free search is answered from memory the second time', async () => {
  global.fetch = fakeWeb();
  await hotelFree(q({ ci: '2027-04-01', co: '2027-04-03' }));
  const n = global.fetch.urls.length;
  await hotelFree(q({ ci: '2027-04-01', co: '2027-04-03' }));
  assert.equal(global.fetch.urls.length, n);
});

test('free search: bad dates are refused, an unknown city gives an empty list', async () => {
  global.fetch = fakeWeb();
  assert.equal((await hotelFree(q({ ci: 'soon' }))).status, 400);
  assert.equal((await hotelFree(q({ co: '2027-03-10' }))).status, 400);                     // no nights
  assert.equal(global.fetch.urls.length, 0);
  global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ search: [] }) });
  const r = await hotelFree(q({ q: 'Nowhereville' }));
  assert.deepStrictEqual(JSON.parse(r.body), { ok: true, properties: [] });
});

test('stay suggestions: both sources are merged, the cheaper price wins, and up to 12 are shown', () => {
  const { STAYS } = load('airports.js', 'common.js', 'stays.js');
  const g = [{ name: 'Grand Hotel', type: 'hotel', night: 100, total: 300, rating: 4.4, image: 'g.jpg', link: 'https://g', source: 'Hotel site' }];
  const x = [{ name: 'GRAND HOTEL ', type: 'Hotel', night: 90, total: 270, rating: 4.5, image: null, link: 'https://ta', source: 'Agoda.com' },
             { name: 'Sunny Hostel', type: 'Hostel', night: 30, total: 90, rating: 4.8 }];
  const m = STAYS.merge(g, x);
  assert.equal(m.length, 2);
  const grand = m.find(p => /grand/i.test(p.name));
  assert.deepStrictEqual([grand.total, grand.source, grand.link, grand.image], [270, 'Agoda.com', 'https://ta', 'g.jpg']);
  const many = Array.from({ length: 30 }, (_, i) => ({ name: 'Hotel ' + i, type: 'hotel', night: 50 + i, total: 150 + 3 * i, rating: 4 }));
  assert.equal(STAYS.pick(many, 'both', 3).length, 12);
  assert.equal(STAYS.pick(many, 'both', 3, 36).length, 30);
  assert.equal(STAYS.pick([...many, ...x], 'hostel', 3).length, 1);
});
