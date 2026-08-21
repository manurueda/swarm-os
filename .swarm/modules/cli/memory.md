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
- tsconfig.base.json has `noUncheckedIndexedAccess` enabled — any `arr[i]` types as `T | undefined` even after a `.length > 0` check. For a first-element read feeding a non-optional-`T` sink, use `const [first, ...rest] = arr; if (first) {...}` — never a bare `arr[0]`.
- MissionModuleResult (core/mission/run.ts) declares verifyOutcome, refusalCount, quarantinedPaths, quarantineCommitHash as required fields. mission.ts's quarantinedPathsOf/quarantineCommitHashOf read them directly; verifyOutcomeOf/refusalCountOf still read via `as unknown as {...}` casts — stale leftover, safe to drop when touched next.
- AgentLedgerEntry (packages/core/src/types.ts) has no per-run diagnostic fields (verifyOutcome, refusalCount, quarantinedPaths, quarantineCommitHash) — only an in-memory MissionModuleResult from a live `swarm mission` run carries these. Past-mission history (`swarm missions`) structurally cannot show them.
- In `printResults()` and missionCommand's own violations/branches/stranded/refused/followUps/quarantine/Report-note sections (mission.ts), each conditional block owns its own unconditional leading separator, never checking a sibling block's fired-state. verify.ts's post-table spacing (one shared leading blank line) is a different pattern — don't conflate them.
- c.green/c.red/c.gray/c.yellow strip to plain text when `process.stdout.isTTY` is false. <sub>`packages/cli/src/ui.ts`</sub>
- ui.ts's LiveBoard has zero awareness of commit/branch/ownership/quarantine state — only module/state/activity/tokens/verifyOutcome/refusalCount rows.
- doctor.ts's config-dependent checks (drift, verifyCommand soft-warn, and any future config-field warning) live inside `if (workspace.exists) { ... }`. doctorCommand's exit code (`report.ok && billingVars.length === 0 ? 0 : 1`) stays independent of any Project-section warning — soft-warn checks never affect exit code.
- detectVerifyCommand(repoRoot, dominantLanguage?) (from `@swarm-os/core`) is a pure fs-inspection call, no agent spawn — safe to call directly inside doctorCommand's `if (workspace.exists)` block without assertRuntimeReady or async plumbing.
- SwarmConfig.verifyCommand is a required `string` field defaulting to `''` (not optional) — `!config.verifyCommand` is the correct empty-check, matching core's applyVerifyCommandDetection.
- MapResult.verifyCommandMessage is a genuinely optional field (`verifyCommandMessage?: string`), already typed on the `@swarm-os/core` barrel export — no defensive cast needed.

## Gotchas

- main.ts's VERSION constant ('0.1.0') is hand-maintained — bumping packages/cli/package.json's version does nothing to `swarm --version` output.
- dist/ is gitignored and bin points at ./dist/main.js — after any pull/checkout the installed `swarm` is whatever was last built; stale dist is invisible until `npm run build` reruns.
- scheduleBackgroundUpdate spawns `node main.js update --background` detached with SWARM_UPDATE_WORKER=1; main.ts checks that same env var to avoid infinite chains. Easy to break by refactoring either side independently.
- `swarm wake <module>` only flips recorded state to active — spawns no process, does no work.
- LiveBoard degrades based on `process.stdout.isTTY`, not NO_COLOR/TERM=dumb (those only affect `c` color wrapping).
- `swarm loop --plan` recomputes signals from scratch rather than reusing a prior `swarm map`/`refactor` run.
- commands/map.ts only treats a re-map as a no-op when drift.moduleCount > 0 as well as unchanged.
- The Bash permission layer can refuse `npm run build`/`tsc`/`node --test`/git outright in a headless sandbox. When blocked: do full manual diff/type review, say so explicitly, watch for indexed-access typing (see invariant).
- `npm run build` compiles `tsc --build packages/core packages/cli` together — a cli file referencing a not-yet-existing core named export fails the *whole* build with TS2305 immediately, no soft-import workaround. Before writing code against a mission-contract-promised core export, verify it actually exists in this worktree's `@swarm-os/core` barrel — the contract may describe work still landing elsewhere in parallel. Confirmed pattern twice (checkStaleBuild in update.ts still blocked this way; detectVerifyCommand in doctor.ts was blocked this way but has since landed and is now used — see invariants).
- doctor.ts calls `detectVerifyCommand(workspace.repoRoot)` with no second arg, unlike the mapper's own call site (apply-verify-command-detection.ts) which always passes `dominantLanguage` via `digest.languages[0]?.[0]`. In multi-language repos with >1 candidate (e.g. both package.json and Cargo.toml), doctor can suggest a different verify command than `swarm map` would have written — known minor inconsistency, not yet fixed.
- `swarm map` (core) already persists a detected verifyCommand into .swarm/config.yaml whenever config.verifyCommand was empty going in — so doctor's soft warning mostly only fires when nothing was detected at all, or on repos mapped before this feature existed / with verifyCommand manually cleared. Narrower in practice than it looks, not redundant.
- packages/cli/src/commands/mission.test.ts's formatVerify/formatRefusals/quarantinedPathsOf/quarantineCommitHashOf tests use substring/structural checks deliberately, to survive wording tweaks — established style, now also followed by doctor.test.ts/map.test.ts for verifyCommandCheckLines/verifyCommandNote.
- doctorCommand/printMapResult write straight to console via ui.ts's note/line/warn (no stdout capture harness in this package) — the only practical way to unit-test their wording is extracting pure, exported formatting functions (verifyCommandCheckLines, verifyCommandNote, formatVerify, etc.) rather than testing the command functions directly.
- mission.ts's refusal/followUps blank-line spacing has a pending fix (special-casing on `refused.length === 0`) reviewed as a regression against the sibling-block separator convention above — don't assume current spacing there is correct without re-checking.
- The `table()` helper in ui.ts computes column widths dynamically per row array length — adding a column to printResults() rows has no fixed-arity assumption to worry about.

## Landmarks

- `packages/cli/src/main.ts` — command-dispatch table; HELP text canonical; owns SIGINT double-Ctrl-C escalation and post-exit update-scheduling hook.
- `packages/cli/src/args.ts` — minimal argv parser + flagString/flagBool/flagNumber/flagList helpers.
- `packages/cli/src/context.ts` — CommandContext resolution, config-override merging, strictSubscription runtime preflight gate.
- `packages/cli/src/ui.ts` — ANSI helpers, formatTokens/formatDuration/clip/pad/table, LiveBoard.
- `packages/cli/src/server.ts` — HTTP server for `swarm ui --serve`: renderUi(), /api/snapshot, /api/events (SSE), /api/mission.
- `packages/cli/src/commands/mission.ts` — largest handler; wires runMission callbacks into LiveBoard; renders verifyOutcome/refusalCount and quarantinedPaths/quarantineCommitHash in printResults()/report sections. Pure helpers unit-tested in mission.test.ts.
- `packages/cli/src/commands/loop.ts` — `swarm loop`/`loop --plan`; refuses dirty tree; writes .swarm/loop.log and loop.json.
- `packages/cli/src/commands/map.ts` — drift/pendingSplits short-circuit for no-op re-runs; printMapResult prints `result.verifyCommandMessage` (from mapProject) via exported pure helper `verifyCommandNote(result)`; tested in map.test.ts.
- `packages/cli/src/commands/verify.ts` — deterministic citation checks + per-module verifier agents; writes verification.md. Shared-single-blank-line spacing style differs from mission.ts's per-block pattern.
- `packages/cli/src/commands/refactor.ts` — deterministic signals then optional reviewer agents; writes REFACTOR.md and refactor.json.
- `packages/cli/src/commands/doctor.ts` — billing-env detection + lean-spawn context measurement; only command that skips assertRuntimeReady. Now includes a soft "Project" check: inside `if (workspace.exists)`, when `!config.verifyCommand`, warns the verify loop is disabled and calls `detectVerifyCommand(workspace.repoRoot)` (no dominantLanguage arg — see gotcha); wording factored into exported pure `verifyCommandCheckLines(detection)`, tested in doctor.test.ts. Exit code untouched by this check.
- `packages/cli/src/commands/update.ts` — self-update logic; `noticeIfUpdated()` here; `warnIfStaleBuild()` still blocked on core's `checkStaleBuild` export not yet existing.
- `README.md` — canonical module/swarm/mission/runtime mental model.

## Public interface

- bin `swarm` (packages/cli/dist/main.js) — the only artifact end users invoke
- @swarm-os/cli package name/version consumed by packaging/install tooling (npm link -w @swarm-os/cli)
- root package.json workspaces list (packages/core, packages/cli) and scripts (build/test/clean/watch/swarm/link)
- tsconfig.base.json — shared TS compiler options extended by packages/cli/tsconfig.json
- README.md / docs/** — canonical mental model other modules' docs and CLI HELP text should stay consistent with
- `@swarm-os/core` now exports `detectVerifyCommand`, `VerifyCommandCandidate`, `VerifyCommandDetection` from mapper/pipeline/detect-verify-command.ts — usable directly by cli commands.

---

_Surveyed 2026-08-21 by the `cli` analyst._
