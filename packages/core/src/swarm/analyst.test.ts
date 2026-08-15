/**
 * The module analyst's prompt, and how it changes when the module is split
 * into areas surveyed ahead of it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { analyzeModule, MODULE_ANALYSIS_SCHEMA, moduleAnalysisSchema } from './analyst.js';
import type { AgentRuntime, AgentSpec, ModuleSpec, SwarmEvent } from '../types.js';

const SPEC: ModuleSpec = {
  slug: 'billing',
  name: 'Billing',
  purpose: 'Invoicing.',
  owns: ['src/billing/**'],
  entryPoints: [],
  dependsOn: [],
};

function fakeRuntime(capture: { spec?: AgentSpec }): AgentRuntime {
  return {
    id: 'fake',
    async preflight() {
      return { ok: true, runtime: 'fake', checks: [] };
    },
    async *run(spec: AgentSpec) {
      capture.spec = spec;
      yield { type: 'agent.start', at: '', agentId: spec.id, role: spec.role, sessionId: 's', cwd: spec.cwd } as SwarmEvent;
      yield {
        type: 'agent.done',
        at: '',
        agentId: spec.id,
        ok: true,
        structured: {
          purpose: 'Invoicing.',
          entryPoints: [],
          landmarks: [],
          invariants: [],
          gotchas: [],
          publicInterface: [],
          dependsOn: [],
        },
      } as SwarmEvent;
    },
  };
}

test('says nothing about areas when the module has none', async () => {
  const capture: { spec?: AgentSpec } = {};
  await analyzeModule({
    runtime: fakeRuntime(capture),
    repoRoot: '/repo',
    module: SPEC,
    siblings: [],
    systemSummary: '',
  });
  assert.doesNotMatch(capture.spec?.prompt ?? '', /split into areas/);
});

test('tells the analyst which areas already have their own memory', async () => {
  const capture: { spec?: AgentSpec } = {};
  await analyzeModule({
    runtime: fakeRuntime(capture),
    repoRoot: '/repo',
    module: SPEC,
    siblings: [],
    systemSummary: '',
    areaNames: ['invoicing', 'refunds'],
  });
  const prompt = capture.spec?.prompt ?? '';
  assert.match(prompt, /split into areas/);
  assert.match(prompt, /invoicing, refunds/);
  assert.match(prompt, /ONLY invariants,\ngotchas and interface facts that are true across every area/);
});

const ARRAY_LIMIT_FIELDS = ['entryPoints', 'landmarks', 'invariants', 'gotchas', 'publicInterface'] as const;

function maxItems(schema: ReturnType<typeof moduleAnalysisSchema>, field: (typeof ARRAY_LIMIT_FIELDS)[number]): number {
  const prop = schema.properties[field] as { maxItems: number };
  return prop.maxItems;
}

test('the unsplit schema is unchanged from the frozen constant', () => {
  const unsplit = moduleAnalysisSchema(false);
  assert.deepEqual(unsplit, MODULE_ANALYSIS_SCHEMA);
  assert.equal(maxItems(unsplit, 'entryPoints'), 8);
  assert.equal(maxItems(unsplit, 'landmarks'), 12);
  assert.equal(maxItems(unsplit, 'invariants'), 10);
  assert.equal(maxItems(unsplit, 'gotchas'), 10);
  assert.equal(maxItems(unsplit, 'publicInterface'), 12);
});

test('a split module gets a strictly tighter schema than an unsplit one', () => {
  const unsplit = moduleAnalysisSchema(false);
  const split = moduleAnalysisSchema(true);
  for (const field of ARRAY_LIMIT_FIELDS) {
    assert.ok(
      maxItems(split, field) < maxItems(unsplit, field),
      `${field} should be tighter when split: ${maxItems(split, field)} >= ${maxItems(unsplit, field)}`,
    );
  }
});

test('an empty area list is treated the same as no areas', async () => {
  const capture: { spec?: AgentSpec } = {};
  await analyzeModule({
    runtime: fakeRuntime(capture),
    repoRoot: '/repo',
    module: SPEC,
    siblings: [],
    systemSummary: '',
    areaNames: [],
  });
  assert.doesNotMatch(capture.spec?.prompt ?? '', /split into areas/);
});
