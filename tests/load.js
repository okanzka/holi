/* Loads the browser scripts into a sandbox so their pure helpers can be unit-tested with node --test. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function load(...files) {
  const noop = () => {};
  const ctx = vm.createContext({
    console, Intl, Date, Math, JSON, URLSearchParams,
    document: { addEventListener: noop, querySelector: () => null, querySelectorAll: () => [] },
    location: { protocol: 'file:', search: '', hash: '' },
  });
  const src = files.map(f => fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8')).join('\n;\n');
  // top-level const/let stay in the script scope, so hand them back explicitly
  vm.runInContext(src + '\n;({H, AP, STAYS: typeof STAYS !== "undefined" ? STAYS : null, AIRLINES})', ctx);
  return vm.runInContext('({H, AP, STAYS: typeof STAYS !== "undefined" ? STAYS : null, AIRLINES})', ctx);
}
module.exports = { load };
