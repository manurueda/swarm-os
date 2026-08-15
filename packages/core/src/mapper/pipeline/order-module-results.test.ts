import { test } from 'node:test';
import assert from 'node:assert/strict';

import { orderModuleResults } from './order-module-results.js';
import type { ModuleSpec } from '../../types.js';
import type { MapModuleResult } from './types.js';

const spec = (slug: string): ModuleSpec => ({
  slug,
  name: slug,
  purpose: '',
  owns: [],
  entryPoints: [],
  dependsOn: [],
});

test('follows module order, not results insertion order', () => {
  const results = new Map<string, MapModuleResult>([
    ['b', { spec: spec('b'), status: 'analysed' }],
    ['a', { spec: spec('a'), status: 'analysed' }],
  ]);
  assert.deepEqual(
    orderModuleResults([spec('a'), spec('b')], results).map((r) => r.spec.slug),
    ['a', 'b'],
  );
});

test('a module never processed gets a failed placeholder', () => {
  const [result] = orderModuleResults([spec('a')], new Map());
  assert.equal(result?.status, 'failed');
  assert.equal(result?.error, 'not processed');
});
