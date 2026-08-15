# CLI & Product Surface — memory

_Durable knowledge for the `cli` swarm. Read on wake, rewritten on sleep._

## Invariants

- Commands that spawn agents must call `assertRuntimeReady(runtime)` before doing so; it throws UserError if `runtime.preflight()` fails (e.g. an API key is set, defeating the subscription-billing guarantee). Read-only commands (status, memory) skip it. <sub>`packages/cli/src/context.ts`</sub>
- Only `config.runtime === 'claude-code-local'` is implemented; buildRuntime throws UserError for anything else, telling the user to edit .swarm/config.yaml. <sub>`packages/cli/src/context.ts`</sub>
- resolveWorkspace prefers an explicit --repo/explicitPath, then the nearest mapped ancestor directory (Workspace.find), then falls back to a fresh (unmapped) Workspace at cwd — never errors just from missing a map unless requireMapped is set. <sub>`packages/cli/src/context.ts`</sub>
- The background self-update spawn only happens after main()'s promise resolves, and never when SWARM_UPDATE_WORKER=1 (i.e. the background worker itself doesn't re-spawn another background worker), and never before a mission/command's real work is done — deliberately ordered so an update can't race a live agent or the network a mission is using. <sub>`packages/cli/src/main.ts`</sub>
- `swarm loop` refuses to start (unless --dry-run) if the working tree has uncommitted changes, because it merges onto one branch over hours as it goes. <sub>`packages/cli/src/commands/loop.ts`</sub>
- The local HTTP server (swarm ui --serve) binds only to 127.0.0.1 (not configurable), requires an `x-swarm-token` header matching a randomBytes(16) token generated at startup for the mutating POST /api/mission endpoint, and refuses a second mission while one is already running. <sub>`packages/cli/src/server.ts`</sub>
- `.swarm/` itself is deliberately NOT in the root .gitignore — Swarm OS writes its own `.swarm/.gitignore` to ignore only per-run/per-machine state, so the module map/memory/config remain committable. <sub>`.gitignore`</sub>

## Gotchas

- parseArgs treats the first argv token as the command ONLY if it does not start with '-'; `swarm --version` and `swarm --help` therefore have command === '' and are matched as flags in main.ts, not as commands. <sub>`packages/cli/src/args.ts`</sub>
- A long flag consumes the following token as its value only if that token does NOT start with '-'; otherwise the flag is boolean true. So a value that happens to start with '-' (e.g. a negative number) cannot be passed as a bare flag value, only via --flag=-5. <sub>`packages/cli/src/args.ts`</sub>
- flagList splits on comma OR whitespace, so `--modules "cli,core mapper"` becomes three modules ['cli','core','mapper'] — a space inside a quoted arg is treated as a separator too, not just commas. <sub>`packages/cli/src/args.test.ts`</sub>
- `swarm loop --plan` (loopPlanCommand) and the `currentBranchName` helper in loop.ts use dynamic `await import('@swarm-os/core')` for buildDigest/countLines/etc rather than the static import at top of file — an easy place to miss an export when core's barrel changes. <sub>`packages/cli/src/commands/loop.ts`</sub>
- LiveBoard renders differently depending on TTY: in non-interactive mode (piped/CI), `set()` immediately appends a plain line on change instead of repainting in place; command code doesn't need to branch on this itself. <sub>`packages/cli/src/ui.ts`</sub>
- `swarm wake <module>` only flips the on-disk state to active — it spawns no agent and does no work; the command's own output explicitly warns the user of this to avoid the intuitive-but-wrong assumption that wake starts a mission. <sub>`packages/cli/src/commands/swarms.ts`</sub>
- `swarm sleep` without --compress uses `budgetTokens: Number.MAX_SAFE_INTEGER`, i.e. it will not invoke a compression model call unless explicitly asked (compression costs a model call and is normally driven automatically by missions). <sub>`packages/cli/src/commands/swarms.ts`</sub>
- packages/cli/dist/ (compiled .d.ts etc) exists alongside src/ in the tree — build output, not source of truth; always read src/. <sub>`packages/cli/dist`</sub>
- main.ts's SIGINT handler kills agents with SIGTERM on first Ctrl-C then SIGKILL 1.5s later automatically, and immediately SIGKILL + exit(130) on a second Ctrl-C before that timer fires — a future agent adding cleanup-on-exit logic must account for the forced-kill window, not assume graceful shutdown always runs. <sub>`packages/cli/src/main.ts`</sub>

## Landmarks

- `packages/cli/src/main.ts` — bin entry, help text, command dispatch switch, SIGINT/exit handling
- `packages/cli/src/context.ts` — shared context resolution (Workspace, AgentRuntime, SwarmConfig) + UserError + preflight gate
- `packages/cli/src/args.ts` — minimal hand-rolled argv parser + flagString/flagBool/flagNumber/flagList helpers
- `packages/cli/src/ui.ts` — terminal color/table/LiveBoard rendering, TTY-aware (degrades to plain appended lines when piped)
- `packages/cli/src/server.ts` — local-only HTTP server backing `swarm ui --serve`: snapshot, SSE events, token-gated mission POST
- `packages/cli/src/commands/map.ts` — `swarm map`: drift detection, incremental re-analysis, calls core's mapProject with progress callback
- `packages/cli/src/commands/mission.ts` — `swarm mission`/`swarm missions`: calls core's runMission, renders per-module agent rows, review findings, ownership violations
- `packages/cli/src/commands/loop.ts` — `swarm loop`/`swarm loop --plan`: unattended survey→pick→mission→verify→merge cycle via core's runLoop; requires a clean working tree unless --dry-run
- `packages/cli/src/commands/verify.ts` — `swarm verify`: deterministic citation check + optional adversarial verifier agent per module, uses core's Scheduler directly
- `packages/cli/src/commands/refactor.ts` — `swarm refactor`: deterministic signals (computeSignals) + per-module reviewer agent, writes .swarm/REFACTOR.md and refactor.json
- `packages/cli/src/commands/doctor.ts` — `swarm doctor`: billing-env detection (the API-key-vs-subscription safety check), preflight report, optional lean-spawn token measurement

## Public interface

- bin `swarm` → packages/cli/dist/main.js (declared in packages/cli/package.json)
- Subcommands: doctor, map, status, mission, missions, memory, verify, refactor, ui, loop (+--plan), update, sleep, wake, help, version — this is the whole product surface a human or script drives
- npm scripts at repo root (package.json): build, test, clean, watch, `swarm` (runs dist/main.js directly), `link` (npm link -w @swarm-os/cli) — used by anyone building/testing/installing Swarm OS locally
- tsconfig.base.json — shared strict TS compiler options (ES2023, NodeNext, strict, noUncheckedIndexedAccess) that packages/cli's own tsconfig presumably extends
- README.md / docs/ARCHITECTURE.md / docs/CONTEXT-ECONOMY.md — the project's public-facing explanation of the module/swarm/mission/memory model and the AgentRuntime port, consumed by anyone (human or agent) onboarding to the whole system

---

_Surveyed 2026-08-15 by the `cli` analyst, reading only this module's paths._
