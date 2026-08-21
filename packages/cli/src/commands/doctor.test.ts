/**
 * verifyCommand soft-check rendering.
 *
 * doctorCommand only calls this when config.verifyCommand is empty; these
 * tests pin what it says given a VerifyCommandDetection, without touching
 * the filesystem detectVerifyCommand reads from or driving a full
 * doctorCommand run.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { VerifyCommandDetection } from '@swarm-os/core';

import { verifyCommandCheckLines } from './doctor.js';

test('verifyCommandCheckLines explains the verify loop is disabled', () => {
  const lines = verifyCommandCheckLines({ command: null, reason: '', alternatives: [] });
  assert.ok(lines.some((l) => l.includes('verifyCommand') && l.includes('disabled')));
  assert.ok(lines.some((l) => /no build.*no test.*no gate/.test(l)));
});

test('verifyCommandCheckLines surfaces a detected command and its reason', () => {
  const detection: VerifyCommandDetection = {
    command: 'npm test',
    reason: 'package.json has a scripts.test entry',
    alternatives: [],
  };
  const lines = verifyCommandCheckLines(detection);
  assert.ok(lines.some((l) => l.includes('npm test') && l.includes('scripts.test')));
});

test('verifyCommandCheckLines hints at setting verifyCommand when nothing is detected', () => {
  const lines = verifyCommandCheckLines({ command: null, reason: '', alternatives: [] });
  assert.ok(lines.some((l) => l.includes('nothing detected')));
  assert.ok(lines.some((l) => l.includes('verifyCommand') && l.includes('.swarm/config.yaml')));
});
