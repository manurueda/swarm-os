/**
 * The runtime seam: Claude Code's NDJSON in, normalized SwarmEvents out.
 *
 * Everything above this — the live display, mission ledgers, the scheduler's
 * rate-limit reaction — reads only the normalized stream. A silent regression
 * here surfaces as agents that appear to do nothing.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { NdjsonBuffer, translate, tryParseJson } from './stream-json.js';
import type { TranslateContext } from './stream-json.js';

function ctx(): TranslateContext {
  return { agentId: 'work:cli', role: 'module', module: 'cli', cwd: '/repo' };
}

test('NdjsonBuffer reassembles objects split across chunks', () => {
  const buffer = new NdjsonBuffer();
  assert.deepEqual(buffer.push('{"a":'), []);
  assert.deepEqual(buffer.push('1}\n'), [{ a: 1 }]);
});

test('NdjsonBuffer yields every complete line in one chunk', () => {
  const buffer = new NdjsonBuffer();
  assert.deepEqual(buffer.push('{"a":1}\n{"b":2}\n'), [{ a: 1 }, { b: 2 }]);
});

test('NdjsonBuffer skips blank and non-JSON lines rather than throwing', () => {
  const buffer = new NdjsonBuffer();
  // Hooks and wrappers print to the same stdout.
  assert.deepEqual(buffer.push('\nnot json at all\n{"a":1}\n'), [{ a: 1 }]);
});

test('NdjsonBuffer.flush returns a trailing line that never got a newline', () => {
  const buffer = new NdjsonBuffer();
  buffer.push('{"a":1}');
  assert.deepEqual(buffer.flush(), [{ a: 1 }]);
  assert.deepEqual(buffer.flush(), [], 'flush must not replay what it already returned');
});

test('an init event starts the agent and carries the session id forward', () => {
  const context = ctx();
  const events = translate(
    { type: 'system', subtype: 'init', session_id: 's-1', model: 'sonnet', cwd: '/worktree' },
    context,
  );
  assert.equal(events.length, 1);
  const [start] = events;
  assert.equal(start?.type, 'agent.start');
  assert.equal(context.sessionId, 's-1');
  if (start?.type === 'agent.start') {
    assert.equal(start.sessionId, 's-1');
    assert.equal(start.module, 'cli');
    assert.equal(start.model, 'sonnet');
    assert.equal(start.cwd, '/worktree');
  }
});

test('an assistant turn becomes text, tool and usage events', () => {
  const events = translate(
    {
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Reading the router.' },
          { type: 'text', text: '   ' },
          { type: 'tool_use', name: 'Read', input: { file_path: 'src/route.ts' } },
        ],
        usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100 },
      },
    },
    ctx(),
  );

  assert.deepEqual(
    events.map((e) => e.type),
    ['agent.text', 'agent.tool', 'agent.usage'],
    'whitespace-only text blocks are dropped',
  );

  const [, tool, usage] = events;
  if (tool?.type === 'agent.tool') {
    assert.equal(tool.tool, 'Read');
    assert.equal(tool.summary, 'src/route.ts');
  }
  if (usage?.type === 'agent.usage') {
    // What occupied the window, not what was billed as fresh input.
    assert.equal(usage.usage.contextTokens, 110);
  }
});

test('a tool result comes back as a synthetic user turn', () => {
  const events = translate(
    { type: 'user', message: { content: [{ type: 'tool_result', is_error: true }] } },
    ctx(),
  );
  assert.equal(events.length, 1);
  const [result] = events;
  assert.equal(result?.type, 'agent.tool_result');
  if (result?.type === 'agent.tool_result') {
    assert.equal(result.ok, false);
    assert.equal(result.refused, undefined, 'a plain error is not a refusal');
  }
});

test('a tool result refused for requiring approval is flagged', () => {
  const events = translate(
    {
      type: 'user',
      message: {
        content: [
          {
            type: 'tool_result',
            is_error: true,
            content: [{ type: 'text', text: 'Bash requires approval to run in this session.' }],
          },
        ],
      },
    },
    ctx(),
  );
  assert.equal(events.length, 1);
  const [result] = events;
  assert.equal(result?.type, 'agent.tool_result');
  if (result?.type === 'agent.tool_result') {
    assert.equal(result.ok, false);
    assert.equal(result.refused, true);
  }
});

test('a stream with no refusals never sets the refused flag', () => {
  const events = [
    translate({ type: 'user', message: { content: [{ type: 'tool_result', is_error: false }] } }, ctx()),
    translate(
      {
        type: 'user',
        message: { content: [{ type: 'tool_result', is_error: true, content: 'file not found' }] },
      },
      ctx(),
    ),
  ].flat();
  assert.equal(events.length, 2);
  for (const event of events) {
    if (event.type === 'agent.tool_result') assert.equal(event.refused, undefined);
  }
});

test('a result event terminates the agent with usage and cost', () => {
  const events = translate(
    {
      type: 'result',
      subtype: 'success',
      result: '{"status":"complete"}',
      usage: { input_tokens: 1, cache_read_input_tokens: 2, cache_creation_input_tokens: 3 },
      modelUsage: { 'claude-sonnet': { contextWindow: 200000 } },
      total_cost_usd: 1.25,
      duration_ms: 4200,
    },
    ctx(),
  );

  assert.equal(events.length, 1);
  const [done] = events;
  assert.equal(done?.type, 'agent.done');
  if (done?.type === 'agent.done') {
    assert.equal(done.ok, true);
    assert.equal(done.costUsd, 1.25);
    assert.equal(done.durationMs, 4200);
    assert.equal(done.usage?.contextTokens, 6);
    assert.equal(done.usage?.contextWindow, 200000);
    assert.deepEqual(done.structured, { status: 'complete' });
  }
});

test('a non-success result is reported as failed', () => {
  const [done] = translate({ type: 'result', subtype: 'error_max_turns' }, ctx());
  assert.equal(done?.type, 'agent.done');
  if (done?.type === 'agent.done') assert.equal(done.ok, false);
});

test('structured output on the result event wins over parsing the text', () => {
  const [done] = translate(
    { type: 'result', subtype: 'success', result: 'ignored', structured_output: { modules: [] } },
    ctx(),
  );
  if (done?.type === 'agent.done') assert.deepEqual(done.structured, { modules: [] });
});

test('a rate limit event is surfaced for the scheduler', () => {
  const [event] = translate(
    { type: 'rate_limit_event', rate_limit_info: { status: 'rejected', resetsAt: 123 } },
    ctx(),
  );
  assert.equal(event?.type, 'ratelimit');
  if (event?.type === 'ratelimit') {
    assert.equal(event.snapshot.status, 'rejected');
    assert.equal(event.snapshot.resetsAt, 123);
  }
});

test('unknown and malformed events are ignored, so a CLI upgrade degrades', () => {
  assert.deepEqual(translate({ type: 'something_new_in_2_2' }, ctx()), []);
  assert.deepEqual(translate({ type: 'assistant', message: 'not-a-record' }, ctx()), []);
  assert.deepEqual(translate(null, ctx()), []);
  assert.deepEqual(translate('a string', ctx()), []);
});

test('tryParseJson survives the ways a model wraps its output', () => {
  assert.deepEqual(tryParseJson('{"a":1}'), { a: 1 });
  assert.deepEqual(tryParseJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(tryParseJson('```\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(tryParseJson('Here you go: {"a":1} — hope that helps'), { a: 1 });
  assert.equal(tryParseJson('no json here'), undefined);
});
