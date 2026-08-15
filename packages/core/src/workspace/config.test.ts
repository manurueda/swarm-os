/**
 * Project configuration.
 *
 * `.swarm/config.yaml` is committed, so it is read by machines that did not
 * write it and by versions of Swarm OS that did not exist when it was written.
 * Unknown-shaped input must land on defaults rather than on undefined.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_CONFIG, parseConfig, serializeConfig } from './config.js';

test('an empty or malformed file yields the defaults', () => {
  assert.deepEqual(parseConfig(''), DEFAULT_CONFIG);
  assert.deepEqual(parseConfig('# just a comment\n'), DEFAULT_CONFIG);
  assert.deepEqual(parseConfig('a plain string'), DEFAULT_CONFIG);
});

test('stated values win and everything absent falls back', () => {
  const config = parseConfig('model: opus\nmaxConcurrentAgents: 6\n');
  assert.equal(config.model, 'opus');
  assert.equal(config.maxConcurrentAgents, 6);
  assert.equal(config.systemModel, DEFAULT_CONFIG.systemModel);
  assert.deepEqual(config.tools, DEFAULT_CONFIG.tools);
});

test('the schema version is always the one this build understands', () => {
  assert.equal(parseConfig('version: 7\n').version, 1);
});

test('a config survives a round trip through YAML unchanged', () => {
  const config = {
    ...DEFAULT_CONFIG,
    codeStyle: 'Small files.\nTypes and behaviour split.\n',
    verifyCommand: 'npm test',
    verifyEnv: { PYTHONPATH: 'src' },
  };
  assert.deepEqual(parseConfig(serializeConfig(config)), config);
});

test('a serialized config says it is safe to commit', () => {
  const text = serializeConfig(DEFAULT_CONFIG);
  assert.match(text, /Safe to commit/);
  assert.match(text, /no credentials/i);
});

test('the verify gate is off until a project opts in', () => {
  // Documented behaviour, and the reason `swarm loop` will otherwise keep work
  // on a reviewer's word alone.
  assert.equal(DEFAULT_CONFIG.verifyCommand, '');
  assert.deepEqual(DEFAULT_CONFIG.verifyEnv, {});
});
