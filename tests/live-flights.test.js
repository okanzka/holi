/* Live flight prices for every airline (Google Flights through SerpApi): one search per date pair, key never leaves the server. */
const test = require('node:test');
const assert = require('node:assert');
const { flightLive, serpUsage } = require('../server.js');

const SAMPLE = {
  search_metadata: { google_flights_url: 'https://www.google.com/travel/flights?x=1' },
  best_flights: [{ price: 89, total_duration: 150, type: 'Round trip',
    flights: [{ airline: 'Wizz Air', flight_number: 'W6 2302', airline_logo: 'https://logo/w6.png', duration: 150,
      departure_airport: { id: 'NUE', time: '2027-01-10 06:05' }, arrival_airport: { id: 'BUD', time: '2027-01-10 07:15' } }] }],
  other_flights: [{ price: 140, total_duration: 300, type: 'Round trip',
    flights: [{ airline: 'Lufthansa', flight_number: 'LH 1', duration: 60, departure_airport: { id: 'NUE', time: '2027-01-10 07:00' }, arrival_airport: { id: 'FRA', time: '2027-01-10 08:00' } },
              { airline: 'Lufthansa', flight_number: 'LH 2', duration: 80, departure_airport: { id: 'FRA', time: '2027-01-10 10:00' }, arrival_airport: { id: 'BUD', time: '2027-01-10 11:20' } }] }],
  price_insights: { lowest_price: 89, price_level: 'low', typical_price_range: [90, 160] },
};

function mockFetch(body, status = 200){
  const f = async url => { f.urls.push(String(url)); return { ok: status === 200, status, json: async () => body }; };
  f.urls = []; return f;
}
const q = o => new URLSearchParams({ from: 'NUE', to: 'BUD', dep: '2027-01-10', ret: '2027-01-14', adults: '2', currency: 'EUR', ...o });

test('live search returns every airline, sorted by price, and never leaks the key', async () => {
  process.env.SERPAPI_KEY = 'secret-key';
  global.fetch = mockFetch(SAMPLE);
  const r = await flightLive(q());
  assert.equal(r.status, 200);
  assert.ok(!r.body.includes('secret-key'), 'key not in the reply');
  const j = JSON.parse(r.body);
  assert.deepStrictEqual(j.flights.map(f => f.price), [89, 140]);
  assert.deepStrictEqual(j.flights[0].airlines, ['Wizz Air']);
  assert.equal(j.flights[1].stops, 1);
  assert.equal(j.flights[0].legs[0].no, 'W6 2302');
  assert.equal(j.link, 'https://www.google.com/travel/flights?x=1');
  assert.equal(j.level, 'low');
  const u = new URL(global.fetch.urls[0]);
  assert.equal(u.searchParams.get('engine'), 'google_flights');
  assert.equal(u.searchParams.get('type'), '1');                 // round trip
  assert.equal(u.searchParams.get('return_date'), '2027-01-14');
  assert.equal(u.searchParams.get('adults'), '2');
});

test('the same live search within the hour does not use the quota again', async () => {
  process.env.SERPAPI_KEY = 'secret-key';
  global.fetch = mockFetch(SAMPLE);
  await flightLive(q({ dep: '2027-02-01', ret: '' }));
  await flightLive(q({ dep: '2027-02-01', ret: '' }));
  assert.equal(global.fetch.urls.length, 1);
  assert.equal(new URL(global.fetch.urls[0]).searchParams.get('type'), '2');   // one way
});

test('bad input is refused before calling SerpApi', async () => {
  global.fetch = mockFetch(SAMPLE);
  process.env.SERPAPI_KEY = 'secret-key';
  assert.equal((await flightLive(q({ from: 'C:DE' }))).status, 400);
  assert.equal((await flightLive(q({ dep: 'tomorrow' }))).status, 400);
  assert.equal((await flightLive(q({ ret: '2027-01-01' }))).status, 400);   // return before departure
  assert.equal(global.fetch.urls.length, 0);
});

test('quota counter reads the account page (which is free) and hides the key', async () => {
  process.env.SERPAPI_KEY = 'secret-key';
  global.fetch = mockFetch({ searches_per_month: 100, this_month_usage: 23, plan_searches_left: 77, total_searches_left: 77, api_key: 'secret-key' });
  const r = await serpUsage();
  assert.ok(!r.body.includes('secret-key'));
  assert.deepStrictEqual(JSON.parse(r.body), { ok: true, used: 23, limit: 100, left: 77 });
  assert.ok(global.fetch.urls[0].startsWith('https://serpapi.com/account.json'));
});
