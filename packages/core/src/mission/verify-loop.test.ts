/**
 * The fail-then-fix loop, exercised with a fake runtime and a fake verify
 * function — no worktree, no subprocess, no agent process. `runVerifyLoop`
 * takes both as arguments precisely so this is possible.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runVerifyLoop } from './verify-loop.js';
import type { AgentRuntime, AgentSpec, SwarmEvent } from '../types.js';
import type { AgentOutcome } from '../runtime/collect.js';
import type { VerifyResult } from './verify.js';
import type { WorkReport } from './run.js';

function baseSpec(): AgentSpec {
  return {
    id: 'work:test-module',
    role: 'module',
    module: 'test-module',
    prompt: 'do the thing',
    cwd: '/tmp/worktree',
  };
}

function outcome(overrides: Partial<AgentOutcome> = {}): AgentOutcome {
  return { ok: true, sessionId: 'session-1', refusalCount: 0, ...overrides };
}

/** Answers every `runtime.run` call from a canned queue — no process spawned. */
function fakeRuntime(responses: AgentOutcome[]): AgentRuntime {
  let call = 0;
  return {
    id: 'fake',
    async preflight() {
      return { ok: true, runtime: 'fake', checks: [] };
    },
    async *run(spec: AgentSpec): AsyncIterable<SwarmEvent> {
      const next = responses[call] ?? responses[responses.length - 1];
      call += 1;
      yield {
        type: 'agent.start',
        at: new Date().toISOString(),
        agentId: spec.id,
        role: spec.role,
        sessionId: next?.sessionId ?? 'session',
        cwd: spec.cwd,
      };
      yield {
        type: 'agent.done',
        at: new Date().toISOString(),
        agentId: spec.id,
        ok: next?.ok ?? true,
        ...(next?.structured !== undefined ? { structured: next.structured } : {}),
        ...(next?.costUsd !== undefined ? { costUsd: next.costUsd } : {}),
      };
    },
  };
}

function fakeVerify(results: VerifyResult[]): () => Promise<VerifyResult> {
  let call = 0;
  return async () => {
    const next = results[call] ?? results[results.length - 1];
    call += 1;
    if (!next) throw new Error('fakeVerify called with no results queued');
    return next;
  };
}

const noReport = (): WorkReport | undefined => undefined;

test('verify passes on the first try — no resume, no wasted turn', async () => {
  const result = await runVerifyLoop({
    runtime: fakeRuntime([]),
    module: 'test-module',
    worktreePath: '/tmp/worktree',
    verifyCommand: 'npm test',
    maxVerifyRounds: 2,
    baseSpec: baseSpec(),
    initialOutcome: outcome(),
    parseWorkReport: noReport,
    onEvent: () => {},
    verify: fakeVerify([{ outcome: 'passed', output: '' }]),
  });

  assert.equal(result.verifyOutcome, 'passed');
  assert.equal(result.resumeCostUsd, 0);
  assert.equal(result.lastOutcome, undefined);
});

test('verify fails, the resumed agent fixes it, verify passes', async () => {
  const runtime = fakeRuntime([outcome({ costUsd: 0.5, structured: { status: 'complete' } })]);
  const result = await runVerifyLoop({
    runtime,
    module: 'test-module',
    worktreePath: '/tmp/worktree',
    verifyCommand: 'npm test',
    maxVerifyRounds: 2,
    baseSpec: baseSpec(),
    initialOutcome: outcome(),
    parseWorkReport: (raw) => raw as WorkReport,
    onEvent: () => {},
    verify: fakeVerify([
      { outcome: 'failed', output: 'boom' },
      { outcome: 'passed', output: '' },
    ]),
  });

  assert.equal(result.verifyOutcome, 'passed');
  assert.equal(result.resumeCostUsd, 0.5);
  assert.ok(result.lastOutcome);
  assert.equal(result.lastWorkReport?.status, 'complete');
});

test('verify fails through every round — recorded as failed, not silently kept', async () => {
  const runtime = fakeRuntime([outcome({ costUsd: 0.2 })]);
  const result = await runVerifyLoop({
    runtime,
    module: 'test-module',
    worktreePath: '/tmp/worktree',
    verifyCommand: 'npm test',
    maxVerifyRounds: 2,
    baseSpec: baseSpec(),
    initialOutcome: outcome(),
    parseWorkReport: noReport,
    onEvent: () => {},
    verify: fakeVerify([
      { outcome: 'failed', output: 'still broken' },
      { outcome: 'failed', output: 'still broken' },
    ]),
  });

  assert.equal(result.verifyOutcome, 'failed');
  // Exactly one resume between two verify attempts — the last failure gets no
  // further turn, so cost is not paid for a fix nobody will check.
  assert.equal(result.resumeCostUsd, 0.2);
});

test('no verify command configured — skipped, no resume attempted', async () => {
  let verifyCalls = 0;
  const result = await runVerifyLoop({
    runtime: fakeRuntime([]),
    module: 'test-module',
    worktreePath: '/tmp/worktree',
    verifyCommand: '',
    maxVerifyRounds: 2,
    baseSpec: baseSpec(),
    initialOutcome: outcome(),
    parseWorkReport: noReport,
    onEvent: () => {},
    verify: async () => {
      verifyCalls += 1;
      return { outcome: 'skipped-no-command', output: '' };
    },
  });

  assert.equal(result.verifyOutcome, 'skipped-no-command');
  assert.equal(verifyCalls, 1);
  assert.equal(result.lastOutcome, undefined);
});

test('refusals on the initial turn are still counted when verify passes outright', async () => {
  const seeded: AgentOutcome = { ...outcome(), refusalCount: 3 } as AgentOutcome & {
    refusalCount: number;
  };
  const result = await runVerifyLoop({
    runtime: fakeRuntime([]),
    module: 'test-module',
    worktreePath: '/tmp/worktree',
    verifyCommand: 'npm test',
    maxVerifyRounds: 2,
    baseSpec: baseSpec(),
    initialOutcome: seeded,
    parseWorkReport: noReport,
    onEvent: () => {},
    verify: fakeVerify([{ outcome: 'passed', output: '' }]),
  });

  assert.equal(result.refusalCount, 3);
});
