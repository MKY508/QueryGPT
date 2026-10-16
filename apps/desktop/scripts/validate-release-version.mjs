#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkVersions, validateVersion } from '../../../scripts/version.mjs';

export function validateReleaseVersion({ eventName, releaseTag, packageVersion }) {
  validateVersion(packageVersion);
  if (eventName === 'push') {
    const expected = `desktop-v${packageVersion}`;
    if (releaseTag !== expected) {
      throw new Error(
        `Desktop tag/version mismatch: received "${releaseTag}", expected "${expected}" from apps/desktop/package.json`
      );
    }
    return `Validated desktop release ${releaseTag}`;
  }

  if (eventName === 'workflow_dispatch') {
    if (!releaseTag) return `Validated build-only desktop run for ${packageVersion}`;
    const match = /^(?:desktop-)?v(.+)$/.exec(releaseTag);
    if (!match) {
      throw new Error(
        `Invalid workflow_dispatch release_tag "${releaseTag}"; expected v${packageVersion} or desktop-v${packageVersion}`
      );
    }
    if (match[1] !== packageVersion) {
      throw new Error(
        `Desktop release_tag/version mismatch: received "${releaseTag}", package version is "${packageVersion}"`
      );
    }
    return `Validated desktop release target ${releaseTag}`;
  }

  throw new Error(`Unsupported desktop release event: ${eventName}`);
}

function runSelfTest() {
  assert.equal(
    validateReleaseVersion({
      eventName: 'push',
      releaseTag: 'desktop-v1.0.0',
      packageVersion: '1.0.0',
    }),
    'Validated desktop release desktop-v1.0.0'
  );
  assert.doesNotThrow(() => validateReleaseVersion({
    eventName: 'workflow_dispatch',
    releaseTag: 'v1.0.0',
    packageVersion: '1.0.0',
  }));
  assert.doesNotThrow(() => validateReleaseVersion({
    eventName: 'workflow_dispatch',
    releaseTag: 'desktop-v1.0.0',
    packageVersion: '1.0.0',
  }));
  assert.doesNotThrow(() => validateReleaseVersion({
    eventName: 'workflow_dispatch',
    releaseTag: '',
    packageVersion: '1.0.0',
  }));
  assert.throws(() => validateReleaseVersion({
    eventName: 'push',
    releaseTag: 'desktop-v1.9.0',
    packageVersion: '1.0.0',
  }), /mismatch/);
  assert.throws(() => validateReleaseVersion({
    eventName: 'workflow_dispatch',
    releaseTag: 'v1.9.0',
    packageVersion: '1.0.0',
  }), /mismatch/);
  console.log('Desktop release version validator self-test passed');
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? '' : '';
}

const isMain = process.argv[1]
  && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isMain) {
  try {
    if (process.argv.includes('--self-test')) {
      runSelfTest();
    } else {
      const releaseVersion = checkVersions();
      const packagePath = argument('--package') || fileURLToPath(new URL('../package.json', import.meta.url));
      const packageVersion = JSON.parse(readFileSync(packagePath, 'utf-8')).version;
      if (packageVersion !== releaseVersion) {
        throw new Error(`Desktop package version ${packageVersion} differs from release authority ${releaseVersion}`);
      }
      const message = validateReleaseVersion({
        eventName: argument('--event'),
        releaseTag: argument('--tag'),
        packageVersion,
      });
      console.log(message);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
