/**
 * Drive one agent to completion and collect its outcome.
 *
 * Missions stream events for display; system agents (router, mapper,
 * compressor) just need the answer. Both go through here so the event log stays
 * complete either way.
 */

import type { AgentRuntime, AgentSpec, SwarmEvent, UsageSnapshot } from '../types.js';

export interface AgentOutcome {
  ok: boolean;
  sessionId?: string;
  /** Final assistant text. */
  result?: string;
  /** Parsed structured output when the spec carried a JSON Schema. */
  structured?: unknown;
  usage?: UsageSnapshot;
  costUsd?: number;
  durationMs?: number;
  error?: string;
}

export async function collectAgent(
  runtime: AgentRuntime,
  spec: AgentSpec,
  onEvent?: (event: SwarmEvent) => void | Promise<void>,
  signal?: AbortSignal,
): Promise<AgentOutcome> {
  const outcome: AgentOutcome = { ok: false };

  for await (const event of runtime.run(spec, signal)) {
    await onEvent?.(event);

    switch (event.type) {
      case 'agent.start':
        outcome.sessionId = event.sessionId;
        break;
      case 'agent.done':
        outcome.ok = event.ok;
        if (event.result !== undefined) outcome.result = event.result;
        if (event.structured !== undefined) outcome.structured = event.structured;
        if (event.usage) outcome.usage = event.usage;
        if (event.costUsd !== undefined) outcome.costUsd = event.costUsd;
        if (event.durationMs !== undefined) outcome.durationMs = event.durationMs;
        break;
      case 'agent.error':
        outcome.ok = false;
        outcome.error = event.message;
        break;
      default:
        break;
    }
  }

  return outcome;
}

/** Sum usage across agents, for the mission ledger. */
export function sumUsage(snapshots: Array<UsageSnapshot | undefined>): UsageSnapshot {
  const total: UsageSnapshot = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    contextTokens: 0,
  };
  for (const s of snapshots) {
    if (!s) continue;
    total.inputTokens += s.inputTokens;
    total.outputTokens += s.outputTokens;
    total.cacheReadTokens += s.cacheReadTokens;
    total.cacheCreationTokens += s.cacheCreationTokens;
    total.contextTokens += s.contextTokens;
  }
  return total;
}
