/**
 * Argv parsing.
 *
 * `swarm mission "<goal>"` puts the goal in a positional and everything that
 * changes what agents do in a flag, so a parsing slip is the difference between
 * a dry run and a real one.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { flagBool, flagList, flagNumber, flagString, parseArgs } from './args.js';

test('a subcommand is taken only when the first token is not a flag', () => {
  assert.equal(parseArgs(['status']).command, 'status');
  assert.equal(parseArgs(['--version']).command, '');
  assert.equal(parseArgs(['--version']).flags['version'], true);
  assert.equal(parseArgs([]).command, '');
});

test('a goal stays a positional and flags stay flags', () => {
  const args = parseArgs(['mission', 'make the timeline smooth', '--dry-run']);
  assert.equal(args.command, 'mission');
  assert.deepEqual(args.positionals, ['make the timeline smooth']);
  assert.equal(args.flags['dry-run'], true);
});

test('a long flag takes a value from the next token or from an equals sign', () => {
  assert.equal(parseArgs(['map', '--model', 'opus']).flags['model'], 'opus');
  assert.equal(parseArgs(['map', '--model=opus']).flags['model'], 'opus');
});

test('a flag followed by another flag is a boolean, not a value', () => {
  const args = parseArgs(['loop', '--plan', '--hours', '5']);
  assert.equal(args.flags['plan'], true);
  assert.equal(args.flags['hours'], '5');
});

test('short flags are boolean and everything after -- is positional', () => {
  const args = parseArgs(['mission', '-v', '--', '--not-a-flag']);
  assert.equal(args.flags['v'], true);
  assert.deepEqual(args.positionals, ['--not-a-flag']);
});

test('flag readers coerce, and report absence rather than guessing', () => {
  const { flags } = parseArgs([
    'mission',
    '--modules', 'cli,core mapper',
    '--concurrency', '4',
    '--no-review',
    '--hours', 'soon',
  ]);

  assert.equal(flagString(flags, 'modules'), 'cli,core mapper');
  assert.equal(flagString(flags, 'no-review'), undefined, 'a boolean is not a string');
  assert.equal(flagBool(flags, 'no-review'), true);
  assert.equal(flagBool(flags, 'missing'), false);
  assert.equal(flagNumber(flags, 'concurrency'), 4);
  assert.equal(flagNumber(flags, 'hours'), undefined, 'unparseable is absent, not NaN');
  assert.deepEqual(flagList(flags, 'modules'), ['cli', 'core', 'mapper']);
  assert.equal(flagList(flags, 'missing'), undefined);
});
