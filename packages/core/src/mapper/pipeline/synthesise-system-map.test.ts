import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { synthesiseSystemMap } from './synthesise-system-map.js';
import { Workspace } from '../../workspace/store.js';
import type { ModuleSpec } from '../../types.js';
import type { RepoDigest } from '../digest.js';

async function tempWorkspace(): Promise<Workspace> {
  const dir = await mkdtemp(join(tmpdir(), 'swarm-map-synthesise-'));
  return new Workspace(dir);
}

const digest: RepoDigest = {
  repoName: 'test-repo',
  files: ['src/a.ts'],
  totalFiles: 1,
  languages: [],
  tree: '',
  sourceFiles: ['src/a.ts'],
  docs: [],
  manifests: [],
  hash: 'x',
  fingerprints: new Map(),
};

const moduleSpec: ModuleSpec = {
  slug: 'billing',
  name: 'Billing',
  purpose: 'Handles invoices.',
  owns: ['src/billing/**'],
  entryPoints: [],
  dependsOn: [],
};

test('writes a system map naming the repo and every final module', async () => {
  const workspace = await tempWorkspace();

  await synthesiseSystemMap(
    workspace,
    { summary: 'A test repo.', stack: 'TypeScript' },
    [moduleSpec],
    digest,
  );

  const written = await workspace.readSystem();
  assert.match(written, /test-repo/);
  assert.match(written, /A test repo\./);
  assert.match(written, /billing/);
});
