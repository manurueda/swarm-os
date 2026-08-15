import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { recordModuleProgress } from './record-module-progress.js';
import { createSerialQueue } from './serial-queue.js';
import { Workspace } from '../../workspace/store.js';

async function tempWorkspace(): Promise<Workspace> {
  const dir = await mkdtemp(join(tmpdir(), 'swarm-map-record-progress-'));
  return new Workspace(dir);
}

test('writes the module hash and marks the swarm sleeping', async () => {
  const workspace = await tempWorkspace();
  const queue = createSerialQueue();

  await recordModuleProgress(workspace, queue, 'billing', 'hash-1', 250);

  const state = await workspace.readState();
  assert.equal(state.moduleHashes?.['billing'], 'hash-1');
  assert.deepEqual(state.swarms['billing'], { module: 'billing', state: 'sleeping', memoryTokens: 250 });
});

test('preserves hashes recorded by concurrent writes through the same queue', async () => {
  const workspace = await tempWorkspace();
  const queue = createSerialQueue();

  await Promise.all([
    recordModuleProgress(workspace, queue, 'billing', 'hash-billing', 100),
    recordModuleProgress(workspace, queue, 'rendering', 'hash-rendering', 200),
  ]);

  const state = await workspace.readState();
  assert.equal(state.moduleHashes?.['billing'], 'hash-billing');
  assert.equal(state.moduleHashes?.['rendering'], 'hash-rendering');
});
