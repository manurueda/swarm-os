import { test } from 'node:test';
import assert from 'node:assert/strict';

import { shouldPartition } from './should-partition.js';

test('force always partitions, regardless of existing modules', () => {
  assert.equal(shouldPartition({ force: true }, 5), true);
});

test('repartition always partitions, regardless of existing modules', () => {
  assert.equal(shouldPartition({ repartition: true }, 5), true);
});

test('no existing modules forces a first partition', () => {
  assert.equal(shouldPartition({}, 0), true);
});

test('an existing map with neither flag is reused', () => {
  assert.equal(shouldPartition({}, 5), false);
});

test('force: false is not the same as force being absent', () => {
  assert.equal(shouldPartition({ force: false, repartition: false }, 5), false);
});
