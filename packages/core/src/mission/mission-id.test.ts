/**
 * Mission ids.
 *
 * Regression for the collision that made an autonomous loop lose its own
 * record: the id came from the first six words of the goal, and a loop
 * generates goals that differ only in their tail — "Split the oversized files
 * in this module. Start with X" against "...Start with Y". Three missions
 * shared one directory and overwrote each other's plan, report and event log.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { missionId } from './run.js';

const DAY = new Date('2026-08-13T09:00:00.000Z');

test('goals differing only after the sixth word get different ids', () => {
  const a = missionId('Split the oversized files in this module. Start with render.ts', DAY);
  const b = missionId('Split the oversized files in this module. Start with snapshot.ts', DAY);

  assert.notEqual(a, b);
  // The readable half is still shared — it is the fingerprint that separates them.
  assert.ok(a.startsWith('2026-08-13-split-the-oversized-files-in-this-'));
  assert.ok(b.startsWith('2026-08-13-split-the-oversized-files-in-this-'));
});

test('the same goal always produces the same id', () => {
  const goal = 'make the timeline smooth with 100+ scenes';
  assert.equal(missionId(goal, DAY), missionId(goal, DAY));
});

test('an id is dated, slugged to six words, and fingerprinted', () => {
  const id = missionId('Make the timeline smooth with 100+ scenes please', DAY);
  const match = /^(\d{4}-\d{2}-\d{2})-(.+)-([0-9a-f]{6})$/.exec(id);
  assert.ok(match, `${id} is not a well-formed mission id`);
  assert.equal(match?.[1], '2026-08-13');
  assert.equal(match?.[2], 'make-the-timeline-smooth-with-100');
});

test('a goal with no usable words still yields a directory name', () => {
  assert.ok(/^2026-08-13-mission-[0-9a-f]{6}$/.test(missionId('!!! ???', DAY)));
});
