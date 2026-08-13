/**
 * Self-update.
 *
 * Swarm OS is installed one of two ways, and updates differently for each:
 *
 *   git     — cloned and linked (`npm link`). Update = fetch, fast-forward,
 *             reinstall, rebuild. This is how it is installed today.
 *   npm     — installed globally from the registry. Update = `npm install -g`.
 *
 * Design constraints, in priority order:
 *
 * 1. NEVER slow down a command. The check runs in a detached background process
 *    and writes its answer to a cache file. The foreground only ever reads that
 *    cache, which costs a single small file read.
 * 2. NEVER update underneath a running command. An update applied mid-mission
 *    could swap the binary while agents are streaming. Updates are applied by
 *    the background process only, and take effect on the next invocation.
 * 3. NEVER update a dirty checkout. A git install with local modifications is
 *    someone working on Swarm OS itself; fast-forwarding over them would lose
 *    work. Those are reported, not touched.
 * 4. Always be disableable, and say so. `SWARM_NO_UPDATE=1`, or `autoUpdate:
 *    false` in the project config.
 *
 * The check contacts GitHub (git installs) or the npm registry (npm installs).
 * Nothing about the user or their repositories is transmitted.
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** How long a check stays fresh before another one is due. */
export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export type InstallKind = 'git' | 'npm' | 'unknown';

export interface InstallInfo {
  kind: InstallKind;
  /** Root of the git checkout, for git installs. */
  root?: string;
  packageName: string;
  currentVersion: string;
}

export interface UpdateStatus {
  /** When the last successful check ran. */
  checkedAt?: string;
  available: boolean;
  currentVersion?: string;
  latestVersion?: string;
  /** For git installs: how many commits behind origin. */
  behind?: number;
  /** Set when an update was applied by the background worker. */
  appliedAt?: string;
  appliedVersion?: string;
  /** Why an update could not be applied — dirty tree, no remote, etc. */
  blocked?: string;
}

// ---------------------------------------------------------------------------
// Where state lives
// ---------------------------------------------------------------------------

export function stateDir(): string {
  return join(homedir(), '.swarm');
}

function cachePath(): string {
  return join(stateDir(), 'update.json');
}

export async function readUpdateStatus(): Promise<UpdateStatus> {
  try {
    const raw: unknown = JSON.parse(await readFile(cachePath(), 'utf8'));
    if (typeof raw !== 'object' || raw === null) return { available: false };
    return raw as UpdateStatus;
  } catch {
    return { available: false };
  }
}

export async function writeUpdateStatus(status: UpdateStatus): Promise<void> {
  await mkdir(stateDir(), { recursive: true });
  await writeFile(cachePath(), `${JSON.stringify(status, null, 2)}\n`, 'utf8');
}

/** Is another check due? */
export function isCheckDue(status: UpdateStatus, now = Date.now()): boolean {
  if (!status.checkedAt) return true;
  const last = Date.parse(status.checkedAt);
  return Number.isNaN(last) || now - last > CHECK_INTERVAL_MS;
}

/** Explicit opt-out, honoured everywhere. */
export function updatesDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const flag = env['SWARM_NO_UPDATE'];
  return flag !== undefined && flag !== '' && flag !== '0' && flag !== 'false';
}

// ---------------------------------------------------------------------------
// Install detection
// ---------------------------------------------------------------------------

/**
 * Work out how this copy of Swarm OS was installed, starting from the running
 * module's own path and walking up to the package root.
 */
export async function detectInstall(moduleUrl: string): Promise<InstallInfo> {
  const start = resolve(dirname(new URL(moduleUrl).pathname));

  let packageName = '@swarm-os/cli';
  let currentVersion = '0.0.0';
  let dir = start;
  let packageRoot: string | undefined;

  // Nearest package.json going up is the CLI package.
  while (true) {
    const candidate = join(dir, 'package.json');
    if (existsSync(candidate)) {
      try {
        const raw: unknown = JSON.parse(await readFile(candidate, 'utf8'));
        const pkg = raw as { name?: string; version?: string };
        if (pkg.name) packageName = pkg.name;
        if (pkg.version) currentVersion = pkg.version;
        packageRoot = dir;
      } catch {
        /* unreadable package.json — keep walking */
      }
      break;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // A git checkout means the repo root is at or above the package root.
  let search = packageRoot ?? start;
  while (true) {
    if (existsSync(join(search, '.git'))) {
      return { kind: 'git', root: search, packageName, currentVersion };
    }
    const parent = dirname(search);
    if (parent === search) break;
    search = parent;
  }

  // No git checkout: a global npm install, unless we cannot tell at all.
  return {
    kind: packageRoot ? 'npm' : 'unknown',
    packageName,
    currentVersion,
  };
}

// ---------------------------------------------------------------------------
// Checking
// ---------------------------------------------------------------------------

async function run(
  cmd: string,
  args: string[],
  cwd?: string,
  timeout = 60_000,
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, {
      ...(cwd ? { cwd } : {}),
      timeout,
      maxBuffer: 8 * 1024 * 1024,
    });
    return { ok: true, stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return {
      ok: false,
      stdout: (e.stdout ?? '').trim(),
      stderr: (e.stderr ?? e.message ?? 'command failed').trim(),
    };
  }
}

export async function checkForUpdate(install: InstallInfo): Promise<UpdateStatus> {
  const checkedAt = new Date().toISOString();

  if (install.kind === 'git' && install.root) {
    const branch = await run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], install.root);
    const remote = await run('git', ['remote'], install.root);
    if (!remote.ok || !remote.stdout) {
      return { checkedAt, available: false, blocked: 'no git remote configured' };
    }

    const fetched = await run('git', ['fetch', '--quiet', 'origin'], install.root, 120_000);
    if (!fetched.ok) {
      return { checkedAt, available: false, blocked: `git fetch failed: ${fetched.stderr}` };
    }

    const ref = `origin/${branch.stdout || 'main'}`;
    const counted = await run('git', ['rev-list', '--count', `HEAD..${ref}`], install.root);
    const behind = counted.ok ? Number(counted.stdout) : 0;

    return {
      checkedAt,
      available: Number.isFinite(behind) && behind > 0,
      currentVersion: install.currentVersion,
      behind: Number.isFinite(behind) ? behind : 0,
    };
  }

  if (install.kind === 'npm') {
    const view = await run('npm', ['view', install.packageName, 'version'], undefined, 60_000);
    if (!view.ok) {
      return { checkedAt, available: false, blocked: `npm view failed: ${view.stderr}` };
    }
    const latest = view.stdout;
    return {
      checkedAt,
      available: latest !== '' && latest !== install.currentVersion,
      currentVersion: install.currentVersion,
      latestVersion: latest,
    };
  }

  return { checkedAt, available: false, blocked: 'could not determine how Swarm OS was installed' };
}

// ---------------------------------------------------------------------------
// Applying
// ---------------------------------------------------------------------------

export interface ApplyResult {
  ok: boolean;
  detail: string;
  version?: string;
}

export async function applyUpdate(install: InstallInfo): Promise<ApplyResult> {
  if (install.kind === 'git' && install.root) {
    // Refuse to touch a checkout with local work in it.
    const status = await run('git', ['status', '--porcelain'], install.root);
    if (status.ok && status.stdout !== '') {
      return {
        ok: false,
        detail:
          'local changes in the Swarm OS checkout — not updating. ' +
          'Commit or stash them, then run `swarm update`.',
      };
    }

    const pull = await run('git', ['pull', '--ff-only', '--quiet'], install.root, 180_000);
    if (!pull.ok) {
      return { ok: false, detail: `git pull failed: ${pull.stderr}` };
    }

    const install_ = await run('npm', ['install', '--no-audit', '--no-fund'], install.root, 300_000);
    if (!install_.ok) return { ok: false, detail: `npm install failed: ${install_.stderr}` };

    const build = await run('npm', ['run', 'build'], install.root, 300_000);
    if (!build.ok) return { ok: false, detail: `build failed: ${build.stderr}` };

    const version = await run('git', ['rev-parse', '--short', 'HEAD'], install.root);
    return { ok: true, detail: 'updated from git', version: version.stdout };
  }

  if (install.kind === 'npm') {
    const res = await run(
      'npm',
      ['install', '-g', `${install.packageName}@latest`],
      undefined,
      300_000,
    );
    return res.ok
      ? { ok: true, detail: 'updated from npm' }
      : { ok: false, detail: `npm install -g failed: ${res.stderr}` };
  }

  return { ok: false, detail: 'could not determine how Swarm OS was installed' };
}

/**
 * The background worker: check, and apply if one is available.
 * Runs in a detached process so it can never delay or interrupt a command.
 */
export async function backgroundUpdate(
  moduleUrl: string,
  options: { apply?: boolean } = {},
): Promise<UpdateStatus> {
  const install = await detectInstall(moduleUrl);
  const status = await checkForUpdate(install);

  if (!status.available || options.apply === false) {
    await writeUpdateStatus(status);
    return status;
  }

  const result = await applyUpdate(install);
  const next: UpdateStatus = result.ok
    ? {
        ...status,
        available: false,
        appliedAt: new Date().toISOString(),
        ...(result.version ? { appliedVersion: result.version } : {}),
      }
    : { ...status, blocked: result.detail };

  await writeUpdateStatus(next);
  return next;
}
