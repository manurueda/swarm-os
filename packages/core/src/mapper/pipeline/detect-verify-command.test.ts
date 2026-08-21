import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { detectVerifyCommand } from './detect-verify-command.js';

async function tempRepo(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'swarm-verify-detect-'));
}

test('nothing detected in an empty repo', async () => {
  const repo = await tempRepo();
  const result = detectVerifyCommand(repo);
  assert.equal(result.command, null);
  assert.deepEqual(result.alternatives, []);
});

test('package.json with a usable scripts.test suggests npm test', async () => {
  const repo = await tempRepo();
  await writeFile(
    join(repo, 'package.json'),
    JSON.stringify({ scripts: { test: 'node --test' } }),
    'utf8',
  );
  const result = detectVerifyCommand(repo);
  assert.equal(result.command, 'npm test');
  assert.match(result.reason, /scripts\.test/);
});

test('package.json with the npm placeholder test script is not usable', async () => {
  const repo = await tempRepo();
  await writeFile(
    join(repo, 'package.json'),
    JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } }),
    'utf8',
  );
  const result = detectVerifyCommand(repo);
  assert.equal(result.command, null);
});

test('package.json with only scripts.build suggests npm run build', async () => {
  const repo = await tempRepo();
  await writeFile(
    join(repo, 'package.json'),
    JSON.stringify({ scripts: { build: 'tsc' } }),
    'utf8',
  );
  const result = detectVerifyCommand(repo);
  assert.equal(result.command, 'npm run build');
  assert.match(result.reason, /scripts\.build/);
});

test('package.json with an unusable test script but a build script falls back to build', async () => {
  const repo = await tempRepo();
  await writeFile(
    join(repo, 'package.json'),
    JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1', build: 'tsc' } }),
    'utf8',
  );
  const result = detectVerifyCommand(repo);
  assert.equal(result.command, 'npm run build');
});

test('pyproject.toml suggests pytest -q', async () => {
  const repo = await tempRepo();
  await writeFile(join(repo, 'pyproject.toml'), '[project]\nname = "x"\n', 'utf8');
  const result = detectVerifyCommand(repo);
  assert.equal(result.command, 'pytest -q');
  assert.match(result.reason, /pyproject\.toml/);
});

test('pytest.ini suggests pytest -q', async () => {
  const repo = await tempRepo();
  await writeFile(join(repo, 'pytest.ini'), '[pytest]\n', 'utf8');
  const result = detectVerifyCommand(repo);
  assert.equal(result.command, 'pytest -q');
});

test('setup.cfg with a [tool:pytest] section suggests pytest -q', async () => {
  const repo = await tempRepo();
  await writeFile(join(repo, 'setup.cfg'), '[tool:pytest]\ntestpaths = tests\n', 'utf8');
  const result = detectVerifyCommand(repo);
  assert.equal(result.command, 'pytest -q');
});

test('setup.cfg without a [tool:pytest] section is not evidence', async () => {
  const repo = await tempRepo();
  await writeFile(join(repo, 'setup.cfg'), '[metadata]\nname = x\n', 'utf8');
  const result = detectVerifyCommand(repo);
  assert.equal(result.command, null);
});

test('a tests/ directory containing a .py file suggests pytest -q', async () => {
  const repo = await tempRepo();
  await mkdir(join(repo, 'tests'), { recursive: true });
  await writeFile(join(repo, 'tests', 'test_a.py'), 'def test_a(): assert True\n', 'utf8');
  const result = detectVerifyCommand(repo);
  assert.equal(result.command, 'pytest -q');
  assert.match(result.reason, /tests\//);
});

test('a tests/ directory with no .py files is not evidence', async () => {
  const repo = await tempRepo();
  await mkdir(join(repo, 'tests'), { recursive: true });
  await writeFile(join(repo, 'tests', 'a.ts'), 'export {}\n', 'utf8');
  const result = detectVerifyCommand(repo);
  assert.equal(result.command, null);
});

test('prefers .venv/bin/python -m pytest -q when a .venv directory exists', async () => {
  const repo = await tempRepo();
  await writeFile(join(repo, 'pyproject.toml'), '[project]\nname = "x"\n', 'utf8');
  await mkdir(join(repo, '.venv'), { recursive: true });
  const result = detectVerifyCommand(repo);
  assert.equal(result.command, '.venv/bin/python -m pytest -q');
});

test('Cargo.toml suggests cargo test', async () => {
  const repo = await tempRepo();
  await writeFile(join(repo, 'Cargo.toml'), '[package]\nname = "x"\n', 'utf8');
  const result = detectVerifyCommand(repo);
  assert.equal(result.command, 'cargo test');
});

test('go.mod suggests go test ./...', async () => {
  const repo = await tempRepo();
  await writeFile(join(repo, 'go.mod'), 'module example.com/x\n', 'utf8');
  const result = detectVerifyCommand(repo);
  assert.equal(result.command, 'go test ./...');
});

test('a Makefile with a test: target suggests make test', async () => {
  const repo = await tempRepo();
  await writeFile(join(repo, 'Makefile'), 'test:\n\tgo test ./...\n', 'utf8');
  const result = detectVerifyCommand(repo);
  assert.equal(result.command, 'make test');
});

test('a Makefile without a test: target is not evidence', async () => {
  const repo = await tempRepo();
  await writeFile(join(repo, 'Makefile'), 'build:\n\tgo build ./...\n', 'utf8');
  const result = detectVerifyCommand(repo);
  assert.equal(result.command, null);
});

test('several candidates: prefers the one matching the dominant language, keeps the rest as alternatives', async () => {
  const repo = await tempRepo();
  await writeFile(join(repo, 'package.json'), JSON.stringify({ scripts: { test: 'jest' } }), 'utf8');
  await writeFile(join(repo, 'go.mod'), 'module example.com/x\n', 'utf8');
  await writeFile(join(repo, 'Cargo.toml'), '[package]\nname = "x"\n', 'utf8');

  const result = detectVerifyCommand(repo, 'go');
  assert.equal(result.command, 'go test ./...');
  const altCommands = result.alternatives.map((a) => a.command).sort();
  assert.deepEqual(altCommands, ['cargo test', 'npm test'].sort());
});

test('several candidates with no dominant-language match falls back to matrix order', async () => {
  const repo = await tempRepo();
  await writeFile(join(repo, 'go.mod'), 'module example.com/x\n', 'utf8');
  await writeFile(join(repo, 'Cargo.toml'), '[package]\nname = "x"\n', 'utf8');

  const result = detectVerifyCommand(repo, 'rb');
  assert.equal(result.command, 'cargo test');
  assert.deepEqual(
    result.alternatives.map((a) => a.command),
    ['go test ./...'],
  );
});

test('nothing detected returns a null command and no alternatives', async () => {
  const repo = await tempRepo();
  await writeFile(join(repo, 'README.md'), '# hello\n', 'utf8');
  const result = detectVerifyCommand(repo, 'md');
  assert.equal(result.command, null);
  assert.equal(result.reason, '');
  assert.deepEqual(result.alternatives, []);
});
