import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { countAreasByModule } from './count-areas-by-module.js';
import { Workspace } from '../../workspace/store.js';
import type { ModuleSpec } from '../../types.js';

async function tempWorkspace(): Promise<Workspace> {
  const dir = await mkdtemp(join(tmpdir(), 'swarm-map-count-areas-'));
  return new Workspace(dir);
}

const spec = (slug: string): ModuleSpec => ({
  slug,
  name: slug,
  purpose: '',
  owns: [],
  entryPoints: [],
  dependsOn: [],
});

test('modules with areas are counted, modules without are omitted entirely', async () => {
  const workspace = await tempWorkspace();
  await workspace.writeAreaFile('billing', 'invoices', 'memory.md', 'x');
  await workspace.writeAreaFile('billing', 'refunds', 'memory.md', 'x');

  const counts = await countAreasByModule(workspace, [spec('billing'), spec('rendering')]);

  assert.deepEqual(counts, { billing: 2 });
});

test('no modules have areas yields an empty record', async () => {
  const workspace = await tempWorkspace();
  const counts = await countAreasByModule(workspace, [spec('billing')]);
  assert.deepEqual(counts, {});
});
