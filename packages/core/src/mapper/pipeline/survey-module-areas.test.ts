/**
 * This unit used to be a closure inside `mapProject` that was defined and
 * never invoked — nothing could construct it in isolation, so nothing caught
 * that. These tests call it directly, the way the orchestrator does, so a
 * missing call site would fail here first.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { surveyModuleAreas } from './survey-module-areas.js';
import { Workspace } from '../../workspace/store.js';
import { Scheduler } from '../../swarm/scheduler.js';
import type { MapProgress } from './types.js';
import type { AgentRuntime, AgentSpec, ModuleSpec, SwarmEvent } from '../../types.js';

async function tempWorkspace(): Promise<Workspace> {
  const dir = await mkdtemp(join(tmpdir(), 'swarm-map-survey-areas-'));
  return new Workspace(dir);
}

const SPEC: ModuleSpec = {
  slug: 'rendering',
  name: 'Rendering',
  purpose: 'Renders video.',
  owns: ['src/rendering/**'],
  entryPoints: [],
  dependsOn: [],
};

/** Three sub-domains of 8 files each — enough for detectAreas to find 3 areas. */
function repoFiles(): string[] {
  const files: string[] = [];
  for (const area of ['captions', 'audio', 'video']) {
    for (let i = 0; i < 8; i += 1) files.push(`src/rendering/${area}/f${i}.ts`);
  }
  return files;
}

/** One sub-domain of 2 files — nowhere near enough for detectAreas to split. */
function smallRepoFiles(): string[] {
  return ['src/rendering/a.ts', 'src/rendering/b.ts'];
}

function respondingRuntime(calls: string[]): AgentRuntime {
  return {
    id: 'stub',
    preflight: async () => ({ ok: true, runtime: 'stub', checks: [] }),
    async *run(spec: AgentSpec): AsyncIterable<SwarmEvent> {
      calls.push(spec.id);
      yield {
        type: 'agent.done',
        at: new Date().toISOString(),
        agentId: spec.id,
        ok: true,
        structured: {
          purpose: `The ${spec.id} area.`,
          entryPoints: [],
          landmarks: [],
          invariants: [],
          gotchas: [],
          publicInterface: [],
          dependsOn: [],
        },
      };
    },
  };
}

function neverCalledRuntime(): AgentRuntime {
  return {
    id: 'never-called',
    preflight: async () => ({ ok: true, runtime: 'never-called', checks: [] }),
    async *run(): AsyncIterable<SwarmEvent> {
      throw new Error('the runtime must not be called when the module has no real sub-domains');
    },
  };
}

test('a module with no real sub-domains is not split, and no agent runs', async () => {
  const workspace = await tempWorkspace();
  const progress: MapProgress[] = [];

  const result = await surveyModuleAreas({
    runtime: neverCalledRuntime(),
    workspace,
    scheduler: new Scheduler({ limit: 2 }),
    spec: SPEC,
    repoFiles: smallRepoFiles(),
    force: false,
    generatedAt: '2026-08-15',
    report: (p) => progress.push(p),
  });

  assert.deepEqual(result.areaNames, []);
  assert.deepEqual(progress, []);
  assert.deepEqual(await workspace.listAreas('rendering'), []);
});

test('a module with real sub-domains is split, surveyed and filed — no memory.md needed to trigger it', async () => {
  const workspace = await tempWorkspace();
  const progress: MapProgress[] = [];
  const calls: string[] = [];

  const result = await surveyModuleAreas({
    runtime: respondingRuntime(calls),
    workspace,
    scheduler: new Scheduler({ limit: 2 }),
    spec: SPEC,
    repoFiles: repoFiles(),
    force: false,
    generatedAt: '2026-08-15',
    report: (p) => progress.push(p),
  });

  assert.deepEqual(result.areaNames.sort(), ['rendering-audio', 'rendering-captions', 'rendering-video']);
  assert.match(progress[0]?.message ?? '', /splitting into 3 areas/);
  assert.equal(progress[0]?.module, 'rendering');
  assert.equal(calls.length, 3, 'one analyst per detected area');

  const areas = await workspace.listAreas('rendering');
  assert.deepEqual(areas.sort(), ['rendering-audio', 'rendering-captions', 'rendering-video']);

  for (const area of areas) {
    const memory = await workspace.readAreaFile('rendering', area, 'memory.md');
    assert.match(memory, new RegExp(`Surveyed 2026-08-15 by the \`rendering/${area}\` analyst`));
    const spec = await workspace.readAreaFile('rendering', area, 'area.json');
    assert.match(spec, new RegExp(`"slug": "${area}"`));
  }
});

test('an area that already has memory is kept but not re-surveyed', async () => {
  const workspace = await tempWorkspace();
  await workspace.writeAreaFile('rendering', 'rendering-captions', 'memory.md', '- already known\n');
  const calls: string[] = [];

  const result = await surveyModuleAreas({
    runtime: respondingRuntime(calls),
    workspace,
    scheduler: new Scheduler({ limit: 2 }),
    spec: SPEC,
    repoFiles: repoFiles(),
    force: false,
    generatedAt: '2026-08-15',
    report: () => {},
  });

  assert.equal(calls.length, 2, 'rendering-captions already has memory, so only the other two are surveyed');
  assert.deepEqual(result.areaNames.sort(), ['rendering-audio', 'rendering-captions', 'rendering-video']);
  assert.equal(
    await workspace.readAreaFile('rendering', 'rendering-captions', 'memory.md'),
    '- already known\n',
    'existing area memory must not be overwritten',
  );
});

test('force re-surveys every area, even ones with existing memory', async () => {
  const workspace = await tempWorkspace();
  await workspace.writeAreaFile('rendering', 'rendering-captions', 'memory.md', '- already known\n');
  const calls: string[] = [];

  await surveyModuleAreas({
    runtime: respondingRuntime(calls),
    workspace,
    scheduler: new Scheduler({ limit: 2 }),
    spec: SPEC,
    repoFiles: repoFiles(),
    force: true,
    generatedAt: '2026-08-15',
    report: () => {},
  });

  assert.equal(calls.length, 3);
});

test('a module already split loses areas the current plan no longer wants once its files shrink below the threshold', async () => {
  const workspace = await tempWorkspace();
  await workspace.writeAreaFile('rendering', 'stale-area', 'memory.md', '- leftover\n');

  const result = await surveyModuleAreas({
    runtime: neverCalledRuntime(),
    workspace,
    scheduler: new Scheduler({ limit: 2 }),
    spec: SPEC,
    repoFiles: smallRepoFiles(),
    force: false,
    generatedAt: '2026-08-15',
    report: () => {},
  });

  assert.deepEqual(result.areaNames, []);
  assert.deepEqual(await workspace.listAreas('rendering'), []);
});
