import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { areasWithMemory } from './areas-with-memory.js';
import { Workspace } from '../../workspace/store.js';

async function tempWorkspace(): Promise<Workspace> {
  const dir = await mkdtemp(join(tmpdir(), 'swarm-map-areas-memory-'));
  return new Workspace(dir);
}

test('an area with written memory counts as recorded', async () => {
  const workspace = await tempWorkspace();
  await workspace.writeAreaFile('billing', 'invoices', 'memory.md', '- something learned\n');

  assert.deepEqual([...(await areasWithMemory(workspace, 'billing'))], ['invoices']);
});

test('an area with a blank memory file is not recorded', async () => {
  const workspace = await tempWorkspace();
  await workspace.writeAreaFile('billing', 'invoices', 'memory.md', '   \n');

  assert.deepEqual([...(await areasWithMemory(workspace, 'billing'))], []);
});

test('a module with no areas yet returns an empty set', async () => {
  const workspace = await tempWorkspace();
  assert.deepEqual([...(await areasWithMemory(workspace, 'billing'))], []);
});
