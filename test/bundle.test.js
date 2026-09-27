import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle } from '../tools/bundle.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const committed = join(root, 'ilumap.mjs');

test('ilumap.mjs is up to date with the sources (run: npm run bundle)', () => {
  const fresh = bundle();
  assert.equal(bundle(), fresh, 'bundling is deterministic');
  assert.ok(fresh.startsWith('#!/usr/bin/env node\n'));
  assert.ok(fresh.endsWith('\n') && !fresh.includes('\r'));
  let current = '';
  try { current = readFileSync(committed, 'utf8'); } catch { /* missing */ }
  assert.ok(current === fresh, 'ilumap.mjs is out of date or missing: run npm run bundle and commit the result');
});

test('the bundled CLI behaves exactly like tools/ilumap.mjs', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ilumap-bundle-'));
  try {
    const demo = JSON.parse(readFileSync(join(root, 'examples/demo/map.json'), 'utf8'));
    const changed = JSON.parse(JSON.stringify(demo));
    changed.pois[0].x += 25000;
    changed.pois[1].name = 'Renamed POI';
    changed.links.pop();
    const oldFile = join(tmp, 'old.json');
    const newFile = join(tmp, 'new.json');
    writeFileSync(oldFile, JSON.stringify(demo, null, 2));
    writeFileSync(newFile, JSON.stringify(changed, null, 2));
    const demoPath = 'examples/demo/map.json';
    const cases = [
      ['validate', demoPath],
      ['validate', demoPath, '--quiet'],
      ['text', demoPath],
      ['text', demoPath, '--plain', '--nearest', '1'],
      ['svg', demoPath, '--width', '800'],
      ['list', demoPath],
      ['list', demoPath, '--features', '--json'],
      ['list', demoPath, '--ids'],
      ['list', demoPath, '--links'],
      ['diff', oldFile, newFile],
      ['diff', oldFile, newFile, '--plain'],
      ['diff', oldFile, newFile, '--json'],
      ['diff', demoPath, demoPath],
      ['diff', demoPath, '--git'],
      ['terrain', demoPath],
      ['--version'],
      ['validate', join(tmp, 'missing.json')],
    ];
    const run = (script, args) => spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    for (const args of cases) {
      const a = run('tools/ilumap.mjs', args);
      const b = run('ilumap.mjs', args);
      const label = args.join(' ');
      assert.equal(b.status, a.status, `exit code of: ${label}\n${b.stderr}`);
      assert.equal(b.stdout, a.stdout, `stdout of: ${label}`);
      assert.equal(b.stderr, a.stderr, `stderr of: ${label}`);
    }
    assert.match(run('ilumap.mjs', ['version']).stdout, /^ilumap \d+\.\d+\.\d+ \(map format v\d+\)\n$/);
    assert.match(run('ilumap.mjs', ['--help']).stdout, /Usage: node ilumap\.mjs <command>/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// --- the bundler itself, on small synthetic module graphs

function project(files) {
  const dir = mkdtempSync(join(tmpdir(), 'ilumap-bundler-'));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(dir, name, '..'), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  return dir;
}

test('bundler: scopes, aliases, re-exports, node: builtins', () => {
  const dir = project({
    'lib/a.js': "import { join } from 'node:path';\nconst helper = 'a';\nexport const counter = { n: 0 };\nexport function bump() { counter.n++; return helper; }\nexport const where = join('x', 'y').length;\n",
    'lib/b.js': "import {\n  bump as inc,\n  counter,\n} from './a.js';\nconst helper = 'b';\nexport { bump } from './a.js';\nfunction local() { return `${inc()}${helper}${counter.n}`; }\nexport { local as describe };\n",
    'main.mjs': "#!/usr/bin/env node\nimport { describe, bump } from './lib/b.js';\nimport { counter, where } from './lib/a.js';\nimport { basename } from 'node:path';\nconst helper = 'main';\nbump();\nconsole.log(describe(), counter.n, where, basename('/q/r.txt'), helper);\n",
  });
  try {
    const text = bundle({ root: dir, entry: 'main.mjs', version: '9.9.9' });
    assert.ok(text.includes('from IluMap v9.9.9'));
    assert.equal((text.match(/from 'node:path'/g) || []).length, 1, 'node: imports are de-duplicated');
    writeFileSync(join(dir, 'out.mjs'), text);
    const r = spawnSync(process.execPath, [join(dir, 'out.mjs')], { encoding: 'utf8' });
    const direct = spawnSync(process.execPath, [join(dir, 'main.mjs')], { encoding: 'utf8' });
    assert.equal(r.stderr, '');
    assert.equal(r.stdout, direct.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('bundler: import cycles (names used at call time)', () => {
  const dir = project({
    'text.js': "import { network } from './routes.js';\nexport function fmt(n) { return `${n} m`; }\nexport function describe() { return `route: ${network()}`; }\n",
    'routes.js': "import { fmt as format } from './text.js';\nexport function network() { return format(42); }\n",
    'main.mjs': "import { describe } from './text.js';\nimport { network } from './routes.js';\nconsole.log(describe(), network());\n",
  });
  try {
    const text = bundle({ root: dir, entry: 'main.mjs', version: '0' });
    writeFileSync(join(dir, 'out.mjs'), text);
    const r = spawnSync(process.execPath, [join(dir, 'out.mjs')], { encoding: 'utf8' });
    assert.equal(r.stderr, '');
    assert.equal(r.stdout, 'route: 42 m 42 m\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('bundler: unsupported module syntax fails loudly', () => {
  const bad = {
    'default import': "import thing from './x.js';\n",
    'namespace import': "import * as x from './x.js';\n",
    'export default': "import { y } from './x.js';\nexport default y;\n",
    'export star': "export * from './x.js';\n",
    'dynamic import': "const m = await import('./x.js');\n",
    'import.meta': 'console.log(import.meta.url);\n',
    'bare package': "import { z } from 'left-pad';\n",
    'missing export': "import { nope } from './x.js';\n",
    'exported let (live binding)': "import { y } from './x.js';\nexport let z = y;\n",
  };
  for (const [what, main] of Object.entries(bad)) {
    const dir = project({ 'x.js': 'export const y = 1;\n', 'main.mjs': main });
    try {
      assert.throws(() => bundle({ root: dir, entry: 'main.mjs', version: '0' }), undefined, what);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});
