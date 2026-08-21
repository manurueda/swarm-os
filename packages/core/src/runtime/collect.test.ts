/**
 * collectAgent drains a runtime's event stream into a single outcome; mission
 * reads refusalCount off that outcome to diagnose a misconfigured project.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { AgentRuntime, AgentSpec, SwarmEvent } from '../types.js';
import { translate, type TranslateContext } from './stream-json.js';
import { collectAgent } from './collect.js';

function ctx(): TranslateContext {
  return { agentId: 'work:cli', role: 'module', module: 'cli', cwd: '/repo' };
}

/** A runtime whose run() replays translate()'d raw stream-json fixtures. */
function fakeRuntime(rawEvents: unknown[]): AgentRuntime {
  return {
    id: 'fake',
    preflight: async () => ({ ok: true, runtime: 'fake', checks: [] }),
    async *run(): AsyncIterable<SwarmEvent> {
      const context = ctx();
      for (const raw of rawEvents) {
        for (const event of translate(raw, context)) yield event;
      }
    },
  };
}

const spec: AgentSpec = { id: 'work:cli', role: 'module', prompt: 'do the thing', cwd: '/repo' };

test('collectAgent counts refused tool calls into refusalCount', async () => {
  const runtime = fakeRuntime([
    {
      type: 'user',
      message: {
        content: [
          { type: 'tool_result', is_error: true, content: 'Bash requires approval to run.' },
        ],
      },
    },
    {
      type: 'user',
      message: {
        content: [{ type: 'tool_result', is_error: true, content: 'permission denied' }],
      },
    },
    { type: 'result', subtype: 'success', result: 'done' },
  ]);

  const outcome = await collectAgent(runtime, spec);
  assert.equal(outcome.refusalCount, 2);
});

test('collectAgent reports refusalCount 0 when nothing was refused', async () => {
  const runtime = fakeRuntime([
    { type: 'user', message: { content: [{ type: 'tool_result', is_error: false }] } },
    { type: 'result', subtype: 'success', result: 'done' },
  ]);

  const outcome = await collectAgent(runtime, spec);
  assert.equal(outcome.refusalCount, 0);
});
