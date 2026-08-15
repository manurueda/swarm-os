# Agent Runtime Port — memory

_Durable knowledge for the `runtime` swarm. Read on wake, rewritten on sleep._

## Invariants

- scrubEnv() must be applied to every spawned claude/git/npm child process env; it strips BILLING_ENV_VARS (ANTHROPIC_API_KEY etc.) and NESTING_ENV_VARS (CLAUDECODE, CLAUDE_CODE_SESSION_ID etc.) and defaults CI=1 without overriding an explicit CI value. It never mutates the source env object and returns only variable names, never values, in its report. <sub>`packages/core/src/runtime/env.ts`</sub>
- AgentSpec.tools === undefined means 'use claude's full default toolset'; an explicit empty array ([]) means 'no tools at all' — buildArgs() only emits --tools when spec.tools !== undefined, so omitting vs. empty-array are semantically different, not equivalent. <sub>`packages/core/src/runtime/claude-code-local.ts`</sub>
- systemPromptOverride (--system-prompt) and systemPrompt (--append-system-prompt) are not mutually exclusive and can both be passed; override REPLACES the default prompt and must only be used for tool-less agents, since it would strip tool-use guidance from an agent that has tools. <sub>`packages/core/src/types.ts`</sub>
- run() always yields a terminal event: if the child process closes without ever emitting an agent.done, run() synthesizes an agent.error so downstream consumers (collectAgent, UI) can rely on always seeing a terminal event. <sub>`packages/core/src/runtime/claude-code-local.ts`</sub>
- Every spawned child is added to the module-level `liveChildren` Set and removed on 'error'/'close'; killAllAgents() is the backstop for process.exit() bypassing the async generator's `finally` block, since children outside the terminal's process group can otherwise survive a cancelled Swarm OS process. <sub>`packages/core/src/runtime/claude-code-local.ts`</sub>
- Unknown/unrecognized stream-json event types and shapes are silently ignored by translate() rather than throwing, so a claude CLI upgrade degrades gracefully instead of crashing agents. <sub>`packages/core/src/runtime/stream-json.ts`</sub>
- applyUpdate() for a git install refuses to run if `git status --porcelain` is non-empty (treats any local modification as work-in-progress and reports blocked rather than overwriting it); it only fast-forwards (`git pull --ff-only`). <sub>`packages/core/src/update/index.ts`</sub>
- backgroundUpdate() is designed to run in a detached background process; the foreground path is expected to only ever read the cached update.json via readUpdateStatus(), never call checkForUpdate/applyUpdate synchronously, to avoid slowing down any command. <sub>`packages/core/src/update/index.ts` [doc]</sub>
- updatesDisabled() must be checked before any update path runs — SWARM_NO_UPDATE env var (any value other than '', '0', 'false') disables checks/applies entirely. <sub>`packages/core/src/update/index.ts`</sub>

## Gotchas

- agentBaselineTokens() is an interpolation/extrapolation over only 3 measured anchor points (0, 3, 6 tools) taken on one specific Claude Code version (2.1.231); it is explicitly labelled an estimate, not exact, since tools vary widely in prompt-token cost (e.g. Bash vs Glob). <sub>`packages/core/src/runtime/baseline.ts`</sub>
- lean mode (default true unless spec.lean === false) forces --setting-sources to spec.settingSources ?? '' (i.e. no settings files loaded at all) in addition to --strict-mcp-config and --disable-slash-commands; non-lean mode only sets --setting-sources if the caller explicitly passed one, otherwise it's omitted (CLI default applies). <sub>`packages/core/src/runtime/claude-code-local.ts`</sub>
- tryParseJson() has a lenient fallback: if strict JSON.parse fails, it slices from the first '[' or '{' to the last ']' or '}' and retries — this can silently succeed on malformed/truncated text that merely happens to have matching outer brackets somewhere in the middle. <sub>`packages/core/src/runtime/stream-json.ts`</sub>
- 'user' type stream-json events (synthetic tool-result turns) always produce agent.tool_result events with tool: '' — the tool name is not recoverable from that event shape, so consumers cannot correlate which tool a result belongs to from this field alone. <sub>`packages/core/src/runtime/stream-json.ts`</sub>
- detectInstall() determines git-vs-npm installation by walking up from the running module's own file path looking for the nearest package.json (assumed to be @swarm-os/cli) and then further up for a .git directory — this depends on the package layout (dist/ nested under a monorepo root with .git) and will misclassify if that layout changes. <sub>`packages/core/src/update/index.ts`</sub>
- index.ts re-exports far more than this module owns (workspace, mapper, swarm, architecture, ui, mission, loop, git — all owned by sibling modules); it is the single flat @swarm-os/core barrel for the entire package, not scoped to runtime/update. <sub>`packages/core/src/index.ts`</sub>

## Landmarks

- `packages/core/src/types.ts` — Domain types + the AgentRuntime port interface (preflight/run) that all runtime implementations must satisfy.
- `packages/core/src/runtime/claude-code-local.ts` — ClaudeCodeLocalRuntime class: buildArgs(), run() async generator, killAllAgents()/liveChildren registry, preflight() (version+auth+billing-env checks).
- `packages/core/src/runtime/stream-json.ts` — NdjsonBuffer (line-splitting) + translate() (raw JSON -> SwarmEvent[]) + tryParseJson() (fenced/loose JSON extraction for structured output fallback).
- `packages/core/src/runtime/env.ts` — BILLING_ENV_VARS / NESTING_ENV_VARS lists + scrubEnv()/detectBillingEnv().
- `packages/core/src/runtime/collect.ts` — collectAgent() drains an AgentRuntime.run() stream into a single AgentOutcome; sumUsage() aggregates UsageSnapshots for mission ledgers.
- `packages/core/src/runtime/system-tier.ts` — standaloneSystemPrompt() (no-tools agents, replaces default prompt) and standaloneAgentPrompt() (tool-bearing agents, also replaces default prompt) — used by system-tier agents like partitioner/router/compressor.
- `packages/core/src/runtime/baseline.ts` — agentBaselineTokens(toolCount) — interpolated/extrapolated token-cost estimate from measured anchors; CONTEXT_WINDOW constant (200k).
- `packages/core/src/update/index.ts` — Self-update: detectInstall() (git vs npm), checkForUpdate(), applyUpdate(), backgroundUpdate() (detached check+apply), status cache under ~/.swarm/update.json.
- `packages/core/src/index.ts` — Barrel export for the entire @swarm-os/core package (not just this module) — every sibling module's public surface is re-exported here.

## Public interface

- AgentRuntime (interface), AgentSpec, SwarmEvent, ModuleSpec, SwarmRecord, MissionRecord, AgentLedgerEntry, MissionPlan/Assignment, UsageSnapshot, RateLimitSnapshot, PreflightReport/Check, PermissionMode (from types.ts)
- ClaudeCodeLocalRuntime, ClaudeCodeLocalOptions, AuthStatus, killAllAgents (from runtime/claude-code-local.ts)
- collectAgent, sumUsage, AgentOutcome (from runtime/collect.ts)
- scrubEnv, detectBillingEnv, BILLING_ENV_VARS, NESTING_ENV_VARS (from runtime/env.ts)
- NdjsonBuffer, translate, tryParseJson (from runtime/stream-json.ts)
- standaloneSystemPrompt, standaloneAgentPrompt (from runtime/system-tier.ts)
- agentBaselineTokens, CONTEXT_WINDOW (from runtime/baseline.ts)
- detectInstall, checkForUpdate, applyUpdate, backgroundUpdate, readUpdateStatus, writeUpdateStatus, isCheckDue, updatesDisabled, stateDir, CHECK_INTERVAL_MS, InstallInfo, InstallKind, UpdateStatus, ApplyResult (from update/index.ts)
- index.ts barrel re-exports all of the above plus every sibling module's public surface as the single @swarm-os/core package entry point

---

_Surveyed 2026-08-15 by the `runtime` analyst, reading only this module's paths._
