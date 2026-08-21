/**
 * checkStaleBuild mirrors the fast-path check `tsc --build` itself uses:
 * newest source mtime vs. `tsconfig.tsbuildinfo` mtime, per package. These
 * tests build a throwaway fixture tree under the OS temp dir rather than
 * touching the real repo's build artifacts.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { checkStaleBuild } from './stale-build.js';

/** A repoRoot with packages/core and packages/cli, each with a src/ tree. */
function makeRepoFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'swarm-stale-build-'));
  for (const pkg of ['core', 'cli']) {
    const src = join(root, 'packages', pkg, 'src');
    mkdirSync(src, { recursive: true });
    writeFileSync(join(src, 'index.ts'), 'export {};\n');
  }
  return root;
}

function touch(path: string, time: Date): void {
  utimesSync(path, time, time);
}

test('tsbuildinfo newer than all sources is not stale', () => {
  const root = makeRepoFixture();
  try {
    const earlier = new Date(Date.now() - 60_000);
    const later = new Date();
    for (const pkg of ['core', 'cli']) {
      const dir = join(root, 'packages', pkg);
      touch(join(dir, 'src', 'index.ts'), earlier);
      writeFileSync(join(dir, 'tsconfig.tsbuildinfo'), '{}');
      touch(join(dir, 'tsconfig.tsbuildinfo'), later);
    }

    assert.deepEqual(checkStaleBuild(root), { stale: false });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a source file newer than tsbuildinfo is stale', () => {
  const root = makeRepoFixture();
  try {
    const earlier = new Date(Date.now() - 60_000);
    const later = new Date();
    for (const pkg of ['core', 'cli']) {
      const dir = join(root, 'packages', pkg);
      touch(join(dir, 'src', 'index.ts'), earlier);
      writeFileSync(join(dir, 'tsconfig.tsbuildinfo'), '{}');
      touch(join(dir, 'tsconfig.tsbuildinfo'), earlier);
    }

    // Edit a source file in one of the two checked packages after its build.
    touch(join(root, 'packages', 'cli', 'src', 'index.ts'), later);

    assert.deepEqual(checkStaleBuild(root), { stale: true });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a missing tsbuildinfo is stale', () => {
  const root = makeRepoFixture();
  try {
    // Only build packages/cli; packages/core never got a tsbuildinfo.
    writeFileSync(join(root, 'packages', 'cli', 'tsconfig.tsbuildinfo'), '{}');

    assert.deepEqual(checkStaleBuild(root), { stale: true });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a missing or garbage package directory does not throw', () => {
  const root = mkdtempSync(join(tmpdir(), 'swarm-stale-build-garbage-'));
  try {
    assert.doesNotThrow(() => checkStaleBuild(root));
    assert.deepEqual(checkStaleBuild(root), { stale: false });

    assert.doesNotThrow(() => checkStaleBuild('/definitely/not/a/real/path/at/all'));
    assert.deepEqual(checkStaleBuild('/definitely/not/a/real/path/at/all'), { stale: false });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
