/**
 * Handing the compressor prompt to a runtime and collecting its answer.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runCompressorAgent } from './compressor-agent.js';
import type { AgentRuntime, AgentSpec, SwarmEvent } from '../types.js';

function fakeRuntime(result: string, capture: { spec?: AgentSpec }): AgentRuntime {
  return {
    id: 'fake',
    async preflight() {
      return { ok: true, runtime: 'fake', checks: [] };
    },
    async *run(spec: AgentSpec) {
      capture.spec = spec;
      yield { type: 'agent.start', at: '', agentId: spec.id, role: spec.role, sessionId: 's', cwd: spec.cwd } as SwarmEvent;
      yield { type: 'agent.done', at: '', agentId: spec.id, ok: true, result } as SwarmEvent;
    },
  };
}

test('returns the agent result on success', async () => {
  const capture: { spec?: AgentSpec } = {};
  const runtime = fakeRuntime('# new memory', capture);
  const outcome = await runCompressorAgent(runtime, 'billing', 'the prompt', '/repo', undefined, undefined, undefined);
  assert.equal(outcome.ok, true);
  assert.equal(outcome.result, '# new memory');
});

test('scopes the agent id and prompt to the module being compressed', async () => {
  const capture: { spec?: AgentSpec } = {};
  const runtime = fakeRuntime('ok', capture);
  await runCompressorAgent(runtime, 'billing', 'the prompt', '/repo', undefined, undefined, undefined);
  assert.equal(capture.spec?.id, 'compressor:billing');
  assert.equal(capture.spec?.module, 'billing');
  assert.equal(capture.spec?.prompt, 'the prompt');
  assert.equal(capture.spec?.cwd, '/repo');
  assert.deepEqual(capture.spec?.tools, []);
});

test('passes a model through only when one is given', async () => {
  const capture: { spec?: AgentSpec } = {};
  const runtime = fakeRuntime('ok', capture);
  await runCompressorAgent(runtime, 'billing', 'the prompt', '/repo', 'claude-x', undefined, undefined);
  assert.equal(capture.spec?.model, 'claude-x');

  const capture2: { spec?: AgentSpec } = {};
  await runCompressorAgent(fakeRuntime('ok', capture2), 'billing', 'the prompt', '/repo', undefined, undefined, undefined);
  assert.equal(capture2.spec?.model, undefined);
});

test('forwards every event to the given onEvent callback', async () => {
  const capture: { spec?: AgentSpec } = {};
  const runtime = fakeRuntime('ok', capture);
  const events: SwarmEvent[] = [];
  await runCompressorAgent(runtime, 'billing', 'the prompt', '/repo', undefined, (e) => {
    events.push(e);
  }, undefined);
  assert.deepEqual(
    events.map((e) => e.type),
    ['agent.start', 'agent.done'],
  );
});
