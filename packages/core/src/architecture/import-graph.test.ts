/**
 * Dependency edges must come from imports, never from opinions.
 *
 * `dependsOn` is a judgement an analyst agent wrote down; an edge here means one
 * file literally imports another. The two exclusions below were learned by
 * running this against Swarm OS itself, where counting them reported the cycle
 * `mapper → orchestrator → runtime → mapper` — which was a shared types file and
 * an index re-export, and not a cycle at all.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { buildImportGraph } from './import-graph.js';
import type { ModuleSpec } from '../types.js';

function mod(slug: string): ModuleSpec {
  return { slug, name: slug, purpose: '', owns: [`${slug}/**`], entryPoints: [], dependsOn: [] };
}

/** Write a fixture repo and return its root plus the file list. */
async function fixture(files: Record<string, string>): Promise<{ root: string; paths: string[] }> {
  const root = await mkdtemp(join(tmpdir(), 'swarm-imports-'));
  for (const [path, source] of Object.entries(files)) {
    await mkdir(join(root, dirname(path)), { recursive: true });
    await writeFile(join(root, path), source);
  }
  return { root, paths: Object.keys(files) };
}

test('type-only imports and barrels do not create dependencies', async () => {
  const { root, paths } = await fixture({
    // A barrel: its imports describe a public API, not what any logic needs.
    'pkg-a/index.ts': [
      "export * from '../pkg-b/one.js';",
      "export * from '../pkg-b/two.js';",
      "export * from '../pkg-b/three.js';",
      '',
    ].join('\n'),
    // Erased at compile time — no runtime coupling.
    'pkg-a/typed.ts': "import type { One } from '../pkg-b/one.js';\n\nexport const marker: One | undefined = undefined;\n",
    // The only real edge in this repo, plus one import that leaves it.
    'pkg-a/real.ts': "import { parse } from 'yaml';\nimport { one } from '../pkg-b/one.js';\n\nexport const y = one(parse('x'));\n",
    'pkg-b/one.ts': 'export const one = (v: unknown): unknown => v;\n',
    'pkg-b/two.ts': 'export const two = 2;\n',
    'pkg-b/three.ts': 'export const three = 3;\n',
  });

  try {
    const graph = await buildImportGraph(root, paths, [mod('pkg-a'), mod('pkg-b')]);

    assert.equal(graph.scanned, 6);
    assert.equal(graph.edges.length, 1, 'only the value import counts');
    assert.equal(graph.edges[0]?.from, 'pkg-a');
    assert.equal(graph.edges[0]?.to, 'pkg-b');
    assert.equal(graph.edges[0]?.count, 1);
    assert.deepEqual(graph.edges[0]?.samples, [{ from: 'pkg-a/real.ts', to: 'pkg-b/one.ts' }]);
    assert.deepEqual(graph.cycles, []);

    // A package import is external, not an edge to a local file of the same name.
    assert.equal(graph.unresolved, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a real cycle is reported once, not once per member', async () => {
  const { root, paths } = await fixture({
    'pkg-a/real.ts': "import { two } from '../pkg-b/two.js';\n\nexport const real = two;\n",
    'pkg-b/two.ts': "import { real } from '../pkg-a/real.js';\n\nexport const two = real;\n",
  });

  try {
    const graph = await buildImportGraph(root, paths, [mod('pkg-a'), mod('pkg-b')]);

    assert.equal(graph.edges.length, 2);
    assert.equal(graph.cycles.length, 1);
    assert.deepEqual(new Set(graph.cycles[0]), new Set(['pkg-a', 'pkg-b']));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('imports within one module are not edges', async () => {
  const { root, paths } = await fixture({
    'pkg-a/one.ts': "import { two } from './two.js';\n\nexport const one = two;\n",
    'pkg-a/two.ts': 'export const two = 2;\n',
  });

  try {
    const graph = await buildImportGraph(root, paths, [mod('pkg-a')]);
    assert.deepEqual(graph.edges, []);
    assert.equal(graph.unresolved, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
