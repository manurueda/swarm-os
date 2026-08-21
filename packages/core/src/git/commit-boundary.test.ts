/**
 * `commitAll` must mechanically enforce a module's ownership boundary, not
 * merely let `checkOwnership` report it afterwards. A diff that touches both
 * a module's own files and someone else's must land as two commits: one
 * holding only the owned paths, one quarantining everything else — including
 * a deletion, the case that motivated this (a module's diff silently deleted
 * another module's files in a real incident).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { git, commitAll } from './worktree.js';

async function initRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'swarm-boundary-'));
  await mkdir(join(root, 'mine'), { recursive: true });
  await mkdir(join(root, 'theirs'), { recursive: true });
  await writeFile(join(root, 'mine', 'a.ts'), 'export const a = 1;\n');
  await writeFile(join(root, 'theirs', 'b.ts'), 'export const b = 1;\n');
  await git(root, ['init', '-q']);
  await git(root, ['config', 'core.excludesFile', '']);
  await git(root, ['add', '-A']);
  await git(root, [
    '-c', 'user.email=test@example.com',
    '-c', 'user.name=Swarm Test',
    '-c', 'commit.gpgsign=false',
    'commit', '-q', '-m', 'init',
  ]);
  return root;
}

test('an owned-only change produces exactly one commit', async () => {
  const root = await initRepo();
  try {
    await writeFile(join(root, 'mine', 'a.ts'), 'export const a = 2;\n');

    const result = await commitAll(root, 'my-module', ['mine/**'], 'update a.ts');

    assert.ok(result.mainCommitHash);
    assert.equal(result.quarantineCommitHash, undefined);
    assert.deepEqual(result.quarantinedPaths, []);

    const count = await git(root, ['rev-list', '--count', 'HEAD']);
    assert.equal(count.stdout.trim(), '2'); // init + the one main commit
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a mixed change produces two commits with the correct file split', async () => {
  const root = await initRepo();
  try {
    await writeFile(join(root, 'mine', 'a.ts'), 'export const a = 2;\n');
    await writeFile(join(root, 'theirs', 'b.ts'), 'export const b = 2;\n');

    const result = await commitAll(root, 'my-module', ['mine/**'], 'update a.ts');

    assert.ok(result.mainCommitHash);
    assert.ok(result.quarantineCommitHash);
    assert.deepEqual(result.quarantinedPaths, ['theirs/b.ts']);

    const mainShow = await git(root, ['show', '--name-only', '--format=', result.mainCommitHash as string]);
    assert.match(mainShow.stdout, /mine\/a\.ts/);
    assert.doesNotMatch(mainShow.stdout, /theirs\/b\.ts/);

    const quarantineShow = await git(root, [
      'show', '--name-only', '--format=%s', result.quarantineCommitHash as string,
    ]);
    assert.match(quarantineShow.stdout, /^OUT OF BOUNDS \(my-module\): theirs\/b\.ts/m);
    assert.match(quarantineShow.stdout, /theirs\/b\.ts/);
    assert.doesNotMatch(quarantineShow.stdout, /mine\/a\.ts/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('an out-of-bounds deletion lands only in the quarantine commit, never the main one', async () => {
  const root = await initRepo();
  try {
    await writeFile(join(root, 'mine', 'a.ts'), 'export const a = 2;\n');
    await unlink(join(root, 'theirs', 'b.ts'));

    const result = await commitAll(root, 'my-module', ['mine/**'], 'update a.ts');

    assert.ok(result.mainCommitHash);
    assert.ok(result.quarantineCommitHash);
    assert.deepEqual(result.quarantinedPaths, ['theirs/b.ts']);

    const mainShow = await git(root, ['show', '--name-only', '--format=', result.mainCommitHash as string]);
    assert.doesNotMatch(mainShow.stdout, /theirs\/b\.ts/);

    const quarantineShow = await git(root, [
      'show', '--name-only', '--format=', result.quarantineCommitHash as string,
    ]);
    assert.match(quarantineShow.stdout, /theirs\/b\.ts/);

    const lsTree = await git(root, ['ls-tree', '-r', '--name-only', 'HEAD']);
    assert.doesNotMatch(lsTree.stdout, /theirs\/b\.ts/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('when every change is out of bounds, only the quarantine commit exists', async () => {
  const root = await initRepo();
  try {
    await writeFile(join(root, 'theirs', 'b.ts'), 'export const b = 2;\n');

    const result = await commitAll(root, 'my-module', ['mine/**'], 'update a.ts');

    assert.equal(result.mainCommitHash, undefined);
    assert.ok(result.quarantineCommitHash);
    assert.deepEqual(result.quarantinedPaths, ['theirs/b.ts']);

    const count = await git(root, ['rev-list', '--count', 'HEAD']);
    assert.equal(count.stdout.trim(), '2'); // init + only the quarantine commit
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('linked paths stay uncommitted in both the main and the quarantine commit', async () => {
  const root = await initRepo();
  try {
    await mkdir(join(root, 'node_modules'));
    await writeFile(join(root, 'node_modules', 'stray.js'), 'noise\n');
    await writeFile(join(root, 'mine', 'a.ts'), 'export const a = 2;\n');
    await writeFile(join(root, 'theirs', 'b.ts'), 'export const b = 2;\n');

    const result = await commitAll(root, 'my-module', ['mine/**'], 'update a.ts', ['node_modules']);

    assert.ok(result.mainCommitHash);
    assert.ok(result.quarantineCommitHash);
    assert.ok(!result.quarantinedPaths.some((p) => p.startsWith('node_modules')));

    const mainShow = await git(root, ['show', '--name-only', '--format=', result.mainCommitHash as string]);
    const quarantineShow = await git(root, [
      'show', '--name-only', '--format=', result.quarantineCommitHash as string,
    ]);
    assert.doesNotMatch(mainShow.stdout, /node_modules/);
    assert.doesNotMatch(quarantineShow.stdout, /node_modules/);

    const status = await git(root, ['status', '--porcelain']);
    assert.match(status.stdout, /node_modules/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a linked path staged by hand before commitAll lands in neither commit, and an out-of-bounds file staged by hand still lands only in quarantine', async () => {
  const root = await initRepo();
  try {
    await mkdir(join(root, 'node_modules'));
    await writeFile(join(root, 'node_modules', 'stray.js'), 'noise\n');
    await writeFile(join(root, 'mine', 'a.ts'), 'export const a = 2;\n');
    await writeFile(join(root, 'theirs', 'b.ts'), 'export const b = 2;\n');

    // Simulate a work agent that already ran `git add` on both before commitAll runs.
    await git(root, ['add', 'node_modules/stray.js', 'theirs/b.ts']);

    const result = await commitAll(root, 'my-module', ['mine/**'], 'update a.ts', ['node_modules']);

    assert.ok(result.mainCommitHash);
    assert.ok(result.quarantineCommitHash);
    assert.deepEqual(result.quarantinedPaths, ['theirs/b.ts']);

    const mainShow = await git(root, ['show', '--name-only', '--format=', result.mainCommitHash as string]);
    const quarantineShow = await git(root, [
      'show', '--name-only', '--format=', result.quarantineCommitHash as string,
    ]);
    assert.match(mainShow.stdout, /mine\/a\.ts/);
    assert.doesNotMatch(mainShow.stdout, /node_modules/);
    assert.doesNotMatch(quarantineShow.stdout, /node_modules/);
    assert.match(quarantineShow.stdout, /theirs\/b\.ts/);

    const status = await git(root, ['status', '--porcelain']);
    assert.match(status.stdout, /node_modules/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a new untracked directory with both owned and out-of-bounds files is split file-by-file, not collapsed to the directory', async () => {
  const root = await initRepo();
  try {
    await mkdir(join(root, 'mine', 'sub'));
    await writeFile(join(root, 'mine', 'sub', 'owned.ts'), 'export const owned = 1;\n');
    await writeFile(join(root, 'mine', 'sub', 'stray.ts'), 'export const stray = 1;\n');

    const result = await commitAll(
      root,
      'my-module',
      ['mine/sub/owned.ts'],
      'add sub files',
    );

    assert.ok(result.mainCommitHash);
    assert.ok(result.quarantineCommitHash);
    assert.deepEqual(result.quarantinedPaths, ['mine/sub/stray.ts']);

    const mainShow = await git(root, ['show', '--name-only', '--format=', result.mainCommitHash as string]);
    assert.match(mainShow.stdout, /mine\/sub\/owned\.ts/);
    assert.doesNotMatch(mainShow.stdout, /mine\/sub\/stray\.ts/);

    const quarantineShow = await git(root, [
      'show', '--name-only', '--format=', result.quarantineCommitHash as string,
    ]);
    assert.match(quarantineShow.stdout, /mine\/sub\/stray\.ts/);
    assert.doesNotMatch(quarantineShow.stdout, /mine\/sub\/owned\.ts/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
