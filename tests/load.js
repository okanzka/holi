/* Loads the browser scripts into a sandbox so their pure helpers can be unit-tested with node --test. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function load(...files) {
  const noop = () => {};
  const extra = typeof files[files.length - 1] === 'object' ? files.pop() : {};   // optional globals, e.g. a fake fetch
  const ctx = vm.createContext({
    console, Intl, Date, Math, JSON, URLSearchParams, setTimeout, clearTimeout, AbortController, Promise, ...extra,
    document: { addEventListener: noop, querySelector: () => null, querySelectorAll: () => [] },
    location: { protocol: 'file:', search: '', hash: '' },
  });
  const src = files.map(f => fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8')).join('\n;\n');
  // top-level const/let stay in the script scope, so hand them back explicitly
  const names = '({H, AP, STAYS: typeof STAYS !== "undefined" ? STAYS : null, AIRLINES,' +
    ' RYANAIR: typeof RYANAIR !== "undefined" ? RYANAIR : null, MULTI: typeof MULTI !== "undefined" ? MULTI : null,' +
    ' NET: typeof NET !== "undefined" ? NET : null, TP: typeof TP !== "undefined" ? TP : null})';
  vm.runInContext(src + '\n;' + names, ctx);
  return vm.runInContext(names, ctx);
}
module.exports = { load };
