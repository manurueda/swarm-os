/**
 * verifyOutcome/refusalCount rendering.
 *
 * mission contracts these fields onto MissionModuleResult; the cli only
 * displays what it is given, so these tests pin that the display functions
 * read the fields verbatim (no recomputation) and degrade gracefully when a
 * field is absent — e.g. a @swarm-os/core build from before it landed.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { MissionModuleResult } from '@swarm-os/core';

import {
  formatRefusals,
  formatVerify,
  quarantineCommitHashOf,
  quarantinedPathsOf,
  refusalCountOf,
  verifyOutcomeOf,
} from './mission.js';

function fakeResult(overrides: Record<string, unknown> = {}): MissionModuleResult {
  return {
    module: 'cli',
    ok: true,
    changedFiles: [],
    ownershipViolations: [],
    ...overrides,
  } as unknown as MissionModuleResult;
}

test('verifyOutcomeOf reads the field verbatim and is undefined when absent', () => {
  assert.equal(verifyOutcomeOf(fakeResult({ verifyOutcome: 'passed' })), 'passed');
  assert.equal(verifyOutcomeOf(fakeResult({ verifyOutcome: 'failed' })), 'failed');
  assert.equal(verifyOutcomeOf(fakeResult({ verifyOutcome: 'skipped-no-command' })), 'skipped-no-command');
  assert.equal(verifyOutcomeOf(fakeResult()), undefined);
});

test('refusalCountOf reads the field verbatim and defaults to 0 when absent', () => {
  assert.equal(refusalCountOf(fakeResult({ refusalCount: 3 })), 3);
  assert.equal(refusalCountOf(fakeResult({ refusalCount: 0 })), 0);
  assert.equal(refusalCountOf(fakeResult()), 0);
});

test('formatVerify labels each outcome and falls back to a dash', () => {
  assert.match(formatVerify('passed'), /passed/);
  assert.match(formatVerify('failed'), /failed/);
  assert.match(formatVerify('skipped-no-command'), /skip/);
  assert.doesNotMatch(formatVerify(undefined), /passed|failed|skip/);
});

test('formatRefusals only calls out a nonzero count', () => {
  assert.doesNotMatch(formatRefusals(0), /\d*[1-9]/);
  const flagged = formatRefusals(2);
  assert.match(flagged, /2/);
  assert.notEqual(flagged, formatRefusals(0));
});

test('quarantinedPathsOf reads the field verbatim and defaults to empty when absent', () => {
  assert.deepEqual(
    quarantinedPathsOf(fakeResult({ quarantinedPaths: ['assets/foo.wav', 'assets/CREDITS.md'] })),
    ['assets/foo.wav', 'assets/CREDITS.md'],
  );
  assert.deepEqual(quarantinedPathsOf(fakeResult()), []);
});

test('quarantineCommitHashOf reads the field verbatim and is undefined when absent', () => {
  assert.equal(quarantineCommitHashOf(fakeResult({ quarantineCommitHash: 'abc1234' })), 'abc1234');
  assert.equal(quarantineCommitHashOf(fakeResult()), undefined);
});
