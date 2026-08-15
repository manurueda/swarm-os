/**
 * The clean-tree check `swarm loop` refuses to start without.
 *
 * Regression for the run that broke itself: a mission writes mission.json,
 * plan.md and report.md while it runs, so with those files tracked the loop
 * failed its own clean-tree check on the second round, having caused the
 * problem itself. Changes under `.swarm/` are the tool's bookkeeping and never
 * the user's work — including on a repository that committed them before they
 * were ignored.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { git, isWorkingTreeClean, isWorkingTreeCleanIgnoringSwarm } from './worktree.js';

/** A repo with one source file and one tracked `.swarm/` file, committed. */
async function repoWithSwarmFilesTracked(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'swarm-git-'));
  await git(root, ['init', '-q']);
  await mkdir(join(root, '.swarm'), { recursive: true });
  await writeFile(join(root, 'a.ts'), 'export const a = 1;\n');
  await writeFile(join(root, '.swarm', 'config.yaml'), 'version: 1\n');
  await git(root, ['add', '-A']);
  await git(root, [
    '-c', 'user.email=test@example.com',
    '-c', 'user.name=Swarm Test',
    '-c', 'commit.gpgsign=false',
    'commit', '-q', '-m', 'init',
  ]);
  return root;
}

test('a committed tree is clean by either measure', async () => {
  const root = await repoWithSwarmFilesTracked();
  try {
    assert.equal(await isWorkingTreeClean(root), true);
    assert.equal(await isWorkingTreeCleanIgnoringSwarm(root), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a mission writing its own record does not make the tree dirty', async () => {
  const root = await repoWithSwarmFilesTracked();
  try {
    // Untracked, as a mission record normally is.
    await mkdir(join(root, '.swarm', 'missions', '2026-08-13-x'), { recursive: true });
    await writeFile(join(root, '.swarm', 'missions', '2026-08-13-x', 'mission.json'), '{}\n');
    // And tracked, as it is on a repo that committed these before they were ignored.
    await writeFile(join(root, '.swarm', 'config.yaml'), 'version: 1\nmodel: opus\n');

    assert.equal(await isWorkingTreeClean(root), false, 'git does consider this dirty');
    assert.equal(await isWorkingTreeCleanIgnoringSwarm(root), true, 'the loop must not');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('uncommitted work of the user\'s own still blocks the loop', async () => {
  const root = await repoWithSwarmFilesTracked();
  try {
    await writeFile(join(root, 'a.ts'), 'export const a = 2;\n');
    assert.equal(await isWorkingTreeCleanIgnoringSwarm(root), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('an untracked file outside .swarm blocks the loop too', async () => {
  const root = await repoWithSwarmFilesTracked();
  try {
    await writeFile(join(root, 'scratch.ts'), 'export const b = 1;\n');
    assert.equal(await isWorkingTreeCleanIgnoringSwarm(root), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
