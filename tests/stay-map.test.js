/* Stay map: places with coordinates go on the map, with their distance to the city centre. */
const test = require('node:test');
const assert = require('node:assert');
const { load } = require('./load');
const server = require('../server.js');

test('coordinates are read from either hotel source and junk is ignored', () => {
  const { STAYS } = load('airports.js', 'common.js', 'stays.js');
  assert.deepStrictEqual(Array.from(STAYS.ll({ gps: { latitude: 41.38, longitude: 2.17 } })), [41.38, 2.17]);
  assert.deepStrictEqual(Array.from(STAYS.ll({ gps: { latitude: '38.72', longitude: '-9.14' } })), [38.72, -9.14]);
  assert.strictEqual(STAYS.ll({ gps: null }), null);
  assert.strictEqual(STAYS.ll({}), null);
  assert.strictEqual(STAYS.ll({ gps: { latitude: 120, longitude: 2 } }), null);
  assert.strictEqual(STAYS.ll({ gps: { latitude: 'x', longitude: 2 } }), null);
  assert.strictEqual(STAYS.ll({ gps: { latitude: 0, longitude: 0 } }), null);        // "null island" is a missing value
});

test('distance to the centre is in km', () => {
  const { STAYS } = load('airports.js', 'common.js', 'stays.js');
  assert.equal(STAYS.km([41.3874, 2.1686], [41.3874, 2.1686]), 0);
  const d = STAYS.km([41.3874, 2.1686], [41.4036, 2.1744]);                          // Plaça de Catalunya → Sagrada Família
  assert.ok(d > 1.7 && d < 2.0, d);
});

test('without a known centre, the middle of the places is used', () => {
  const { STAYS } = load('airports.js', 'common.js', 'stays.js');
  const g = (a, b) => ({ gps: { latitude: a, longitude: b } });
  assert.deepStrictEqual(Array.from(STAYS.mid([g(41.0, 2.0), g(41.2, 2.2), g(41.4, 2.4), g(45, 9), {}])), [41.3, 2.3]);
  assert.strictEqual(STAYS.mid([{}, { gps: null }]), null);
});

test('the server finds a city centre and refuses bad requests', async () => {
  const real = global.fetch, asked = [];
  global.fetch = async (url) => { asked.push(String(url)); return { json: async () => [{ lat: '41.3828', lon: '2.1769' }] }; };
  try {
    const r = await server.cityGeo(new URLSearchParams({ q: 'Barcelona' }));
    assert.equal(r.status, 200);
    assert.deepStrictEqual(JSON.parse(r.body), { ok: true, lat: 41.3828, lon: 2.1769 });
    assert.match(asked[0], /^https:\/\/nominatim\.openstreetmap\.org\/search\?/);
    await server.cityGeo(new URLSearchParams({ q: 'barcelona ' }));                  // cached: no second request
    assert.equal(asked.length, 1);
    assert.equal((await server.cityGeo(new URLSearchParams({ q: '' }))).status, 400);
    global.fetch = async () => ({ json: async () => [] });
    assert.deepStrictEqual(JSON.parse((await server.cityGeo(new URLSearchParams({ q: 'Nowhereville' }))).body), { ok: true, lat: null, lon: null });
  } finally { global.fetch = real; }
});
