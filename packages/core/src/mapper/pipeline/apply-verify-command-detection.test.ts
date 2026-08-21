import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { applyVerifyCommandDetection } from './apply-verify-command-detection.js';
import { Workspace } from '../../workspace/store.js';
import { DEFAULT_CONFIG, type SwarmConfig } from '../../workspace/config.js';

async function tempWorkspace(): Promise<Workspace> {
  const dir = await mkdtemp(join(tmpdir(), 'swarm-map-verify-detect-'));
  return new Workspace(dir);
}

test('leaves an already-set verifyCommand untouched and reports nothing', async () => {
  const workspace = await tempWorkspace();
  const config: SwarmConfig = { ...DEFAULT_CONFIG, verifyCommand: 'make check' };

  const message = await applyVerifyCommandDetection(workspace, config, undefined);

  assert.equal(message, undefined);
  assert.equal(config.verifyCommand, 'make check');
});

test('fills an empty verifyCommand from a detected candidate and persists it', async () => {
  const workspace = await tempWorkspace();
  await writeFile(join(workspace.repoRoot, 'go.mod'), 'module example.com/x\n', 'utf8');
  const config: SwarmConfig = { ...DEFAULT_CONFIG, verifyCommand: '' };

  const message = await applyVerifyCommandDetection(workspace, config, 'go');

  assert.equal(config.verifyCommand, 'go test ./...');
  assert.match(message ?? '', /detected verifyCommand: go test \.\/\.\.\./);

  const persisted = await workspace.readConfig();
  assert.equal(persisted.verifyCommand, 'go test ./...');
});

test('reports nothing was detected without touching verifyCommand', async () => {
  const workspace = await tempWorkspace();
  const config: SwarmConfig = { ...DEFAULT_CONFIG, verifyCommand: '' };

  const message = await applyVerifyCommandDetection(workspace, config, undefined);

  assert.equal(config.verifyCommand, '');
  assert.match(message ?? '', /no verify command detected/);
});
