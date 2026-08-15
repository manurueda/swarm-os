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

import { tasksFromSignals } from './run.js';
import type { Signal, SignalSeverity } from '../architecture/signals.js';

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
