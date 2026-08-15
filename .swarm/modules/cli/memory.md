# CLI & Product Surface — memory

_Durable knowledge for the `cli` swarm. Read on wake, rewritten on sleep._

## Invariants

- The `VERSION` constant in main.ts ('0.1.0') is a hardcoded literal, not read from package.json — `swarm --version` and packages/cli/package.json's version field must be bumped together or they will silently diverge. <sub>`packages/cli/src/main.ts`</sub>
- scheduleBackgroundUpdate() is only ever invoked in main()'s `.then()` after main() resolves — never before or during — so a self-update can't compete with a running mission for the network or swap files under a live agent process. <sub>`packages/cli/src/main.ts`</sub>
- The background updater is itself just `spawn(process.execPath, [SELF_URL, 'update', '--background'], {detached:true, stdio:'ignore', env:{...,SWARM_UPDATE_WORKER:'1'}})`; main.ts checks `process.env.SWARM_UPDATE_WORKER` to avoid recursively scheduling another background updater from within the background updater. <sub>`packages/cli/src/commands/update.ts`</sub>
- assertRuntimeReady()/runtime.preflight() is the sole enforcement point for the 'never bill via API key, subscription only' guarantee; every command that spawns agents calls it before doing so (mission, map, loop, sleep --compress, verify without --citations-only, refactor without --signals-only) — commands that only read (status, memory, missions) skip it. <sub>`packages/cli/src/context.ts`</sub>
- The live HTTP server (`swarm ui --serve`) binds only to 127.0.0.1, is not configurable to anything else, and every mutating endpoint (`/api/mission`) requires a random per-process token sent via the `x-swarm-token` header — relying on the browser CORS preflight rule (custom headers require a preflight, and this server answers no CORS preflight) to prevent a malicious page from POSTing on your behalf. <sub>`packages/cli/src/server.ts`</sub>
- The live server enforces one mission at a time: `/api/mission` returns 409 if `live.running` is already true, because missions consume a shared agent-spawn rate-limit budget that a double-click shouldn't spend twice. <sub>`packages/cli/src/server.ts`</sub>
- SIGINT handling is two-stage: first Ctrl-C sends SIGTERM to spawned agents via killAllAgents and leaves a 1.5s grace window before force-exiting with SIGKILL; a second Ctrl-C during that window immediately SIGKILLs and exits with code 130. <sub>`packages/cli/src/main.ts`</sub>
- `swarm loop` refuses to start (unless --dry-run) if the working tree has uncommitted changes, because the loop merges accumulated work onto one branch over hours and needs a clean starting point. <sub>`packages/cli/src/commands/loop.ts`</sub>
- LiveBoard degrades to plain appended lines (no ANSI repaint) whenever stdout is not a TTY, so piping CLI output to a file/CI log never contains cursor-control escape sequences. <sub>`packages/cli/src/ui.ts`</sub>

## Gotchas

- `swarm wake <module>` only flips the swarm's state marker to active — it spawns nothing; the command itself prints a warning to this effect. Missions wake/sleep swarms automatically, so this and `swarm sleep` are rarely-needed manual overrides. <sub>`packages/cli/src/commands/swarms.ts`</sub>
- `swarm sleep` only reaches for the runtime (and thus only requires assertRuntimeReady) when `--compress` is passed; otherwise it passes `budgetTokens: Number.MAX_SAFE_INTEGER` so sleepSwarm's compressor never actually triggers a model call. <sub>`packages/cli/src/commands/swarms.ts`</sub>
- `loop.ts`'s `currentBranchName` helper does a dynamic `await import('@swarm-os/core')` just to grab `currentBranch`, duplicating the static import pattern used everywhere else in the same file for no apparent reason other than to avoid widening the top-level import list — same pattern appears in `loopPlanCommand` and in doctor.ts's `measure()` for `collectAgent`. <sub>`packages/cli/src/commands/loop.ts`</sub>
- In args.ts, a long flag consumes the *next* token as its value only if that token does not start with `-`; otherwise the flag is boolean `true`. This means `--model --dry-run` sets model=true (boolean), not an error — a missing value silently becomes a boolean flag rather than failing parsing. <sub>`packages/cli/src/args.ts`</sub>
- main.ts calls `noticeIfUpdated()` before dispatch for every command except `update` itself — so a `swarm update` invocation never prints the 'updated in background' banner even if one is pending, by design (checked via `args.command !== 'update'`). <sub>`packages/cli/src/main.ts`</sub>
- `packages/cli/dist/**` is checked into the glob results (compiled output alongside src) — the module ships prebuilt dist/*.js/.d.ts/.map files; be sure changes to src are followed by a build rather than assuming dist is gitignored/regenerated transparently. <sub>`packages/cli/package.json`</sub>
- resolveWorkspace() falls back silently to `new Workspace(process.cwd())` when no `.swarm/` is found anywhere up the tree and no --repo flag was given; most commands then immediately throw a clearer UserError via `loadContext({requireMapped:true})`, but any caller that omits requireMapped gets a Workspace pointing at an unmapped cwd with no error. <sub>`packages/cli/src/context.ts`</sub>

## Landmarks

- `packages/cli/src/main.ts` — argv→command dispatch, HELP text, SIGINT handling, background-update trigger
- `packages/cli/src/context.ts` — loadContext/resolveWorkspace/buildRuntime/assertRuntimeReady — shared setup for every command
- `packages/cli/src/args.ts` — minimal argv parser + typed flag readers (flagBool/flagString/flagNumber/flagList)
- `packages/cli/src/ui.ts` — terminal color/table/LiveBoard rendering primitives shared by all commands
- `packages/cli/src/server.ts` — localhost HTTP+SSE server backing `swarm ui --serve`, including the mission-start endpoint
- `packages/cli/src/commands/mission.ts` — `swarm mission`/`swarm missions` — richest command, drives runMission with a live per-module status board
- `packages/cli/src/commands/map.ts` — `swarm map` — drift/incremental-remap logic, calls ensureSwarmIgnore + mapProject
- `packages/cli/src/commands/loop.ts` — `swarm loop`/`swarm loop --plan` — unattended multi-mission runner, writes .swarm/loop.log and loop.json
- `packages/cli/src/commands/doctor.ts` — `swarm doctor` — runtime preflight + billing-env detection + optional lean-spawn measurement
- `packages/cli/src/commands/update.ts` — `swarm update` plus the detached background-update worker entry (`--background` flag) and noticeIfUpdated banner
- `packages/cli/src/commands/verify.ts` — `swarm verify` — deterministic citation check + independent verifier agent per module
- `docs/ARCHITECTURE.md` — System-level design doc: layering (CLI → core → AgentRuntime port → concrete runtimes) and the runtime port contract

## Public interface

- bin `swarm` (packages/cli/dist/main.js) — the only externally consumed artifact; the whole package.json `files` field is just `["dist"]`
- packages/cli/src/args.ts: parseArgs/flagBool/flagString/flagNumber/flagList — used across every commands/*.ts file within this module only, not exported outside the package
- packages/cli/src/ui.ts: c/line/note/ok/fail/warn/heading/table/LiveBoard/formatTokens/formatDuration/clip/pad — shared terminal rendering used by every command handler, internal to the module
- packages/cli/src/context.ts: loadContext/resolveWorkspace/buildRuntime/applyOverrides/assertRuntimeReady/UserError — shared command setup, internal to the module
- packages/cli/src/server.ts: serve(options) — consumed only by commands/ui.ts's `--serve` path

---

_Surveyed 2026-08-15 by the `cli` analyst, reading only this module's paths._
