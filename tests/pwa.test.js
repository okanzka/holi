/* Add to Home Screen: a manifest, real PNG icons, and the iOS tags on every page. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { resolveFile, TYPES } = require('../server.js');
const root = path.join(__dirname, '..');

test('the manifest and icons are served, and nothing else next to them', () => {
  for (const p of ['/icons/manifest.webmanifest', '/icons/icon-180.png', '/icons/icon-192.png', '/icons/icon-512.png'])
    assert.notStrictEqual(resolveFile(p), null, p + ' should be served');
  assert.strictEqual(resolveFile('/icons/../serpapi.key'), null);
  assert.strictEqual(resolveFile('/icons/sub/x.png'), null);
  assert.match(TYPES['.webmanifest'], /manifest\+json/);
});

test('the manifest names the app and points at icons that exist', () => {
  const m = JSON.parse(fs.readFileSync(path.join(root, 'icons', 'manifest.webmanifest'), 'utf8'));
  assert.equal(m.name, 'Heybe');
  assert.equal(m.display, 'standalone');
  assert.ok(m.start_url);
  for (const i of m.icons) {
    const f = path.join(root, 'icons', i.src);
    const png = fs.readFileSync(f);
    assert.equal(png.toString('latin1', 1, 4), 'PNG', i.src);
    const [w, h] = [png.readUInt32BE(16), png.readUInt32BE(20)];
    assert.equal(`${w}x${h}`, i.sizes, i.src);
  }
});

test('every page links the manifest and the iPhone icon', () => {
  for (const p of ['index.html', 'hotels.html', 'things.html', 'help.html']) {
    const html = fs.readFileSync(path.join(root, p), 'utf8');
    assert.match(html, /<link rel="manifest" href="icons\/manifest\.webmanifest">/, p);
    assert.match(html, /<link rel="apple-touch-icon" href="icons\/icon-180\.png">/, p);
    assert.match(html, /<meta name="apple-mobile-web-app-capable" content="yes">/, p);
    assert.match(html, /<meta name="apple-mobile-web-app-title" content="Heybe">/, p);
  }
});
