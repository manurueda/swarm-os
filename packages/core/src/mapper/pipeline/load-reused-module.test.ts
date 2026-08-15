import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadReusedModuleResult } from './load-reused-module.js';
import { Workspace } from '../../workspace/store.js';
import type { ModuleAnalysisPlan } from './plan-module-analysis.js';

async function tempWorkspace(): Promise<Workspace> {
  const dir = await mkdtemp(join(tmpdir(), 'swarm-map-reused-'));
  return new Workspace(dir);
}

const plan = (): ModuleAnalysisPlan => ({
  spec: {
    slug: 'billing',
    name: 'Billing',
    purpose: '',
    owns: ['src/billing/**'],
    entryPoints: [],
    dependsOn: [],
  },
  hash: 'h',
  unchanged: true,
});

test('reads the existing memory.md and reports it as reused', async () => {
  const workspace = await tempWorkspace();
  await workspace.writeModuleFile('billing', 'memory.md', 'a'.repeat(40));

  const result = await loadReusedModuleResult(workspace, plan());

  assert.equal(result.status, 'reused');
  assert.equal(result.spec.slug, 'billing');
  assert.equal(result.memoryTokens, 10);
});

test('a module with no memory file yet is reused with zero tokens', async () => {
  const workspace = await tempWorkspace();
  const result = await loadReusedModuleResult(workspace, plan());
  assert.equal(result.memoryTokens, 0);
});
