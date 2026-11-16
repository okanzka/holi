/* Things to do: the trip's cities, ranking sights by fame, and the Wikipedia + Wikidata look-up (faked here). */
const test = require('node:test');
const assert = require('node:assert');
const { load } = require('./load');

function fakeStorage(init = {}){
  const m = new Map(Object.entries(init).map(([k, v]) => ['heybe.' + k, JSON.stringify(v)]));
  return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), m };
}
const js = v => JSON.parse(JSON.stringify(v));   // values from the sandbox -> plain values
const row = (id, links) => ({ item: { value: 'http://www.wikidata.org/entity/' + id }, links: { value: String(links) } });

test('rank keeps the most famous sights first, drops repeats and bad ids, and stops at 10', () => {
  const { THINGS } = load('airports.js', 'common.js', 'things.js');
  const rows = [row('Q1', 5), row('Q2', 90), row('Q1', 7), { item: { value: 'x' }, links: { value: '99' } },
    ...Array.from({ length: 15 }, (_, i) => row('Q' + (100 + i), 50 - i))];
  const r = THINGS.rank(rows);
  assert.equal(r.length, 10);
  assert.deepStrictEqual(js(r[0]), { id: 'Q2', links: 90 });
  assert.ok(!r.some(x => x.id === 'x'));
  assert.deepStrictEqual(js(THINGS.rank([row('Q1', 5), row('Q1', 7)])), [{ id: 'Q1', links: 7 }]);   // the higher count wins
  assert.deepStrictEqual(js(THINGS.rank(undefined)), []);
});

test('the query asks only for the given items, sight types, and leaves out cities and streets', () => {
  const { THINGS } = load('airports.js', 'common.js', 'things.js');
  const q = THINGS.query(['Q90', 'Q243']);
  assert.match(q, /VALUES \?item \{ wd:Q90 wd:Q243 \}/);
  assert.match(q, /wd:Q33506/);                      // museum is a sight
  assert.match(q, /MINUS[\s\S]*wd:Q515/);            // a city is not
  assert.match(q, /LIMIT 20/);
});

test('cities come from the trip, then the stay plan, then cities added by hand, without repeats', () => {
  const localStorage = fakeStorage({ trip: { to: 'LIS', city: 'Lisbon' }, stayPlan: { cities: [{ city: 'Lisbon', cc: 'PT' }, { city: 'Porto', cc: 'PT' }] }, thingsCities: ['porto', 'Seville'] });
  const { THINGS } = load('airports.js', 'common.js', 'stays.js', 'things.js', { localStorage });
  assert.deepStrictEqual(js(THINGS.cities().map(c => c.city)), ['Lisbon', 'Porto', 'Seville']);
  THINGS.removeCity('SEVILLE'); THINGS.addCity('Faro'); THINGS.addCity('faro');
  assert.deepStrictEqual(js(THINGS.cities().map(c => c.city)), ['Lisbon', 'Porto', 'Faro']);
});

test('"Anywhere" as the destination adds no city', () => {
  const localStorage = fakeStorage({ trip: { to: 'ANY' } });
  const { THINGS } = load('airports.js', 'common.js', 'things.js', { localStorage });
  assert.deepStrictEqual(js(THINGS.cities()), []);
});

test('"Anywhere" with a destination picked from the deals uses that city', () => {
  const localStorage = fakeStorage({ trip: { to: 'ANY', city: 'Valencia' } });
  const { THINGS } = load('airports.js', 'common.js', 'things.js', { localStorage });
  assert.deepStrictEqual(js(THINGS.cities().map(c => c.city)), ['Valencia']);
});

function fakeWeb(){
  const f = async (url, opts = {}) => { url = String(url); f.calls.push({ url, opts }); const u = new URL(url);
    let body;
    if (u.host === 'query.wikidata.org') body = { results: { bindings: [row('Q2', 57), row('Q1', 53), row('Q3', 2)] } };
    else if (u.searchParams.get('generator') === 'geosearch') body = { query: { pages: [
      { title: 'Jerónimos Monastery', pageprops: { wikibase_item: 'Q1' } }, { title: 'Belém Tower', pageprops: { wikibase_item: 'Q2' } },
      { title: 'Rossio station', pageprops: { wikibase_item: 'Q3' } }, { title: 'No item' }] } };
    else if (u.searchParams.get('prop') === 'coordinates') body = { query: { pages: [{ title: 'Lisbon', coordinates: [{ lat: 38.7, lon: -9.1 }] }] } };
    else body = { query: { pages: [{ title: 'Belém Tower', description: 'Fortified tower', thumbnail: { source: 'https://img/b.jpg' }, coordinates: [{ lat: 38.69, lon: -9.21 }] },
      { title: 'Jerónimos Monastery', description: 'Monastery' }] } };
    return { ok: true, status: 200, json: async () => body }; };
  f.calls = []; return f;
}

test('top() ranks the sights of a city, adds photos and links, and keeps the result for a week', async () => {
  const fetch = fakeWeb(), localStorage = fakeStorage();
  const { THINGS } = load('airports.js', 'common.js', 'things.js', { fetch, localStorage });
  const list = await THINGS.top('Lisbon');
  assert.deepStrictEqual(js(list.map(x => x.title)), ['Belém Tower', 'Jerónimos Monastery', 'Rossio station']);
  assert.equal(list[0].img, 'https://img/b.jpg');
  assert.equal(list[0].desc, 'Fortified tower');
  assert.equal(list[0].url, 'https://en.wikipedia.org/wiki/Bel%C3%A9m_Tower');
  assert.match(list[0].map, /query=38\.69%2C-9\.21/);               // exact spot when Wikipedia knows it
  assert.match(list[1].map, /Jer%C3%B3nimos%20Monastery%2C%20Lisbon/); // else name + city
  assert.equal(fetch.calls.filter(c => /generator=geosearch/.test(c.url)).length, 5);   // centre + 4 points around it
  assert.ok(fetch.calls.every(c => c.url.includes('query.wikidata.org') || c.url.includes('origin=*')), 'Wikipedia calls must allow the browser (CORS)');
  const sparql = fetch.calls.find(c => c.url.includes('wikidata'));
  assert.equal(sparql.opts.method, 'POST');
  const n = fetch.calls.length;
  assert.deepStrictEqual(js((await THINGS.top('LISBON')).map(x => x.title)), js(list.map(x => x.title)));
  assert.equal(fetch.calls.length, n, 'second look-up comes from the saved copy');
});

test('a city Wikipedia cannot place gives an empty list, not an error', async () => {
  const fetch = async () => ({ ok: true, status: 200, json: async () => ({ query: { pages: [{ title: 'Nowhereville', missing: true }] } }) });
  const { THINGS } = load('airports.js', 'common.js', 'things.js', { fetch, localStorage: fakeStorage() });
  assert.deepStrictEqual(js(await THINGS.top('Nowhereville')), []);
});

test('a busy Wikidata is reported, and nothing is saved', async () => {
  const base = fakeWeb(), localStorage = fakeStorage();
  const fetch = async (url, o) => String(url).includes('wikidata') ? { ok: false, status: 429, json: async () => { throw new Error('html'); } } : base(url, o);
  const { THINGS } = load('airports.js', 'common.js', 'things.js', { fetch, localStorage });
  await assert.rejects(THINGS.top('Lisbon'), /Wikidata is busy/);
  assert.equal(localStorage.m.size, 0);
});
