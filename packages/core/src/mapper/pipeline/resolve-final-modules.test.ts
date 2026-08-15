import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveFinalModules } from './resolve-final-modules.js';
import type { ModuleSpec } from '../../types.js';
import type { MapModuleResult } from './types.js';

const spec = (slug: string, purpose: string): ModuleSpec => ({
  slug,
  name: slug,
  purpose,
  owns: [],
  entryPoints: [],
  dependsOn: [],
});

test('an analysed module wins over the proposed spec', () => {
  const proposed = [spec('billing', 'proposed')];
  const results = new Map<string, MapModuleResult>([
    ['billing', { spec: spec('billing', 'analysed'), status: 'analysed' }],
  ]);
  assert.equal(resolveFinalModules(proposed, results)[0]?.purpose, 'analysed');
});

test('a module with no result yet keeps the proposed spec', () => {
  const proposed = [spec('billing', 'proposed')];
  assert.equal(resolveFinalModules(proposed, new Map())[0]?.purpose, 'proposed');
});

test('order follows the proposed module list, not the results map', () => {
  const proposed = [spec('a', ''), spec('b', ''), spec('c', '')];
  const results = new Map<string, MapModuleResult>([
    ['c', { spec: spec('c', ''), status: 'analysed' }],
    ['a', { spec: spec('a', ''), status: 'analysed' }],
  ]);
  assert.deepEqual(
    resolveFinalModules(proposed, results).map((m) => m.slug),
    ['a', 'b', 'c'],
  );
});
