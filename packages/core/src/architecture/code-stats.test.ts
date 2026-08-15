/**
 * The deterministic facts underneath `swarm refactor`.
 *
 * These run on any repository with no toolchain and no model, and they decide
 * what an agent is later asked to look at. A false positive here is expensive
 * in a way a missed signal is not: it fires on healthy code and teaches people
 * to ignore the output.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  directoryShapes,
  isCodeFile,
  isTestFile,
  median,
  repeatedBasenames,
} from './code-stats.js';

test('isCodeFile counts source and skips assets and data', () => {
  assert.equal(isCodeFile('src/a.ts'), true);
  assert.equal(isCodeFile('src/a.PY'), true);
  assert.equal(isCodeFile('src/a.json'), false);
  assert.equal(isCodeFile('README.md'), false);
  assert.equal(isCodeFile('Makefile'), false);
  assert.equal(isCodeFile('.gitignore'), false);
});

test('isTestFile recognises the conventions of several languages', () => {
  assert.equal(isTestFile('test/a.js'), true);
  assert.equal(isTestFile('src/__tests__/a.ts'), true);
  assert.equal(isTestFile('packages/core/test/env.test.ts'), true);
  assert.equal(isTestFile('tests/test_render.py'), true);
  assert.equal(isTestFile('render_test.go'), true);
  assert.equal(isTestFile('spec/a.rb'), true);
});

test('isTestFile does not fire on a word that merely contains "test"', () => {
  assert.equal(isTestFile('src/contest/entry.ts'), false);
  assert.equal(isTestFile('src/latest.ts'), false);
});

test('median describes the typical file, including the even case', () => {
  assert.equal(median([]), 0);
  assert.equal(median([5]), 5);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 3);
});

test('directoryShapes counts direct files separately from subdirectories', () => {
  const shapes = directoryShapes(['a/b/c.ts', 'a/b/d.ts', 'a/e.ts', 'top.ts']);
  const at = (dir: string) => shapes.find((s) => s.dir === dir);

  assert.equal(at('a/b')?.directFiles, 2);
  assert.equal(at('a/b')?.subdirectories, 0);
  assert.equal(at('a/b')?.depth, 2);

  assert.equal(at('a')?.directFiles, 1);
  assert.equal(at('a')?.subdirectories, 1);

  assert.equal(at('.')?.directFiles, 1);
  assert.equal(at('.')?.subdirectories, 1);
  assert.equal(at('.')?.depth, 0);
});

test('repeatedBasenames ignores names that are a convention, not duplication', () => {
  const files = [
    'a/index.ts', 'b/index.ts', 'c/index.ts', 'd/index.ts',
    'a/handler.ts', 'b/handler.ts', 'c/handler.ts', 'd/handler.ts',
    'a/once.ts',
  ];
  assert.deepEqual(repeatedBasenames(files), [['handler.ts', 4]]);
});
