/**
 * Whether a sleep can skip the compressor entirely.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { shouldSkipCompression } from './compression-budget.js';

test('skips compression when nothing happened and memory is within budget', () => {
  assert.equal(shouldSkipCompression(undefined, 500, 1000), true);
});

test('does not skip when memory already exceeds the budget', () => {
  assert.equal(shouldSkipCompression(undefined, 1500, 1000), false);
});

test('does not skip when a mission report is present, even under budget', () => {
  assert.equal(shouldSkipCompression('the mission did X', 500, 1000), false);
});

test('exactly at budget still counts as within it', () => {
  assert.equal(shouldSkipCompression(undefined, 1000, 1000), true);
});

test('an empty-string mission report is falsy and still allows a skip', () => {
  assert.equal(shouldSkipCompression('', 500, 1000), true);
});
