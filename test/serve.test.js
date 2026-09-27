import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createServer } from '../tools/serve.mjs';

function request(port, method, p, { body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: p, headers: { host: `localhost:${port}`, ...headers } }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    if (body != null) req.write(body);
    req.end();
  });
}

async function withServer(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ilumap-serve-'));
  fs.mkdirSync(path.join(dir, 'maps'));
  fs.writeFileSync(path.join(dir, 'maps', 'world.json'), '{\n  "format": "ilumap",\n  "version": 1\n}\n');
  fs.writeFileSync(path.join(dir, 'other.json'), '{ "not": "a map" }');
  fs.mkdirSync(path.join(dir, '.git'));
  fs.writeFileSync(path.join(dir, '.git', 'config.json'), '{}');
  const server = createServer({ folder: dir, port: 0 });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  // the Host check needs the real port: rebuild with it
  server.close();
  const real = createServer({ folder: dir, port });
  await new Promise((r) => real.listen(port, '127.0.0.1', r));
  try { await fn({ port, dir }); } finally { real.close(); fs.rmSync(dir, { recursive: true, force: true }); }
}

test('local server: info, list, read, stat', async () => {
  await withServer(async ({ port }) => {
    const info = JSON.parse((await request(port, 'GET', '/__ilumap/info')).body);
    assert.equal(info.app, 'ilumap');
    const list = JSON.parse((await request(port, 'GET', '/__ilumap/list')).body);
    assert.deepEqual(list.files, ['maps/world.json'], 'only map files, no dot folders');
    const file = await request(port, 'GET', '/__ilumap/file?path=maps/world.json');
    assert.equal(file.status, 200);
    assert.match(file.body, /"ilumap"/);
    assert.ok(Number(file.headers['x-mtime']) > 0);
    const st = JSON.parse((await request(port, 'GET', '/__ilumap/stat?path=maps/world.json')).body);
    assert.ok(st.size > 0);
    assert.equal((await request(port, 'GET', '/__ilumap/stat?path=maps/none.json')).status, 404);
  });
});

test('local server: writes need the header, stay inside the folder, JSON only', async () => {
  await withServer(async ({ port, dir }) => {
    const body = '{ "format": "ilumap", "version": 1, "meta": { "name": "New" } }\n';
    assert.equal((await request(port, 'PUT', '/__ilumap/file?path=maps/world.json', { body })).status, 403, 'no X-IluMap header');
    const ok = await request(port, 'PUT', '/__ilumap/file?path=maps/new/map.json', { body, headers: { 'x-ilumap': '1' } });
    assert.equal(ok.status, 200);
    assert.equal(fs.readFileSync(path.join(dir, 'maps', 'new', 'map.json'), 'utf8'), body);
    assert.equal((await request(port, 'PUT', '/__ilumap/file?path=../evil.json', { body, headers: { 'x-ilumap': '1' } })).status, 400);
    assert.equal((await request(port, 'PUT', '/__ilumap/file?path=.git/config.json', { body, headers: { 'x-ilumap': '1' } })).status, 400);
    assert.equal((await request(port, 'PUT', '/__ilumap/file?path=notes.txt', { body, headers: { 'x-ilumap': '1' } })).status, 403);
    assert.equal((await request(port, 'PUT', '/__ilumap/file?path=maps/bad.json', { body: '{ nope', headers: { 'x-ilumap': '1' } })).status, 400);
    assert.equal((await request(port, 'GET', '/__ilumap/file?path=..%2F..%2Fetc%2Fpasswd')).status, 400);
    assert.ok(!fs.readdirSync(path.join(dir, 'maps')).some((f) => f.endsWith('.tmp')), 'no temp files left');
  });
});

test('local server: other hosts are refused (DNS rebinding); the editor and project files are served', async () => {
  await withServer(async ({ port }) => {
    assert.equal((await request(port, 'GET', '/__ilumap/info', { headers: { host: 'evil.example' } })).status, 403);
    const index = await request(port, 'GET', '/');
    assert.equal(index.status, 200);
    assert.match(index.headers['content-type'], /text\/html/);
    const map = await request(port, 'GET', '/maps/world.json');
    assert.equal(map.status, 200, 'project files resolve for relative paths (background images)');
    assert.equal((await request(port, 'GET', '/.git/config.json')).status, 404);
  });
});
