/**
 * The billing safety property.
 *
 * Claude Code prefers `ANTHROPIC_API_KEY` over the subscription when both are
 * present, so a stray key in the parent shell would move every agent onto
 * metered API billing. Swarm OS's entire defence is that no child process ever
 * sees one. These tests are the gate on that.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BILLING_ENV_VARS,
  NESTING_ENV_VARS,
  detectBillingEnv,
  scrubEnv,
} from './env.js';

/** An environment with every variable we refuse to pass on, all set. */
function pollutedEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { PATH: '/usr/bin', HOME: '/home/dev' };
  for (const name of BILLING_ENV_VARS) env[name] = `secret-value-for-${name}`;
  for (const name of NESTING_ENV_VARS) env[name] = `parent-value-for-${name}`;
  return env;
}

test('scrubEnv removes every billing variable', () => {
  const { env } = scrubEnv(pollutedEnv());
  for (const name of BILLING_ENV_VARS) {
    assert.equal(env[name], undefined, `${name} survived into the child environment`);
  }
});

test('scrubEnv removes every parent-session variable', () => {
  const { env } = scrubEnv(pollutedEnv());
  for (const name of NESTING_ENV_VARS) {
    assert.equal(env[name], undefined, `${name} survived into the child environment`);
  }
});

test('scrubEnv keeps everything it was not asked to remove', () => {
  const { env } = scrubEnv(pollutedEnv());
  assert.equal(env['PATH'], '/usr/bin');
  assert.equal(env['HOME'], '/home/dev');
});

test('scrubEnv reports names and never carries values', () => {
  const result = scrubEnv(pollutedEnv());
  assert.deepEqual(result.removedBilling, [...BILLING_ENV_VARS]);
  assert.deepEqual(result.removedNesting, [...NESTING_ENV_VARS]);

  // A removed value must not reappear anywhere — not in the returned env, and
  // not in the report that gets logged.
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('secret-value-for-'), false);
  assert.equal(serialized.includes('parent-value-for-'), false);
});

test('scrubEnv does not mutate the environment it was given', () => {
  const source = pollutedEnv();
  scrubEnv(source);
  assert.equal(source['ANTHROPIC_API_KEY'], 'secret-value-for-ANTHROPIC_API_KEY');
});

test('scrubEnv reports only variables that were actually present', () => {
  const result = scrubEnv({ PATH: '/usr/bin', ANTHROPIC_API_KEY: 'sk-test' });
  assert.deepEqual(result.removedBilling, ['ANTHROPIC_API_KEY']);
  assert.deepEqual(result.removedNesting, []);
});

test('scrubEnv marks agents non-interactive without overriding an explicit CI', () => {
  assert.equal(scrubEnv({}).env['CI'], '1');
  assert.equal(scrubEnv({ CI: '0' }).env['CI'], '0');
});

test('detectBillingEnv finds set variables and ignores empty ones', () => {
  assert.deepEqual(detectBillingEnv({ PATH: '/usr/bin' }), []);
  assert.deepEqual(detectBillingEnv({ ANTHROPIC_API_KEY: '' }), []);
  assert.deepEqual(
    detectBillingEnv({ ANTHROPIC_API_KEY: 'sk-test', CLAUDE_CODE_USE_BEDROCK: '1' }),
    ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_USE_BEDROCK'],
  );
});
