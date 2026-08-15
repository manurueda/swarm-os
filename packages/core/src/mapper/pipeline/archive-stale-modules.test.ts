import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { archiveStaleModules } from './archive-stale-modules.js';
import { Workspace } from '../../workspace/store.js';
import type { ModuleSpec } from '../../types.js';
import type { MapProgress } from './types.js';

const spec = (slug: string): ModuleSpec => ({
  slug,
  name: slug,
  purpose: '',
  owns: [`${slug}/**`],
  entryPoints: [],
  dependsOn: [],
});

async function tempWorkspace(): Promise<Workspace> {
  const dir = await mkdtemp(join(tmpdir(), 'swarm-map-archive-'));
  return new Workspace(dir);
}

test('modules missing from the new map are archived and reported', async () => {
  const workspace = await tempWorkspace();
  await workspace.writeModule(spec('billing'), '# Billing');
  await workspace.writeModule(spec('rendering'), '# Rendering');

  const progress: MapProgress[] = [];
  const archived = await archiveStaleModules(workspace, [spec('billing')], '2026-08-15', (p) =>
    progress.push(p),
  );

  assert.deepEqual(archived, ['rendering']);
  assert.deepEqual((await workspace.listModules()).map((m) => m.slug), ['billing']);
  assert.match(progress[0]?.message ?? '', /archived 1 module\(s\) no longer in the map: rendering/);
});

test('nothing archived means nothing reported', async () => {
  const workspace = await tempWorkspace();
  await workspace.writeModule(spec('billing'), '# Billing');

  const progress: MapProgress[] = [];
  const archived = await archiveStaleModules(workspace, [spec('billing')], '2026-08-15', (p) =>
    progress.push(p),
  );

  assert.deepEqual(archived, []);
  assert.deepEqual(progress, []);
});
