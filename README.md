# Swarm OS

Run coding agents as **sleeping, per-module swarms** so large repositories stop
breaking on context limits.

A big codebase defeats a coding agent the same way every time: the agent tries to
hold the whole system in one context window, and the window runs out. Swarm OS
never lets that happen. It partitions a repository into **modules**, gives each
one durable compressed **memory** on disk, and wakes only the modules a task
actually touches — each in its own process, its own worktree, and its own small
context.

Everything runs locally against the Claude Code you already have installed and
authenticated. **Swarm OS never handles credentials and never uses API keys.**

```
$ swarm map
  digest      1,742 tracked files, py dominant
  partition   7 modules proposed
  analysing modules  7/7

  ✓ reel-core        991 files   1.9k memory   Shared rendering pipeline…
  ✓ explainer-reel   104 files   1.4k memory   Slide-based explainer videos…
  ✓ good-bad-reel    114 files   1.6k memory   Before/after comparison reels…
  …

  Every swarm is asleep. Total memory on disk: 11k tokens.
  That is what a mission loads — not the 1,742 files.
```

---

## The idea

| | Without Swarm OS | With Swarm OS |
| --- | --- | --- |
| What the agent loads | as much of the repo as fits | one module's charter + memory |
| Cost of 12 known domains | 12 × whole-repo exploration | 12 markdown files, ~2k tokens each |
| Two tasks at once | one context, interleaved | two processes, two worktrees |
| What survives the session | the transcript, until it's compacted | `memory.md`, forever, in git |

Four moving parts:

- **Module** — one domain of the repo (`billing`, `rendering`, `auth`). Owns a
  set of globs and a `memory.md` that outlives every process.
- **Swarm** — the agent team for a module. Either **sleeping** (zero processes,
  zero tokens, knowledge on disk) or **active** (live processes).
- **Mission** — a goal. Routes to a subset of modules, wakes those swarms,
  spawns one agent each, harvests results, compresses memory, sleeps.
- **Runtime** — the adapter underneath. `claude-code-local` today; the swarm,
  memory and mission layers don't know or care which model is below them.

---

## Install

Requires Node 20+, git, and [Claude Code](https://claude.com/claude-code)
installed and logged in.

```bash
git clone https://github.com/manurueda/swarm-os
cd swarm-os
npm install
npm run build
npm link -w @swarm-os/cli    # puts `swarm` on your PATH
```

Then confirm the machine is ready:

```bash
swarm doctor
```

---

## Use

```bash
cd ~/your-big-repo

swarm map                       # understand the repo as modules
swarm status                    # what exists, what's awake, what it costs

swarm mission "make the timeline smooth with 100+ scenes" --dry-run
swarm mission "make the timeline smooth with 100+ scenes"

swarm memory rendering          # read what a swarm knows
```

`swarm map` is **incremental**. Run it again whenever you sit back down: it
re-fingerprints the repo, re-surveys only the modules whose files changed, and
leaves every other module's accumulated memory untouched.

Missions leave each module's work on its own branch, so you review before
anything lands:

```
git diff main..swarm/2026-08-13-timeline-performance/rendering
```

### Commands

| | |
| --- | --- |
| `swarm doctor` | check the runtime, confirm subscription billing |
| `swarm map [path]` | partition and survey a repository (incremental) |
| `swarm status` | swarms, state, memory cost, drift |
| `swarm ui` | a local visual view of the whole repository |
| `swarm mission "<goal>"` | route a goal and run the modules in parallel |
| `swarm missions` | past missions |
| `swarm memory [module]` | read what a swarm knows |
| `swarm verify [module]` | check the memory is true, not just confident |
| `swarm refactor [module]` | find where the code's structure is what makes it hard |
| `swarm sleep [module]` | compress memory and release |
| `swarm wake <module>` | mark a swarm active |
| `swarm update` | update Swarm OS itself |

Useful flags: `--dry-run`, `--modules a,b`, `--concurrency n`, `--model`,
`--force`, `--repartition`, `--repo <path>`.

---

## How `swarm map` works

```
1. DIGEST      deterministic. git ls-files, directory shapes, manifests,
               doc headings. 1,742 files → ~1.8k tokens. Costs nothing.

2. PARTITION   one agent, no tools, digest only. Proposes module boundaries.
               It cannot read source code, so it cannot blow up.

3. ANALYSE     one agent per module, in parallel, each reading ONLY its own
               globs. Produces the module's charter and its first memory:
               invariants, gotchas, landmarks, public interface.

4. SYNTHESISE  assemble system.md from what the analysts actually found.
```

Step 3 is where swarms come into being. Each analyst is the same shape as the
agents that will later wake for missions — scoped to one domain, ignorant of the
others, cheap enough to run several at once.

### What lands in your repo

```
.swarm/
├── config.yaml              runtime, model, concurrency, memory budget
├── system.md                the map
├── state.json               swarm states and file fingerprints
├── modules/
│   └── rendering/
│       ├── module.md        charter: purpose, owns, read-first, depends-on
│       ├── memory.md        invariants · gotchas · landmarks · interface
│       ├── decisions.md     append-only log
│       └── ownership.yaml   the globs this module owns
└── missions/
    └── 2026-08-13-.../      plan.md · report.md · events.jsonl
```

All plain markdown and YAML. Commit it — every machine that clones the repo
inherits the map, and `memory.md` diffs are reviewable like any other change.

---

## Billing

Claude Code silently prefers `ANTHROPIC_API_KEY` over your subscription. With a
dozen agents running, that is the difference between a flat subscription and a
metered bill you did not agree to.

Swarm OS treats this as a safety property:

- `swarm doctor` reports the billing basis in plain terms and exits non-zero if
  an API-billing variable is set.
- Commands that spawn agents **refuse to start** when one is present.
- Every spawned process has `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`,
  `ANTHROPIC_BASE_URL`, Bedrock/Vertex/Foundry switches and friends **stripped
  from its environment**.

Swarm OS reads no credential, stores no credential, and transmits no credential.
You run `claude auth login` once; agents resolve those credentials themselves.

> Anthropic's terms do not permit third-party products to authenticate users
> through Claude.ai accounts or to run on Pro/Max subscription limits. Swarm OS
> is a personal tool that drives *your own* local Claude Code install. Any
> distributed version would need the `ClaudeApiRuntime` adapter and BYO API keys.

---

## Context economy

Every agent pays a fixed baseline before it reads a line of your code. Measured
on Claude Code 2.1.231 with the prompt `"Reply with exactly: OK"`:

| spawn | baseline context |
| --- | --- |
| ambient environment (MCP servers, skills, plugins, user settings) | **31k – 95k** |
| lean, all default tools | 30,350 |
| lean, 6 work tools | 16,774 |
| lean, 3 read-only tools | 11,798 |
| lean, no tools | 8,746 |
| no tools + own system prompt | **175** |

The ambient figure is a range because it depends on how many MCP servers happen
to be connected — two runs on the same machine measured 94,911 and 31,463.
Everything below it is stable.

Two things fall out of that table:

**Tool definitions cost about 1k each.** Not just a JSON schema — each ships a
long description with usage rules and edge cases. Six work tools cost ~8k.

**Claude Code's own system prompt is ~8.5k**, and it is almost entirely guidance
for using tools and navigating a codebase. An agent running with `--tools ""`
cannot use any of it. Swarm OS's tool-less agents — the partitioner, router and
memory compressor — therefore *replace* that prompt with their own charter
rather than appending to it.

That is cheaper and also measurably better. The same structured-output task:

```
default system prompt   28,925 tokens   →  {"modules": []}          wrong
own system prompt        1,726 tokens   →  {"modules": [{...}]}     right
```

With nothing to act on, tool-use guidance is not neutral — it pushes the model
to explore and be thorough when the correct behaviour is to answer once. Agents
that *do* have tools keep the default prompt, with their charter appended.

Measure it on your own machine:

```bash
swarm doctor --measure
```

---

## Is the memory true?

Durable memory is only an asset if it is accurate. A confident, wrong invariant
is worse than an empty file — it gets loaded into every future mission and
believed.

```bash
swarm verify              # every module
swarm verify --citations-only    # deterministic, zero tokens
```

Two stages:

1. **Citation resolution** — free. Every claim records the file it came from.
   Does that file exist, and does it belong to the module? Catches invented
   paths without a model call.
2. **Adversarial re-read** — one fresh agent per module that sees *only the
   claims*, never how they were derived, and tries to falsify each one against
   the code. Returns supported / contradicted / unverifiable with `file:line`
   evidence.

Claims also record **provenance**: `code` if the analyst read the
implementation, `doc` if a docstring or README asserted it and the analyst did
not confirm it. Documentation-sourced claims are the ones that go stale, and
they are marked `[doc]` in the memory file so a reader weights them differently.

Reports land in `.swarm/modules/<slug>/verification.md`.

## Seeing it

```bash
swarm ui
```

One self-contained HTML file, opened. No server, no network, no build — it
works offline and opens straight from disk.

Three tabs, and the first one is the point:

- **Tasks** — everything worth doing, most serious first. Each card says what
  is wrong, where, and carries the one command that acts on it. Refactor
  proposals rank above raw signals, because an agent read the code for those.
- **Modules** — what is in here. A name, a size bar, and a flag if something
  needs attention. Click one for its invariants, its gotchas and its heaviest
  files.
- **Missions** — what has run.

An earlier version was a treemap, a dependency matrix and a wall of statistics.
All true, all interesting, and none of it told anyone what to do next. The
primary object is a task now, not a module.

## The code agents write

Charters, not hope. Work agents are told, and reviewers check:

- **Tests first where tests exist.** If a module has no test setup, say so
  rather than inventing a harness the project never chose.
- **One reason to change.** A function that needs editing for two unrelated
  reasons is two things wearing one name.
- **Duplication is cheaper than the wrong abstraction.** Two similar blocks are
  fine; extract on the third, when you can see what actually varies.
- **Build only what was asked.** No option nobody sets, no extension point
  nobody extends, no parameter with one caller passing one value.
- **Never refactor and change behaviour in the same step.** A diff that
  reorganises and alters at once cannot be reviewed or bisected.
- **Match what is already there.** Local consistency beats global correctness.

And one that came from watching this fail: **never invent a neighbour's
interface**. An isolated agent that needs another module's signature will
produce something plausible rather than admit it does not know. Agents now get
the published interface of every module they depend on, and the reviewer treats
anything outside it as invented until proven otherwise.

## Review

Every mission is reviewed before you see it, by an agent that did not write the
change and reads only the diff, the task, and the contracts of neighbouring
modules. It checks the things the author structurally could not:

```
✓ workspace-state  approve
! cli              changes-needed
    major  packages/cli/src/commands/ui.ts:41
      calls buildSnapshot with two arguments; it takes three
```

Verdicts are advisory — work lands on a branch either way. `--no-review` skips
it, and then nothing checks the contracts the author guessed at.

## Is the code itself the problem?

Often a repository is hard to work in for reasons no module boundary will fix:
files that do too much, directories nobody decided what to call, whole domains
with no tests. `swarm refactor` finds those and proposes what to do.

```bash
swarm refactor                 # signals, then a reviewer agent per module
swarm refactor --signals-only  # deterministic only, instant, zero tokens
```

The deterministic pass is the interesting half. From the file list, line counts
and a regex import graph — no model, no toolchain, any language:

```
✗ scattered-module   `reel-core-video` needs 14 globs across 2 top-level
                     directories — its code is not colocated
✗ memory-pressure    `reel-core-audio` holds ~11 sub-domains in a 2000-token
                     budget — about 190 tokens each
✗ import-cycle       circular import: reel-products → reel-core-analysis →
                     reel-core-foundation → … → reel-products
✗ god-file           `reel-products` has 8 files far larger than the rest
                     (median 63 lines)
! unowned-files      270 files (15%) belong to no module
```

Those signals then become the reviewer's brief. Handing an agent "read this
500-file module and tell me what's wrong" is the unbounded exploration this tool
exists to prevent; handing it "here are eleven specific files, three over 1,200
lines, this directory has no tests — go and confirm" is a bounded job.

Reviewers report `healthy` / `workable` / `needs-restructuring`, and are asked
to name the **false positives** explicitly — a reviewer that finds problems
everywhere has prioritised nothing.

### On trusting the signals

Two rules were learned by running this against its own source:

**`dependsOn` is an opinion; imports are a fact.** Dependency signals are built
only from a real import graph, never from the `dependsOn` an analyst wrote down.
A cycle warning you cannot act on — because you cannot tell whether the code or
the opinion is wrong — is worse than no warning.

**Type-only imports and barrel files are excluded.** `import type` is erased at
compile time, and a barrel's imports describe a public API rather than
coupling. Counting either invents cycles: on this repo it reported
`mapper → orchestrator → runtime → mapper`, which turned out to be a shared
`types.ts` and an `index.ts` re-export, not a cycle at all.

Same reason `core`, `lib` and `shared` are not treated as junk-drawer names —
they are standard package names, and flagging them fires on healthy code and
teaches people to ignore the output.

## Updating

Swarm OS checks for a new version once a day, in a detached background process
started **after** a command finishes — never during one, so an update can't swap
files under a live agent. The new version takes effect on the next invocation.

```bash
swarm update            # update now
swarm update --check    # report only
SWARM_NO_UPDATE=1       # disable entirely
```

A git checkout with uncommitted changes is never fast-forwarded — that's someone
working on Swarm OS itself, and losing their work to an auto-update would be
unforgivable. It's reported instead.

## Ownership is enforced, not requested

Claude Code has no flag confining an agent to a set of globs, so the boundary is
enforced from both sides: the agent is told its globs in its charter, **and its
diff is checked against them afterwards**. Files touched outside the module are
reported in the mission output and recorded in `mission.json`.

`swarm map` also flags overlapping ownership between modules — two swarms
claiming the same files would produce conflicting worktrees, which is the one
thing this design cannot merge for you.

---

## Concurrency is a budget, not a throttle

A subscription is a shared, finite window: every concurrent agent draws from the
same quota. The scheduler watches the `rate_limit_event` stream and stops
launching new agents the moment the window is reported exhausted, rather than
discovering it one failed agent at a time.

The default is 3 concurrent agents. Raise it with `--concurrency` when the
window is fresh; the router is separately instructed to route to the *fewest*
modules that can do the job.

---

## Status

**v0.1 — working, early.** The CLI engine is complete: map, status, mission,
memory, sleep/wake, doctor. Real agents, real worktrees, real memory
compression.

Roadmap, in order:

1. **Sub-module memory** — measured across a 1,742-file repo, every module
   saturates its 2k budget with ~12 sub-domains, i.e. ~170 tokens each. Routing
   should stay coarse while memory gets addressed per area.
2. **Reviewer agents** — a per-mission reviewer that reads the diffs before you do
3. **Cursor / VS Code extension** — sidebar and mission view over this same engine
4. **Visual architecture map** — modules and their dependency edges
5. **More runtimes** — `ClaudeApiRuntime` for distribution, others behind the
   same `AgentRuntime` port

## Layout

```
packages/core   @swarm-os/core   engine: runtime adapters, mapper, swarms,
                                 missions, memory, ownership, worktrees
packages/cli    @swarm-os/cli    the `swarm` command
```

MIT.
