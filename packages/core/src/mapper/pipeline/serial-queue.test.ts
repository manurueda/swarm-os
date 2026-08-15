/**
 * `state.json` is read-modify-written by every parallel analyst. This queue is
 * the only thing standing between that and a lost write — so what it has to
 * guarantee is ordering, not speed.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createSerialQueue } from './serial-queue.js';

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

test('tasks run in the order they were queued, even when earlier ones are slower', async () => {
  const queue = createSerialQueue();
  const order: number[] = [];

  const a = queue.run(async () => {
    await delay(20);
    order.push(1);
  });
  const b = queue.run(async () => {
    await delay(0);
    order.push(2);
  });
  const c = queue.run(async () => {
    await delay(0);
    order.push(3);
  });

  await Promise.all([a, b, c]);
  assert.deepEqual(order, [1, 2, 3]);
});

test('a task that throws propagates through subsequent runs, like a plain promise chain', async () => {
  // This is plain `.then()` chaining, not a retry queue: a failed write to
  // state.json is a real problem for the caller to see, not something to
  // paper over silently.
  const queue = createSerialQueue();
  const ran: string[] = [];

  await assert.rejects(
    queue.run(async () => {
      ran.push('first');
      throw new Error('boom');
    }),
    /boom/,
  );

  await assert.rejects(
    queue.run(async () => {
      ran.push('second');
    }),
  );

  assert.deepEqual(ran, ['first'], 'the second task must never run once the chain is rejected');
});

test('run resolves only once its own task has completed', async () => {
  const queue = createSerialQueue();
  let ran = false;
  await queue.run(async () => {
    await delay(5);
    ran = true;
  });
  assert.equal(ran, true);
});
