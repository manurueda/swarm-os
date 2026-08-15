import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { detectDrift } from './pipeline.js';
import { buildDigest } from './digest.js';
import { hashFiles, filesFor } from './pipeline/module-files.js';
import { Workspace } from '../workspace/store.js';
import type { ModuleSpec } from '../types.js';

const spec = (slug: string, owns: string[]): ModuleSpec => ({
  slug,
  name: slug,
  purpose: '',
  owns,
  entryPoints: [],
  dependsOn: [],
});

async function tempWorkspace(): Promise<Workspace> {
  const dir = await mkdtemp(join(tmpdir(), 'swarm-map-drift-'));
  return new Workspace(dir);
}

test('a digest that moved without touching any module is not drifted', async () => {
  const workspace = await tempWorkspace();
  await mkdir(join(workspace.repoRoot, 'billing'), { recursive: true });
  await writeFile(join(workspace.repoRoot, 'billing', 'a.ts'), 'export const a = 1;\n', 'utf8');

  const billing = spec('billing', ['billing/**']);
  await workspace.writeModule(billing, '# Billing');

  const before = await buildDigest(workspace.repoRoot);
  const moduleHashes = {
    billing: hashFiles(filesFor(before, billing.owns), before.fingerprints),
  };
  await workspace.writeState({
    swarms: {},
    digestHash: before.hash,
    moduleHashes,
    mappedAt: '2026-08-15T00:00:00.000Z',
  });

  // Touch a file no module owns — the whole-repo digest moves, but billing's
  // files did not.
  await mkdir(join(workspace.repoRoot, 'unowned'), { recursive: true });
  await writeFile(join(workspace.repoRoot, 'unowned', 'b.ts'), 'export const b = 1;\n', 'utf8');

  const after = await buildDigest(workspace.repoRoot);
  assert.notEqual(after.hash, before.hash);

  const result = await detectDrift(workspace);
  assert.equal(result.drifted, false);
  assert.deepEqual(result.changedModules, []);
});

test('a module with no recorded hash is still drift, even when the digest is unchanged', async () => {
  const workspace = await tempWorkspace();
  await mkdir(join(workspace.repoRoot, 'billing'), { recursive: true });
  await writeFile(join(workspace.repoRoot, 'billing', 'a.ts'), 'export const a = 1;\n', 'utf8');

  const billing = spec('billing', ['billing/**']);
  await workspace.writeModule(billing, '# Billing');

  const digest = await buildDigest(workspace.repoRoot);
  await workspace.writeState({
    swarms: {},
    digestHash: digest.hash,
    moduleHashes: {},
    mappedAt: '2026-08-15T00:00:00.000Z',
  });

  const result = await detectDrift(workspace);
  assert.equal(result.drifted, true);
  assert.deepEqual(result.changedModules, ['billing']);
});

test('a module whose own files changed is reported as drift', async () => {
  const workspace = await tempWorkspace();
  await mkdir(join(workspace.repoRoot, 'billing'), { recursive: true });
  await writeFile(join(workspace.repoRoot, 'billing', 'a.ts'), 'export const a = 1;\n', 'utf8');

  const billing = spec('billing', ['billing/**']);
  await workspace.writeModule(billing, '# Billing');

  const before = await buildDigest(workspace.repoRoot);
  const moduleHashes = {
    billing: hashFiles(filesFor(before, billing.owns), before.fingerprints),
  };
  await workspace.writeState({
    swarms: {},
    digestHash: before.hash,
    moduleHashes,
    mappedAt: '2026-08-15T00:00:00.000Z',
  });

  await writeFile(join(workspace.repoRoot, 'billing', 'b.ts'), 'export const b = 1;\n', 'utf8');

  const result = await detectDrift(workspace);
  assert.equal(result.drifted, true);
  assert.deepEqual(result.changedModules, ['billing']);
});
