/**
 * Reading a module's current memory and how big it is.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { readMemoryState } from './memory-state.js';
import type { Workspace } from '../workspace/store.js';

function workspaceWithMemory(text: string): Workspace {
  return {
    async readModuleFile() {
      return text;
    },
  } as unknown as Workspace;
}

test('reports the memory text and its token estimate', async () => {
  const workspace = workspaceWithMemory('- a fact\n- another fact\n');
  const state = await readMemoryState(workspace, 'billing');
  assert.equal(state.before, '- a fact\n- another fact\n');
  assert.ok(state.beforeTokens > 0);
});

test('an empty memory file estimates to zero tokens', async () => {
  const state = await readMemoryState(workspaceWithMemory(''), 'billing');
  assert.equal(state.before, '');
  assert.equal(state.beforeTokens, 0);
});

test('reads the memory file of the requested module, not a hardcoded one', async () => {
  let requestedSlug: string | undefined;
  let requestedFile: string | undefined;
  const workspace = {
    async readModuleFile(slug: string, file: string) {
      requestedSlug = slug;
      requestedFile = file;
      return '';
    },
  } as unknown as Workspace;

  await readMemoryState(workspace, 'rendering');
  assert.equal(requestedSlug, 'rendering');
  assert.equal(requestedFile, 'memory.md');
});
