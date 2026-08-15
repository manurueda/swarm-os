/**
 * Concurrency as a spending policy.
 *
 * Every concurrent agent draws on the same subscription window, so the two
 * behaviours that matter are: never exceed the limit, and stop launching the
 * moment the window is reported exhausted — rather than discovering it one
 * failed agent at a time.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Scheduler } from './scheduler.js';
import type { RateLimitSnapshot, SwarmEvent } from '../types.js';

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 5));

function rateLimit(status: string): SwarmEvent {
  return { type: 'ratelimit', at: new Date().toISOString(), snapshot: { status } };
}

test('never runs more than the limit at once', async () => {
  const scheduler = new Scheduler({ limit: 2 });
  let active = 0;
  let peak = 0;

  const tasks = Array.from({ length: 8 }, () => async () => {
    active += 1;
    peak = Math.max(peak, active);
    await tick();
    active -= 1;
    return 'ok';
  });

  const results = await scheduler.run(tasks);
  assert.equal(results.length, 8);
  assert.equal(peak, 2);
});

test('results keep the order of the tasks that produced them', async () => {
  const scheduler = new Scheduler({ limit: 3 });
  const results = await scheduler.run(
    [30, 10, 20, 0].map((delay, index) => async () => {
      await new Promise((resolve) => setTimeout(resolve, delay));
      return index;
    }),
  );
  assert.deepEqual(results, [0, 1, 2, 3]);
});

test('one failing task becomes an Error in place and never kills the batch', async () => {
  const scheduler = new Scheduler({ limit: 2 });
  const results = await scheduler.run([
    async () => 'first',
    async () => {
      throw new Error('module blew up');
    },
    async () => 'third',
  ]);

  assert.equal(results[0], 'first');
  assert.ok(results[1] instanceof Error);
  assert.equal((results[1] as Error).message, 'module blew up');
  assert.equal(results[2], 'third');
});

test('an exhausted window stops further launches instead of failing them one by one', async () => {
  const paused: RateLimitSnapshot[] = [];
  const scheduler = new Scheduler({ limit: 1, onPause: (s) => paused.push(s) });

  let ran = 0;
  const tasks = Array.from({ length: 4 }, (_, index) => async () => {
    ran += 1;
    // The runtime reports the window exhausted while the first agent is running.
    if (index === 0) {
      scheduler.observe(rateLimit('rejected'));
      scheduler.observe(rateLimit('rejected'));
    }
    return index;
  });

  const results = await scheduler.run(tasks);

  assert.equal(ran, 1, 'no agent may launch after the window is reported exhausted');
  assert.equal(results[0], 0);
  for (const skipped of results.slice(1)) {
    assert.ok(skipped instanceof Error);
    assert.match((skipped as Error).message, /rate limit/);
  }
  assert.equal(scheduler.isPaused, true);
  assert.equal(paused.length, 1, 'pausing is announced once, not per event');
});

test('a rate-limit status outside the pause list is recorded but does not stop work', async () => {
  const scheduler = new Scheduler({ limit: 2, pauseOnStatus: ['rejected'] });
  scheduler.observe(rateLimit('allowed_warning'));

  assert.equal(scheduler.isPaused, false);
  assert.equal(scheduler.rateLimit?.status, 'allowed_warning');
  assert.deepEqual(await scheduler.run([async () => 'ran']), ['ran']);
});

test('a limit below one still makes progress', async () => {
  const scheduler = new Scheduler({ limit: 0 });
  assert.deepEqual(await scheduler.run([async () => 'a', async () => 'b']), ['a', 'b']);
});
