/**
 * Ownership boundaries.
 *
 * Claude Code cannot confine an agent to a set of globs, so the after-the-fact
 * diff check is the only thing making the boundary real. If these matchers are
 * wrong the boundary silently stops existing.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  checkOwnership,
  findOwnershipConflicts,
  isOwned,
  matchesGlob,
} from './ownership.js';

test('matchesGlob handles the glob forms ownership.yaml actually uses', () => {
  assert.equal(matchesGlob('packages/core/src/a.ts', 'packages/core/src/**'), true);
  assert.equal(matchesGlob('packages/core/src/deep/a.ts', 'packages/core/src/**'), true);
  assert.equal(matchesGlob('packages/cli/src/a.ts', 'packages/core/src/**'), false);

  // `**/` matches zero or more segments, so it must match the shallow case too.
  assert.equal(matchesGlob('src/a.ts', 'src/**/*.ts'), true);
  assert.equal(matchesGlob('src/deep/a.ts', 'src/**/*.ts'), true);

  // A single star never crosses a directory boundary.
  assert.equal(matchesGlob('src/a.ts', 'src/*.ts'), true);
  assert.equal(matchesGlob('src/deep/a.ts', 'src/*.ts'), false);

  assert.equal(matchesGlob('src/a.tsx', 'src/*.{ts,tsx}'), true);
  assert.equal(matchesGlob('src/a.css', 'src/*.{ts,tsx}'), false);
});

test('a glob naming a directory owns everything beneath it', () => {
  assert.equal(matchesGlob('src/editor/a.ts', 'src/editor'), true);
  assert.equal(matchesGlob('src/editor/deep/a.ts', 'src/editor/'), true);
  assert.equal(matchesGlob('src/editorial/a.ts', 'src/editor'), false);
});

test('isOwned is satisfied by any one glob', () => {
  const owns = ['packages/core/**', 'docs/**'];
  assert.equal(isOwned('docs/ARCHITECTURE.md', owns), true);
  assert.equal(isOwned('packages/cli/src/main.ts', owns), false);
});

test('checkOwnership separates the module\'s files from its violations', () => {
  const report = checkOwnership(
    ['packages/core/src/a.ts', 'packages/cli/src/main.ts', 'README.md'],
    ['packages/core/**'],
  );
  assert.deepEqual(report.owned, ['packages/core/src/a.ts']);
  assert.deepEqual(report.violations, ['packages/cli/src/main.ts', 'README.md']);
});

test('.swarm/ is always permitted — it is where agents record memory', () => {
  const report = checkOwnership(['.swarm/modules/x/memory.md'], []);
  assert.deepEqual(report.owned, ['.swarm/modules/x/memory.md']);
  assert.deepEqual(report.violations, []);
});

test('overlapping ownership is decided by real files, not by glob prefixes', () => {
  // The common prefix of these two globs is `src/`, which looks like an overlap
  // and is not one. Reporting it would train people to ignore the warning.
  const modules = [
    { slug: 'reels', owns: ['src/*_reel/**'] },
    { slug: 'core', owns: ['src/reel_core/**'] },
  ];
  const conflicts = findOwnershipConflicts(modules, [
    'src/good_reel/a.py',
    'src/reel_core/b.py',
  ]);
  assert.deepEqual(conflicts, []);
});

test('two modules claiming the same file is reported with a count and samples', () => {
  const modules = [
    { slug: 'a', owns: ['src/shared/**'] },
    { slug: 'b', owns: ['src/**'] },
  ];
  const conflicts = findOwnershipConflicts(modules, [
    'src/shared/one.ts',
    'src/shared/two.ts',
    'src/only-b.ts',
  ]);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0]?.count, 2);
  assert.deepEqual(conflicts[0]?.files, ['src/shared/one.ts', 'src/shared/two.ts']);
});
