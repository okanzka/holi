/* Iberia and Air Europa have no public fare API: their buttons open Google Flights showing only their flights. */
const test = require('node:test');
const assert = require('node:assert');
const { load } = require('./load');

test('Iberia and Air Europa are booking sites limited to their own flights', () => {
  const { FLIGHT_SITES } = load('airports.js', 'common.js');
  const o = { from: 'MAD', to: 'BCN', dep: '2027-02-10', ret: '2027-02-17', adults: 2, children: 0, cabin: 'economy' };
  for (const name of ['Iberia', 'Air Europa']) {
    const s = FLIGHT_SITES.find(x => x.name === name);
    assert.ok(s, name + ' is listed');
    const q = decodeURIComponent(new URL(s.url(o)).searchParams.get('q'));
    assert.match(q, /from MAD to BCN on 2027-02-10 through 2027-02-17/);
    assert.ok(q.endsWith(' on ' + name), q);
  }
  // the plain Google Flights link is unchanged (no airline)
  assert.doesNotMatch(decodeURIComponent(FLIGHT_SITES[0].url(o)), / on (Iberia|Air Europa)/);
});
