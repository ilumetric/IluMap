#!/usr/bin/env node
// IluMap local server — for working on maps in a project folder, in any
// browser (also embedded ones such as the Claude app's, where the File System
// Access API cannot write files). No dependencies.
//
//   node tools/serve.mjs [folder] [--port 8765] [--open examples/demo/map.json]
//
// Serves the editor (this repository) and a project folder (default: the
// current directory) and gives the editor a small file API, so Save writes
// map.json straight into the folder — no save dialogs — and changes made on
// disk by someone else (an AI agent, git pull) show up in the open editor.
//
//   GET  /__ilumap/info            { app, version, folder }
//   GET  /__ilumap/list            { files: [paths of map files] }
//   GET  /__ilumap/stat?path=p     { mtime, size }
//   GET  /__ilumap/file?path=p     the file's text
//   PUT  /__ilumap/file?path=p     write the body (JSON map files only)
//
// Safety: listens on 127.0.0.1 only; requests must name this host (no DNS
// rebinding); writes need the X-IluMap header (a plain web page on another
// site cannot send it without a CORS preflight, which is never answered);
// paths stay inside the folder, dot folders (.git …) are off limits, and
// only *.json files are written (atomically: temp file + rename).
//
// Open a map directly: http://localhost:8765/?file=maps/world/map.json
// GitHub Pages keeps working without this server (the editor then uses the
// browser's file pickers).

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'package.json'), 'utf8')).version;
const API = '/__ilumap/';
const MAX_BODY = 64 * 1024 * 1024;
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'Library', 'Intermediate', 'Saved', 'DerivedDataCache', 'Binaries', '__pycache__']);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.avif': 'image/avif', '.bmp': 'image/bmp', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8', '.woff2': 'font/woff2',
};

function parseArgs(argv) {
  const out = { folder: process.cwd(), port: 8765, open: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port' || a === '-p') out.port = Number(argv[++i]);
    else if (a === '--open') out.open = argv[++i];
    else if (a === '--help' || a === '-h') out.help = true;
    else if (!a.startsWith('-')) out.folder = path.resolve(a);
  }
  return out;
}

/** A path inside `root` for a URL / API path, or null when it would leave it or enter a dot folder. */
function inside(root, rel) {
  let p;
  try { p = decodeURIComponent(rel); } catch { return null; }
  p = p.replace(/\\/g, '/').replace(/^\/+/, '');
  if (p.split('/').some((seg) => seg === '..' || (seg.startsWith('.') && seg !== '.'))) return null;
  const abs = path.resolve(root, p);
  const r = path.resolve(root);
  if (abs !== r && !abs.startsWith(r + path.sep)) return null;
  return abs;
}

const toPosix = (p) => p.split(path.sep).join('/');

async function listMaps(root) {
  const files = [];
  let seen = 0;
  async function visit(dir, depth) {
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (++seen > 20000 || files.length >= 500) return;
      if (e.name.startsWith('.')) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) { if (depth < 8 && !SKIP_DIRS.has(e.name)) await visit(abs, depth + 1); continue; }
      if (!e.name.toLowerCase().endsWith('.json') || e.name === 'package.json' || e.name.endsWith('.masks.json') || e.name === 'masks.json') continue;
      // a map file says "format": "ilumap" near its start
      try {
        const fh = await fsp.open(abs, 'r');
        const { bytesRead, buffer } = await fh.read(Buffer.alloc(2048), 0, 2048, 0);
        await fh.close();
        if (/"format"\s*:\s*"ilumap"/.test(buffer.toString('utf8', 0, bytesRead))) files.push(toPosix(path.relative(root, abs)));
      } catch { /* unreadable */ }
    }
  }
  await visit(root, 0);
  return files.sort();
}

function send(res, status, body, headers = {}) {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': typeof body === 'object' && !Buffer.isBuffer(body) ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(data);
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw Object.assign(new Error('body too large'), { status: 413 });
    chunks.push(c);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function api(req, res, url, folder) {
  const name = url.pathname.slice(API.length);
  const rel = url.searchParams.get('path') || '';
  if (name === 'info' && req.method === 'GET') return send(res, 200, { app: 'ilumap', version: VERSION, folder: path.basename(folder), writable: true });
  if (name === 'list' && req.method === 'GET') return send(res, 200, { files: await listMaps(folder) });
  const abs = inside(folder, rel);
  if (!rel || !abs) return send(res, 400, { error: 'bad path' });
  if (name === 'stat' && req.method === 'GET') {
    try { const s = await fsp.stat(abs); return send(res, 200, { mtime: s.mtimeMs, size: s.size }); } catch { return send(res, 404, { error: 'not found' }); }
  }
  if (name === 'file' && req.method === 'GET') {
    try {
      const [text, s] = await Promise.all([fsp.readFile(abs, 'utf8'), fsp.stat(abs)]);
      return send(res, 200, text, { 'Content-Type': 'application/json; charset=utf-8', 'X-Mtime': String(s.mtimeMs) });
    } catch { return send(res, 404, { error: 'not found' }); }
  }
  if (name === 'file' && req.method === 'PUT') {
    if (req.headers['x-ilumap'] !== '1') return send(res, 403, { error: 'missing X-IluMap header' });
    if (!abs.toLowerCase().endsWith('.json')) return send(res, 403, { error: 'only .json files can be written' });
    const text = await readBody(req);
    try { JSON.parse(text); } catch { return send(res, 400, { error: 'not valid JSON' }); }
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    const tmp = `${abs}.${process.pid}.${Date.now()}.tmp`;
    await fsp.writeFile(tmp, text, 'utf8');
    await fsp.rename(tmp, abs);
    const s = await fsp.stat(abs);
    console.log(`  saved ${toPosix(path.relative(folder, abs))} (${s.size} bytes)`);
    return send(res, 200, { mtime: s.mtimeMs, size: s.size });
  }
  return send(res, 405, { error: 'method not allowed' });
}

/** Static files: the editor from the app folder, everything else from the project folder. */
async function serveStatic(req, res, url, folder) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'method not allowed');
  let rel = url.pathname;
  if (rel.endsWith('/')) rel += 'index.html';
  // the editor's own files win, so a project folder elsewhere still gets the app
  for (const root of folder === APP_ROOT ? [APP_ROOT] : [APP_ROOT, folder]) {
    const abs = inside(root, rel);
    if (!abs) continue;
    try {
      const s = await fsp.stat(abs);
      if (s.isDirectory()) { res.writeHead(301, { Location: `${url.pathname}/` }); return res.end(); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store', 'Content-Length': s.size });
      if (req.method === 'HEAD') return res.end();
      return fs.createReadStream(abs).pipe(res);
    } catch { /* try the next root */ }
  }
  return send(res, 404, 'not found');
}

export function createServer({ folder = process.cwd(), port = 8765 } = {}) {
  const hosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`]);
  return http.createServer(async (req, res) => {
    try {
      if (!hosts.has(String(req.headers.host || '').toLowerCase())) return send(res, 403, 'forbidden host');
      const url = new URL(req.url, `http://localhost:${port}`);
      if (url.pathname.startsWith(API)) return await api(req, res, url, folder);
      return await serveStatic(req, res, url, folder);
    } catch (e) {
      if (!res.headersSent) send(res, e.status || 500, { error: e.message });
      else res.end();
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node tools/serve.mjs [folder] [--port 8765] [--open path/to/map.json]');
    process.exit(0);
  }
  const server = createServer(args);
  server.on('error', (e) => {
    console.error(e.code === 'EADDRINUSE' ? `Port ${args.port} is busy — try --port ${args.port + 1}` : e.message);
    process.exit(1);
  });
  server.listen(args.port, '127.0.0.1', () => {
    const q = args.open ? `?file=${encodeURIComponent(args.open)}` : '';
    console.log(`IluMap ${VERSION} — http://localhost:${args.port}/${q}`);
    console.log(`  project folder: ${args.folder}`);
    console.log('  Save writes map files into this folder; changes on disk show up in the editor.');
  });
}
