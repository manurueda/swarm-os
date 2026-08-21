/**
 * verifyCommandMessage rendering.
 *
 * mapProject only sets this field when it detected something worth telling
 * the user about; the cli just surfaces it verbatim, so these tests pin that
 * it prints when present and stays silent when absent.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { MapResult } from '@swarm-os/core';

import { verifyCommandNote } from './map.js';

function fakeResult(overrides: Record<string, unknown> = {}): MapResult {
  return {
    repoName: 'swarm-os',
    modules: [],
    totalFiles: 0,
    totalMemoryTokens: 0,
    conflicts: [],
    archived: [],
    areas: {},
    ...overrides,
  } as unknown as MapResult;
}

test('verifyCommandNote is undefined when the mapper had nothing to report', () => {
  assert.equal(verifyCommandNote(fakeResult()), undefined);
  assert.equal(verifyCommandNote(fakeResult({ verifyCommandMessage: undefined })), undefined);
});

test('verifyCommandNote surfaces a detected command and its reason', () => {
  const note = verifyCommandNote(
    fakeResult({
      verifyCommandMessage:
        'detected verifyCommand: npm test because package.json has a scripts.test entry, alternatives: []',
    }),
  );
  assert.ok(note?.includes('npm test'));
  assert.ok(note?.includes('scripts.test'));
});

test('verifyCommandNote surfaces the no-detection hint verbatim', () => {
  const note = verifyCommandNote(
    fakeResult({
      verifyCommandMessage:
        'no verify command detected — missions will run without verification until verifyCommand is set.',
    }),
  );
  assert.ok(note?.includes('no verify command detected'));
});
