import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolvePartition } from './resolve-partition.js';
import type { MapProgress } from './types.js';
import type { AgentRuntime, AgentSpec, SwarmEvent } from '../../types.js';

const EXISTING_SYSTEM = { summary: 'existing summary', stack: 'TypeScript' };

test('reusing the existing map does not call the runtime, and reports why', async () => {
  const progress: MapProgress[] = [];
  const runtime: AgentRuntime = {
    id: 'never-called',
    preflight: async () => {
      throw new Error('preflight should not run when reusing the map');
    },
    async *run() {
      throw new Error('run should not be called when reusing the map');
    },
  };

  const result = await resolvePartition({
    partition: false,
    runtime,
    repoRoot: '/does/not/matter',
    existingModules: [
      { slug: 'billing', name: 'Billing', purpose: '', owns: [], entryPoints: [], dependsOn: [] },
    ],
    existingSystem: EXISTING_SYSTEM,
    report: (p) => progress.push(p),
  });

  assert.deepEqual(result.modules.map((m) => m.slug), ['billing']);
  assert.equal(result.system, EXISTING_SYSTEM);
  assert.match(progress[0]?.message ?? '', /reusing existing map/);
});

async function tempGitRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'swarm-map-partition-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  await writeFile(join(dir, 'index.ts'), 'export const x = 1;\n');
  execFileSync('git', ['add', '-A'], { cwd: dir });
  return dir;
}

/** An AgentRuntime that returns a fixed, valid module map without running any agent. */
function stubMapperRuntime(): AgentRuntime {
  return {
    id: 'stub',
    preflight: async () => ({ ok: true, runtime: 'stub', checks: [] }),
    async *run(spec: AgentSpec): AsyncIterable<SwarmEvent> {
      yield { type: 'agent.start', at: new Date().toISOString(), agentId: spec.id, role: spec.role, sessionId: 's1', cwd: spec.cwd };
      yield {
        type: 'agent.done',
        at: new Date().toISOString(),
        agentId: spec.id,
        ok: true,
        structured: {
          system: { summary: 'a repo', stack: 'TypeScript' },
          modules: [
            {
              slug: 'core',
              name: 'Core',
              purpose: 'Everything.',
              owns: ['index.ts'],
              entryPoints: [],
              dependsOn: [],
            },
            {
              slug: 'other',
              name: 'Other',
              purpose: 'Nothing yet.',
              owns: ['nonexistent/**'],
              entryPoints: [],
              dependsOn: [],
            },
          ],
        },
      };
    },
  };
}

test('partitioning calls the mapper agent and reports the proposed modules', async () => {
  const repoRoot = await tempGitRepo();
  const progress: MapProgress[] = [];

  const result = await resolvePartition({
    partition: true,
    runtime: stubMapperRuntime(),
    repoRoot,
    existingModules: [],
    existingSystem: { summary: '', stack: '' },
    report: (p) => progress.push(p),
  });

  assert.deepEqual(result.modules.map((m) => m.slug).sort(), ['core']);
  assert.equal(result.system.summary, 'a repo');
  assert.match(progress[0]?.message ?? '', /proposing module boundaries/);
  assert.match(progress[1]?.message ?? '', /modules proposed/);
});
