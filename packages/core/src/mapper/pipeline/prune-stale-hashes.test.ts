import { test } from 'node:test';
import assert from 'node:assert/strict';

import { pruneStaleHashes } from './prune-stale-hashes.js';
import type { ModuleSpec } from '../../types.js';

const spec = (slug: string): ModuleSpec => ({
  slug,
  name: slug,
  purpose: '',
  owns: [],
  entryPoints: [],
  dependsOn: [],
});

test('drops hashes for modules no longer in the map', () => {
  const pruned = pruneStaleHashes({ billing: 'h1', rendering: 'h2' }, [spec('billing')]);
  assert.deepEqual(pruned, { billing: 'h1' });
});

test('keeps every hash when every module survives', () => {
  const hashes = { billing: 'h1', rendering: 'h2' };
  assert.deepEqual(pruneStaleHashes(hashes, [spec('billing'), spec('rendering')]), hashes);
});

test('does not mutate the input', () => {
  const hashes = { billing: 'h1', rendering: 'h2' };
  pruneStaleHashes(hashes, [spec('billing')]);
  assert.deepEqual(hashes, { billing: 'h1', rendering: 'h2' });
});
