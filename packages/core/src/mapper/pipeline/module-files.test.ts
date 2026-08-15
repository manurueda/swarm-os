/**
 * The incremental-mapping primitive: whether a module's files, and what is in
 * them, have moved since the last `swarm map`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { filesFor, hashFiles } from './module-files.js';
import type { RepoDigest } from '../digest.js';

const digest = (files: string[]): RepoDigest => ({
  repoName: 'test-repo',
  files,
  totalFiles: files.length,
  languages: [],
  tree: '',
  sourceFiles: files,
  docs: [],
  manifests: [],
  hash: 'x',
  fingerprints: new Map(),
});

test('filesFor keeps only files matching the given globs', () => {
  const d = digest(['src/a.ts', 'src/b.ts', 'docs/readme.md']);
  assert.deepEqual(filesFor(d, ['src/**']), ['src/a.ts', 'src/b.ts']);
});

test('hashFiles is stable for the same input', () => {
  const prints = new Map([['a.ts', 'sha1'], ['b.ts', 'sha2']]);
  assert.equal(hashFiles(['a.ts', 'b.ts'], prints), hashFiles(['a.ts', 'b.ts'], prints));
});

test('hashFiles changes when the file list changes', () => {
  const prints = new Map([['a.ts', 'sha1'], ['b.ts', 'sha2']]);
  assert.notEqual(hashFiles(['a.ts'], prints), hashFiles(['a.ts', 'b.ts'], prints));
});

test('hashFiles changes when a file\'s content fingerprint changes, even though the list did not', () => {
  const before = hashFiles(['a.ts'], new Map([['a.ts', 'sha1']]));
  const after = hashFiles(['a.ts'], new Map([['a.ts', 'sha2']]));
  assert.notEqual(before, after);
});

test('hashFiles tolerates a missing fingerprints map', () => {
  assert.doesNotThrow(() => hashFiles(['a.ts', 'b.ts']));
});
