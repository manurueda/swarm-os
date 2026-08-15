/**
 * The last step of a sleep: rewrite memory.md, if there is a new one, and
 * record the swarm as sleeping.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { writeMemoryAndUpdateState } from './finalize-sleep.js';
import type { SwarmRecord } from '../types.js';
import type { Workspace } from '../workspace/store.js';

function recordingWorkspace() {
  const writes: Array<{ slug: string; content: string }> = [];
  const patches: Array<{ slug: string; patch: Partial<SwarmRecord> }> = [];
  const workspace = {
    async writeModuleFile(slug: string, _file: string, content: string) {
      writes.push({ slug, content });
    },
    async updateSwarm(slug: string, patch: Partial<SwarmRecord>) {
      patches.push({ slug, patch });
      return { module: slug, state: 'sleeping', ...patch } as SwarmRecord;
    },
  } as unknown as Workspace;
  return { workspace, writes, patches };
}

test('writes the new module memory when one is given', async () => {
  const { workspace, writes } = recordingWorkspace();
  await writeMemoryAndUpdateState(workspace, 'billing', '# new memory\n', 42);
  assert.equal(writes.length, 1);
  assert.equal(writes[0]?.slug, 'billing');
  assert.equal(writes[0]?.content, '# new memory\n');
});

test('leaves the module memory file untouched when none is given', async () => {
  const { workspace, writes } = recordingWorkspace();
  await writeMemoryAndUpdateState(workspace, 'billing', undefined, 42);
  assert.equal(writes.length, 0);
});

test('always marks the swarm sleeping with the given token count', async () => {
  const { workspace, patches } = recordingWorkspace();
  const record = await writeMemoryAndUpdateState(workspace, 'billing', undefined, 42);
  assert.equal(patches.length, 1);
  assert.equal(patches[0]?.patch.state, 'sleeping');
  assert.equal(patches[0]?.patch.memoryTokens, 42);
  assert.ok(typeof patches[0]?.patch.lastActiveAt === 'string');
  assert.equal(record.state, 'sleeping');
});
