/**
 * Deterministic repository digest.
 *
 * The mapper must not read a large codebase into a context window in order to
 * decide how to split it up — that is the exact failure this tool exists to
 * avoid. So the shape of the repo is computed here with plain filesystem and
 * git operations, and compressed into a few kilobytes of markdown. Only that
 * digest is ever sent to a model.
 *
 * A 1,700-file repository produces roughly 6 KB of digest.
 */

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface RepoDigest {
  repoName: string;
  /** Every tracked, non-noise file. Used to scope modules; never sent to a model. */
  files: string[];
  totalFiles: number;
  /** Extension -> file count, most common first. */
  languages: Array<[string, number]>;
  /** Indented directory tree with per-directory file counts. */
  tree: string;
  /** Full path list, populated only for small repositories. */
  sourceFiles: string[];
  /** Headings lifted from existing architecture docs. */
  docs: Array<{ path: string; headings: string[] }>;
  /** Project manifests found at the root. */
  manifests: Array<{ path: string; excerpt: string }>;
  /** Fingerprint of every file's path AND content, to detect drift after mapping. */
  hash: string;
  /** Per-file content fingerprints, so per-module drift can be computed. */
  fingerprints: Map<string, string>;
}

/** Under this many tracked files, send real paths instead of aggregates. */
const SMALL_REPO_FILES = 400;

const DOC_CANDIDATES = [
  'README.md',
  'ARCHITECTURE.md',
  'CLAUDE.md',
  'AGENTS.md',
  'CONTRIBUTING.md',
  'PIPELINE.md',
  'docs/ARCHITECTURE.md',
  'docs/architecture.md',
];

const MANIFEST_CANDIDATES = [
  'package.json',
  'pyproject.toml',
  'Cargo.toml',
  'go.mod',
  'pom.xml',
  'build.gradle',
  'Gemfile',
  'composer.json',
];

/** Directories that are never a meaningful domain boundary. */
const NOISE_SEGMENTS = new Set([
  'node_modules',
  '__pycache__',
  '.git',
  'dist',
  'build',
  '.next',
  '.venv',
  'venv',
  'target',
  'vendor',
  '.mypy_cache',
  '.pytest_cache',
  '.ruff_cache',
  'coverage',
  '.turbo',
  'egg-info',
]);

function isNoise(path: string): boolean {
  return path
    .split('/')
    .some((seg) => NOISE_SEGMENTS.has(seg) || seg.endsWith('.egg-info'));
}

/**
 * Content fingerprints, one per tracked file.
 *
 * The fingerprint has to change when a file's CONTENT changes, not only when
 * files are added or removed. Hashing the path list alone means a module whose
 * code was rewritten entirely still looks untouched, is never re-analysed, and
 * its memory quietly goes stale — which defeats the whole point of re-mapping
 * when you sit back down at a project.
 *
 * `git ls-files -s` gives the index blob SHA for free, so this costs one git
 * call rather than reading every file. Working-tree edits that are not staged
 * do not change that SHA, so `git status` supplies those separately.
 */
async function fileFingerprints(repoRoot: string, files: string[]): Promise<Map<string, string>> {
  const prints = new Map<string, string>();

  try {
    const { stdout } = await execFileAsync('git', ['ls-files', '-s', '-z'], {
      cwd: repoRoot,
      maxBuffer: 64 * 1024 * 1024,
    });
    for (const entry of stdout.split('\0')) {
      // "<mode> <sha> <stage>\t<path>"
      const tab = entry.indexOf('\t');
      if (tab === -1) continue;
      const meta = entry.slice(0, tab).split(' ');
      const path = entry.slice(tab + 1);
      if (meta[1]) prints.set(path, meta[1]);
    }

    // Anything modified in the working tree gets its own marker, so an unstaged
    // edit counts as drift too.
    const { stdout: status } = await execFileAsync('git', ['status', '--porcelain', '-z'], {
      cwd: repoRoot,
      maxBuffer: 16 * 1024 * 1024,
    });
    for (const entry of status.split('\0')) {
      const path = entry.slice(3).trim();
      if (path) prints.set(path, `dirty:${entry.slice(0, 2)}:${path}`);
    }
  } catch {
    // Not a git repo: fall back to size and mtime, which is coarser but still
    // reacts to edits.
    const { stat } = await import('node:fs/promises');
    for (const file of files) {
      try {
        const info = await stat(join(repoRoot, file));
        prints.set(file, `${info.size}:${Math.floor(info.mtimeMs)}`);
      } catch {
        prints.set(file, 'missing');
      }
    }
  }

  return prints;
}

/** List tracked files via git, falling back to a filesystem walk. */
async function listFiles(repoRoot: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync('git', ['ls-files', '-z'], {
      cwd: repoRoot,
      maxBuffer: 64 * 1024 * 1024,
    });
    const files = stdout.split('\0').filter(Boolean);
    if (files.length > 0) return files.filter((f) => !isNoise(f));
  } catch {
    /* not a git repo, or git unavailable */
  }

  const { readdir } = await import('node:fs/promises');
  const out: string[] = [];
  const walk = async (dir: string, prefix: string, depth: number): Promise<void> => {
    if (depth > 12 || out.length > 200_000) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.github') continue;
      if (NOISE_SEGMENTS.has(entry.name)) continue;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(join(dir, entry.name), rel, depth + 1);
      else out.push(rel);
    }
  };
  await walk(repoRoot, '', 0);
  return out;
}

interface TreeNode {
  name: string;
  count: number;
  children: Map<string, TreeNode>;
}

function buildTree(files: string[]): TreeNode {
  const root: TreeNode = { name: '', count: 0, children: new Map() };
  for (const file of files) {
    const parts = file.split('/');
    root.count += 1;
    let node = root;
    // Directories only — the leaf filename is not a node.
    for (let i = 0; i < parts.length - 1; i += 1) {
      const seg = parts[i] as string;
      let child = node.children.get(seg);
      if (!child) {
        child = { name: seg, count: 0, children: new Map() };
        node.children.set(seg, child);
      }
      child.count += 1;
      node = child;
    }
  }
  return root;
}

/**
 * Render the tree, descending only into directories large enough to matter and
 * stopping once the output budget is spent. Large directories are expanded
 * further than small ones, so a 991-file package still reveals its internals.
 */
function renderTree(root: TreeNode, opts: { maxLines: number; minCount: number }): string {
  const lines: string[] = [];

  const walk = (node: TreeNode, depth: number, prefix: string): void => {
    if (lines.length >= opts.maxLines) return;

    const children = [...node.children.values()].sort((a, b) => b.count - a.count);
    let hidden = 0;
    let hiddenFiles = 0;

    for (const child of children) {
      if (lines.length >= opts.maxLines) {
        hidden += 1;
        hiddenFiles += child.count;
        continue;
      }
      // Threshold rises with depth: deep, small directories are not domains.
      const threshold = Math.max(opts.minCount, depth * 6);
      if (child.count < threshold && depth > 0) {
        hidden += 1;
        hiddenFiles += child.count;
        continue;
      }
      lines.push(`${prefix}${child.name}/ (${child.count})`);
      if (depth < 3) walk(child, depth + 1, `${prefix}  `);
    }

    if (hidden > 0) {
      lines.push(`${prefix}… ${hidden} smaller ${hidden === 1 ? 'directory' : 'directories'} (${hiddenFiles} files)`);
    }
  };

  walk(root, 0, '');
  return lines.join('\n');
}

async function readHeadings(repoRoot: string, path: string): Promise<string[] | undefined> {
  try {
    const text = await readFile(join(repoRoot, path), 'utf8');
    const headings = text
      .split('\n')
      .filter((l) => /^#{1,3}\s+\S/.test(l))
      .map((l) => l.trim())
      .slice(0, 40);
    return headings.length > 0 ? headings : undefined;
  } catch {
    return undefined;
  }
}

async function readManifest(repoRoot: string, path: string): Promise<string | undefined> {
  try {
    const text = await readFile(join(repoRoot, path), 'utf8');
    if (path.endsWith('.json')) {
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed === 'object' && parsed !== null) {
        const p = parsed as Record<string, unknown>;
        const keep = {
          name: p['name'],
          description: p['description'],
          workspaces: p['workspaces'],
          scripts: p['scripts'] && Object.keys(p['scripts'] as object).slice(0, 12),
          dependencies: p['dependencies'] && Object.keys(p['dependencies'] as object).slice(0, 25),
        };
        return JSON.stringify(keep, null, 2).slice(0, 1500);
      }
    }
    return text.slice(0, 1200);
  } catch {
    return undefined;
  }
}

export async function buildDigest(repoRoot: string): Promise<RepoDigest> {
  const files = await listFiles(repoRoot);

  const extCounts = new Map<string, number>();
  for (const file of files) {
    const base = file.slice(file.lastIndexOf('/') + 1);
    const dot = base.lastIndexOf('.');
    const ext = dot > 0 ? base.slice(dot + 1).toLowerCase() : '(none)';
    extCounts.set(ext, (extCounts.get(ext) ?? 0) + 1);
  }
  const languages = [...extCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);

  const tree = renderTree(buildTree(files), { maxLines: 140, minCount: 3 });

  // Below this size the whole file list costs less than the tree and removes
  // all guesswork about what actually exists.
  const sourceFiles =
    files.length <= SMALL_REPO_FILES
      ? files.filter((f) => !/\.(png|jpg|jpeg|gif|svg|ico|woff2?|ttf|mp4|mp3|wav|pdf|lock)$/i.test(f))
      : [];

  const docs: RepoDigest['docs'] = [];
  for (const candidate of DOC_CANDIDATES) {
    const headings = await readHeadings(repoRoot, candidate);
    if (headings) docs.push({ path: candidate, headings });
  }

  const manifests: RepoDigest['manifests'] = [];
  for (const candidate of MANIFEST_CANDIDATES) {
    const excerpt = await readManifest(repoRoot, candidate);
    if (excerpt) manifests.push({ path: candidate, excerpt });
  }

  const prints = await fileFingerprints(repoRoot, files);
  const hash = createHash('sha256')
    .update(files.map((f) => `${f}\u0000${prints.get(f) ?? ''}`).join('\n'))
    .digest('hex')
    .slice(0, 16);
  const repoName = repoRoot.slice(repoRoot.lastIndexOf('/') + 1);

  return {
    repoName,
    files,
    sourceFiles,
    totalFiles: files.length,
    languages,
    tree,
    docs,
    manifests,
    hash,
    fingerprints: prints,
  };
}

/** Render the digest as the compact markdown the mapper agent receives. */
export function renderDigest(digest: RepoDigest): string {
  const parts: string[] = [];
  parts.push(`# Repository digest: ${digest.repoName}`);
  parts.push('');
  parts.push(`Tracked files: ${digest.totalFiles}`);
  parts.push('');
  parts.push('## File types');
  parts.push(digest.languages.map(([ext, n]) => `${ext}: ${n}`).join(', '));
  parts.push('');
  if (digest.sourceFiles.length > 0) {
    parts.push('## Every file');
    parts.push('```');
    parts.push(digest.sourceFiles.join('\n'));
    parts.push('```');
  } else {
    parts.push('## Directory tree (file counts in parentheses)');
    parts.push('```');
    parts.push(digest.tree);
    parts.push('```');
  }

  if (digest.manifests.length > 0) {
    parts.push('');
    parts.push('## Manifests');
    for (const m of digest.manifests) {
      parts.push(`### ${m.path}`);
      parts.push('```');
      parts.push(m.excerpt);
      parts.push('```');
    }
  }

  if (digest.docs.length > 0) {
    parts.push('');
    parts.push('## Existing documentation (headings only)');
    for (const doc of digest.docs) {
      parts.push(`### ${doc.path}`);
      parts.push(doc.headings.join('\n'));
    }
  }

  return parts.join('\n');
}
