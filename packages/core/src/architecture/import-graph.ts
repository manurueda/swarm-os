/**
 * A real import graph, extracted with regexes.
 *
 * Why this exists: `dependsOn` in a module's ownership.yaml is a *judgement* an
 * analyst agent made after reading the code. It is usually right, but it is an
 * opinion, and building a "circular dependency" warning on an opinion produces
 * warnings that cannot be trusted or acted on. An edge here means one file
 * literally imports another.
 *
 * Regexes, not parsers. This has to work on any repository without a toolchain,
 * a language server, or a build step, and be fast enough to run every time. The
 * trade is real: dynamic imports, re-exports through barrels, and runtime
 * plugin loading are invisible to it. So this UNDER-reports — an edge it finds
 * is genuine, but absence of an edge is not proof of independence.
 *
 * Unresolvable imports are treated as external and dropped, which is the right
 * default: `import numpy` should not create an edge to a local module that
 * happens to be called numpy.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { isOwned } from '../swarm/ownership.js';
import type { ModuleSpec } from '../types.js';
import { isCodeFile } from './code-stats.js';

const JS_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
const PY_EXTENSIONS = ['.py'];

/**
 * `import x from 'y'`, `export * from 'y'`, `require('y')`, `import('y')`.
 * Group 1 is the whole statement head, so type-only forms can be filtered out.
 */
const JS_IMPORT = /(?:^|\n)(\s*(?:import|export)[^'"\n]*?)from\s*['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)|import\(\s*['"]([^'"]+)['"]\s*\)|(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g;

/**
 * `import type {...} from` and `export type {...} from` are erased at compile
 * time. They create no runtime coupling, so counting them invents dependencies
 * — and in particular makes every module that touches a shared types file look
 * like it depends on whichever module happens to own that file.
 */
const TYPE_ONLY = /^\s*(?:import|export)\s+type\b/;

/**
 * A barrel is a file that only re-exports other modules. Its imports describe
 * the shape of the public API, not a dependency of any particular piece of
 * logic, so treating it as a source produces an edge from its module to
 * everything — and a spurious cycle with whatever imports it back.
 */
function isBarrel(source: string): boolean {
  const statements = source
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('//') && !l.startsWith('*') && !l.startsWith('/*'));
  if (statements.length === 0) return false;
  const reexports = statements.filter((l) => /^export\s+(?:\*|type\s*\{|\{)/.test(l)).length;
  return reexports >= Math.max(3, statements.length * 0.6);
}

/** `import a.b.c`, `from a.b import c`, `from .relative import c`. */
const PY_IMPORT = /(?:^|\n)\s*(?:from\s+([.\w]+)\s+import|import\s+([.\w]+))/g;

export interface ImportEdge {
  from: string;
  to: string;
}

export interface ModuleEdge {
  from: string;
  to: string;
  /** How many distinct file-level imports back this edge. */
  count: number;
  /** A few concrete examples, for evidence. */
  samples: ImportEdge[];
}

export interface ImportGraph {
  /** Module-to-module edges, backed by real imports. */
  edges: ModuleEdge[];
  /** Cycles among modules, deduplicated by member set. */
  cycles: string[][];
  /** How many files were successfully scanned. */
  scanned: number;
  /** Imports that could not be resolved to a file in this repo. */
  unresolved: number;
}

function dirOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
}

function normalize(path: string): string {
  const parts: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') parts.pop();
    else parts.push(segment);
  }
  return parts.join('/');
}

/** Try a specifier against the real file set, with the usual extension dance. */
function resolve(candidate: string, files: Set<string>, extensions: string[]): string | undefined {
  if (files.has(candidate)) return candidate;

  // A TS source importing `./x.js` is the compiled name of `./x.ts`.
  const withoutExt = candidate.replace(/\.(js|mjs|cjs)$/, '');
  for (const ext of extensions) {
    if (files.has(withoutExt + ext)) return withoutExt + ext;
    if (files.has(candidate + ext)) return candidate + ext;
  }
  for (const ext of extensions) {
    if (files.has(`${candidate}/index${ext}`)) return `${candidate}/index${ext}`;
    if (files.has(`${candidate}/__init__${ext}`)) return `${candidate}/__init__${ext}`;
  }
  return undefined;
}

function extractSpecifiers(source: string, isPython: boolean): string[] {
  const out: string[] = [];

  if (isPython) {
    PY_IMPORT.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = PY_IMPORT.exec(source)) !== null) {
      const spec = match[1] ?? match[2];
      if (spec) out.push(spec);
    }
    return out;
  }

  JS_IMPORT.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = JS_IMPORT.exec(source)) !== null) {
    const head = match[1];
    // Type-only imports vanish at compile time — no runtime dependency.
    if (head && TYPE_ONLY.test(head)) continue;
    const spec = match[2] ?? match[3] ?? match[4] ?? match[5];
    if (spec) out.push(spec);
  }
  return out;
}

/**
 * Resolve one import specifier to a repo file, or undefined if it is external.
 *
 * Python absolute imports are matched against every plausible source root
 * because `from reel_core.captions import x` is written relative to a root that
 * is on `sys.path`, not to the repo.
 */
function resolveSpecifier(
  spec: string,
  fromFile: string,
  files: Set<string>,
  roots: string[],
  isPython: boolean,
): string | undefined {
  const extensions = isPython ? PY_EXTENSIONS : JS_EXTENSIONS;

  if (isPython) {
    if (spec.startsWith('.')) {
      // Leading dots count levels up from the containing package.
      const up = /^\.+/.exec(spec)?.[0].length ?? 1;
      const rest = spec.slice(up).replace(/\./g, '/');
      const base = dirOf(fromFile).split('/').slice(0, -(up - 1) || undefined).join('/');
      return resolve(normalize(rest ? `${base}/${rest}` : base), files, extensions);
    }
    const asPath = spec.replace(/\./g, '/');
    for (const root of roots) {
      const hit = resolve(normalize(root ? `${root}/${asPath}` : asPath), files, extensions);
      if (hit) return hit;
    }
    return undefined;
  }

  if (spec.startsWith('.')) {
    return resolve(normalize(`${dirOf(fromFile)}/${spec}`), files, extensions);
  }
  // Bare specifiers are packages. In a monorepo one may still be a local
  // workspace, but that is resolved through package.json, not the filesystem —
  // out of scope for a regex pass.
  return undefined;
}

export async function buildImportGraph(
  repoRoot: string,
  files: string[],
  modules: ModuleSpec[],
): Promise<ImportGraph> {
  const code = files.filter(isCodeFile);
  const fileSet = new Set(files);

  // Plausible Python source roots, so absolute package imports resolve.
  const roots = ['', 'src', 'lib', 'app'].filter(
    (r) => r === '' || files.some((f) => f.startsWith(`${r}/`)),
  );

  const moduleOf = (path: string): string | undefined =>
    modules.find((m) => isOwned(path, m.owns))?.slug;

  const pairs = new Map<string, ModuleEdge>();
  let scanned = 0;
  let unresolved = 0;

  for (const file of code) {
    let source: string;
    try {
      source = await readFile(join(repoRoot, file), 'utf8');
    } catch {
      continue;
    }
    scanned += 1;

    const isPython = file.endsWith('.py');
    const fromModule = moduleOf(file);
    if (!fromModule) continue;
    // A barrel's edges describe the public API surface, not coupling.
    if (!isPython && isBarrel(source)) continue;

    for (const spec of extractSpecifiers(source, isPython)) {
      const target = resolveSpecifier(spec, file, fileSet, roots, isPython);
      if (!target) {
        unresolved += 1;
        continue;
      }
      const toModule = moduleOf(target);
      if (!toModule || toModule === fromModule) continue;

      const key = `${fromModule}→${toModule}`;
      const existing = pairs.get(key);
      if (existing) {
        existing.count += 1;
        if (existing.samples.length < 3) existing.samples.push({ from: file, to: target });
      } else {
        pairs.set(key, {
          from: fromModule,
          to: toModule,
          count: 1,
          samples: [{ from: file, to: target }],
        });
      }
    }
  }

  const edges = [...pairs.values()].sort((a, b) => b.count - a.count);
  return { edges, cycles: findCycles(edges), scanned, unresolved };
}

/** Cycles over real import edges, deduplicated by member set. */
function findCycles(edges: ModuleEdge[]): string[][] {
  const graph = new Map<string, string[]>();
  for (const e of edges) {
    if (!graph.has(e.from)) graph.set(e.from, []);
    graph.get(e.from)?.push(e.to);
  }

  const found = new Map<string, string[]>();
  const walk = (node: string, path: string[]): void => {
    const at = path.indexOf(node);
    if (at !== -1) {
      const cycle = [...path.slice(at), node];
      const key = [...new Set(cycle)].sort().join('|');
      if (!found.has(key)) found.set(key, cycle);
      return;
    }
    if (path.length > 12) return;
    for (const next of graph.get(node) ?? []) walk(next, [...path, node]);
  };

  for (const node of graph.keys()) walk(node, []);

  const sets = [...found.entries()].map(([key, cycle]) => ({
    key,
    members: new Set(key.split('|')),
    cycle,
  }));

  return sets
    .filter(
      (a) =>
        !sets.some(
          (b) =>
            b.key !== a.key &&
            b.members.size > a.members.size &&
            [...a.members].every((m) => b.members.has(m)),
        ),
    )
    .map((s) => s.cycle);
}
