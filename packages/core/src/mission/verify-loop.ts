/**
 * Fail-then-fix: after a work agent reports, prove it before the reviewer sees
 * it. The agent cannot do this itself — it runs sandboxed and its own test,
 * build and package-manager commands are refused — so the harness runs the
 * project's verify command in the agent's own worktree and, on failure,
 * resumes the same session with the failure and a chance to fix it.
 *
 * The runtime and the verify function are both passed in rather than reached
 * for, so this can be driven by a fake runtime and a fake verify command in
 * tests — no subprocess, no worktree, no agent process.
 */

import type { AgentRuntime, AgentSpec, SwarmEvent } from '../types.js';
import { collectAgent, type AgentOutcome } from '../runtime/collect.js';
import { runVerify, type VerifyOutcome, type VerifyResult } from './verify.js';
import type { WorkReport } from './run.js';

export type VerifyFn = typeof runVerify;

export interface VerifyLoopOptions {
  runtime: AgentRuntime;
  module: string;
  worktreePath: string;
  verifyCommand: string;
  maxVerifyRounds: number;
  /** The spec used for the work agent's first turn — reused for every resume. */
  baseSpec: AgentSpec;
  /** The work agent's own outcome, so its refusals count towards the total. */
  initialOutcome: AgentOutcome;
  parseWorkReport: (raw: unknown) => WorkReport | undefined;
  onEvent: (event: SwarmEvent) => void | Promise<void>;
  signal?: AbortSignal;
  /** Defaults to the real `runVerify`. Overridden by tests. */
  verify?: VerifyFn;
}

export interface VerifyLoopResult {
  verifyOutcome: VerifyOutcome;
  refusalCount: number;
  /** Cost of every resume round. The initial turn's cost is the caller's. */
  resumeCostUsd: number;
  /** Set only when a resume round ran — the caller should adopt these in place of its own. */
  lastOutcome?: AgentOutcome;
  lastWorkReport?: WorkReport;
}

export async function runVerifyLoop(options: VerifyLoopOptions): Promise<VerifyLoopResult> {
  const verify = options.verify ?? runVerify;

  let refusalCount = readRefusalCount(options.initialOutcome);
  let resumeCostUsd = 0;
  let sessionId = options.initialOutcome.sessionId;
  let lastOutcome: AgentOutcome | undefined;
  let lastWorkReport: WorkReport | undefined;
  let result: VerifyResult = { outcome: 'skipped-no-command', output: '' };

  for (let round = 1; round <= options.maxVerifyRounds; round += 1) {
    result = await verify(options.module, options.worktreePath, options.verifyCommand);
    if (result.outcome !== 'failed') break;
    if (round === options.maxVerifyRounds) break;
    if (!sessionId) break; // nothing to resume — no session id was ever assigned

    const resumed = await collectAgent(
      options.runtime,
      { ...options.baseSpec, prompt: fixPrompt(result.output), resume: sessionId },
      options.onEvent,
      options.signal,
    );

    refusalCount += readRefusalCount(resumed);
    resumeCostUsd += resumed.costUsd ?? 0;
    sessionId = resumed.sessionId ?? sessionId;
    lastOutcome = resumed;
    lastWorkReport = options.parseWorkReport(resumed.structured) ?? lastWorkReport;
  }

  return {
    verifyOutcome: result.outcome,
    refusalCount,
    resumeCostUsd,
    ...(lastOutcome ? { lastOutcome } : {}),
    ...(lastWorkReport ? { lastWorkReport } : {}),
  };
}

function fixPrompt(verifyOutput: string): string {
  return [
    'The verify command failed after your last change. Fix it, then report',
    'again with the same structured report shape.',
    '',
    'Do not attempt to run the verify command, tests, builds or a package',
    "manager yourself — they will be refused, and won't tell you anything the",
    'output below does not.',
    '',
    '```',
    verifyOutput,
    '```',
  ].join('\n');
}

/**
 * Bridges to a field the runtime does not expose yet: `AgentOutcome` has no
 * `refusalCount` today. Remove this cast once the runtime adds it — this
 * function should then just read `outcome.refusalCount ?? 0`.
 */
function readRefusalCount(outcome: AgentOutcome): number {
  return (outcome as AgentOutcome & { refusalCount?: number }).refusalCount ?? 0;
}
