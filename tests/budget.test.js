/* Trip budget in Anywhere mode: flight + stay as one total, live stay prices with an honest estimate as fallback. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { hotelFree } = require('../server.js');

const BUDGET = (() => { const ctx = vm.createContext({ Math });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'budget.js'), 'utf8') + '\n;this.B=BUDGET;', ctx); return ctx.B; })();

test('estimate is per night in EUR only, with a default for unknown countries', () => {
  assert.equal(BUDGET.estimate('ES', 'EUR'), BUDGET.NIGHT.ES);
  assert.equal(BUDGET.estimate('ZZ', 'EUR'), BUDGET.DEFAULT);
  assert.equal(BUDGET.estimate('ES', 'GBP'), null);          // no exchange rates: no made-up price
});

test('rooms: at least the rooms asked for, two adults per room', () => {
  assert.equal(BUDGET.rooms({ adults: 2, rooms: 1 }), 1);
  assert.equal(BUDGET.rooms({ adults: 3, rooms: 1 }), 2);
  assert.equal(BUDGET.rooms({ adults: 1, rooms: 2 }), 2);
});

test('nights: the round trip length, else the planned stay', () => {
  assert.equal(BUDGET.nights({ nights: 4 }, { start: '2027-03-01', end: '2027-03-08' }), 4);
  assert.equal(BUDGET.nights({ nights: null }, { start: '2027-03-01', end: '2027-03-08' }), 7);
  assert.equal(BUDGET.nights({ nights: null }, { start: '2027-03-01', end: '2027-03-08', minNights: 3 }), 3);
});

test('trip total = flight for everyone + night x nights x rooms; no stay price keeps the flight only', () => {
  const t = { adults: 3, rooms: 1, start: '2027-03-01', end: '2027-03-05' };
  assert.deepStrictEqual({ ...BUDGET.total({ total: 300, nights: 4 }, { night: 50 }, t) }, { stay: 400, total: 700, nights: 4 });
  assert.deepStrictEqual({ ...BUDGET.total({ total: 300, nights: 4 }, null, t) }, { stay: null, total: 300, nights: 4 });
});

test('cheapest night ignores places without a price', () => {
  assert.equal(BUDGET.cheapest([{ night: null }, { night: 80 }, { night: 45 }]), 45);
  assert.equal(BUDGET.cheapest([{ night: null }]), null);
});

test('free hotel search can be asked for fewer rate lookups (limit)', async () => {
  const urls = [];
  global.fetch = async url => { url = String(url); urls.push(url); const u = new URL(url);
    const body = u.pathname === '/api/list'
      ? { result: { list: Array.from({ length: 10 }, (_, i) => ({ name: 'H' + i, key: 'k' + i, accommodation_type: 'Hotel', url: 'x' })) } }
      : { result: { rates: [{ name: 'Booking.com', rate: 50 }] } };
    return { ok: true, status: 200, json: async () => body }; };
  const r = await hotelFree(new URLSearchParams({ q: 'Lisbon', ci: '2027-04-10', co: '2027-04-12', currency: 'EUR', limit: '4' }));
  assert.equal(r.status, 200);
  assert.equal(JSON.parse(r.body).properties.length, 4);
  assert.equal(urls.filter(u => u.includes('/api/rates')).length, 4);
});
