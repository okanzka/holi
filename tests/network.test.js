/* Searches must never hang: a request that never answers times out, and a newer search cancels the older one. */
const test = require('node:test');
const assert = require('node:assert');
const { load } = require('./load');

// a fetch that never answers unless aborted; counts how many requests were started
function hangingFetch(){
  const f = (url, opts = {}) => { f.calls++; return new Promise((_, reject) => {
    if (opts.signal) opts.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }); }); };
  f.calls = 0; return f;
}

test('a Ryanair request that never answers fails after the timeout instead of hanging', async () => {
  const { RYANAIR, NET } = load('airports.js', 'common.js', { fetch: hangingFetch() });
  assert.ok(NET, 'NET helper exists');
  NET.TIMEOUT = 200;
  const started = Date.now();
  await assert.rejects(RYANAIR.oneWays({ from: 'NUE', outFrom: '2027-01-01', outTo: '2027-01-05', currency: 'EUR' }), /timed out/i);
  assert.ok(Date.now() - started < 2000, 'gave up quickly');
});

test('per-day prices give up on a dead request and return what they have', async () => {
  const { RYANAIR, NET } = load('airports.js', 'common.js', { fetch: hangingFetch() });
  NET.TIMEOUT = 200;
  const r = await RYANAIR.perDay('NUE', 'BCN', ['2027-01-01'], 'EUR');
  assert.deepStrictEqual(Object.keys(r), []);
  assert.strictEqual(r[NET.FAILED], true, 'marked as failed, so the calendar says "try again" instead of "no flight"');
});

test('a newer search cancels the older one, and the old multi-city search stops sending requests', async () => {
  const fetch = hangingFetch();
  const { MULTI, NET } = load('airports.js', 'common.js', { fetch });
  NET.TIMEOUT = 60000;                               // only cancellation can end these requests
  const signal = NET.begin('mc');
  const old = MULTI.search({ from: 'NUE', outFrom: '2027-01-01', outTo: '2027-01-05', latest: '2027-01-12', currency: 'EUR', signal });
  NET.begin('mc');                                   // the user searches again
  await assert.rejects(old, /cancelled/i);
  const sent = fetch.calls;
  await new Promise(r => setTimeout(r, 50));
  assert.strictEqual(fetch.calls, sent, 'no new requests after cancelling');
});
