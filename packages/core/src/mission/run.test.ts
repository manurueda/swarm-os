/**
 * Quarantine plumbing.
 *
 * Covers the two seams around commitAll's two-commit split that route.ts's
 * network of agent spawns makes impossible to exercise directly: mapping a
 * CommitSplit onto MissionModuleResult, and rendering the resulting fields
 * into the mission report.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { applyCommitSplit, renderMissionReport, type MissionModuleResult } from './run.js';
import type { CommitSplit } from '../git/worktree.js';

function baseResult(overrides: Partial<MissionModuleResult> = {}): MissionModuleResult {
  return {
    module: 'widgets',
    ok: true,
    changedFiles: [],
    ownershipViolations: [],
    quarantinedPaths: [],
    verifyOutcome: 'skipped-no-command',
    refusalCount: 0,
    ...overrides,
  };
}

test('applyCommitSplit: a main commit alone is committed with nothing quarantined', () => {
  const commit: CommitSplit = { mainCommitHash: 'abc123', quarantinedPaths: [] };
  assert.deepEqual(applyCommitSplit(commit), {
    committed: true,
    quarantinedPaths: [],
    quarantineCommitHash: undefined,
  });
});

test('applyCommitSplit: everything out of bounds still counts as committed', () => {
  const commit: CommitSplit = {
    quarantineCommitHash: 'def456',
    quarantinedPaths: ['other-module/file.ts'],
  };
  assert.deepEqual(applyCommitSplit(commit), {
    committed: true,
    quarantinedPaths: ['other-module/file.ts'],
    quarantineCommitHash: 'def456',
  });
});

test('applyCommitSplit: a split with both commits carries both hashes and the quarantined paths', () => {
  const commit: CommitSplit = {
    mainCommitHash: 'abc123',
    quarantineCommitHash: 'def456',
    quarantinedPaths: ['other-module/file.ts', 'other-module/other.ts'],
  };
  const mapped = applyCommitSplit(commit);
  assert.equal(mapped.committed, true);
  assert.equal(mapped.quarantineCommitHash, 'def456');
  assert.deepEqual(mapped.quarantinedPaths, ['other-module/file.ts', 'other-module/other.ts']);
});

test('applyCommitSplit: no changes staged into either commit is not committed', () => {
  const commit: CommitSplit = { quarantinedPaths: [] };
  assert.deepEqual(applyCommitSplit(commit), {
    committed: false,
    quarantinedPaths: [],
    quarantineCommitHash: undefined,
  });
});

test('renderMissionReport: quarantined paths render with the quarantine commit hash', () => {
  const report = renderMissionReport('fix the thing', undefined, [
    baseResult({
      quarantinedPaths: ['other-module/file.ts'],
      quarantineCommitHash: 'def456',
    }),
  ]);
  assert.match(report, /\*\*Quarantined\*\*/);
  assert.match(report, /`def456`/);
  assert.match(report, /- `other-module\/file\.ts`/);
});

test('renderMissionReport: quarantined paths without a hash still render, minus the hash', () => {
  const report = renderMissionReport('fix the thing', undefined, [
    baseResult({ quarantinedPaths: ['other-module/file.ts'] }),
  ]);
  assert.match(report, /\*\*Quarantined\*\*/);
  assert.match(report, /- `other-module\/file\.ts`/);
  assert.doesNotMatch(report, /`undefined`/);
});

test('renderMissionReport: a module with nothing quarantined has no Quarantined section', () => {
  const report = renderMissionReport('fix the thing', undefined, [baseResult()]);
  assert.doesNotMatch(report, /Quarantined/);
});
