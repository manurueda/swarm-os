/**
 * Areas: sub-domains inside a module.
 *
 * Measured across a 1,742-file repository, every module's memory saturated its
 * 2,000-token budget regardless of size, and every module held eleven or twelve
 * distinct sub-domains. That works out to about 170 tokens each — one invariant
 * and a landmark line for a whole subsystem. An agent sent to fix background
 * removal loaded forty lines about screen recording and motion graphics it would
 * never touch, and got five lines about the thing it came for.
 *
 * The fix is not finer modules. Thirteen flat modules make routing harder and
 * multiply the cross-module contracts that agents demonstrably invent when they
 * cannot see them. Instead:
 *
 *   routing stays coarse   — few modules, easy to route correctly
 *   memory gets addressed  — each area keeps its own budget, loaded on demand
 *
 * Areas are derived from the directory structure rather than proposed by a
 * model. If a domain's code is colocated, its directories already are its
 * sub-domains; if it is not colocated, `swarm refactor` says so as a
 * `scattered-module` signal, and that is the problem to fix first.
 */

import type { ModuleSpec } from '../types.js';
import { isOwned } from './ownership.js';

export interface AreaSpec {
  /** Unique within the module. */
  slug: string;
  /** Directory this area covers, relative to the repo root. */
  path: string;
  owns: string[];
  fileCount: number;
}

export interface DetectAreasOptions {
  /** An area needs at least this many files to be worth its own memory. */
  minFiles?: number;
  /** Below this many candidate areas, splitting is not worth the machinery. */
  minAreas?: number;
  /** Cap, so a sprawling module does not spawn thirty analysts. */
  maxAreas?: number;
}

/**
 * Group a module's files into areas by their common directory.
 *
 * The grouping level is the shallowest directory below the module's own root
 * that actually branches — for `src/reel_core/{captions,music,sfx}/...` that is
 * the `captions` / `music` / `sfx` level, not `src` and not each leaf.
 */
export function detectAreas(
  spec: ModuleSpec,
  files: string[],
  options: DetectAreasOptions = {},
): AreaSpec[] {
  const minFiles = options.minFiles ?? 8;
  const minAreas = options.minAreas ?? 3;
  const maxAreas = options.maxAreas ?? 12;

  const owned = files.filter((f) => isOwned(f, spec.owns));
  if (owned.length < minFiles * minAreas) return [];

  // Grouping at a fixed depth does not work. A module confined to one package
  // wants the level just inside it; a module spanning `src/*_reel/**`,
  // `scripts/**` and `projects/**` has no common root at all, and grouping at
  // depth 1 yields "src", "scripts", "projects" — directories, not domains.
  //
  // So try each depth and keep the one that discriminates best: the most groups
  // that clear the minimum size. Ties go to the shallower depth, which keeps
  // areas as coarse as they can be while still being real.
  let best: { depth: number; groups: Map<string, string[]> } | undefined;

  for (let depth = 1; depth <= 4; depth += 1) {
    const groups = new Map<string, string[]>();
    for (const file of owned) {
      const parts = file.split('/');
      // A file shallower than the grouping depth has no area of its own.
      if (parts.length <= depth) continue;
      const key = parts.slice(0, depth).join('/');
      const list = groups.get(key);
      if (list) list.push(file);
      else groups.set(key, [file]);
    }

    const qualifying = [...groups.values()].filter((g) => g.length >= minFiles).length;
    const bestQualifying = best
      ? [...best.groups.values()].filter((g) => g.length >= minFiles).length
      : 0;
    if (qualifying > bestQualifying) best = { depth, groups };
  }

  if (!best) return [];

  const areas = [...best.groups.entries()]
    .filter(([, list]) => list.length >= minFiles)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, maxAreas)
    .map(([path, list]) => ({
      slug: slugForPath(path),
      path,
      owns: [`${path}/**`],
      fileCount: list.length,
    }));

  // Splitting into one or two areas buys nothing over the module's own memory.
  return areas.length >= minAreas ? dedupeSlugs(areas) : [];
}

function slugForPath(path: string): string {
  return (
    path
      .split('/')
      .slice(-2)
      .join('-')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'area'
  );
}

function dedupeSlugs(areas: AreaSpec[]): AreaSpec[] {
  const seen = new Set<string>();
  return areas.map((area) => {
    let slug = area.slug;
    let n = 2;
    while (seen.has(slug)) slug = `${area.slug}-${n++}`;
    seen.add(slug);
    return { ...area, slug };
  });
}

/**
 * An area, expressed as a module so the existing analyst can survey it.
 *
 * An area is the same shape of problem as a module — a bounded set of paths
 * that needs durable knowledge — so it gets the same agent rather than a
 * parallel implementation that would drift.
 */
export function areaAsModule(spec: ModuleSpec, area: AreaSpec): ModuleSpec {
  return {
    slug: `${spec.slug}/${area.slug}`,
    name: `${spec.name} — ${area.slug}`,
    purpose: `The \`${area.slug}\` area of ${spec.name}: everything under \`${area.path}\`.`,
    owns: area.owns,
    entryPoints: spec.entryPoints.filter((f) => f.startsWith(`${area.path}/`)),
    dependsOn: [],
    fileCount: area.fileCount,
  };
}

/**
 * The index appended to a module's context pack.
 *
 * Deliberately only an index. Loading every area's memory eagerly would rebuild
 * the exact problem areas exist to solve; the agent reads the one it needs,
 * which is a single Read of a file it has been told the path of.
 */
export function renderAreaIndex(moduleSlug: string, areas: Array<AreaSpec & { tokens?: number }>): string {
  if (areas.length === 0) return '';
  return [
    '# Areas of this module',
    '',
    'This module is large enough that its knowledge is split by area. Each file',
    'below holds the invariants and gotchas for one part of it. Read the ones',
    'your task touches — not all of them.',
    '',
    ...areas.map(
      (a) =>
        `- \`${a.path}\` (${a.fileCount} files) — \`.swarm/modules/${moduleSlug}/areas/${a.slug}/memory.md\``,
    ),
  ].join('\n');
}
