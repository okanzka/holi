const test = require('node:test');
const assert = require('node:assert');
const { load } = require('./load');
const { H, AP, AIRLINES } = load('airports.js', 'common.js');

const first = q => AP.search(q, 5)[0]?.code;
const codes = q => AP.search(q, 8).map(a => a.code);

test('city names are the city people travel to, not the airport village', () => {
  const want = { BNX: 'Banja Luka', MXP: 'Milan', BGY: 'Bergamo', TIA: 'Tirana', SAW: 'Istanbul', CDG: 'Paris',
    ORY: 'Paris', LYS: 'Lyon', NCE: 'Nice', VCE: 'Venice', ATH: 'Athens', KRK: 'Krakow', MLA: 'Malta', FLR: 'Florence', ADB: 'Izmir', FRA: 'Frankfurt', LJU: 'Ljubljana' };
  for (const [code, city] of Object.entries(want)) assert.strictEqual(H.cityOf(code), city, code);
});

test('city clean-up keeps accents and the full Palma de Mallorca', () => {
  assert.strictEqual(H.cityOf('AGP'), 'Málaga');
  assert.strictEqual(H.cityOf('GDN'), 'Gdańsk');
  assert.strictEqual(H.cityOf('PMI'), 'Palma de Mallorca');
  assert.strictEqual(H.cityOf('QSR'), 'Salerno');
  assert.strictEqual(H.cityOf('KSC'), 'Košice');
});

test('autocomplete puts the obvious city first', () => {
  assert.strictEqual(first('Palma'), 'PMI');
  assert.strictEqual(first('Kos'), 'KGS');
  assert.strictEqual(first('Venice'), 'VCE');
  assert.strictEqual(first('Lyon'), 'LYS');
  assert.strictEqual(first('Tirana'), 'TIA');
  assert.strictEqual(first('Nador'), 'NDR');
  assert.strictEqual(first('Antalya'), 'AYT');
  assert.strictEqual(first('NUE'), 'NUE');
  assert.strictEqual(first('Frankfurt'), 'FRA');
  assert.strictEqual(first('Izmir'), 'ADB');
  assert.ok(codes('Milan').slice(0, 3).includes('MXP'));
});

test('old airport place names still find the airport', () => {
  assert.ok(codes('Pendik').includes('SAW'));
  assert.ok(codes('Valletta').includes('MLA'));
  assert.ok(codes('Orio al Serio').includes('BGY'));
});

test('common airlines have names', () => {
  for (const c of ['EY', 'UX']) assert.ok(AIRLINES[c], c);
});
