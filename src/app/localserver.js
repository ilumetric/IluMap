// Talking to the local IluMap server (tools/serve.mjs), when the editor is
// served by it. The server reads and writes map files in the project folder
// over HTTP, which works in every browser — including embedded ones where the
// File System Access API cannot write — and needs no save dialogs.
//
// A map opened through the server is linked with a "server handle": an object
// with the parts of FileSystemFileHandle that io.js / session.js use (name,
// getFile, createWritable, queryPermission / requestPermission, isSameEntry),
// so saving, the changed-on-disk check and reloading work unchanged.
// Projects remember it as `fileServerPath` (a handle object cannot be stored).

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
let detected = null;

const apiUrl = (name, path) => {
  const u = new URL(`/__ilumap/${name}`, location.origin);
  if (path != null) u.searchParams.set('path', path);
  return u.href;
};

/** The server's info ({ app, version, folder }) when the editor runs on it, else null. Cached. */
export function localServer() {
  if (!detected) detected = detect();
  return detected;
}

async function detect() {
  if (typeof location === 'undefined' || !LOCAL_HOSTS.has(location.hostname)) return null;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 1500);
    const r = await fetch(apiUrl('info'), { cache: 'no-store', signal: ctl.signal });
    clearTimeout(timer);
    if (!r.ok) return null;
    const info = await r.json();
    return info?.app === 'ilumap' ? info : null;
  } catch {
    return null;
  }
}

async function check(r) {
  if (r.ok) return r;
  let msg = `${r.status}`;
  try { msg = (await r.json()).error || msg; } catch { /* not JSON */ }
  throw new Error(msg);
}

/** Map files in the project folder (paths relative to it). */
export async function listServerMaps() {
  const r = await check(await fetch(apiUrl('list'), { cache: 'no-store' }));
  return (await r.json()).files || [];
}

/** { mtime, size } of a file, or null when it does not exist. */
export async function statServerFile(path) {
  const r = await fetch(apiUrl('stat', path), { cache: 'no-store' });
  if (r.status === 404) return null;
  return (await check(r)).json();
}

export async function readServerFile(path) {
  const r = await check(await fetch(apiUrl('file', path), { cache: 'no-store' }));
  return { text: await r.text(), mtime: Number(r.headers.get('x-mtime')) || 0 };
}

export async function writeServerFile(path, text) {
  const r = await check(await fetch(apiUrl('file', path), {
    method: 'PUT', cache: 'no-store', headers: { 'Content-Type': 'application/json', 'X-IluMap': '1' }, body: text,
  }));
  return r.json();
}

/** URL of a map file in the project folder: its relative paths (background images) resolve against it. */
export function serverBaseUrl(path) {
  return new URL(`/${path.split('/').map(encodeURIComponent).join('/')}`, location.origin).href;
}

/** A FileSystemFileHandle look-alike for a file served by the local server. */
export function serverHandle(path) {
  const name = path.split('/').pop() || 'map.json';
  return {
    kind: 'file',
    name,
    serverPath: path,
    async queryPermission() { return 'granted'; },
    async requestPermission() { return 'granted'; },
    async isSameEntry(other) { return other?.serverPath === path; },
    async getFile() {
      const { text, mtime } = await readServerFile(path);
      return { name, lastModified: mtime, text: async () => text };
    },
    async createWritable() {
      const parts = [];
      return {
        async write(data) { parts.push(typeof data === 'string' ? data : await new Response(data).text()); },
        async close() { await writeServerFile(path, parts.join('')); },
        async abort() { parts.length = 0; },
      };
    },
  };
}

export const isServerHandle = (h) => typeof h?.serverPath === 'string';
