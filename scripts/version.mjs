#!/usr/bin/env node

// Release metadata is checked before dependency installation. Keep this module
// dependency-free and never import/execute Python application code here.
import { randomUUID } from 'node:crypto';
import {
  closeSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const REPOSITORY_ROOT = fileURLToPath(new URL('../', import.meta.url));
export const VERSION_SOURCE = 'apps/api/app/__init__.py';

export function validateVersion(version) {
  // This repository currently publishes stable releases only. Do not silently
  // translate arbitrary npm prereleases into a different Python release order.
  if (
    typeof version !== 'string' ||
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version) ||
    version.split('.').some((part) => !Number.isSafeInteger(Number(part)))
  ) {
    throw new Error(
      'Expected a stable release version MAJOR.MINOR.PATCH (no prefix, leading zeros, or prerelease suffix)',
    );
  }
  return version;
}

function oneMatch(text, pattern, label) {
  const matches = [...text.matchAll(pattern)];
  if (matches.length !== 1)
    throw new Error(`${label}: expected exactly one version field/section`);
  return matches[0];
}

function replaceVersion(text, version, label) {
  const match = oneMatch(
    text,
    /^(version[\t ]*=[\t ]*")([^"\r\n]+)("[\t ]*(?:#[^\r\n]*)?\r?$)/gm,
    label,
  );
  return (
    text.slice(0, match.index) +
    match[1] +
    version +
    match[3] +
    text.slice(match.index + match[0].length)
  );
}

// These are narrow, fail-closed edits of the repository's static TOML layout,
// not a TOML serializer. Dependency versions and all other bytes stay intact.
function projectManifest(text, name, version, label) {
  const section = oneMatch(
    text,
    /^\[project\][\t ]*\r?\n[^]*?(?=^\[|(?![^]))/gm,
    label,
  );
  const foundName = oneMatch(
    section[0],
    /^name[\t ]*=[\t ]*"([^"\r\n]+)"[\t ]*\r?$/gm,
    label,
  )[1];
  if (foundName !== name) throw new Error(`${label}: expected project ${name}`);
  return (
    text.slice(0, section.index) +
    replaceVersion(section[0], version, label) +
    text.slice(section.index + section[0].length)
  );
}

function workspaceLock(text, version) {
  for (const name of ['receiptbi', 'receiptbi-api']) {
    const packages = [
      ...text.matchAll(/^\[\[package\]\][\t ]*\r?\n[^]*?(?=^\[|(?![^]))/gm),
    ].filter((match) =>
      new RegExp(`^name = "${name}"\\r?$`, 'm').test(match[0]),
    );
    if (packages.length !== 1)
      throw new Error(`uv.lock: expected one workspace package ${name}`);
    const section = packages[0];
    const expectedSource =
      name === 'receiptbi'
        ? 'source = { virtual = "." }'
        : 'source = { editable = "apps/api" }';
    if (!section[0].split(/\r?\n/).includes(expectedSource)) {
      throw new Error(`uv.lock: ${name} is not the expected workspace package`);
    }
    text =
      text.slice(0, section.index) +
      replaceVersion(section[0], version, `uv.lock:${name}`) +
      text.slice(section.index + section[0].length);
  }
  return text;
}

function npmManifest(text, name, version, lock, label) {
  const data = JSON.parse(text);
  if (data.name !== name || typeof data.version !== 'string') {
    throw new Error(`${label}: expected versioned package ${name}`);
  }
  let changed = data.version !== version;
  data.version = version;
  if (lock) {
    const root = data.packages?.[''];
    if (
      data.lockfileVersion !== 3 ||
      root?.name !== name ||
      typeof root.version !== 'string'
    ) {
      throw new Error(
        `${label}: expected npm lockfile v3 with root package ${name}`,
      );
    }
    changed ||= root.version !== version;
    root.version = version;
  }
  if (!changed) return text;
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const indent = /\n([\t ]+)"/.exec(text)?.[1] ?? '  ';
  return JSON.stringify(data, null, indent).replaceAll('\n', newline) + newline;
}

export function planVersions(root = REPOSITORY_ROOT) {
  const inputs = [];
  function read(path) {
    const absolute = join(root, path);
    const stat = lstatSync(absolute);
    if (!stat.isFile()) throw new Error(`${path}: expected a regular file`);
    const before = readFileSync(absolute, 'utf8');
    const entry = { path, absolute, before, after: before, mode: stat.mode };
    inputs.push(entry);
    return entry;
  }

  const source = read(VERSION_SOURCE);
  const version = validateVersion(
    oneMatch(
      source.before,
      /^__version__[\t ]*=[\t ]*"([^"\r\n]+)"[\t ]*\r?$/gm,
      VERSION_SOURCE,
    )[1],
  );
  for (const [path, name] of [
    ['pyproject.toml', 'receiptbi'],
    ['apps/api/pyproject.toml', 'receiptbi-api'],
  ]) {
    const entry = read(path);
    entry.after = projectManifest(entry.before, name, version, path);
  }
  const lock = read('uv.lock');
  lock.after = workspaceLock(lock.before, version);
  for (const app of ['web', 'desktop']) {
    for (const file of ['package.json', 'package-lock.json']) {
      const entry = read(`apps/${app}/${file}`);
      entry.after = npmManifest(
        entry.before,
        `receiptbi-${app}`,
        version,
        file === 'package-lock.json',
        entry.path,
      );
    }
  }
  return {
    version,
    inputs,
    changes: inputs.filter((entry) => entry.before !== entry.after),
  };
}

export function checkVersions(root = REPOSITORY_ROOT) {
  const plan = planVersions(root);
  if (plan.changes.length) {
    throw new Error(
      `Release version drift from ${VERSION_SOURCE} (${plan.version}):\n` +
        plan.changes.map((entry) => `  ${entry.path}`).join('\n') +
        '\nRun node scripts/version.mjs --write, then review the diff.',
    );
  }
  return plan.version;
}

export function syncVersions(root = REPOSITORY_ROOT) {
  const plan = planVersions(root);
  // Validate every input before the first write; malformed/missing metadata
  // must not leave a partly synchronized checkout. No installs or Git writes.
  for (const entry of plan.inputs) {
    if (
      !lstatSync(entry.absolute).isFile() ||
      readFileSync(entry.absolute, 'utf8') !== entry.before
    ) {
      throw new Error(
        `${entry.path}: changed while preparing version synchronization`,
      );
    }
  }
  for (const entry of plan.changes) {
    const temp = join(
      dirname(entry.absolute),
      `.${basename(entry.absolute)}.version-${randomUUID()}.tmp`,
    );
    let owned = false;
    try {
      const fd = openSync(temp, 'wx', entry.mode & 0o777);
      owned = true;
      try {
        writeFileSync(fd, entry.after, 'utf8');
      } finally {
        closeSync(fd);
      }
      renameSync(temp, entry.absolute);
      owned = false;
    } finally {
      if (owned) unlinkSync(temp);
    }
  }
  return {
    version: plan.version,
    paths: plan.changes.map((entry) => entry.path),
  };
}

if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  try {
    const args = process.argv.slice(2);
    if (args.length === 0 || (args.length === 1 && args[0] === '--check')) {
      console.log(`Release versions agree: ${checkVersions()}`);
    } else if (args.length === 1 && args[0] === '--write') {
      const result = syncVersions();
      console.log(
        `Synchronized ${result.paths.length} file(s) to ${result.version}`,
      );
      for (const path of result.paths) console.log(`  ${path}`);
    } else {
      throw new Error(
        `Usage: node scripts/version.mjs [--check|--write]\nEdit ${VERSION_SOURCE} to choose the release version. --check is read-only; --write synchronizes package metadata.`,
      );
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
