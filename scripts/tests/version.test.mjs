import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import {
  checkVersions,
  planVersions,
  syncVersions,
  validateVersion,
  VERSION_SOURCE,
} from '../version.mjs';
import { validateReleaseVersion } from '../../apps/desktop/scripts/validate-release-version.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'receiptbi-version-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (path, text) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  write(VERSION_SOURCE, '__version__ = "1.0.0"\n');
  for (const [path, name] of [
    ['pyproject.toml', 'receiptbi'],
    ['apps/api/pyproject.toml', 'receiptbi-api'],
  ]) {
    write(
      path,
      `[project]\nname = "${name}"\nversion = "1.0.0" # keep this comment\ndependencies = ["other==1.0.0"]\n\n[tool.example]\nversion = "7.0.0"\n`,
    );
  }
  write(
    'uv.lock',
    'version = 1\n\n[[package]]\nname = "receiptbi"\nversion = "1.0.0"\nsource = { virtual = "." }\n\n[[package]]\nname = "other"\nversion = "1.0.0"\nsource = { registry = "https://example.invalid" }\n\n[[package]]\nname = "receiptbi-api"\nversion = "1.0.0"\nsource = { editable = "apps/api" }\n',
  );
  for (const app of ['web', 'desktop']) {
    const name = `receiptbi-${app}`;
    write(
      `apps/${app}/package.json`,
      JSON.stringify(
        {
          name,
          version: '1.0.0',
          scripts: { dev: 'keep-me' },
          dependencies: { other: '1.0.0' },
        },
        null,
        2,
      ) + '\n',
    );
    write(
      `apps/${app}/package-lock.json`,
      JSON.stringify(
        {
          name,
          version: '1.0.0',
          lockfileVersion: 3,
          packages: {
            '': { name, version: '1.0.0' },
            'node_modules/other': { version: '1.0.0', integrity: 'keep-me' },
          },
        },
        null,
        2,
      ) + '\n',
    );
  }
  return {
    root,
    write,
    read: (path) => readFileSync(join(root, path), 'utf8'),
  };
}

test('checks are read-only; synchronization updates every release copy but no dependency', (t) => {
  const f = fixture(t);
  assert.equal(checkVersions(f.root), '1.0.0');
  assert.deepEqual(syncVersions(f.root).paths, []);
  f.write(VERSION_SOURCE, '__version__ = "1.2.3"\n');
  const plan = planVersions(f.root);
  assert.equal(plan.changes.length, 7);
  assert.throws(() => checkVersions(f.root), /Release version drift/);
  for (const entry of plan.inputs)
    assert.equal(f.read(entry.path), entry.before);

  assert.equal(syncVersions(f.root).paths.length, 7);
  assert.equal(checkVersions(f.root), '1.2.3');
  assert.deepEqual(syncVersions(f.root).paths, []);
  assert.match(
    f.read('pyproject.toml'),
    /version = "1.2.3" # keep this comment/,
  );
  assert.match(f.read('pyproject.toml'), /other==1.0.0/);
  assert.match(f.read('pyproject.toml'), /version = "7.0.0"/);
  assert.match(f.read('uv.lock'), /name = "other"\nversion = "1.0.0"/);
  for (const app of ['web', 'desktop']) {
    const pkg = JSON.parse(f.read(`apps/${app}/package.json`));
    const lock = JSON.parse(f.read(`apps/${app}/package-lock.json`));
    assert.equal(pkg.scripts.dev, 'keep-me');
    assert.equal(pkg.dependencies.other, '1.0.0');
    assert.equal(lock.packages[''].version, '1.2.3');
    assert.deepEqual(lock.packages['node_modules/other'], {
      version: '1.0.0',
      integrity: 'keep-me',
    });
  }
});

test('all inputs validate before any write; drift and ambiguous/missing metadata fail closed', (t) => {
  const f = fixture(t);
  f.write(VERSION_SOURCE, '__version__ = "2.0.0"\n');
  const plan = planVersions(f.root);
  const path = 'apps/desktop/package-lock.json';
  const original = f.read(path);
  f.write(
    path,
    original.replace('"lockfileVersion": 3', '"lockfileVersion": 1'),
  );
  assert.throws(() => syncVersions(f.root), /lockfile v3/);
  for (const entry of plan.inputs.filter((entry) => entry.path !== path))
    assert.equal(f.read(entry.path), entry.before);
  f.write(path, original);

  const lock = f.read('uv.lock');
  f.write(
    'uv.lock',
    lock.replace(
      'source = { editable = "apps/api" }',
      'source = { registry = "https://example.invalid" }',
    ),
  );
  assert.throws(() => syncVersions(f.root), /expected workspace package/);
  f.write('uv.lock', lock);
  const manifest = f.read('pyproject.toml');
  f.write(
    'pyproject.toml',
    manifest.replace(
      'version = "1.0.0"',
      'version = "1.0.0"\nversion = "1.0.0"',
    ),
  );
  assert.throws(() => syncVersions(f.root), /exactly one/);
  f.write('pyproject.toml', manifest);
  f.write(VERSION_SOURCE, '__version__ = "2.0.0"\n__version__ = "2.0.1"\n');
  assert.throws(() => syncVersions(f.root), /exactly one/);
  f.write(VERSION_SOURCE, '__version__ = "2.0.0"\n');
  rmSync(join(f.root, path));
  assert.throws(() => syncVersions(f.root), /ENOENT/);
  assert.equal(f.read('pyproject.toml'), manifest);
});

test('Windows CRLF metadata stays CRLF and an isolated npm root lock drift is detected', (t) => {
  const f = fixture(t);
  for (const entry of planVersions(f.root).inputs)
    f.write(entry.path, entry.before.replaceAll('\n', '\r\n'));
  f.write(VERSION_SOURCE, '__version__ = "1.0.1"\r\n');
  syncVersions(f.root);
  for (const entry of planVersions(f.root).inputs)
    assert.doesNotMatch(entry.before, /(?<!\r)\n/);
  const path = 'apps/web/package-lock.json';
  const lock = JSON.parse(f.read(path));
  lock.packages[''].version = '1.0.0';
  f.write(path, JSON.stringify(lock));
  assert.throws(() => checkVersions(f.root), /apps\/web\/package-lock.json/);
  assert.deepEqual(syncVersions(f.root).paths, [path]);
  assert.equal(checkVersions(f.root), '1.0.1');
});

test('stable release policy is explicit and tags cannot bypass it', () => {
  for (const version of ['0.0.0', '1.2.3', '10.20.30'])
    assert.equal(validateVersion(version), version);
  for (const packageVersion of [
    undefined,
    1,
    '',
    'v1.0.0',
    '01.0.0',
    '1.0',
    '1.0.0\n',
    '1.0.0-rc.1',
    '1.0.0+build',
    '9007199254740992.0.0',
  ]) {
    assert.throws(
      () => validateVersion(packageVersion),
      /stable release version/,
    );
    assert.throws(
      () =>
        validateReleaseVersion({
          eventName: 'push',
          releaseTag: `desktop-v${packageVersion}`,
          packageVersion,
        }),
      /stable release version/,
    );
  }
  assert.throws(
    () =>
      validateReleaseVersion({
        eventName: 'push',
        releaseTag: 'desktop-v1.0.1',
        packageVersion: '1.0.0',
      }),
    /mismatch/,
  );
  assert.doesNotThrow(() =>
    validateReleaseVersion({
      eventName: 'workflow_dispatch',
      releaseTag: '',
      packageVersion: '1.0.0',
    }),
  );
});
