/**
 * Run a project's verify command inside a worktree.
 *
 * Shared by the mission verify loop (`run.ts`, before review) and the
 * autonomous loop's merge gate (`loop/run.ts`). One implementation, so
 * "did this change actually work" means the same thing in both places.
 *
 * The environment matters as much as the command. A worktree is a bare
 * checkout and a project's installed tooling still points at the original
 * clone, so without help the verification runs against the wrong source or
 * fails to resolve it at all. Both look like the change is broken when it is
 * not — and a caller then throws away work that was correct.
 *
 * Observed: a mission split a 1,712-line module into a clean package, the
 * reviewer approved it, and the gate rejected it with 246 collection errors
 * that were entirely an artefact of the worktree. With PYTHONPATH pointed at
 * the worktree's own sources the same branch passed the whole suite.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** Kept small: enough to show a caller (or a resumed agent) what broke. */
const MAX_OUTPUT_CHARS = 8_000;

export type VerifyOutcome = 'passed' | 'failed' | 'skipped-no-command';

export interface VerifyResult {
  outcome: VerifyOutcome;
  /** Combined stdout+stderr, trimmed to the tail. Empty when skipped. */
  output: string;
}

/**
 * @param module Module slug the worktree belongs to. Not used to change
 *   behaviour — only to label output when a caller logs or replays it.
 */
export async function runVerify(
  module: string,
  worktree: string,
  verifyCommand: string,
): Promise<VerifyResult> {
  if (!verifyCommand) {
    return { outcome: 'skipped-no-command', output: '' };
  }

  const env: NodeJS.ProcessEnv = { ...process.env };

  // PYTHONPATH precedes site-packages, so pointing it at the worktree's own
  // sources shadows an editable install pointing at the original clone.
  if (existsSync(join(worktree, 'src')) && existsSync(join(worktree, 'pyproject.toml'))) {
    const own = join(worktree, 'src');
    env['PYTHONPATH'] = env['PYTHONPATH'] ? `${own}:${env['PYTHONPATH']}` : own;
  }

  const chunks: Buffer[] = [];
  const passed = await new Promise<boolean>((resolve) => {
    const child = spawn(verifyCommand, {
      cwd: worktree,
      shell: true,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      // A hung build must not hold a mission hostage.
      timeout: 15 * 60_000,
    });
    child.stdout?.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.stderr?.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.on('close', (code) => resolve(code === 0));
    child.on('error', (err) => {
      chunks.push(Buffer.from(err.message));
      resolve(false);
    });
  });

  return {
    outcome: passed ? 'passed' : 'failed',
    output: passed ? '' : trim(Buffer.concat(chunks).toString('utf8'), module),
  };
}

/** Keep the tail — a build failure's cause is almost always its last lines. */
function trim(output: string, module: string): string {
  const text = output.trim();
  if (text.length <= MAX_OUTPUT_CHARS) return text;
  return (
    `[${module}] output truncated to the last ${MAX_OUTPUT_CHARS} characters\n\n` +
    text.slice(-MAX_OUTPUT_CHARS)
  );
}
