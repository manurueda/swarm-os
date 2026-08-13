/**
 * Structural health signals.
 *
 * Every one of these is computed from the file list and the module map, with no
 * model call. They do not tell you a repository is badly organised — plenty of
 * good code scores badly on some of them — but they say precisely *where* the
 * module boundaries and the directory structure disagree, which is where a
 * refactoring conversation should start.
 *
 * The strongest signal by far is glob fragmentation. A domain that needs
 * fourteen globs to describe itself is a domain whose code is not colocated:
 * the concept exists, but the directory tree does not represent it.
 */

import type { ModuleSpec } from '../types.js';
import type { ImportGraph } from './import-graph.js';
import { findOwnershipConflicts, isOwned, type OwnershipConflict } from '../swarm/ownership.js';
import {
  directoryShapes,
  isCodeFile,
  isJunkName,
  isTestFile,
  median,
  repeatedBasenames,
  type FileStat,
} from './code-stats.js';

export type SignalSeverity = 'info' | 'warn' | 'high';

export interface Signal {
  kind: string;
  severity: SignalSeverity;
  /** Module this concerns, when it is about one. */
  module?: string;
  summary: string;
  /** Concrete supporting facts — paths, counts. */
  evidence: string[];
}

export interface ArchitectureSignals {
  signals: Signal[];
  /** Files no module claims. */
  unowned: string[];
  conflicts: OwnershipConflict[];
  modules: ModuleHealth[];
  coverage: number;
}

export interface ModuleHealth {
  slug: string;
  fileCount: number;
  globCount: number;
  /** Distinct top-level directories the module's globs reach into. */
  rootCount: number;
  /** Distinct parent directories its files actually live in. */
  scatter: number;
  memoryTokens: number;
  /** Landmarks recorded in memory — a proxy for how many sub-domains it holds. */
  subDomains: number;
  dependsOn: string[];
}

export interface ComputeSignalsInput {
  modules: ModuleSpec[];
  files: string[];
  /** memory.md token count and landmark count, per module slug. */
  memory: Record<string, { tokens: number; landmarks: number }>;
  memoryBudget: number;
  /** Line counts for code files. Omit to skip the code-quality signals. */
  stats?: FileStat[];
  /**
   * Real import edges. Omit to skip dependency signals entirely — they are not
   * worth emitting from declared `dependsOn`, which is a model's judgement
   * rather than a fact about the code.
   */
  imports?: ImportGraph;
}

/**
 * Signals about the code itself rather than the module map.
 *
 * These are the ones that matter when a repository is hard to work in for
 * reasons no boundary redraw will fix: files that do too much, directories
 * nobody decided what to call, flat dumping grounds, whole domains with no
 * tests. A module map drawn over code like that will be awkward however it is
 * drawn, because the awkwardness is underneath it.
 *
 * Thresholds are deliberately conservative — these should point at things a
 * developer would agree are worth a look, not generate a lint report.
 */
function codeSignals(
  modules: ModuleSpec[],
  files: string[],
  stats: FileStat[],
): Signal[] {
  const signals: Signal[] = [];
  const byPath = new Map(stats.map((s) => [s.path, s.lines]));

  for (const spec of modules) {
    const owned = files.filter((f) => isOwned(f, spec.owns));
    const code = owned.filter(isCodeFile);
    if (code.length === 0) continue;

    const lines = code.map((f) => byPath.get(f) ?? 0).filter((n) => n > 0);
    const mid = median(lines);

    // -- god files ----------------------------------------------------------
    // Judged relative to the module's own median, so a codebase of naturally
    // long files does not light up everywhere.
    const giants = code
      .map((f) => ({ path: f, lines: byPath.get(f) ?? 0 }))
      .filter((f) => f.lines >= 400 && f.lines >= mid * 3)
      .sort((a, b) => b.lines - a.lines);

    if (giants.length > 0) {
      signals.push({
        kind: 'god-file',
        severity: (giants[0]?.lines ?? 0) >= 1000 ? 'high' : 'warn',
        module: spec.slug,
        summary: `\`${spec.slug}\` has ${giants.length} file(s) far larger than the rest (median ${mid} lines)`,
        evidence: [
          ...giants.slice(0, 5).map((f) => `${f.path} — ${f.lines} lines`),
          'A file several times the module median is usually several',
          'responsibilities that were never separated.',
        ],
      });
    }

    // -- junk-drawer names --------------------------------------------------
    const junk = owned.filter((f) =>
      f.split('/').some((seg, i, arr) => isJunkName(i === arr.length - 1 ? seg : seg)),
    );
    if (junk.length >= 5) {
      const dirs = new Set(
        junk.map((f) => {
          const parts = f.split('/');
          const idx = parts.findIndex((seg, i) => isJunkName(i === parts.length - 1 ? seg : seg));
          return parts.slice(0, idx + 1).join('/');
        }),
      );
      signals.push({
        kind: 'junk-drawer',
        severity: junk.length >= 20 ? 'warn' : 'info',
        module: spec.slug,
        summary: `\`${spec.slug}\` keeps ${junk.length} files under names like utils/helpers/common`,
        evidence: [
          ...[...dirs].slice(0, 5),
          'These names mean the code inside was never given a domain. They grow',
          'without limit because nothing can be said not to belong.',
        ],
      });
    }

    // -- flat dumping grounds -----------------------------------------------
    const shapes = directoryShapes(owned).filter(
      (d) => d.directFiles >= 25 && d.subdirectories === 0,
    );
    if (shapes.length > 0) {
      signals.push({
        kind: 'flat-directory',
        severity: 'info',
        module: spec.slug,
        summary: `\`${spec.slug}\` has ${shapes.length} directory(ies) holding 25+ files with no substructure`,
        evidence: [
          ...shapes.slice(0, 4).map((d) => `${d.dir}/ — ${d.directFiles} files, no subdirectories`),
          'Worth checking whether a grouping exists that was never expressed.',
        ],
      });
    }

    // -- repeated basenames -------------------------------------------------
    const repeats = repeatedBasenames(owned, 5);
    if (repeats.length > 0) {
      signals.push({
        kind: 'repeated-filenames',
        severity: 'info',
        module: spec.slug,
        summary: `\`${spec.slug}\` repeats the same filenames across directories`,
        evidence: [
          ...repeats.slice(0, 5).map(([name, n]) => `${name} — ${n} copies`),
          'Sometimes a healthy convention, sometimes the same logic written',
          'repeatedly because there was nowhere shared to put it.',
        ],
      });
    }

    // -- missing tests ------------------------------------------------------
    const tests = owned.filter(isTestFile);
    if (tests.length === 0 && code.length >= 15) {
      signals.push({
        kind: 'untested-module',
        severity: 'high',
        module: spec.slug,
        summary: `\`${spec.slug}\` has ${code.length} code files and no tests`,
        evidence: [
          'Agents cannot verify their own work here, so every mission touching',
          'this module ends with an unverifiable claim that it worked.',
        ],
      });
    }

    // -- deep nesting -------------------------------------------------------
    const deep = owned.filter((f) => f.split('/').length >= 7);
    if (deep.length >= 5) {
      signals.push({
        kind: 'deep-nesting',
        severity: 'info',
        module: spec.slug,
        summary: `\`${spec.slug}\` has ${deep.length} files nested 7+ levels deep`,
        evidence: [...deep.slice(0, 3), 'Deep paths usually mean a hierarchy standing in for a missing abstraction.'],
      });
    }
  }

  return signals;
}

function topLevel(glob: string): string {
  return glob.split('/')[0]?.replace(/\*+/g, '') ?? '';
}

function parentDir(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? '.' : path.slice(0, i);
}

export function computeSignals(input: ComputeSignalsInput): ArchitectureSignals {
  const { modules, files, memory, memoryBudget } = input;
  const signals: Signal[] = [];

  // -- per-module health ----------------------------------------------------
  const health: ModuleHealth[] = modules.map((m) => {
    const owned = files.filter((f) => isOwned(f, m.owns));
    const roots = new Set(m.owns.map(topLevel).filter(Boolean));
    const dirs = new Set(owned.map(parentDir));
    const mem = memory[m.slug] ?? { tokens: 0, landmarks: 0 };
    return {
      slug: m.slug,
      fileCount: owned.length,
      globCount: m.owns.length,
      rootCount: roots.size,
      scatter: dirs.size,
      memoryTokens: mem.tokens,
      subDomains: mem.landmarks,
      dependsOn: m.dependsOn,
    };
  });

  // -- coverage -------------------------------------------------------------
  const unowned = files.filter((f) => !modules.some((m) => isOwned(f, m.owns)));
  const coverage = files.length === 0 ? 1 : (files.length - unowned.length) / files.length;

  if (unowned.length > 0 && coverage < 0.95) {
    const byDir = new Map<string, number>();
    for (const f of unowned) {
      const root = f.split('/')[0] ?? f;
      byDir.set(root, (byDir.get(root) ?? 0) + 1);
    }
    const top = [...byDir.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
    signals.push({
      kind: 'unowned-files',
      severity: coverage < 0.8 ? 'high' : 'warn',
      summary: `${unowned.length} files (${Math.round((1 - coverage) * 100)}%) belong to no module — no swarm can touch them`,
      evidence: top.map(([dir, n]) => `${dir}/ — ${n} files`),
    });
  }

  // -- overlapping ownership ------------------------------------------------
  const conflicts = findOwnershipConflicts(modules, files);
  for (const conflict of conflicts) {
    signals.push({
      kind: 'ownership-conflict',
      severity: 'high',
      summary: `\`${conflict.a}\` and \`${conflict.b}\` both claim ${conflict.count} file(s) — their worktrees will conflict`,
      evidence: conflict.files,
    });
  }

  // -- glob fragmentation ---------------------------------------------------
  // The clearest structural smell available: a module that needs many globs is
  // a domain the directory tree does not actually express.
  for (const h of health) {
    if (h.globCount >= 6) {
      signals.push({
        kind: 'scattered-module',
        severity: h.globCount >= 12 ? 'high' : 'warn',
        module: h.slug,
        summary: `\`${h.slug}\` needs ${h.globCount} globs across ${h.rootCount} top-level ${h.rootCount === 1 ? 'directory' : 'directories'} — its code is not colocated`,
        evidence: [
          `${h.fileCount} files spread over ${h.scatter} directories`,
          'A domain that is one directory needs one glob. This one is a concept',
          'the directory tree does not represent.',
        ],
      });
    }
  }

  // -- memory pressure ------------------------------------------------------
  // A module whose memory saturates the budget while holding many sub-domains
  // is starving each one. This is the signal that argues for splitting.
  for (const h of health) {
    if (h.memoryTokens >= memoryBudget * 0.9 && h.subDomains >= 6) {
      const perDomain = Math.round(h.memoryTokens / h.subDomains);
      signals.push({
        kind: 'memory-pressure',
        severity: h.subDomains >= 10 ? 'high' : 'warn',
        module: h.slug,
        summary: `\`${h.slug}\` holds ~${h.subDomains} sub-domains in a ${memoryBudget}-token budget — about ${perDomain} tokens each`,
        evidence: [
          `memory is at ${h.memoryTokens} tokens against a budget of ${memoryBudget}`,
          'Every agent waking here loads all of it, including the sub-domains',
          'it will never touch.',
        ],
      });
    }
  }

  // -- size imbalance -------------------------------------------------------
  const sizes = health.map((h) => h.fileCount).filter((n) => n > 0);
  if (sizes.length >= 2) {
    const max = Math.max(...sizes);
    const min = Math.min(...sizes);
    if (max / Math.max(min, 1) >= 10) {
      const biggest = health.find((h) => h.fileCount === max);
      const smallest = health.find((h) => h.fileCount === min);
      signals.push({
        kind: 'size-imbalance',
        severity: 'info',
        summary: `largest module is ${Math.round(max / Math.max(min, 1))}× the smallest`,
        evidence: [
          `${biggest?.slug ?? '?'} — ${max} files`,
          `${smallest?.slug ?? '?'} — ${min} files`,
          'Not wrong by itself, but the big one is where splitting pays.',
        ],
      });
    }
  }

  // -- dependency shape, from real imports ----------------------------------
  // Only emitted when an import graph is supplied. Declared `dependsOn` is an
  // analyst's judgement; a cycle warning built on it cannot be acted on because
  // you cannot tell whether the code or the opinion is wrong.
  if (input.imports) {
    const outgoing = new Map<string, Set<string>>();
    for (const e of input.imports.edges) {
      if (!outgoing.has(e.from)) outgoing.set(e.from, new Set());
      outgoing.get(e.from)?.add(e.to);
    }

    for (const [slug, targets] of outgoing) {
      if (targets.size >= Math.max(3, modules.length - 1)) {
        signals.push({
          kind: 'hub-module',
          severity: 'info',
          module: slug,
          summary: `\`${slug}\` imports from ${targets.size} of ${modules.length - 1} other modules`,
          evidence: [
            `imports: ${[...targets].join(', ')}`,
            'Expected of an application or CLI layer. A problem only if this is',
            'supposed to be a leaf.',
          ],
        });
      }
    }

    for (const cycle of input.imports.cycles) {
      const evidence: string[] = [];
      for (let i = 0; i < cycle.length - 1; i += 1) {
        const edge = input.imports.edges.find((e) => e.from === cycle[i] && e.to === cycle[i + 1]);
        const sample = edge?.samples[0];
        if (sample) evidence.push(`${sample.from} imports ${sample.to}`);
      }
      signals.push({
        kind: 'import-cycle',
        severity: 'high',
        summary: `circular import: ${cycle.join(' → ')}`,
        evidence: [
          ...evidence,
          'Neither module can be understood or changed without the other, and',
          'neither can be woken alone.',
        ],
      });
    }
  }

  // -- the code itself ------------------------------------------------------
  if (input.stats && input.stats.length > 0) {
    signals.push(...codeSignals(modules, files, input.stats));
  }

  const order: Record<SignalSeverity, number> = { high: 0, warn: 1, info: 2 };
  signals.sort((a, b) => order[a.severity] - order[b.severity]);

  return { signals, unowned, conflicts, modules: health, coverage };
}
