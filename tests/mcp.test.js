/* The MCP server speaks JSON-RPC over stdio: spawn it and talk to it like a client would. Offline tools only. */
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const path = require('path');

function client(){
  const p = spawn(process.execPath, [path.join(__dirname, '..', 'mcp', 'holi-mcp.js')], { stdio: ['pipe', 'pipe', 'inherit'] });
  const waiting = new Map(); let buf = '', next = 1;
  p.stdout.on('data', d => { buf += d; let i;
    while ((i = buf.indexOf('\n')) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); waiting.get(m.id)?.(m); } });
  return {
    req(method, params){ const id = next++; p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      return new Promise(r => waiting.set(id, r)); },
    notify(method){ p.stdin.write(JSON.stringify({ jsonrpc: '2.0', method }) + '\n'); },
    close(){ p.stdin.end(); },
  };
}

test('MCP server: handshake, tool list and offline tools', async () => {
  const c = client();
  try {
    const init = await c.req('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } });
    assert.equal(init.result.serverInfo.name, 'holi');
    assert.equal(init.result.protocolVersion, '2025-06-18');
    c.notify('notifications/initialized');

    const names = (await c.req('tools/list')).result.tools.map(t => t.name);
    for (const n of ['search_airports', 'find_deals', 'route_calendar', 'find_multi_city', 'make_links', 'search_hotels', 'today'])
      assert.ok(names.includes(n), 'missing tool ' + n);
    assert.ok(!names.includes('get_my_trip'));

    const ap = JSON.parse((await c.req('tools/call', { name: 'search_airports', arguments: { query: 'Nürnberg' } })).result.content[0].text);
    assert.equal(ap[0].code, 'NUE');

    const links = JSON.parse((await c.req('tools/call', { name: 'make_links',
      arguments: { options: [{ from: 'NUE', to: 'PMI', depart: '2027-05-01', return: '2027-05-05' }] } })).result.content[0].text);
    assert.match(links[0].ryanair, /ryanair\.com/);

    const today = JSON.parse((await c.req('tools/call', { name: 'today', arguments: {} })).result.content[0].text);
    assert.match(today.today, /^\d{4}-\d{2}-\d{2}$/);

    const bad = await c.req('tools/call', { name: 'nope', arguments: {} });
    assert.equal(bad.result.isError, true);
    assert.equal((await c.req('no/such/method')).error.code, -32601);
  } finally { c.close(); }
});
