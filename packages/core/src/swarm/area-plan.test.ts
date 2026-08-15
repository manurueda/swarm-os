/**
 * When a module gets split, and what that costs.
 *
 * This decision used to live inside a closure in the middle of `mapProject`,
 * capturing seven variables. Nothing could construct it in a test, nothing did,
 * and so nobody noticed the whole step was never called. It is a separate
 * function now for that reason before any other.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { planAreas } from './areas.js';
import type { AreaSpec } from './areas.js';

const area = (slug: string): AreaSpec => ({
  slug,
  path: `src/${slug}`,
  owns: [`src/${slug}/**`],
  fileCount: 20,
});

const AREAS = [area('captions'), area('audio'), area('video')];

test('a module with real areas is split, however little memory it has', () => {
  // Structural trigger: `detectAreas` already decided this module has enough
  // sub-domains. There is no memory.md yet on a first map, and that must not
  // block the split.
  const plan = planAreas({
    areas: AREAS,
    hasMemory: () => false,
  });
  assert.equal(plan.keep.length, 3);
  assert.equal(plan.survey.length, 3);
});

test('a module that does not decompose is left whole', () => {
  // Splitting is not always available. A module whose code has no structure to
  // split along needs a different remedy, not a worse split.
  const plan = planAreas({
    areas: [],
    hasMemory: () => false,
  });
  assert.deepEqual(plan.keep, []);
  assert.deepEqual(plan.survey, []);
});

test('an area that already has memory is kept but not surveyed again', () => {
  const plan = planAreas({
    areas: AREAS,
    hasMemory: (slug) => slug === 'captions',
  });

  assert.deepEqual(plan.keep.map((a) => a.slug), ['captions', 'audio', 'video']);
  assert.deepEqual(
    plan.survey.map((a) => a.slug),
    ['audio', 'video'],
    'surveying an area again would spend an agent to overwrite what missions learned there',
  );
});

test('force re-surveys every area, including ones with memory', () => {
  const plan = planAreas({
    areas: AREAS,
    hasMemory: () => true,
    force: true,
  });
  assert.equal(plan.survey.length, 3);
});

test('nothing left to survey still keeps the areas', () => {
  const plan = planAreas({
    areas: AREAS,
    hasMemory: () => true,
  });
  assert.equal(plan.keep.length, 3, 'keep drives pruning — emptying it would delete the areas');
  assert.deepEqual(plan.survey, []);
});
