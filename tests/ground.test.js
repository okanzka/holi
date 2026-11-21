/* Buses (FlixBus) and trains (Transitous): turning their answers into rides. */
const test = require('node:test');
const assert = require('node:assert');
const { load } = require('./load');

const flixAnswer = {
  stations: { s1: { name: 'Berlin ZOB' }, s2: { name: 'Munich ZOB' } },
  trips: [{ results: {
    a: { status: 'available', departure: { date: '2026-12-12T07:40:00+01:00', station_id: 's1' }, arrival: { date: '2026-12-12T14:10:00+01:00', station_id: 's2' },
      duration: { hours: 6, minutes: 30 }, price: { total: 37.99, total_with_platform_fee: 38.98 }, available: { seats: 12 }, legs: [{ means_of_transport: 'bus' }] },
    b: { status: 'available', departure: { date: '2026-12-12T00:15:00+01:00', station_id: 's1' }, arrival: { date: '2026-12-12T09:55:00+01:00', station_id: 's2' },
      duration: { hours: 9, minutes: 40 }, price: { total: 29.5 }, available: { seats: 3 }, legs: [{ means_of_transport: 'bus' }, { means_of_transport: 'train' }] },
    c: { status: 'full', departure: { date: '2026-12-12T09:00:00+01:00' }, arrival: { date: '2026-12-12T15:00:00+01:00' }, price: { total: 5 } },
  } }],
};

test('FlixBus rides: available ones only, cheapest first, with transfers and stations', () => {
  const { FLIX } = load('airports.js', 'common.js');
  const r = FLIX.parse(flixAnswer, { from: 'A', to: 'B', date: '2026-12-12', adults: 2, currency: 'EUR' });
  assert.strictEqual(r.length, 2);
  assert.strictEqual(r[0].price, 29.5);
  assert.strictEqual(r[0].transfers, 1);
  assert.strictEqual(r[0].modes.join(), 'bus,train');
  assert.strictEqual(r[1].mins, 390);
  assert.strictEqual(r[1].price, 38.98);                // what you pay, platform fee included
  assert.strictEqual(r[1].fromSt, 'Berlin ZOB');
  assert.match(r[0].url, /departureCity=A&arrivalCity=B&rideDate=12.12.2026&adult=2/);
});

test('FlixBus: an empty or broken answer gives no rides', () => {
  const { FLIX } = load('airports.js', 'common.js');
  assert.strictEqual(FLIX.parse(null, {}).length, 0);
  assert.strictEqual(FLIX.parse({ trips: [{}] }, {}).length, 0);
});

const leg = (o) => ({ mode: 'HIGHSPEED_RAIL', displayName: 'ICE 1162', from: { name: 'Nürnberg Hbf' }, to: { name: 'Berlin Hbf' },
  startTime: '2026-12-12T08:01:00Z', endTime: '2026-12-12T10:48:00Z', agencyName: 'DB Fernverkehr AG', agencyUrl: 'https://www.bahn.de', ...o });

test('Transitous trips: walking left out, duration in minutes', () => {
  const { TRANSIT } = load('airports.js', 'common.js');
  const r = TRANSIT.parse({ itineraries: [
    { startTime: '2026-12-12T07:55:00Z', endTime: '2026-12-12T10:48:00Z', duration: 10380, transfers: 0, legs: [{ mode: 'WALK' }, leg()] },
    { startTime: 'x', endTime: 'y', duration: 60, legs: [{ mode: 'WALK' }] } ] });
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].mins, 173);
  assert.strictEqual(r[0].legs.length, 1);
  assert.strictEqual(r[0].legs[0].name, 'ICE 1162');
});

test('train booking: DB trips go to bahn.de with the stations, others to the operator', () => {
  const { TRANSIT } = load('airports.js', 'common.js');
  const db = TRANSIT.parse({ itineraries: [{ startTime: '2026-12-12T08:01:00Z', endTime: 'e', duration: 1, legs: [leg()] }] })[0];
  assert.match(TRANSIT.bookUrl(db), /^https:\/\/www\.bahn\.de\/buchung\/fahrplan\/suche#.*so=N%C3%BCrnberg\+Hbf/);
  const obb = TRANSIT.parse({ itineraries: [{ startTime: 's', endTime: 'e', duration: 1, legs: [leg({ agencyName: 'ÖBB', agencyUrl: 'https://www.oebb.at' })] }] })[0];
  assert.strictEqual(TRANSIT.bookUrl(obb), 'https://www.oebb.at');
});

test('FlixBus reachable places: the price range in the asked currency, and whether a train goes there', () => {
  const { FLIX } = load('airports.js', 'common.js');
  const r = FLIX.parseReachable({ result: [
    { uuid: 'p', name: 'Prague', country: 'CZ', min_duration: 270.4, transportation_category: ['bus', 'train'], price: { EUR: { min: 14.48, avg: 20 } } },
    { uuid: 'x', name: 'Nowhere', country: 'DE', price: {} },
  ] }, 'EUR');
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].min, 14.48);
  assert.strictEqual(r[0].mins, 270);
  assert.ok(r[0].train && r[0].bus);
});
