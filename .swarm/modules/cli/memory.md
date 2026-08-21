# CLI & Product Surface — memory

_Durable knowledge for the `cli` swarm. Read on wake, rewritten on sleep._

## Invariants

- scheduleBackgroundUpdate() is only invoked in main.ts's .then() after main() has fully resolved, and only when SWARM_UPDATE_WORKER is not set — an update must never run concurrently with a command. <sub>`packages/cli/src/main.ts`</sub>
- Every command that can spawn agents (mission, map, loop, sleep --compress, verify unless --citations-only, refactor unless --signals-only) calls assertRuntimeReady(runtime) before doing so; doctor deliberately does not. <sub>`packages/cli/src/context.ts`</sub>
- buildRuntime() throws UserError for any config.runtime other than 'claude-code-local' — always sets strictSubscription: true. <sub>`packages/cli/src/context.ts`</sub>
- server.ts binds only to 127.0.0.1 (not configurable) and requires header `x-swarm-token` (fresh per serve() call) on POST /api/mission; GET endpoints are unauthenticated. <sub>`packages/cli/src/server.ts`</sub>
- server.ts allows only one mission running at a time (`live.running` guard returns 409). <sub>`packages/cli/src/server.ts`</sub>
- `swarm loop` refuses to start unless the working tree is clean (ignoring .swarm/). <sub>`packages/cli/src/commands/loop.ts`</sub>
- parseArgs treats the first argv token as a command only when it does not start with '-'; `swarm --version`/`--help` have an empty command field. <sub>`packages/cli/src/args.ts`</sub>
- dist/ is gitignored monorepo-wide; VERSION in main.ts is a hand-maintained literal, not derived from package.json. <sub>`.gitignore`</sub>
- Cross-module contracts must exist in the producing package before CLI wires against them. When CLI code depends on fields/exports another module is landing concurrently, prefer an `as unknown as {...}` cast with graceful undefined-handling (render '—'/0) over assuming the shape.
- AgentLedgerEntry (packages/core/src/types.ts, owned by runtime module) has no per-run diagnostic fields (verifyOutcome, refusalCount) — only in-memory MissionModuleResult from a live `swarm mission` run can carry these. Past-mission history surfaces (e.g. `swarm missions`) structurally cannot show them.
- In `printResults()` (mission.ts) and in `missionCommand`'s own violations/branches/stranded/refused/followUps/Report-note sections, each conditional block owns its **own unconditional leading `line()`/blank-line separator** regardless of what fired before it — sections never check a sibling's fired-state before adding their separator. Special-casing one block's separator based on another block's state (e.g. `if (refused.length === 0) line()`) breaks this convention and produces zero-gap collisions when both fire. Confirmed by review 2026-08-21; do not "fix" spacing here without re-reading all sibling blocks first. <sub>`packages/cli/src/commands/mission.ts`</sub>
- c.green/c.red/c.gray/c.yellow strip to plain text when `process.stdout.isTTY` is false (ui.ts's useColor check) — confirmed true under `node --test`. <sub>`packages/cli/src/ui.ts`</sub>

## Gotchas

- main.ts's VERSION constant ('0.1.0') is a hand-maintained literal — bumping packages/cli/package.json's version does nothing to `swarm --version` output.
- Because dist/ is gitignored and bin points at ./dist/main.js, after any pull/checkout the installed `swarm` binary is whatever was last built — stale dist is invisible until `npm run build` reruns.
- scheduleBackgroundUpdate spawns `node main.js update --background` detached with SWARM_UPDATE_WORKER=1; main.ts checks that same env var to avoid infinite chains. Easy to break by refactoring either side independently.
- `swarm wake <module>` only flips recorded state to active — spawns no process, does no work.
- LiveBoard degrades based on `process.stdout.isTTY`, not NO_COLOR/TERM=dumb (those only affect `c` color wrapping).
- `swarm loop --plan` recomputes signals from scratch rather than reusing a prior `swarm map`/`refactor` run.
- commands/map.ts only treats a re-map as a no-op when drift.moduleCount > 0 as well as unchanged.
- The Bash permission layer can refuse `npm run build`/`tsc`/`node --test`/git outright in a headless sandbox, confirmed multiple times including in worktrees with node_modules present. Not a missing-dependency issue. When blocked, do full manual diff/type review and say so explicitly — do not assume tests you couldn't run actually pass.
- As of 2026-08-21, `@swarm-os/core` did not export `checkStaleBuild` — a `warnIfStaleBuild()` in commands/update.ts calling it was rejected pending that export landing; verify it exists before trusting this feature.
- mission.ts's verifyOutcomeOf/refusalCountOf read MissionModuleResult's verifyOutcome/refusalCount via `as unknown as {...}` cast (core hadn't declared these fields at time of writing). A concurrent mission-module fix was reported to drop related casts in verify-loop.ts/run.ts, but that's outside cli scope — confirm core's actual field names before trusting rendered '—'/'0' vs real values, or removing the cli-side cast.
- packages/cli/src/commands/mission.test.ts's formatVerify/formatRefusals tests were loosened (2026-08-21) from exact literal-string assertions to substring/structural checks, specifically to survive future wording tweaks — this change was not contested by review and stands.
- The pending mission.ts fix to the refusal/followUps blank-line spacing (special-casing based on `refused.length === 0`) was reviewed as a regression (see invariant above) and needs rework/revert as of 2026-08-21 — do not assume the current spacing logic in mission.ts is correct without re-checking against the sibling-block convention.
- The `table()` helper in ui.ts computes column widths dynamically per row array length — adding a column to printResults() rows has no fixed-arity assumption to worry about.

## Landmarks

- `packages/cli/src/main.ts` — command-dispatch table; HELP text canonical; owns SIGINT double-Ctrl-C escalation and post-exit update-scheduling hook (call site for per-command warnings like `noticeIfUpdated`/`warnIfStaleBuild`, gated on `args.command !== 'update'`).
- `packages/cli/src/args.ts` — minimal argv parser + flagString/flagBool/flagNumber/flagList helpers.
- `packages/cli/src/context.ts` — CommandContext resolution, config-override merging, strictSubscription runtime preflight gate.
- `packages/cli/src/ui.ts` — ANSI helpers, formatTokens/formatDuration/clip/pad/table, LiveBoard.
- `packages/cli/src/server.ts` — HTTP server for `swarm ui --serve`: renderUi(), /api/snapshot, /api/events (SSE), /api/mission (POST, token-gated, one-mission-at-a-time).
- `packages/cli/src/commands/mission.ts` — largest handler; wires runMission callbacks into LiveBoard; renders verifyOutcome/refusalCount in live board rows, printResults() table, and a refusal-warning block (spacing convention currently under repair, see gotchas). Pure helpers (verifyOutcomeOf, refusalCountOf, formatVerify, formatRefusals) unit-tested in mission.test.ts.
- `packages/cli/src/commands/loop.ts` — `swarm loop`/`loop --plan`; refuses dirty tree; writes .swarm/loop.log and loop.json.
- `packages/cli/src/commands/map.ts` — drift/pendingSplits short-circuit for no-op re-runs.
- `packages/cli/src/commands/verify.ts` — deterministic citation checks + per-module verifier agents; writes verification.md. Its post-table spacing style (one shared leading blank line for annotations) is NOT the pattern mission.ts follows — don't conflate the two.
- `packages/cli/src/commands/refactor.ts` — deterministic signals then optional reviewer agents; writes REFACTOR.md and refactor.json.
- `packages/cli/src/commands/doctor.ts` — billing-env detection + lean-spawn context measurement; only command that skips assertRuntimeReady.
- `packages/cli/src/commands/update.ts` — self-update logic; `noticeIfUpdated()` and (WIP, blocked) `warnIfStaleBuild()` live here.
- `README.md` — canonical module/swarm/mission/runtime mental model.

## Public interface

- bin `swarm` (packages/cli/dist/main.js) — the only artifact end users invoke
- @swarm-os/cli package name/version consumed by packaging/install tooling (npm link -w @swarm-os/cli)
- root package.json workspaces list (packages/core, packages/cli) and scripts (build/test/clean/watch/swarm/link)
- tsconfig.base.json — shared TS compiler options extended by packages/cli/tsconfig.json
- README.md / docs/** — canonical mental model other modules' docs and CLI HELP text should stay consistent with

---

_Surveyed 2026-08-21 by the `cli` analyst._
