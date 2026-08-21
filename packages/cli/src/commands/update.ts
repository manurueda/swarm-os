/**
 * `swarm update` — update Swarm OS itself.
 *
 * Also the entry point for the detached background worker that keeps installs
 * current without ever delaying a command (see `scheduleBackgroundUpdate`).
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  applyUpdate,
  backgroundUpdate,
  checkForUpdate,
  checkStaleBuild,
  detectInstall,
  isCheckDue,
  readUpdateStatus,
  updatesDisabled,
  writeUpdateStatus,
} from '@swarm-os/core';

import { flagBool, type ParsedArgs } from '../args.js';
import { c, heading, line, note, ok, symbols, warn } from '../ui.js';

/** The compiled main.js, used both to locate the install and to re-spawn it. */
const SELF_URL = new URL('../main.js', import.meta.url).href;

export async function updateCommand(args: ParsedArgs): Promise<number> {
  // Detached worker mode: no output, just do the work and record the result.
  if (flagBool(args.flags, 'background')) {
    try {
      await backgroundUpdate(SELF_URL, { apply: !flagBool(args.flags, 'check') });
    } catch {
      /* a failed background update must never surface as a crash */
    }
    return 0;
  }

  const install = await detectInstall(SELF_URL);

  heading('Swarm OS update');
  note(`  installed via   ${install.kind}${install.root ? ` (${install.root})` : ''}`);
  note(`  current         ${install.currentVersion}`);

  if (updatesDisabled()) {
    line();
    warn('SWARM_NO_UPDATE is set — checking anyway because you asked explicitly.');
  }

  line();
  note('  checking…');
  const status = await checkForUpdate(install);
  await writeUpdateStatus(status);

  if (status.blocked) {
    line();
    warn(status.blocked);
    line();
    return 1;
  }

  if (!status.available) {
    line();
    ok('already up to date');
    line();
    return 0;
  }

  line();
  line(
    `  ${c.yellow(symbols.warn)} update available` +
      (status.behind ? ` — ${status.behind} commit(s) behind` : '') +
      (status.latestVersion ? ` — ${status.currentVersion} → ${status.latestVersion}` : ''),
  );

  if (flagBool(args.flags, 'check')) {
    line();
    note('  run `swarm update` to apply it');
    line();
    return 0;
  }

  note('  applying…');
  const result = await applyUpdate(install);
  line();

  if (!result.ok) {
    warn(result.detail);
    line();
    return 1;
  }

  await writeUpdateStatus({
    ...status,
    available: false,
    appliedAt: new Date().toISOString(),
    ...(result.version ? { appliedVersion: result.version } : {}),
  });

  ok(`${result.detail}${result.version ? ` (${result.version})` : ''}`);
  line();
  return 0;
}

/**
 * Fire-and-forget the background updater, if one is due.
 *
 * Called after a command finishes, never before: the update must not compete
 * with a running mission for the network or swap files under a live agent. The
 * child is fully detached and its streams are discarded, so the parent exits
 * immediately regardless of how long the update takes.
 */
export async function scheduleBackgroundUpdate(): Promise<void> {
  if (updatesDisabled()) return;

  try {
    const status = await readUpdateStatus();
    if (!isCheckDue(status)) return;

    const child = spawn(process.execPath, [fileURLToPath(SELF_URL), 'update', '--background'], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, SWARM_UPDATE_WORKER: '1' },
    });
    child.unref();
  } catch {
    /* never let update machinery break a command */
  }
}

/**
 * One line, shown at the top of a command when the background worker has
 * already installed a new version. Silent otherwise.
 */
export async function noticeIfUpdated(): Promise<void> {
  if (updatesDisabled()) return;
  try {
    const status = await readUpdateStatus();
    if (!status.appliedAt) return;

    // Announce once, then clear the marker.
    await writeUpdateStatus({ ...status, appliedAt: undefined, appliedVersion: undefined });
    note(
      `  ${symbols.ok} Swarm OS updated in the background` +
        `${status.appliedVersion ? ` to ${status.appliedVersion}` : ''}` +
        ` — this run uses the new version`,
    );
  } catch {
    /* ignore */
  }
}

/**
 * One line, shown at the top of a command when a git install's TypeScript
 * sources look newer than its compiled build. Only the auto-updater covers
 * being behind origin — a local commit without a rebuild is otherwise
 * silent. Never runs in the background update worker, and never lets a
 * failed check delay or break a command.
 */
export async function warnIfStaleBuild(): Promise<void> {
  if (process.env['SWARM_UPDATE_WORKER']) return;
  try {
    const install = await detectInstall(SELF_URL);
    if (install.kind !== 'git' || !install.root) return;

    const result = checkStaleBuild(install.root);
    if (result?.stale) {
      warn('local TypeScript sources look newer than the compiled build — run `npm run build`');
    }
  } catch {
    /* a failed stale-build check must never break a command */
  }
}
