// Folder access (File System Access API, Chromium): "Open folder" gives the
// editor a directory handle, so a map's relative paths (view.background.src,
// e.g. "../refs/heightmap.png") resolve on their own, and the map file can be
// re-read to notice changes made by someone else (an AI agent, git pull).
//
// A folder is { handle: FileSystemDirectoryHandle, mapDir: string[] } where
// mapDir is the path of the map file's folder inside the opened folder.
// Nothing here touches the document; session.js / io.js use these helpers.

const SKIP_DIRS = new Set(['.git', 'node_modules', '.hg', '.svn', 'dist', 'build', '.venv', '__pycache__', 'Library', 'Intermediate', 'Saved', 'DerivedDataCache', 'Binaries']);
const IMAGE_RE = /\.(png|jpe?g|webp|gif|bmp|avif|svg)$/i;
const MAX_DEPTH = 6;
const MAX_ENTRIES = 4000;

export const folderSupported = () => typeof window !== 'undefined' && 'showDirectoryPicker' in window;

/** Current permission of a handle without prompting ('granted' | 'prompt' | 'denied'). */
export async function permissionOf(handle, mode = 'read') {
  try { return (await handle.queryPermission?.({ mode })) || 'granted'; } catch { return 'prompt'; }
}

/** Ask for permission (needs a user gesture when it is 'prompt'). */
export async function requestPermission(handle, mode = 'read') {
  try { return (await handle.requestPermission?.({ mode })) || 'granted'; } catch { return 'denied'; }
}

/**
 * Walk a folder and collect files matching `test(name)` as { path: string[], name, handle }.
 * Skips VCS / build / Unreal cache folders, stops after MAX_DEPTH levels or MAX_ENTRIES entries.
 */
export async function walk(dir, test, { depth = MAX_DEPTH } = {}) {
  const out = [];
  let seen = 0;
  async function visit(d, path, level) {
    for await (const [name, h] of d.entries()) {
      if (++seen > MAX_ENTRIES) return;
      if (h.kind === 'directory') {
        if (level < depth && !SKIP_DIRS.has(name) && !name.startsWith('.')) await visit(h, [...path, name], level + 1);
      } else if (test(name)) out.push({ path, name, handle: h });
    }
  }
  await visit(dir, [], 0);
  out.sort((a, b) => [...a.path, a.name].join('/').localeCompare([...b.path, b.name].join('/')));
  return out;
}

/** IluMap maps in a folder: *.json files whose content says "format": "ilumap". */
export async function findMaps(dir) {
  const files = await walk(dir, (n) => /\.json$/i.test(n) && !/^(package|tsconfig|masks)(-lock)?\.json$/i.test(n));
  const maps = [];
  for (const f of files) {
    try {
      const file = await f.handle.getFile();
      if (file.size > 20 * 1024 * 1024) continue;
      const head = await file.slice(0, 400).text();
      if (/"format"\s*:\s*"ilumap"/.test(head)) maps.push({ ...f, size: file.size, modified: file.lastModified });
    } catch { /* unreadable: skip */ }
  }
  return maps;
}

/** Images in a folder (for choosing a background). */
export const findImages = (dir) => walk(dir, (n) => IMAGE_RE.test(n));

/** Resolve "a/../b/c.png" against base path segments; null when it leaves the opened folder or is absolute / a URL. */
export function resolvePath(base, rel) {
  if (!rel || /^[a-z]+:/i.test(rel) || rel.startsWith('/')) return null;
  const out = [...base];
  for (const part of rel.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') { if (!out.length) return null; out.pop(); } else out.push(part);
  }
  return out.length ? out : null;
}

/** Relative path from folder `from` (segments) to file `to` (segments incl. the file name). */
export function relativePath(from, to) {
  let i = 0;
  while (i < from.length && i < to.length - 1 && from[i] === to[i]) i++;
  return [...Array(from.length - i).fill('..'), ...to.slice(i)].join('/');
}

/** File handle at path segments (last one is the file name) inside dir, or null. */
export async function fileAt(dir, segments) {
  try {
    let d = dir;
    for (const s of segments.slice(0, -1)) d = await d.getDirectoryHandle(s);
    return await d.getFileHandle(segments[segments.length - 1]);
  } catch { return null; }
}
