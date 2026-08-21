# CLI & Product Surface — memory

_Durable knowledge for the `cli` swarm. Read on wake, rewritten on sleep._

## Invariants

- scheduleBackgroundUpdate() is only invoked in main.ts's .then() after main() has fully resolved, and only when SWARM_UPDATE_WORKER is not set — an update must never run concurrently with a command. <sub>`packages/cli/src/main.ts`</sub>
- Every command that can spawn agents (mission, map, loop, sleep --compress, verify unless --citations-only, refactor unless --signals-only) calls assertRuntimeReady(runtime) before doing so; doctor deliberately does not. <sub>`packages/cli/src/context.ts`</sub>
- buildRuntime() throws UserError for any config.runtime other than 'claude-code-local' — always sets strictSubscription: true. <sub>`packages/cli/src/context.ts`</sub>
- server.ts binds only to 127.0.0.1 (not configurable), requires header `x-swarm-token` (fresh per serve() call) on POST /api/mission (GET endpoints unauthenticated), and allows only one mission running at a time (`live.running` guard → 409). <sub>`packages/cli/src/server.ts`</sub>
- `swarm loop` refuses to start unless the working tree is clean (ignoring .swarm/). <sub>`packages/cli/src/commands/loop.ts`</sub>
- parseArgs treats the first argv token as a command only when it does not start with '-'; `swarm --version`/`--help` have an empty command field. <sub>`packages/cli/src/args.ts`</sub>
- dist/ is gitignored monorepo-wide; VERSION in main.ts is a hand-maintained literal, not derived from package.json. <sub>`.gitignore`</sub>
- tsconfig.base.json (shared by packages/cli/tsconfig.json) has `noUncheckedIndexedAccess` enabled — any `arr[i]` (or destructured-first-element) types as `T | undefined` even when a prior `.length > 0` check already proved non-emptiness; TS does not correlate the two. For any first-element read feeding a function expecting non-optional `T`, use `const [first, ...rest] = arr; if (first) {...}` (precedent: verify.ts's `wrapText` destructuring) — never a bare `arr[0]` passed straight through.
- MissionModuleResult (core/mission/run.ts) declares verifyOutcome, refusalCount, quarantinedPaths, quarantineCommitHash as required (non-optional) fields. mission.ts's quarantinedPathsOf/quarantineCommitHashOf read them directly, no cast. verifyOutcomeOf/refusalCountOf still read via `as unknown as {...}` casts — stale leftover (review flagged 2026-08-21, unresolved) from when these fields were optional/absent; safe to drop next time that code is touched.
- AgentLedgerEntry (packages/core/src/types.ts, owned by runtime module) has no per-run diagnostic fields (verifyOutcome, refusalCount, quarantinedPaths, quarantineCommitHash) — only in-memory MissionModuleResult from a live `swarm mission` run carries these. Past-mission history surfaces (e.g. `swarm missions`) structurally cannot show them.
- In `printResults()` (mission.ts) and in `missionCommand`'s own violations/branches/stranded/refused/followUps/quarantine/Report-note sections, each conditional block owns its own unconditional leading `line()`/blank-line separator regardless of what fired before it — sections never check a sibling's fired-state before adding their separator. Special-casing one block's separator based on another block's state breaks this convention; confirmed by review 2026-08-21. verify.ts's post-table spacing (one shared leading blank line) is a *different* pattern — don't conflate the two files.
- c.green/c.red/c.gray/c.yellow strip to plain text when `process.stdout.isTTY` is false (ui.ts's useColor check) — confirmed true under `node --test`. <sub>`packages/cli/src/ui.ts`</sub>
- ui.ts's LiveBoard has zero awareness of commit/branch/ownership/quarantine state — only tracks module/state/activity/tokens/verifyOutcome/refusalCount rows. Live surfacing of quarantine info mid-run would need a new AgentRow field wired through onProgress/paintRow.

## Gotchas

- main.ts's VERSION constant ('0.1.0') is a hand-maintained literal — bumping packages/cli/package.json's version does nothing to `swarm --version` output.
- Because dist/ is gitignored and bin points at ./dist/main.js, after any pull/checkout the installed `swarm` binary is whatever was last built — stale dist is invisible until `npm run build` reruns.
- scheduleBackgroundUpdate spawns `node main.js update --background` detached with SWARM_UPDATE_WORKER=1; main.ts checks that same env var to avoid infinite chains. Easy to break by refactoring either side independently.
- `swarm wake <module>` only flips recorded state to active — spawns no process, does no work.
- LiveBoard degrades based on `process.stdout.isTTY`, not NO_COLOR/TERM=dumb (those only affect `c` color wrapping).
- `swarm loop --plan` recomputes signals from scratch rather than reusing a prior `swarm map`/`refactor` run.
- commands/map.ts only treats a re-map as a no-op when drift.moduleCount > 0 as well as unchanged.
- The Bash permission layer can refuse `npm run build`/`tsc`/`node --test`/git outright in a headless sandbox, confirmed multiple times including in worktrees with node_modules present. Not a missing-dependency issue. When blocked: do full manual diff/type review, say so explicitly, and be extra wary of indexed-access typing (see noUncheckedIndexedAccess invariant) — a prior blind fix under this exact condition introduced a compile error via `arr[0]` before being caught and fixed in a follow-up mission.
- As of 2026-08-21, `@swarm-os/core` did not export `checkStaleBuild` — a `warnIfStaleBuild()` in commands/update.ts calling it was rejected pending that export landing; verify it exists before trusting this feature.
- packages/cli/src/commands/mission.test.ts's formatVerify/formatRefusals/quarantinedPathsOf/quarantineCommitHashOf tests use substring/structural checks (not exact literal strings) deliberately, to survive future wording tweaks — this is the established style for new tests here. As of 2026-08-21 there's still no test exercising missionCommand's actual printed quarantine block end-to-end (path truncation, hash formatting, message text) — only the accessors are covered.
- mission.ts's refusal/followUps blank-line spacing had a pending fix (special-casing based on `refused.length === 0`) reviewed as a regression against the sibling-block separator convention above — do not assume current spacing logic there is correct without re-checking.
- The `table()` helper in ui.ts computes column widths dynamically per row array length — adding a column to printResults() rows has no fixed-arity assumption to worry about.

## Landmarks

- `packages/cli/src/main.ts` — command-dispatch table; HELP text canonical; owns SIGINT double-Ctrl-C escalation and post-exit update-scheduling hook.
- `packages/cli/src/args.ts` — minimal argv parser + flagString/flagBool/flagNumber/flagList helpers.
- `packages/cli/src/context.ts` — CommandContext resolution, config-override merging, strictSubscription runtime preflight gate.
- `packages/cli/src/ui.ts` — ANSI helpers, formatTokens/formatDuration/clip/pad/table, LiveBoard.
- `packages/cli/src/server.ts` — HTTP server for `swarm ui --serve`: renderUi(), /api/snapshot, /api/events (SSE), /api/mission.
- `packages/cli/src/commands/mission.ts` — largest handler; wires runMission callbacks into LiveBoard; renders verifyOutcome/refusalCount and quarantinedPaths/quarantineCommitHash in printResults()/report sections; quarantine summary line reads first element via destructuring+guard (not `arr[0]`), per noUncheckedIndexedAccess invariant. Pure helpers (verifyOutcomeOf, refusalCountOf, formatVerify, formatRefusals, quarantinedPathsOf, quarantineCommitHashOf) unit-tested in mission.test.ts.
- `packages/cli/src/commands/loop.ts` — `swarm loop`/`loop --plan`; refuses dirty tree; writes .swarm/loop.log and loop.json.
- `packages/cli/src/commands/map.ts` — drift/pendingSplits short-circuit for no-op re-runs.
- `packages/cli/src/commands/verify.ts` — deterministic citation checks + per-module verifier agents; writes verification.md. Its shared-single-blank-line spacing style differs from mission.ts's per-block pattern.
- `packages/cli/src/commands/refactor.ts` — deterministic signals then optional reviewer agents; writes REFACTOR.md and refactor.json.
- `packages/cli/src/commands/doctor.ts` — billing-env detection + lean-spawn context measurement; only command that skips assertRuntimeReady.
- `packages/cli/src/commands/update.ts` — self-update logic; `noticeIfUpdated()` and (WIP, blocked on core export) `warnIfStaleBuild()` live here.
- `README.md` — canonical module/swarm/mission/runtime mental model.

## Public interface

- bin `swarm` (packages/cli/dist/main.js) — the only artifact end users invoke
- @swarm-os/cli package name/version consumed by packaging/install tooling (npm link -w @swarm-os/cli)
- root package.json workspaces list (packages/core, packages/cli) and scripts (build/test/clean/watch/swarm/link)
- tsconfig.base.json — shared TS compiler options extended by packages/cli/tsconfig.json
- README.md / docs/** — canonical mental model other modules' docs and CLI HELP text should stay consistent with

---

_Surveyed 2026-08-21 by the `cli` analyst._
