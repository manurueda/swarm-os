# Agent Runtime Port — memory

_Durable knowledge for the `runtime` swarm. Read on wake, rewritten on sleep._

## Invariants

- scrubEnv() never mutates the source env object (returns a shallow copy); its ScrubResult carries only removed variable *names*, never values. <sub>`packages/core/src/runtime/env.ts`</sub>
- AgentSpec.tools === undefined means 'full default toolset'; AgentSpec.tools === [] means 'no tools at all' and forces the tool-less system tier. Load-bearing in buildArgs(). <sub>`packages/core/src/runtime/claude-code-local.ts`</sub>
- systemPromptOverride (--system-prompt) and systemPrompt (--append-system-prompt) can both be passed at once; systemPromptOverride must only be used for agents with tools===[] since it discards the tool-use guidance the harness otherwise supplies. <sub>`packages/core/src/runtime/claude-code-local.ts`</sub>
- spec.resume (session id) and spec.prompt are not mutually exclusive in buildArgs() — `-p` prompt and `--resume` sessionId can both be passed at once. There is no separate resume() method on AgentRuntime — a verify-fix loop resumes by building a fresh AgentSpec with resume=prior sessionId and prompt=trimmed failure output + fix instructions, then calling runtime.run() again. <sub>`packages/core/src/runtime/claude-code-local.ts`</sub>
- run()'s finally block always attempts child.kill('SIGTERM') if the child is alive when the generator unwinds, but process.exit() from outside bypasses this — liveChildren + killAllAgents() is the documented backstop. <sub>`packages/core/src/runtime/claude-code-local.ts`</sub>
- translate() never throws on unknown/malformed input — unknown event types and non-record shapes return an empty array. <sub>`packages/core/src/runtime/stream-json.ts`</sub>
- UsageSnapshot.contextTokens = inputTokens + cacheReadTokens + cacheCreationTokens, deliberately excluding outputTokens. <sub>`packages/core/src/runtime/stream-json.ts`</sub>
- A tool_result only counts as a refusal (agent.tool_result.refused=true, rolled into AgentOutcome.refusalCount by collectAgent()) when is_error===true AND its content text matches REFUSAL_PATTERNS; an ordinary tool failure is never counted. refusalCount is always a number, never undefined. REFUSAL_PATTERNS currently contains only `/requires approval/i` — the one phrase actually observed from a live sandbox harness refusal. Do not re-add broad phrases like 'permission denied' or 'not been granted' without a way to distinguish harness-level denial from an ordinary tool's own error text. <sub>`packages/core/src/runtime/stream-json.ts`, `packages/core/src/runtime/collect.ts`</sub>
- If the child process closes without ever emitting agent.done (crash, non-zero exit, clean exit with no result), run() synthesizes a terminal agent.error so consumers always see exactly one terminal event per run(). <sub>`packages/core/src/runtime/claude-code-local.ts`</sub>
- applyUpdate() for a git install refuses to run if `git status --porcelain` is non-empty. <sub>`packages/core/src/update/index.ts`</sub>
- backgroundUpdate() is meant to run detached; the foreground CLI path only ever reads update.json via readUpdateStatus() and must never block on a network check. <sub>`packages/core/src/update/index.ts` [doc]</sub>
- updatesDisabled() treats SWARM_NO_UPDATE as opted-out unless unset, '', '0', or 'false'. <sub>`packages/core/src/update/index.ts`</sub>
- checkStaleBuild(repoRoot) compares newest mtime among src/**/*.ts (excluding *.test.ts) against tsconfig.tsbuildinfo mtime, per package (core, cli). NEVER compare against dist output mtimes — tsc --build refreshes tsbuildinfo but skips dist emit when touched files hash unchanged. Missing tsbuildinfo counts as stale. All filesystem errors caught internally per-package, treated as not-stale — never throws. Skipped when SWARM_UPDATE_WORKER is set. Always returns `{ stale: boolean }`, never `null`. <sub>`packages/core/src/update/stale-build.ts`</sub>

## Gotchas

- is_error===true alone does not distinguish a harness permission refusal from an ordinary command failure — both set is_error true. The only reliable signal in the raw NDJSON today is the literal text 'requires approval'; there is no dedicated harness-refusal field. <sub>`packages/core/src/runtime/stream-json.ts`</sub>
- agentBaselineTokens() interpolates/extrapolates over just 3 measured anchor points (0, 3, 6 tools) on one Claude Code version (2.1.231); an estimate, not a guaranteed bound. <sub>`packages/core/src/runtime/baseline.ts` [doc]</sub>
- Lean mode's headline savings (~95k -> ~12k tokens) and the 8,746/28,925-token default-prompt figures in system-tier.ts are measurements from one specific CLI version and an empty/no-tool prompt; will drift, not re-verified at runtime. <sub>`packages/core/src/runtime/claude-code-local.ts` [doc]</sub>
- index.ts is NOT scoped to this module — it's the single barrel for the whole @swarm-os/core package; most of its exports belong to sibling modules. Only ./runtime/*, ./update/*, ./types.js re-exports are this module's surface. <sub>`packages/core/src/index.ts`</sub>
- 'user' events in the NDJSON stream are synthetic tool-result turns, not real end-user chat turns — translate() maps type==='user' to agent.tool_result. <sub>`packages/core/src/runtime/stream-json.ts`</sub>
- detectInstall() finds git-vs-npm by walking up from the running module's file path to package.json then continuing up for a .git dir — a monorepo checkout without .git up the chain would misreport as 'npm'. <sub>`packages/core/src/update/index.ts`</sub>
- detectBillingEnv() and scrubEnv() only cover fixed BILLING_ENV_VARS/NESTING_ENV_VARS lists; a new Claude Code env var added in a future CLI version leaks through until hand-updated. <sub>`packages/core/src/runtime/env.ts`</sub>
- preflight()'s billing-basis check only treats authMethod==='claude.ai' as 'subscription'; every other authMethod is reported 'warn' (bills per token). <sub>`packages/core/src/runtime/claude-code-local.ts`</sub>
- The result event's `structured` field parses raw['result'] as JSON only when raw['structured_output'] is absent — if the CLI ever sends both, structured_output silently wins even if stale/wrong. <sub>`packages/core/src/runtime/stream-json.ts`</sub>
- checkStaleBuild's tsbuildinfo path is hardcoded as `<packageRoot>/tsconfig.tsbuildinfo`, derived from TS's default computation for this repo's current tsconfig layout — never observed from an actual build run. If rootDir/outDir/tsBuildInfoFile setup changes, this silently reports perpetual false staleness. <sub>`packages/core/src/update/stale-build.ts`</sub>
- AgentLedgerEntry (types.ts) carries verifyOutcome/refusalCount (required field), but MissionModuleResult (packages/core/src/mission/run.ts, outside this module's boundary) is what the mission-layer verify loop and CLI display actually read per-module. Wiring ledger→result fields is the mission module's job, not this one's.
- Sandboxes where node_modules is a symlink resolving outside the worktree can refuse ALL commands that resolve through it (npm test/build, npx tsc, even bare `node -e`/`node --test`, `git checkout`) with 'requires approval', while argument-less commands (`node --version`) and plain file reads still succeed. Verify this module's test suite in an unaffected environment before trusting a sandbox-run result — several missions here have shipped changes reviewed only by manual type-tracing for this reason.

## Landmarks

- `packages/core/src/runtime/claude-code-local.ts` — AgentRuntime implementation: buildArgs(), run() (spawn + async generator over SwarmEvents), liveChildren registry, killAllAgents(), preflight()/authStatus()/version().
- `packages/core/src/runtime/stream-json.ts` — NdjsonBuffer (chunk reassembly), translate() (raw JSON -> SwarmEvent[]), REFUSAL_PATTERNS + refusal detection on tool_result events, tryParseJson() (fenced/embedded JSON recovery for structured output fallback).
- `packages/core/src/runtime/env.ts` — scrubEnv()/detectBillingEnv(), BILLING_ENV_VARS, NESTING_ENV_VARS — the sole defence against agents silently billing per-token instead of via subscription.
- `packages/core/src/runtime/collect.ts` — collectAgent() drains an AgentRuntime.run() async iterable into a single AgentOutcome (incl. refusalCount summed from translated events); sumUsage() aggregates UsageSnapshots for mission ledgers.
- `packages/core/src/runtime/system-tier.ts` — standaloneSystemPrompt() (tool-less agents) and standaloneAgentPrompt() (narrow tool sets) — both replace Claude Code's ~8.5k-token default system prompt with a smaller charter.
- `packages/core/src/runtime/baseline.ts` — agentBaselineTokens(toolCount) — interpolated/extrapolated estimate of fixed per-agent context cost, 3 anchor points, Claude Code 2.1.231.
- `packages/core/src/update/index.ts` — Self-update: detectInstall (git vs npm), checkForUpdate, applyUpdate, backgroundUpdate (detached, writes update.json under ~/.swarm), isCheckDue/updatesDisabled/CHECK_INTERVAL_MS gating.
- `packages/core/src/update/stale-build.ts` — checkStaleBuild(repoRoot) — mtime-only check per package (core, cli) of newest src .ts file vs tsconfig.tsbuildinfo. Never throws.
- `packages/core/src/types.ts` — All shared domain types: ModuleSpec, SwarmRecord/SwarmState, MissionRecord/MissionStatus/MissionPlan/MissionAssignment, AgentSpec/PermissionMode, AgentLedgerEntry (verifyOutcome/refusalCount), UsageSnapshot, RateLimitSnapshot, SwarmEvent (discriminated union), PreflightReport/PreflightCheck, AgentRuntime interface.
- `packages/core/src/index.ts` — Flat barrel export for the entire @swarm-os/core package across all sibling modules, not scoped to runtime/update.

## Public interface

- ClaudeCodeLocalRuntime (implements AgentRuntime), killAllAgents(), ClaudeCodeLocalOptions, AuthStatus
- collectAgent(), sumUsage(), AgentOutcome (incl. refusalCount)
- scrubEnv(), detectBillingEnv(), BILLING_ENV_VARS, NESTING_ENV_VARS
- NdjsonBuffer, translate(), tryParseJson(), TranslateContext
- standaloneSystemPrompt(), standaloneAgentPrompt()
- agentBaselineTokens(), CONTEXT_WINDOW
- detectInstall(), checkForUpdate(), applyUpdate(), backgroundUpdate(), readUpdateStatus(), writeUpdateStatus(), isCheckDue(), updatesDisabled(), stateDir(), CHECK_INTERVAL_MS, InstallInfo, InstallKind, UpdateStatus, ApplyResult
- checkStaleBuild(repoRoot) — returns `{ stale: boolean }`
- All domain types from types.ts: ModuleSpec, SwarmRecord, SwarmState, MissionRecord, MissionStatus, AgentLedgerEntry, MissionPlan, MissionAssignment, PermissionMode, AgentSpec, UsageSnapshot, RateLimitSnapshot, SwarmEvent, PreflightReport, PreflightCheck, AgentRuntime

---

_Last touched 2026-08-21: narrowed REFUSAL_PATTERNS (stream-json.ts) to only `/requires approval/i`, removing two unconfirmed guesses ('permission denied', 'not been granted') that could false-positive on an ordinary tool's own error text (e.g. ls on an unreadable directory) since is_error alone doesn't distinguish harness refusal from normal failure. Updated stream-json.test.ts and collect.test.ts accordingly. Not run through `npm test`/`npm run build` in this sandbox (node_modules symlink blocks command execution — see gotcha); verified by full read-trace of translate()/isRefusal() and all call sites/test fixtures instead. Confirmed REFUSAL_PATTERNS is not exported/referenced outside stream-json.ts, so no other module depended on the removed patterns._
