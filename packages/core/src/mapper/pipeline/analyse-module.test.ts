import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { analyseModule } from './analyse-module.js';
import { Workspace } from '../../workspace/store.js';
import type { ModuleAnalysisPlan } from './plan-module-analysis.js';
import type { AgentRuntime, AgentSpec, SwarmEvent } from '../../types.js';
import type { RepoDigest } from '../digest.js';

async function tempWorkspace(): Promise<Workspace> {
  const dir = await mkdtemp(join(tmpdir(), 'swarm-map-analyse-'));
  return new Workspace(dir);
}

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
  fingerprints: new Map(),
});

const plan = (overrides: Partial<ModuleAnalysisPlan['spec']> = {}): ModuleAnalysisPlan => ({
  spec: {
    slug: 'billing',
    name: 'Billing',
    purpose: 'provisional purpose',
    owns: ['src/billing/**'],
    entryPoints: [],
    dependsOn: [],
    ...overrides,
  },
  hash: 'original-hash',
  unchanged: false,
});

function runtimeReturning(structured: unknown, ok = true): AgentRuntime {
  return {
    id: 'stub',
    preflight: async () => ({ ok: true, runtime: 'stub', checks: [] }),
    async *run(spec: AgentSpec): AsyncIterable<SwarmEvent> {
      yield {
        type: 'agent.done',
        at: new Date().toISOString(),
        agentId: spec.id,
        ok,
        ...(ok ? { structured } : {}),
        costUsd: 0.01,
      };
    },
  };
}

function capturingRuntime(structured: unknown, prompts: string[]): AgentRuntime {
  return {
    id: 'stub',
    preflight: async () => ({ ok: true, runtime: 'stub', checks: [] }),
    async *run(spec: AgentSpec): AsyncIterable<SwarmEvent> {
      prompts.push(spec.prompt);
      yield {
        type: 'agent.done',
        at: new Date().toISOString(),
        agentId: spec.id,
        ok: true,
        structured,
        costUsd: 0.01,
      };
    },
  };
}

test('a successful analysis writes the charter and memory, and hashes stay put when globs are not corrected', async () => {
  const workspace = await tempWorkspace();
  const digestWithFiles = digest(['src/billing/a.ts', 'src/billing/b.ts']);

  const outcome = await analyseModule({
    runtime: runtimeReturning({
      purpose: 'Handles invoicing.',
      entryPoints: [{ path: 'src/billing/a.ts', why: 'main entry' }],
      landmarks: [],
      invariants: [],
      gotchas: [],
      publicInterface: [],
      dependsOn: [],
    }),
    workspace,
    digest: digestWithFiles,
    entry: plan(),
    siblings: [],
    systemSummary: 'A billing system.',
    generatedAt: '2026-08-15',
  });

  assert.equal(outcome.status, 'analysed');
  if (outcome.status !== 'analysed') return;
  assert.equal(outcome.spec.purpose, 'Handles invoicing.');
  assert.equal(outcome.hash, 'original-hash', 'the hash is reused unless the analyst corrected its globs');

  const charter = await workspace.readModuleFile('billing', 'module.md');
  assert.match(charter, /Handles invoicing\./);
  const memory = await workspace.readModuleFile('billing', 'memory.md');
  assert.match(memory, /billing/);
});

test('correctedOwns recomputes fileCount and the hash from the new file set', async () => {
  const workspace = await tempWorkspace();
  const digestWithFiles = digest(['src/billing/a.ts', 'src/invoicing/b.ts']);

  const outcome = await analyseModule({
    runtime: runtimeReturning({
      purpose: 'Handles invoicing.',
      entryPoints: [],
      landmarks: [],
      invariants: [],
      gotchas: [],
      publicInterface: [],
      dependsOn: [],
      correctedOwns: ['src/invoicing/**'],
    }),
    workspace,
    digest: digestWithFiles,
    entry: plan(),
    siblings: [],
    systemSummary: '',
    generatedAt: '2026-08-15',
  });

  assert.equal(outcome.status, 'analysed');
  if (outcome.status !== 'analysed') return;
  assert.deepEqual(outcome.spec.owns, ['src/invoicing/**']);
  assert.equal(outcome.spec.fileCount, 1);
  assert.notEqual(outcome.hash, 'original-hash');
});

test('areaNames tells the analyst per-area memory exists, without touching the persisted charter', async () => {
  const workspace = await tempWorkspace();
  const digestWithFiles = digest(['src/billing/a.ts', 'src/billing/b.ts']);
  const prompts: string[] = [];

  const outcome = await analyseModule({
    runtime: capturingRuntime(
      {
        purpose: 'Handles invoicing.',
        entryPoints: [],
        landmarks: [],
        invariants: [],
        gotchas: [],
        publicInterface: [],
        dependsOn: [],
      },
      prompts,
    ),
    workspace,
    digest: digestWithFiles,
    entry: plan(),
    siblings: [],
    systemSummary: 'A billing system.',
    areaNames: ['billing-invoices', 'billing-refunds'],
    generatedAt: '2026-08-15',
  });

  assert.equal(outcome.status, 'analysed');
  // Delivered as a real parameter now, so what reaches the agent is the
  // analyst's own wording rather than a note appended to the system summary.
  assert.match(prompts[0] ?? '', /billing-invoices, billing-refunds/);
  assert.match(prompts[0] ?? '', /true across every area/i);
  assert.doesNotMatch(
    prompts[0] ?? '',
    /A billing system\.\n\nThis module's memory is already split/,
    'the area signal must not be smuggled through systemSummary',
  );

  const charter = await workspace.readModuleFile('billing', 'module.md');
  assert.doesNotMatch(charter, /already split by area/, 'the note is prompt-only, never persisted');
});

test('a failed analysis writes a structural charter, drops no hash and reports the error', async () => {
  const workspace = await tempWorkspace();

  const outcome = await analyseModule({
    runtime: runtimeReturning(undefined, false),
    workspace,
    digest: digest([]),
    entry: plan(),
    siblings: [],
    systemSummary: 'A system.',
    generatedAt: '2026-08-15',
  });

  assert.equal(outcome.status, 'failed');
  if (outcome.status !== 'failed') return;
  assert.equal(outcome.spec.slug, 'billing');
  assert.ok(outcome.error.length > 0);

  const charter = await workspace.readModuleFile('billing', 'module.md');
  assert.match(charter, /analyst did not complete/);
  // A failed analyst must never write memory.md itself — only writeModule's
  // one-time seed may exist, never anything the failed analysis produced.
  assert.match(await workspace.readModuleFile('billing', 'memory.md'), /None recorded yet/);
});
