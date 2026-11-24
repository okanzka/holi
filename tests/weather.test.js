/* Weather badges on the destination cards: which days count, forecast vs typical, the summary, and the Open-Meteo calls (faked here). */
const test = require('node:test');
const assert = require('node:assert');
const { load } = require('./load');

const js = v => JSON.parse(JSON.stringify(v));
const TODAY = '2026-11-20';

test('stay days: dep..ret (ret excluded), at least 3 and at most 7', () => {
  const { WX } = load('airports.js', 'common.js', 'weather.js');
  assert.deepStrictEqual(js(WX.stayDays('2027-07-01', '2027-07-03')), ['2027-07-01', '2027-07-02', '2027-07-03']);
  assert.deepStrictEqual(js(WX.stayDays('2027-07-01', '2027-07-06')), ['2027-07-01', '2027-07-02', '2027-07-03', '2027-07-04', '2027-07-05']);
  assert.equal(WX.stayDays('2027-07-01', '2027-07-30').length, 7);
  assert.equal(WX.stayDays('2027-07-01', null).length, 3);          // one way: the first 3 days
});

test('mode: forecast inside 16 days (days past the horizon dropped), climate after', () => {
  const { WX } = load('airports.js', 'common.js', 'weather.js');
  assert.deepStrictEqual(js(WX.plan('2026-11-25', '2026-11-28', TODAY)), { mode: 'f', days: ['2026-11-25', '2026-11-26', '2026-11-27'] });
  assert.deepStrictEqual(js(WX.plan('2026-12-05', '2026-12-10', TODAY)).days, ['2026-12-05']);   // horizon ends 12-05
  assert.equal(WX.plan('2026-12-06', '2026-12-10', TODAY).mode, 'c');
  assert.equal(WX.plan('2026-11-10', '2026-11-12', TODAY), null);  // in the past
});

test('icons: WMO codes for the forecast, rain and cloud for typical days', () => {
  const { WX } = load('airports.js', 'common.js', 'weather.js');
  assert.equal(WX.icon({ c: 0 }), '☀️');
  assert.equal(WX.icon({ c: 2 }), '⛅');
  assert.equal(WX.icon({ c: 61 }), '🌧️');
  assert.equal(WX.icon({ c: 95 }), '⛈️');
  assert.equal(WX.icon({ c: 73 }), '🌨️');
  assert.equal(WX.icon({ p: 0, cl: 5 }), '☀️');
  assert.equal(WX.icon({ p: 0, cl: 50 }), '⛅');
  assert.equal(WX.icon({ p: 0, cl: 90 }), '☁️');
  assert.equal(WX.icon({ p: 6, cl: 90 }), '🌧️');
});

test('summary: average high and the most common icon; nothing when days are missing', () => {
  const { WX } = load('airports.js', 'common.js', 'weather.js');
  const k = d => 'f|BJV|' + d;
  WX.cache.set(k('2026-11-25'), { t: 18.4, c: 1 });
  WX.cache.set(k('2026-11-26'), { t: 20.1, c: 1 });
  WX.cache.set(k('2026-11-27'), { t: 17, c: 61 });
  assert.deepStrictEqual(js(WX.summary('BJV', '2026-11-25', '2026-11-28', TODAY)), { t: 19, i: '☀️', typ: false });
  assert.equal(WX.summary('BJV', '2026-11-25', '2026-11-30', TODAY), null);   // 11-28 and 11-29 not loaded
});

test('badge: filled from the cache, an empty placeholder otherwise, nothing without coordinates', () => {
  const { WX } = load('airports.js', 'common.js', 'weather.js');
  ['2027-07-01', '2027-07-02', '2027-07-03'].forEach(d => WX.cache.set('c|BJV|' + d, { t: 29.2, p: 0, cl: 0 }));
  const d = { dest: 'BJV', dep: '2027-07-01', ret: '2027-07-04' };
  const b = WX.badge(d, TODAY);
  assert.match(b, /☀️ ~29°C/);
  assert.match(b, /typical/);
  assert.match(WX.badge({ dest: 'BJV', dep: '2027-08-01', ret: '2027-08-04' }, TODAY), /data-wx="BJV\|2027-08-01\|2027-08-04"[^>]*><\/span>/);
  assert.equal(WX.badge({ dest: 'ZZZ', dep: '2027-08-01' }, TODAY), '');
});

test('load: one forecast call and 3 archive calls (one per past year) for many deals, typical days averaged, results cached, failures quiet', async () => {
  const calls = [];
  const fetch = async url => {
    calls.push(url);
    const u = new URL(url), n = u.searchParams.get('latitude').split(',').length;
    const s = u.searchParams.get('start_date'), e = u.searchParams.get('end_date');
    const time = []; for (let d = new Date(s); d <= new Date(e); d.setDate(d.getDate() + 1)) time.push(d.toISOString().slice(0, 10));
    const yr = +s.slice(0, 4), hot = { 2025: 33, 2024: 30, 2023: 27 }[yr];   // 3 past years -> average 30
    const daily = url.includes('archive')
      ? { time, temperature_2m_max: time.map(() => hot), precipitation_sum: time.map(() => 0), cloud_cover_mean: time.map(() => 0) }
      : { time, temperature_2m_max: time.map(() => 20), weather_code: time.map(() => 3) };
    const one = { daily };
    return { ok: true, status: 200, json: async () => n > 1 ? Array(n).fill(one) : one };
  };
  const { WX } = load('airports.js', 'common.js', 'weather.js', { fetch, URL });
  const deals = [
    { dest: 'BJV', dep: '2026-11-25', ret: '2026-11-28' },
    { dest: 'BCN', dep: '2026-11-26', ret: '2026-11-29' },
    { dest: 'BJV', dep: '2027-07-01', ret: '2027-07-04' },
    { dest: 'BCN', dep: '2027-08-01', ret: '2027-08-03' },
    { dest: 'ZZZ', dep: '2027-08-01', ret: '2027-08-03' },
  ];
  await WX.load(deals, TODAY);
  assert.equal(calls.length, 4);
  assert.ok(calls.some(u => u.includes('api.open-meteo.com/v1/forecast')));
  for (const y of [2025, 2024, 2023]) assert.ok(calls.some(u => u.includes('archive-api.open-meteo.com') && u.includes(`start_date=${y}-07-01`) && u.includes(`end_date=${y}-08-03`)), y);
  assert.deepStrictEqual(js(WX.summary('BCN', '2026-11-26', '2026-11-29', TODAY)), { t: 20, i: '☁️', typ: false });
  assert.deepStrictEqual(js(WX.summary('BCN', '2027-08-01', '2027-08-03', TODAY)), { t: 30, i: '☀️', typ: true });
  await WX.load(deals, TODAY);
  assert.equal(calls.length, 4);                                     // all cached: no new calls

  const { WX: W2 } = load('airports.js', 'common.js', 'weather.js', { fetch: async () => { throw new Error('offline'); }, URL });
  await W2.load(deals, TODAY);                                       // does not throw
  assert.equal(W2.summary('BJV', '2027-07-01', '2027-07-04', TODAY), null);
});

/* Open-Meteo answers 429 when asked too often: the badges must come back later, and a reload must not ask again. */
const store = () => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };
const meteo = calls => async url => {
  calls.push(url);
  const u = new URL(url), s = u.searchParams.get('start_date'), e = u.searchParams.get('end_date');
  const time = []; for (let d = new Date(s); d <= new Date(e); d.setDate(d.getDate() + 1)) time.push(d.toISOString().slice(0, 10));
  const daily = url.includes('archive')
    ? { time, temperature_2m_max: time.map(() => 30), precipitation_sum: time.map(() => 0), cloud_cover_mean: time.map(() => 0) }
    : { time, temperature_2m_max: time.map(() => 20), weather_code: time.map(() => 3) };
  return { ok: true, status: 200, json: async () => ({ daily }) };
};
const DEALS = [{ dest: 'BCN', dep: '2026-11-26', ret: '2026-11-29' }, { dest: 'BCN', dep: '2027-08-01', ret: '2027-08-03' }];

test('a refused call (429) is asked again after a pause, not never', async () => {
  let refuse = true; const calls = [];
  const ok = meteo(calls);
  const fetch = async url => refuse ? (calls.push(url), { ok: false, status: 429, json: async () => ({ error: true }) }) : ok(url);
  const { WX } = load('airports.js', 'common.js', 'weather.js', { fetch, URL, localStorage: store() });
  await WX.load(DEALS, TODAY);
  assert.equal(WX.summary('BCN', '2027-08-01', '2027-08-03', TODAY), null);
  const n = calls.length;
  refuse = false;
  await WX.load(DEALS, TODAY);
  assert.equal(calls.length, n, 'right after a 429: wait');
  WX.pauseUntil = 0;                                                  // the pause is over
  await WX.load(DEALS, TODAY);
  assert.deepStrictEqual(js(WX.summary('BCN', '2027-08-01', '2027-08-03', TODAY)), { t: 30, i: '☀️', typ: true });
  assert.deepStrictEqual(js(WX.summary('BCN', '2026-11-26', '2026-11-29', TODAY)), { t: 20, i: '☁️', typ: false });
});

test('weather is kept on this device: typical for 30 days, a forecast for 3 hours', async () => {
  const ls = store(), calls = [];
  const { WX } = load('airports.js', 'common.js', 'weather.js', { fetch: meteo(calls), URL, localStorage: ls });
  await WX.load(DEALS, TODAY);
  assert.ok(calls.length > 0);
  // next visit, offline: both still shown, nothing asked
  const none = async () => { throw new Error('offline'); };
  const { WX: W2 } = load('airports.js', 'common.js', 'weather.js', { fetch: none, URL, localStorage: ls });
  assert.deepStrictEqual(js(W2.summary('BCN', '2027-08-01', '2027-08-03', TODAY)), { t: 30, i: '☀️', typ: true });
  assert.deepStrictEqual(js(W2.summary('BCN', '2026-11-26', '2026-11-29', TODAY)), { t: 20, i: '☁️', typ: false });
  // 4 hours later: the forecast is stale and gone, the typical weather stays
  const realNow = Date.now;
  const { WX: W3 } = load('airports.js', 'common.js', 'weather.js', { fetch: none, URL, localStorage: ls, Date: class extends Date { static now() { return realNow() + 4 * 3600e3; } } });
  assert.equal(W3.summary('BCN', '2026-11-26', '2026-11-29', TODAY), null);
  assert.ok(W3.summary('BCN', '2027-08-01', '2027-08-03', TODAY));
});
