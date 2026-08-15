import { test } from 'node:test';
import assert from 'node:assert/strict';

import { planModuleAnalysis } from './plan-module-analysis.js';
import type { RepoDigest } from '../digest.js';
import type { ModuleSpec } from '../../types.js';

const digest = (files: string[]): RepoDigest => ({
  repoName: 'test-repo',
  files,
  totalFiles: files.length,
  languages: [],
  tree: '',
  sourceFiles: files,
  docs: [],
  manifests: [],
  hash: 'x',
  fingerprints: new Map(files.map((f) => [f, `print:${f}`])),
});

const spec = (overrides: Partial<ModuleSpec> = {}): ModuleSpec => ({
  slug: 'billing',
  name: 'Billing',
  purpose: 'Handles billing.',
  owns: ['src/billing/**'],
  entryPoints: [],
  dependsOn: [],
  ...overrides,
});

test('fileCount is filled in from what the digest actually matches', () => {
  const d = digest(['src/billing/a.ts', 'src/billing/b.ts', 'src/other/c.ts']);
  const plan = planModuleAnalysis(d, spec(), {}, false);
  assert.equal(plan.spec.fileCount, 2);
});

test('a module with no recorded hash is never unchanged', () => {
  const d = digest(['src/billing/a.ts']);
  const plan = planModuleAnalysis(d, spec(), {}, false);
  assert.equal(plan.unchanged, false);
});

test('a module whose fingerprint matches the recorded one is unchanged', () => {
  const d = digest(['src/billing/a.ts']);
  const first = planModuleAnalysis(d, spec(), {}, false);
  const second = planModuleAnalysis(d, spec(), { billing: first.hash }, false);
  assert.equal(second.unchanged, true);
});

test('force always re-analyses, even when the hash matches', () => {
  const d = digest(['src/billing/a.ts']);
  const first = planModuleAnalysis(d, spec(), {}, false);
  const forced = planModuleAnalysis(d, spec(), { billing: first.hash }, true);
  assert.equal(forced.unchanged, false);
});

test('a changed file set changes the hash and is re-analysed', () => {
  const before = digest(['src/billing/a.ts']);
  const beforePlan = planModuleAnalysis(before, spec(), {}, false);

  const after = digest(['src/billing/a.ts', 'src/billing/b.ts']);
  const afterPlan = planModuleAnalysis(after, spec(), { billing: beforePlan.hash }, false);

  assert.notEqual(afterPlan.hash, beforePlan.hash);
  assert.equal(afterPlan.unchanged, false);
});
