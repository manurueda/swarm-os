/**
 * Translation from Claude Code's `--output-format stream-json` NDJSON into the
 * normalized `SwarmEvent` stream.
 *
 * Swarm OS reads structured events. It never parses rendered terminal output,
 * so nothing here depends on colours, spinners or box-drawing characters.
 *
 * Shapes verified against Claude Code 2.1.231. Unknown event types are ignored
 * rather than fatal, so a CLI upgrade degrades instead of breaking.
 */

import type { SwarmEvent, UsageSnapshot, RateLimitSnapshot } from '../types.js';

/** Split a byte stream into whole JSON lines, tolerating partial chunks. */
export class NdjsonBuffer {
  private buf = '';

  push(chunk: string): unknown[] {
    this.buf += chunk;
    const out: unknown[] = [];
    let nl: number;
    while ((nl = this.buf.indexOf('\n')) !== -1) {
      const line = this.buf.slice(0, nl).trim();
      this.buf = this.buf.slice(nl + 1);
      if (!line) continue;
      try {
        out.push(JSON.parse(line));
      } catch {
        // A non-JSON line on stdout is noise from a hook or wrapper. Skip it.
      }
    }
    return out;
  }

  /** Flush any trailing line that arrived without a newline. */
  flush(): unknown[] {
    const rest = this.buf.trim();
    this.buf = '';
    if (!rest) return [];
    try {
      return [JSON.parse(rest)];
    } catch {
      return [];
    }
  }
}

type AnyRecord = Record<string, unknown>;

function isRecord(v: unknown): v is AnyRecord {
  return typeof v === 'object' && v !== null;
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

export function readUsage(raw: unknown, contextWindow?: number): UsageSnapshot | undefined {
  if (!isRecord(raw)) return undefined;
  const inputTokens = num(raw['input_tokens']);
  const outputTokens = num(raw['output_tokens']);
  const cacheReadTokens = num(raw['cache_read_input_tokens']);
  const cacheCreationTokens = num(raw['cache_creation_input_tokens']);
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    contextTokens: inputTokens + cacheReadTokens + cacheCreationTokens,
    ...(contextWindow ? { contextWindow } : {}),
  };
}

/** Pull the declared context window out of a result event's modelUsage map. */
function readContextWindow(raw: unknown): number | undefined {
  if (!isRecord(raw)) return undefined;
  for (const entry of Object.values(raw)) {
    if (isRecord(entry) && typeof entry['contextWindow'] === 'number') {
      return entry['contextWindow'];
    }
  }
  return undefined;
}

function readRateLimit(raw: unknown): RateLimitSnapshot | undefined {
  if (!isRecord(raw)) return undefined;
  const status = raw['status'];
  if (typeof status !== 'string') return undefined;
  return {
    status,
    ...(typeof raw['rateLimitType'] === 'string' ? { rateLimitType: raw['rateLimitType'] } : {}),
    ...(typeof raw['resetsAt'] === 'number' ? { resetsAt: raw['resetsAt'] } : {}),
    ...(typeof raw['isUsingOverage'] === 'boolean' ? { isUsingOverage: raw['isUsingOverage'] } : {}),
  };
}

/** One-line human summary of a tool call, for the live display. */
function summarizeToolInput(tool: string, input: unknown): string {
  if (!isRecord(input)) return '';
  const pick = (k: string): string | undefined =>
    typeof input[k] === 'string' ? (input[k] as string) : undefined;

  switch (tool) {
    case 'Read':
    case 'Edit':
    case 'Write':
    case 'NotebookEdit':
      return pick('file_path') ?? '';
    case 'Bash':
      return (pick('description') ?? pick('command') ?? '').slice(0, 80);
    case 'Grep':
      return pick('pattern') ?? '';
    case 'Glob':
      return pick('pattern') ?? '';
    default: {
      const first = Object.values(input).find((v) => typeof v === 'string') as string | undefined;
      return (first ?? '').slice(0, 80);
    }
  }
}

export interface TranslateContext {
  agentId: string;
  role: string;
  module?: string;
  cwd: string;
  /** Mutable: filled in from the init event so later events can reference it. */
  sessionId?: string;
}

/**
 * Translate one raw stream-json object into zero or more SwarmEvents.
 * `ctx` is mutated to carry the session id forward.
 */
export function translate(raw: unknown, ctx: TranslateContext): SwarmEvent[] {
  if (!isRecord(raw)) return [];
  const at = new Date().toISOString();
  const type = raw['type'];

  if (type === 'system' && raw['subtype'] === 'init') {
    ctx.sessionId = typeof raw['session_id'] === 'string' ? raw['session_id'] : undefined;
    return [
      {
        type: 'agent.start',
        at,
        agentId: ctx.agentId,
        role: ctx.role,
        ...(ctx.module ? { module: ctx.module } : {}),
        sessionId: ctx.sessionId ?? '',
        ...(typeof raw['model'] === 'string' ? { model: raw['model'] } : {}),
        cwd: typeof raw['cwd'] === 'string' ? raw['cwd'] : ctx.cwd,
      },
    ];
  }

  if (type === 'rate_limit_event') {
    const snapshot = readRateLimit(raw['rate_limit_info']);
    return snapshot ? [{ type: 'ratelimit', at, snapshot }] : [];
  }

  if (type === 'assistant') {
    const events: SwarmEvent[] = [];
    const message = raw['message'];
    if (!isRecord(message)) return events;

    const content = message['content'];
    if (Array.isArray(content)) {
      for (const block of content) {
        if (!isRecord(block)) continue;
        if (block['type'] === 'text' && typeof block['text'] === 'string' && block['text'].trim()) {
          events.push({ type: 'agent.text', at, agentId: ctx.agentId, text: block['text'] });
        } else if (block['type'] === 'tool_use' && typeof block['name'] === 'string') {
          events.push({
            type: 'agent.tool',
            at,
            agentId: ctx.agentId,
            tool: block['name'],
            summary: summarizeToolInput(block['name'], block['input']),
          });
        }
      }
    }

    const usage = readUsage(message['usage']);
    if (usage) events.push({ type: 'agent.usage', at, agentId: ctx.agentId, usage });
    return events;
  }

  if (type === 'user') {
    // Tool results come back as synthetic user turns.
    const message = raw['message'];
    if (!isRecord(message)) return [];
    const content = message['content'];
    if (!Array.isArray(content)) return [];
    const events: SwarmEvent[] = [];
    for (const block of content) {
      if (!isRecord(block) || block['type'] !== 'tool_result') continue;
      events.push({
        type: 'agent.tool_result',
        at,
        agentId: ctx.agentId,
        tool: '',
        ok: block['is_error'] !== true,
      });
    }
    return events;
  }

  if (type === 'result') {
    const contextWindow = readContextWindow(raw['modelUsage']);
    const usage = readUsage(raw['usage'], contextWindow);
    const isError = raw['is_error'] === true || raw['subtype'] !== 'success';
    const resultText = typeof raw['result'] === 'string' ? raw['result'] : undefined;

    // With --json-schema the payload arrives pre-parsed on the result event;
    // otherwise fall back to parsing the text as JSON.
    let structured: unknown;
    if (raw['structured_output'] !== undefined) {
      structured = raw['structured_output'];
    } else if (resultText) {
      structured = tryParseJson(resultText);
    }

    return [
      {
        type: 'agent.done',
        at,
        agentId: ctx.agentId,
        ok: !isError,
        ...(resultText !== undefined ? { result: resultText } : {}),
        ...(structured !== undefined ? { structured } : {}),
        ...(usage ? { usage } : {}),
        ...(typeof raw['total_cost_usd'] === 'number' ? { costUsd: raw['total_cost_usd'] } : {}),
        ...(typeof raw['duration_ms'] === 'number' ? { durationMs: raw['duration_ms'] } : {}),
      },
    ];
  }

  return [];
}

/** Parse JSON that may be wrapped in a ```json fence. */
export function tryParseJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/.exec(trimmed);
  const candidate = fenced?.[1] ?? trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    // Last resort: the outermost {...} or [...] span.
    const start = candidate.search(/[[{]/);
    const end = Math.max(candidate.lastIndexOf('}'), candidate.lastIndexOf(']'));
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1));
      } catch {
        /* give up */
      }
    }
    return undefined;
  }
}
