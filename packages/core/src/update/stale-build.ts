/**
 * Stale local build detection.
 *
 * The self-update machinery in this directory only knows about drift against
 * origin — it says nothing about a developer working on Swarm OS itself who
 * commits locally and forgets to `npm run build`. That leaves them silently
 * running old compiled output. This checks for exactly that case, using the
 * same fast-path signal `tsc --build` itself relies on: a project's
 * `tsconfig.tsbuildinfo` is (re)written whenever `tsc --build` verifies that
 * project is current, so comparing its mtime against the newest source file
 * mtime tells us what `tsc --build` would decide, without invoking it.
 *
 * Deliberately mtime-only, and deliberately not dist/-based: `tsc --build`
 * refreshes tsbuildinfo even on runs where it skips re-emitting dist because
 * content hashes were unchanged, so a dist-mtime comparison would false-
 * positive on those runs.
 */

import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const CHECKED_PACKAGES = [
  ['packages', 'core'],
  ['packages', 'cli'],
];

/**
 * True if either checked package's TypeScript sources are newer than its
 * `tsconfig.tsbuildinfo`. A missing `tsconfig.tsbuildinfo` counts as stale.
 *
 * Never throws. A package that cannot be inspected at all (missing/garbage
 * repoRoot, permission error, ...) is treated as not stale for that package
 * rather than surfacing the error — the caller relies on this being
 * fail-safe. This implementation always resolves to `{ stale: boolean }`
 * and never returns `null`; the nullable return type is kept only so a
 * future "could not determine at all" signal can be added without a
 * breaking change to callers.
 */
export function checkStaleBuild(repoRoot: string): { stale: boolean } | null {
  for (const parts of CHECKED_PACKAGES) {
    if (isPackageStale(join(repoRoot, ...parts))) {
      return { stale: true };
    }
  }
  return { stale: false };
}

function isPackageStale(packageDir: string): boolean {
  let buildInfoMtime: number;
  try {
    buildInfoMtime = statSync(join(packageDir, 'tsconfig.tsbuildinfo')).mtimeMs;
  } catch {
    // No tsbuildinfo: stale, unless the package itself is unreachable
    // (garbage repoRoot) — that is "cannot determine", not "stale".
    try {
      statSync(packageDir);
      return true;
    } catch {
      return false;
    }
  }

  try {
    return newestSourceMtime(join(packageDir, 'src')) > buildInfoMtime;
  } catch {
    return false;
  }
}

function newestSourceMtime(srcDir: string): number {
  let newest = -Infinity;
  for (const mtime of walkTsFileMtimes(srcDir)) {
    if (mtime > newest) newest = mtime;
  }
  if (newest === -Infinity) throw new Error(`no TypeScript sources found under ${srcDir}`);
  return newest;
}

function* walkTsFileMtimes(dir: string): Generator<number> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkTsFileMtimes(full);
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      yield statSync(full).mtimeMs;
    }
  }
}
