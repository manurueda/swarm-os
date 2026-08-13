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
| `swarm mission "<goal>"` | route a goal and run the modules in parallel |
| `swarm missions` | past missions |
| `swarm memory [module]` | read what a swarm knows |
| `swarm sleep [module]` | compress memory and release |
| `swarm wake <module>` | mark a swarm active |

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

## Lean spawning

A trivial `claude -p "Reply with exactly: OK"` on a developer machine with MCP
servers, skills and plugins configured:

| | baseline context |
| --- | --- |
| ambient environment | **94,911 tokens** |
| lean spawn | **11,796 tokens** |

Every agent pays that before reading a line of your code. Swarm OS spawns all
agents lean — `--strict-mcp-config --disable-slash-commands --setting-sources ''`
plus an explicit tool list — which on a Max plan is the difference between four
agents per window and thirty, and gives each agent ~83k more usable context.

Measure it on your own machine:

```bash
swarm doctor --measure
```

(Numbers above are from Claude Code 2.1.231. Work agents run with
`--setting-sources project` so the target repo's own permissions still apply.)

---

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

1. **Reviewer agents** — a per-mission reviewer that reads the diffs before you do
2. **Cursor / VS Code extension** — sidebar and mission view over this same engine
3. **Visual architecture map** — modules and their dependency edges
4. **More runtimes** — `ClaudeApiRuntime` for distribution, others behind the
   same `AgentRuntime` port

## Layout

```
packages/core   @swarm-os/core   engine: runtime adapters, mapper, swarms,
                                 missions, memory, ownership, worktrees
packages/cli    @swarm-os/cli    the `swarm` command
```

MIT.
