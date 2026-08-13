/**
 * Cheap, language-agnostic facts about the code itself.
 *
 * Everything here comes from file paths and line counts — no parsing, no
 * language servers, no model. That keeps it instant on a 20,000-file repository
 * and correct for any language.
 *
 * These facts are not judgements. A 900-line file is not automatically wrong.
 * But they locate the places worth *looking*, and they give a refactoring agent
 * something concrete to start from instead of "read the module and tell me what
 * you think", which on a large module is exactly the unbounded exploration this
 * whole tool exists to avoid.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface FileStat {
  path: string;
  lines: number;
}

const TEST_PATTERN = /(^|\/)(tests?|__tests__|spec)(\/|$)|\.(test|spec)\.[a-z]+$|(^|\/)test_[^/]+$|_test\.[a-z]+$/i;

/**
 * Names that signal a directory nobody decided what to call.
 *
 * Deliberately short. `core`, `lib`, `shared` and `tools` were in this list and
 * produced pure noise — they are standard package names in most monorepos, so
 * flagging them fires on healthy code and trains people to ignore the signal.
 * Only names that are *specifically* an admission of "no idea where this goes"
 * belong here.
 */
const JUNK_NAMES = new Set([
  'utils',
  'util',
  'helpers',
  'helper',
  'misc',
  'miscellaneous',
  'stuff',
  'various',
  'other',
  'extras',
]);

/** Extensions worth counting lines for. Assets and data are excluded. */
const CODE_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs',
  'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift', 'scala',
  'c', 'h', 'cc', 'cpp', 'hpp', 'cs', 'm', 'mm',
  'php', 'ex', 'exs', 'erl', 'clj', 'hs', 'ml', 'lua',
  'vue', 'svelte', 'sh', 'bash', 'zsh', 'sql',
]);

export function isCodeFile(path: string): boolean {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot > 0 && CODE_EXTENSIONS.has(base.slice(dot + 1).toLowerCase());
}

export function isTestFile(path: string): boolean {
  return TEST_PATTERN.test(path);
}

/**
 * Line counts for a set of files, via batched `wc -l`.
 *
 * Batched because spawning one process per file would dominate the runtime, and
 * chunked because argv has a length limit that a large repository will exceed.
 */
export async function countLines(repoRoot: string, files: string[]): Promise<FileStat[]> {
  const code = files.filter(isCodeFile);
  const stats: FileStat[] = [];
  const CHUNK = 400;

  for (let i = 0; i < code.length; i += CHUNK) {
    const chunk = code.slice(i, i + CHUNK);
    try {
      const { stdout } = await execFileAsync('wc', ['-l', ...chunk], {
        cwd: repoRoot,
        maxBuffer: 32 * 1024 * 1024,
      });
      for (const raw of stdout.split('\n')) {
        const m = /^\s*(\d+)\s+(.+)$/.exec(raw);
        if (!m?.[1] || !m[2]) continue;
        const path = m[2].trim();
        if (path === 'total') continue;
        stats.push({ path, lines: Number(m[1]) });
      }
    } catch {
      // A chunk can fail on a deleted or unreadable file; skip it rather than
      // losing the whole measurement.
    }
  }

  return stats;
}

export interface DirectoryShape {
  dir: string;
  /** Files directly inside, not counting subdirectories. */
  directFiles: number;
  subdirectories: number;
  depth: number;
}

export function directoryShapes(files: string[]): DirectoryShape[] {
  const direct = new Map<string, number>();
  const subdirs = new Map<string, Set<string>>();

  for (const file of files) {
    const parts = file.split('/');
    const dir = parts.slice(0, -1).join('/') || '.';
    direct.set(dir, (direct.get(dir) ?? 0) + 1);

    // Register every ancestor so a directory of only-directories still appears.
    for (let i = 0; i < parts.length - 1; i += 1) {
      const parent = parts.slice(0, i).join('/') || '.';
      const child = parts.slice(0, i + 1).join('/');
      if (!subdirs.has(parent)) subdirs.set(parent, new Set());
      subdirs.get(parent)?.add(child);
      if (!direct.has(parent)) direct.set(parent, direct.get(parent) ?? 0);
    }
  }

  return [...direct.entries()].map(([dir, directFiles]) => ({
    dir,
    directFiles,
    subdirectories: subdirs.get(dir)?.size ?? 0,
    depth: dir === '.' ? 0 : dir.split('/').length,
  }));
}

export function isJunkName(name: string): boolean {
  const stem = name.replace(/\.[^.]+$/, '').toLowerCase();
  return JUNK_NAMES.has(stem);
}

/** Basenames appearing many times inside one module. */
export function repeatedBasenames(files: string[], min = 4): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const file of files) {
    const base = file.slice(file.lastIndexOf('/') + 1);
    // `index.ts`, `__init__.py` and `mod.rs` are conventions, not duplication.
    if (/^(index|__init__|mod|main)\.[a-z]+$/i.test(base)) continue;
    counts.set(base, (counts.get(base) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([, n]) => n >= min).sort((a, b) => b[1] - a[1]);
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round(((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2)
    : (sorted[mid] ?? 0);
}
