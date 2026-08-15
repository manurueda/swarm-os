import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildNextState } from './build-next-state.js';
import type { ModuleSpec } from '../../types.js';
import type { StateFile } from '../../workspace/store.js';
import type { MapModuleResult } from './types.js';

const spec = (slug: string): ModuleSpec => ({
  slug,
  name: slug,
  purpose: '',
  owns: [],
  entryPoints: [],
  dependsOn: [],
});

test('every final module ends asleep', () => {
  const next = buildNextState({ swarms: {} }, 'digest-hash', {}, { summary: '', stack: '' }, [spec('billing')], '2026-08-15', new Map());
  assert.equal(next.swarms['billing']?.state, 'sleeping');
});

test('memoryTokens comes from this run\'s results, falling back to what was already recorded', () => {
  const state: StateFile = { swarms: { billing: { module: 'billing', state: 'awake', memoryTokens: 50 } } };
  const results = new Map<string, MapModuleResult>([
    ['billing', { spec: spec('billing'), status: 'analysed', memoryTokens: 120 }],
  ]);
  const next = buildNextState(state, 'h', {}, { summary: '', stack: '' }, [spec('billing')], '2026-08-15', results);
  assert.equal(next.swarms['billing']?.memoryTokens, 120);
});

test('a module with no new result keeps its previously recorded memoryTokens', () => {
  const state: StateFile = { swarms: { billing: { module: 'billing', state: 'sleeping', memoryTokens: 50 } } };
  const next = buildNextState(state, 'h', {}, { summary: '', stack: '' }, [spec('billing')], '2026-08-15', new Map());
  assert.equal(next.swarms['billing']?.memoryTokens, 50);
});

test('lastMission and lastActiveAt survive from the previous record', () => {
  const state: StateFile = {
    swarms: { billing: { module: 'billing', state: 'awake', lastMission: 'm1', lastActiveAt: '2026-08-01' } },
  };
  const next = buildNextState(state, 'h', {}, { summary: '', stack: '' }, [spec('billing')], '2026-08-15', new Map());
  assert.equal(next.swarms['billing']?.lastMission, 'm1');
  assert.equal(next.swarms['billing']?.lastActiveAt, '2026-08-01');
});

test('a module missing from the new map is dropped from swarms', () => {
  const state: StateFile = {
    swarms: { billing: { module: 'billing', state: 'sleeping' }, rendering: { module: 'rendering', state: 'sleeping' } },
  };
  const next = buildNextState(state, 'h', {}, { summary: '', stack: '' }, [spec('billing')], '2026-08-15', new Map());
  assert.deepEqual(Object.keys(next.swarms), ['billing']);
});

test('carries the digest hash, module hashes, system summary and mappedAt', () => {
  const next = buildNextState(
    { swarms: {} },
    'digest-hash',
    { billing: 'mod-hash' },
    { summary: 'a system', stack: 'TS' },
    [spec('billing')],
    '2026-08-15',
    new Map(),
  );
  assert.equal(next.digestHash, 'digest-hash');
  assert.deepEqual(next.moduleHashes, { billing: 'mod-hash' });
  assert.deepEqual(next.system, { summary: 'a system', stack: 'TS' });
  assert.equal(next.mappedAt, '2026-08-15');
});

test('does not mutate the input state', () => {
  const state: StateFile = { swarms: { billing: { module: 'billing', state: 'sleeping' } } };
  buildNextState(state, 'h', {}, { summary: '', stack: '' }, [], '2026-08-15', new Map());
  assert.deepEqual(Object.keys(state.swarms), ['billing']);
});
