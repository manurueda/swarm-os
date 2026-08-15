# Agent Runtime Port — memory

_Durable knowledge for the `runtime` swarm. Read on wake, rewritten on sleep._

## Invariants

- scrubEnv() must be applied before spawning any claude/git/npm child; it strips BILLING_ENV_VARS (ANTHROPIC_API_KEY etc.) and NESTING_ENV_VARS (CLAUDECODE, CLAUDE_CODE_SESSION_ID etc.), defaults CI=1 without overriding an explicit value, never mutates the source env object, and returns only variable names (never values) in its report. <sub>`packages/core/src/runtime/env.ts`</sub>
- AgentSpec.tools === undefined means 'use claude's full default toolset'; an explicit empty array means 'no tools at all' — buildArgs() only emits --tools when spec.tools !== undefined, so omitting vs. passing [] are semantically different. <sub>`packages/core/src/runtime/claude-code-local.ts`</sub>
- systemPromptOverride (--system-prompt) and systemPrompt (--append-system-prompt) are not mutually exclusive; override REPLACES the default prompt and must only be used for tool-less agents, never for agents with tools (would strip tool-use guidance). <sub>`packages/core/src/types.ts` [doc]</sub>
- run() always yields a terminal event: if the child closes without ever emitting agent.done, run() synthesizes an agent.error so downstream consumers (collectAgent, UI) can rely on always seeing a terminal event. <sub>`packages/core/src/runtime/claude-code-local.ts`</sub>
- Every spawned child is added to the module-level liveChildren Set and removed on 'error'/'close'; killAllAgents() is the backstop for process.exit() bypassing the async generator's finally block, so children can survive a cancelled Swarm OS process otherwise. <sub>`packages/core/src/runtime/claude-code-local.ts`</sub>
- Unknown/unrecognized stream-json event types are silently ignored by translate() rather than throwing, so a claude CLI upgrade degrades gracefully instead of crashing agents. <sub>`packages/core/src/runtime/stream-json.ts`</sub>
- applyUpdate() for a git install refuses to run if `git status --porcelain` is non-empty (any local modification is treated as work-in-progress and reported as blocked); it only fast-forwards via `git pull --ff-only`. <sub>`packages/core/src/update/index.ts`</sub>
- backgroundUpdate() is meant to run in a detached background process; the foreground/CLI path should only ever read the cached update.json via readUpdateStatus(), never call checkForUpdate/applyUpdate synchronously, so commands are never slowed down. <sub>`packages/core/src/update/index.ts` [doc]</sub>
- updatesDisabled() (SWARM_NO_UPDATE env var, any value other than '', '0', 'false') must be checked before any update check/apply path runs. <sub>`packages/core/src/update/index.ts`</sub>

## Gotchas

- agentBaselineTokens() interpolates/extrapolates over only 3 measured anchor points (0, 3, 6 tools) taken on one specific Claude Code version (2.1.231); explicitly labelled an estimate since tool cost varies widely (e.g. Bash vs Glob). <sub>`packages/core/src/runtime/baseline.ts`</sub>
- lean mode (default true unless spec.lean === false) forces --setting-sources to spec.settingSources ?? '' (no settings files at all) in addition to --strict-mcp-config and --disable-slash-commands; non-lean mode only sets --setting-sources if the caller explicitly passed one. <sub>`packages/core/src/runtime/claude-code-local.ts`</sub>
- tryParseJson() has a lenient fallback: if strict JSON.parse fails it slices from the first '[' or '{' to the last ']' or '}' and retries — can silently 'succeed' on malformed/truncated text that happens to have matching outer brackets somewhere in the middle. <sub>`packages/core/src/runtime/stream-json.ts`</sub>
- 'user' type stream-json events (synthetic tool-result turns) always produce agent.tool_result events with tool: '' — the tool name is not recoverable from that event shape, so consumers cannot correlate a result to which tool produced it via this field alone. <sub>`packages/core/src/runtime/stream-json.ts`</sub>
- detectInstall() determines git-vs-npm by walking up from the running module's own file path for the nearest package.json (assumed to be @swarm-os/cli) and then further up for a .git directory — depends on the current monorepo layout (dist/ nested under a repo root with .git) and will misclassify if that layout changes. <sub>`packages/core/src/update/index.ts`</sub>
- index.ts re-exports far more than this module owns (workspace, mapper, swarm, architecture, ui, mission, loop, git — all owned by sibling modules); it is the single flat @swarm-os/core barrel for the entire package, not scoped to runtime/update. Any edit here risks breaking every other module's public surface. <sub>`packages/core/src/index.ts`</sub>

## Landmarks

- `packages/core/src/types.ts` — Domain vocabulary + AgentRuntime port interface that all runtime implementations (present and future, e.g. a ClaudeApiRuntime) must satisfy.
- `packages/core/src/runtime/claude-code-local.ts` — ClaudeCodeLocalRuntime class: buildArgs(), run() async generator over child_process, killAllAgents()/liveChildren registry, preflight() (version+auth+billing checks).
- `packages/core/src/runtime/stream-json.ts` — NdjsonBuffer (line splitter) + translate() (raw JSON -> SwarmEvent[]) + tryParseJson() (fenced/loose JSON extraction).
- `packages/core/src/runtime/env.ts` — BILLING_ENV_VARS / NESTING_ENV_VARS constant lists + scrubEnv()/detectBillingEnv().
- `packages/core/src/runtime/collect.ts` — collectAgent() drains an AgentRuntime.run() stream into a single AgentOutcome; sumUsage() aggregates UsageSnapshots for mission ledgers.
- `packages/core/src/runtime/system-tier.ts` — standaloneSystemPrompt() (no-tools agents) and standaloneAgentPrompt() (tool-bearing agents) — both replace rather than append to Claude Code's default system prompt, for token savings.
- `packages/core/src/runtime/baseline.ts` — agentBaselineTokens(toolCount) interpolation/extrapolation over 3 measured anchors; CONTEXT_WINDOW=200_000 constant.
- `packages/core/src/update/index.ts` — Self-update: detectInstall(), checkForUpdate(), applyUpdate(), backgroundUpdate() (detached check+apply), status cache under ~/.swarm/update.json.
- `packages/core/src/index.ts` — Flat barrel export for all of @swarm-os/core — types, runtime, update, plus every sibling module's public surface (workspace, mapper, swarm, architecture, ui, mission, loop, git).

## Public interface

- AgentRuntime, AgentSpec, SwarmEvent, ModuleSpec, SwarmRecord, MissionRecord, AgentLedgerEntry, MissionPlan/MissionAssignment, UsageSnapshot, RateLimitSnapshot, PreflightReport/PreflightCheck, PermissionMode (types.ts)
- ClaudeCodeLocalRuntime, ClaudeCodeLocalOptions, AuthStatus, killAllAgents (runtime/claude-code-local.ts) — killAllAgents is called directly by packages/cli/src/main.ts on signal/abrupt-exit handling
- collectAgent, sumUsage, AgentOutcome (runtime/collect.ts)
- scrubEnv, detectBillingEnv, BILLING_ENV_VARS, NESTING_ENV_VARS (runtime/env.ts)
- NdjsonBuffer, translate, tryParseJson (runtime/stream-json.ts)
- standaloneSystemPrompt, standaloneAgentPrompt (runtime/system-tier.ts)
- agentBaselineTokens, CONTEXT_WINDOW (runtime/baseline.ts)
- detectInstall, checkForUpdate, applyUpdate, backgroundUpdate, readUpdateStatus, writeUpdateStatus, isCheckDue, updatesDisabled, stateDir, CHECK_INTERVAL_MS, InstallInfo, InstallKind, UpdateStatus, ApplyResult (update/index.ts) — consumed by packages/cli/src/commands/update.ts
- index.ts as the sole @swarm-os/core package entry point (main/types fields in package.json point at dist/index.js)

---

_Surveyed 2026-08-15 by the `runtime` analyst, reading only this module's paths._
