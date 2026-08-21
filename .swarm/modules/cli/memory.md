# CLI & Product Surface — memory

_Durable knowledge for the `cli` swarm. Read on wake, rewritten on sleep._

## Invariants

- scheduleBackgroundUpdate() is only invoked in main.ts's .then() after main() has fully resolved, and only when SWARM_UPDATE_WORKER is not set — an update must never run concurrently with a command. <sub>`packages/cli/src/main.ts`</sub>
- Every command that can spawn agents (mission, map, loop, sleep --compress, verify unless --citations-only, refactor unless --signals-only) calls assertRuntimeReady(runtime) before doing so; doctor deliberately does not, since its job is to report the failure, not refuse. <sub>`packages/cli/src/context.ts`</sub>
- buildRuntime() throws UserError for any config.runtime other than 'claude-code-local' — the CLI hardcodes the one implemented runtime and always sets strictSubscription: true. <sub>`packages/cli/src/context.ts`</sub>
- server.ts binds only to 127.0.0.1 (not configurable) and requires header `x-swarm-token` (generated fresh per serve() call) on the mutating POST /api/mission endpoint; GET endpoints are unauthenticated since they only expose local .swarm/ data. <sub>`packages/cli/src/server.ts`</sub>
- server.ts allows only one mission running at a time (`live.running` guard returns 409). <sub>`packages/cli/src/server.ts`</sub>
- `swarm loop` refuses to start unless the working tree is clean (ignoring .swarm/), because it runs for hours and merges into one integration branch. <sub>`packages/cli/src/commands/loop.ts`</sub>
- parseArgs treats the first argv token as a command only when it does not start with '-'; `swarm --version`/`--help` therefore have an empty command and are handled via flags, not the command field. <sub>`packages/cli/src/args.ts`</sub>
- dist/ is gitignored monorepo-wide, so the `swarm` binary only exists after `npm run build`; VERSION in main.ts is a hand-maintained literal, not derived from package.json. <sub>`.gitignore`</sub>
- Cross-module contracts must exist in the producing package before CLI wires against them: importing/calling a symbol from `@swarm-os/core` that isn't yet exported (e.g. `checkStaleBuild`) breaks `tsc --build` for the whole package, not just the new feature. Confirm the export exists (barrel + relevant subpath) before landing CLI-side code that depends on it.

## Gotchas

- main.ts's VERSION constant ('0.1.0') is a hand-maintained literal — bumping packages/cli/package.json's version does nothing to `swarm --version` output unless main.ts is edited too. <sub>`packages/cli/src/main.ts`</sub>
- Because dist/ is gitignored and bin points at ./dist/main.js, after any pull/checkout the installed `swarm` binary is whatever was last built — a stale dist is invisible until `npm run build` is rerun. <sub>`packages/cli/package.json`</sub>
- scheduleBackgroundUpdate spawns `node main.js update --background` detached with SWARM_UPDATE_WORKER=1; main.ts checks that same env var to avoid infinite update-spawning-update chains. This coupling is easy to break by refactoring either side independently. <sub>`packages/cli/src/commands/update.ts`</sub>
- `swarm wake <module>` only flips recorded state to active — spawns no process, does no work — despite the name suggesting otherwise. <sub>`packages/cli/src/commands/swarms.ts`</sub>
- LiveBoard degrades based on `process.stdout.isTTY`, not NO_COLOR/TERM=dumb (those only affect `c` color wrapping) — a dumb TTY still gets in-place cursor repainting. <sub>`packages/cli/src/ui.ts`</sub>
- `swarm loop --plan` recomputes signals from scratch (buildDigest/countLines/buildImportGraph/computeSignals) rather than reusing a prior `swarm map`/`refactor` run — duplicates logic in commands/refactor.ts. <sub>`packages/cli/src/commands/loop.ts`</sub>
- commands/map.ts only treats a re-map as a no-op when drift.moduleCount > 0 as well as unchanged — a hand-written config.yaml with zero modules always triggers full (re)analysis. <sub>`packages/cli/src/commands/map.ts`</sub>
- Some sandboxed worktrees have no `node_modules` and `npm run build`/`npx tsc` are blocked by the permission layer — build/typecheck/run verification may be impossible from inside such a worktree; fall back to full manual diff review and say so explicitly rather than claiming unverifiable behavior.
- As of 2026-08-21, `@swarm-os/core` does not export `checkStaleBuild` (not in the barrel, not in `update/index.ts`, zero grep hits) — a `warnIfStaleBuild()` in commands/update.ts calling it exists on the cli side but was rejected in review and will not compile until the `runtime` module lands the export. Check for its existence before assuming this feature works or re-adding it.

## Landmarks

- `packages/cli/src/main.ts` — command-dispatch table; HELP text canonical; owns SIGINT double-Ctrl-C escalation and the post-exit update-scheduling hook (also the intended call site for any per-command warnings like `noticeIfUpdated`/`warnIfStaleBuild`, both gated on `args.command !== 'update'`).
- `packages/cli/src/args.ts` — minimal argv parser + flagString/flagBool/flagNumber/flagList helpers.
- `packages/cli/src/context.ts` — CommandContext resolution, config-override merging, strictSubscription runtime preflight gate.
- `packages/cli/src/ui.ts` — ANSI helpers, formatTokens/formatDuration/clip/pad/table, LiveBoard.
- `packages/cli/src/server.ts` — HTTP server for `swarm ui --serve`: renderUi() page plus /api/snapshot, /api/events (SSE), /api/mission (POST, token-gated, one-mission-at-a-time).
- `packages/cli/src/commands/mission.ts` — largest handler; wires runMission callbacks into a LiveBoard.
- `packages/cli/src/commands/loop.ts` — `swarm loop`/`loop --plan`; refuses dirty tree; writes .swarm/loop.log and loop.json.
- `packages/cli/src/commands/map.ts` — drift/pendingSplits short-circuit for no-op re-runs.
- `packages/cli/src/commands/verify.ts` — deterministic citation checks + per-module verifier agents via Scheduler; writes verification.md.
- `packages/cli/src/commands/refactor.ts` — deterministic signals then optional reviewer agents; writes REFACTOR.md and refactor.json.
- `packages/cli/src/commands/doctor.ts` — billing-env detection + lean-spawn context measurement; only command that skips assertRuntimeReady.
- `packages/cli/src/commands/update.ts` — self-update logic; `noticeIfUpdated()` and (WIP, blocked) `warnIfStaleBuild()` live here, both gated on SWARM_UPDATE_WORKER unset and invoked from main.ts at the same lifecycle point.
- `README.md` — canonical module/swarm/mission/runtime mental model and install/usage flow.

## Public interface

- bin `swarm` (packages/cli/dist/main.js) — the only artifact end users invoke
- @swarm-os/cli package name/version consumed by packaging/install tooling (npm link -w @swarm-os/cli)
- root package.json workspaces list (packages/core, packages/cli) and scripts (build/test/clean/watch/swarm/link)
- tsconfig.base.json — shared TS compiler options extended by packages/cli/tsconfig.json
- README.md / docs/** — canonical mental model other modules' docs and CLI HELP text should stay consistent with

---

_Surveyed 2026-08-21 by the `cli` analyst._
