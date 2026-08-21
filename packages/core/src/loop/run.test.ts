/**
 * What an unattended loop is willing to take on.
 *
 * The queue is the whole safety story of `swarm loop`: it runs for hours with
 * nobody watching, so a signal only becomes a mission when an isolated module
 * agent can actually carry out the remedy. Import cycles, unowned files and
 * ownership conflicts are real problems and are decisions about boundaries —
 * those are left for a person.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { tasksFromSignals, verifyUsable } from './run.js';
import type { Signal, SignalSeverity } from '../architecture/signals.js';
import type { MissionModuleResult } from '../mission/run.js';

function signal(kind: string, options: Partial<Signal> = {}): Signal {
  return {
    kind,
    severity: 'warn' as SignalSeverity,
    module: 'rendering',
    summary: `${kind} in rendering`,
    evidence: [],
    ...options,
  };
}

const ACTIONABLE = ['god-file', 'untested-module', 'junk-drawer', 'flat-directory', 'deep-nesting'];
const FOR_A_PERSON = [
  'import-cycle',
  'unowned-files',
  'ownership-conflict',
  'scattered-module',
  'memory-pressure',
  'size-imbalance',
];

test('every signal with a remedy an agent can carry out becomes a task', () => {
  const tasks = tasksFromSignals(ACTIONABLE.map((kind) => signal(kind)));
  assert.equal(tasks.length, ACTIONABLE.length);
  for (const task of tasks) {
    assert.ok(task.goal.length > 0, `${task.key} produced an empty goal`);
    assert.equal(task.module, 'rendering');
    assert.equal(task.source, 'signal');
  }
});

test('boundary decisions are left for a person, not queued', () => {
  assert.deepEqual(tasksFromSignals(FOR_A_PERSON.map((kind) => signal(kind))), []);
});

test('a signal about no module in particular cannot be assigned to one', () => {
  assert.deepEqual(tasksFromSignals([signal('god-file', { module: undefined })]), []);
});

test('the queue is ordered by severity, worst first', () => {
  const tasks = tasksFromSignals([
    signal('junk-drawer', { severity: 'info', module: 'a' }),
    signal('god-file', { severity: 'high', module: 'b' }),
    signal('flat-directory', { severity: 'warn', module: 'c' }),
  ]);
  assert.deepEqual(
    tasks.map((t) => t.severity),
    ['high', 'warn', 'info'],
  );
});

test('a task key identifies the problem, so a failure is not retried in the same run', () => {
  const [task] = tasksFromSignals([signal('god-file', { module: 'rendering' })]);
  assert.equal(task?.key, 'god-file:rendering');
});

test('a god-file goal carries the concrete file to start with', () => {
  const [task] = tasksFromSignals([
    signal('god-file', { evidence: ['src/reel.py (1,712 lines)', 'median 63 lines'] }),
  ]);
  assert.match(task?.goal ?? '', /src\/reel\.py \(1,712 lines\)/);
  assert.match(task?.goal ?? '', /change no behaviour/i);
});

test('an untested module is told not to invent a harness the project never chose', () => {
  const [task] = tasksFromSignals([signal('untested-module')]);
  assert.match(task?.goal ?? '', /no test setup at all, say so and stop/);
});

/**
 * `verifyUsable` is the loop's only use of the shared verify helper (owned by
 * the `mission` module) — these tests drive it through a fake in place of the
 * real one, the same seam a real caller passes nothing for.
 */

function moduleResult(overrides: Partial<MissionModuleResult> = {}): MissionModuleResult {
  return {
    module: 'rendering',
    ok: true,
    changedFiles: ['rendering/a.ts'],
    ownershipViolations: [],
    worktree: '/tmp/worktree-rendering',
    verifyOutcome: 'skipped-no-command',
    refusalCount: 0,
    ...overrides,
  };
}

test('a passing shared verify result clears every usable module for merge', async () => {
  const result = await verifyUsable(
    [moduleResult(), moduleResult({ module: 'billing', worktree: '/tmp/worktree-billing' })],
    'npm test',
    async () => ({ outcome: 'passed', output: '' }),
  );
  assert.deepEqual(result, { ok: true });
});

test('a failing shared verify result blocks the merge and says why', async () => {
  const result = await verifyUsable([moduleResult()], 'npm test', async () => ({
    outcome: 'failed',
    output: '3 tests failed',
  }));
  assert.equal(result.ok, false);
  assert.match(result.note ?? '', /npm test failed — nothing merged/);
});

test('a skipped-no-command shared verify result is not treated as a pass', async () => {
  const result = await verifyUsable([moduleResult()], '', async () => ({
    outcome: 'skipped-no-command',
    output: '',
  }));
  assert.equal(result.ok, false);
});

test('the first failing module stops checking the rest', async () => {
  const calls: string[] = [];
  const result = await verifyUsable(
    [moduleResult({ module: 'a' }), moduleResult({ module: 'b' })],
    'npm test',
    async (module) => {
      calls.push(module);
      return { outcome: 'failed', output: '' };
    },
  );
  assert.equal(result.ok, false);
  assert.deepEqual(calls, ['a']);
});

test('a module with no worktree cannot be verified and is treated as a failure', async () => {
  let called = false;
  const result = await verifyUsable([moduleResult({ worktree: undefined })], 'npm test', async () => {
    called = true;
    return { outcome: 'passed', output: '' };
  });
  assert.equal(result.ok, false);
  assert.equal(called, false);
});

/**
 * The shared verify helper has no way to accept project-specific env
 * overrides, so `verifyUsable` shadows `process.env` around the call and
 * restores it afterwards — the same PYTHONPATH-shadowing the loop used to do
 * itself before it started calling out to the shared helper.
 */

test('a relative verifyEnv value is joined to the worktree, applied only during the call, then restored', async () => {
  const originalPythonPath = process.env.PYTHONPATH;
  process.env.PYTHONPATH = 'before';
  try {
    let seenDuringCall: string | undefined;
    const result = await verifyUsable(
      [moduleResult()],
      'npm test',
      async () => {
        seenDuringCall = process.env.PYTHONPATH;
        return { outcome: 'passed', output: '' };
      },
      { PYTHONPATH: 'src' },
    );
    assert.equal(result.ok, true);
    assert.equal(seenDuringCall, '/tmp/worktree-rendering/src');
    assert.equal(process.env.PYTHONPATH, 'before');
  } finally {
    if (originalPythonPath === undefined) delete process.env.PYTHONPATH;
    else process.env.PYTHONPATH = originalPythonPath;
  }
});

test('an absolute verifyEnv value is used as-is, not joined to the worktree', async () => {
  const originalPythonPath = process.env.PYTHONPATH;
  try {
    let seenDuringCall: string | undefined;
    await verifyUsable(
      [moduleResult()],
      'npm test',
      async () => {
        seenDuringCall = process.env.PYTHONPATH;
        return { outcome: 'passed', output: '' };
      },
      { PYTHONPATH: '/abs/site-packages' },
    );
    assert.equal(seenDuringCall, '/abs/site-packages');
  } finally {
    if (originalPythonPath === undefined) delete process.env.PYTHONPATH;
    else process.env.PYTHONPATH = originalPythonPath;
  }
});

test('a verifyEnv override that was previously unset is removed again after the call', async () => {
  delete process.env.PYTHONPATH;
  await verifyUsable(
    [moduleResult()],
    'npm test',
    async () => ({ outcome: 'passed', output: '' }),
    { PYTHONPATH: 'src' },
  );
  assert.equal(process.env.PYTHONPATH, undefined);
});
