# Architecture

## The problem this is shaped around

A coding agent working on a large repository fails in a specific way. It explores
to build understanding, understanding accumulates in the context window, the
window fills, and the session either compacts away the thing it needed or stops.
Worse, the understanding is *discarded* at the end of the session, so the next
one pays for it again.

Two observations follow:

1. **Most tasks touch a small part of the system.** A change to billing does not
   require holding the video renderer in mind. The whole-repo context is mostly
   waste.
2. **What an agent learns is small and durable.** "Frames must be written in
   order", "this cache is keyed by content hash, not path" — a few thousand
   tokens of hard-won invariants that stay true for months.

Swarm OS is what you get from taking both seriously: partition the repository so
an agent only ever loads one part, and persist the learned part so it is never
relearned.

---

## Layers

```
                    ┌─────────────────────────────┐
                    │            CLI              │  swarm map / mission / status
                    └──────────────┬──────────────┘
                                   │
  ┌────────────────────────────────┼────────────────────────────────┐
  │                          @swarm-os/core                         │
  │                                                                 │
  │   mapper/          swarm/              mission/                 │
  │   digest           manager             route                    │
  │   map              analyst             run                      │
  │   pipeline         ownership                                    │
  │                    scheduler                                    │
  │                                                                 │
  │   workspace/  .swarm store        git/  worktrees               │
  └────────────────────────────────┬────────────────────────────────┘
                                   │
                       ┌───────────▼───────────┐
                       │     AgentRuntime      │   ← the only seam that
                       └───────────┬───────────┘     knows about models
                                   │
        ┌──────────────────────────┼──────────────────────────┐
        │                          │                          │
  ClaudeCodeLocal            ClaudeApi                     Codex
  (personal, today)          (product mode)               (future)
        │
   claude subprocess × N  →  your subscription
```

Everything above the port — modules, swarms, memory, missions, ownership,
scheduling — is provider-agnostic. That separation is deliberate and dates from
the first commit: it is what lets a personal tool built on a local subscription
become a distributable product on API keys without rewriting the interesting
half.

---

## The runtime port

```ts
interface AgentRuntime {
  readonly id: string
  preflight(): Promise<PreflightReport>
  run(spec: AgentSpec, signal?: AbortSignal): AsyncIterable<SwarmEvent>
}
```

Three methods. `run` yields a normalized event stream:

```
agent.start · agent.text · agent.tool · agent.tool_result
agent.usage · agent.done · agent.error · ratelimit
```

`ClaudeCodeLocalRuntime` spawns `claude -p --output-format stream-json` and
translates its NDJSON into that stream. **No terminal emulation, no scraping of
rendered output** — the display can therefore be a real status board, and an
extension or a web UI can consume exactly the same events.

Unknown event types are ignored rather than fatal, so a Claude Code upgrade
degrades instead of breaking.

---

## The three agent tiers

Not every agent needs the same power, and the cheap ones are cheap on purpose.

| Tier | Agents | Tools | Sees |
| --- | --- | --- | --- |
| **System** | partitioner, router, compressor | none | a digest, or one memory file |
| **Analyst** | one per module | `Read` `Grep` `Glob` | only its module's globs |
| **Work** | one per assigned module | full set | its module + its worktree |

The system tier is tool-less *by construction*. A partitioner with `Read` would
start opening files and reintroduce the problem the digest exists to solve;
giving it no tools makes that impossible rather than merely discouraged.

---

## Context economy

Four mechanisms, in order of how much they save.

### 1. Lean spawning

Measured on Claude Code 2.1.231, `claude -p "Reply with exactly: OK"`:

| | baseline context |
| --- | --- |
| ambient environment (MCP servers, skills, plugins, user settings) | 94,911 |
| lean (`--strict-mcp-config --disable-slash-commands --setting-sources ''`) | 11,796 |

Every agent pays this before reading anything. An 8× reduction in fixed overhead
is worth more than any prompt tuning downstream. Work agents run with
`--setting-sources project` so the target repo's own permissions still apply.

### 2. The digest

`swarm map` never reads source to decide boundaries. `git ls-files`, directory
shapes with rolled-up counts, manifests, doc headings — a 1,742-file repository
compresses to about 1,800 tokens. Mapping cost is therefore roughly independent
of repository size.

The tree renderer raises its inclusion threshold with depth, so a 991-file
package still reveals its internal structure while a 4-file utility directory
collapses into "… 10 smaller directories".

### 3. Module-scoped context packs

When an agent wakes into a module it receives exactly:

```
system.md  (prose head only — not the module table)
module.md  (this module's charter)
memory.md  (this module's accumulated knowledge)
```

Not the repo tree. Not sibling modules. Not source. Typically 2–4k tokens, after
which the agent explores its own globs with the context it has left.

### 4. Sleeping swarms

A sleeping swarm has no processes and occupies no context. Its knowledge is a
markdown file. Twelve mapped modules cost twelve small files; a mission pays only
for the modules it wakes.

Sleeping is a **compression step**, not just a state change: a tool-less
compressor rewrites `memory.md` under a hard token budget, merging what the
mission learned and deleting what it disproved. The charter is explicit that
invariants are never cut to fit — landmarks go first.

---

## Missions

```
goal
 │
 ├── route          one tool-less agent. Sees the system summary and one line
 │                  per module — a few hundred tokens regardless of repo size.
 │                  Returns a self-contained task per module.
 │
 ├── wake           load each target module's context pack
 │
 ├── worktree       git worktree per module, on branch swarm/<mission>/<module>
 │
 ├── work           N agents in parallel, bounded by the scheduler.
 │                  Each returns a structured report: status, changes,
 │                  and — importantly — what it LEARNED.
 │
 ├── police         diff each worktree against the module's globs.
 │                  Out-of-bounds files are reported, not silently merged.
 │
 └── harvest        compress each module's memory with what it learned,
                    then sleep. No processes left running.
```

Agents in a mission never share a context window and cannot see each other. When
two modules must agree on an interface, the router writes the exact contract into
**both** tasks, identically — that shared sentence is the entire coordination
mechanism, and keeping it that thin is what makes the isolation hold.

Work lands on branches. Nothing merges itself.

---

## Ownership

Claude Code has no flag confining an agent to a set of globs, so ownership is
enforced from both ends:

- **Before** — the charter states the globs, and the worker charter says
  explicitly that reaching into another module is a follow-up, not a fix.
- **After** — `git diff --name-only` in the worktree is checked against the
  globs. Violations surface in the mission output and persist in `mission.json`.

`swarm map` separately flags overlapping ownership between modules, because two
swarms claiming the same files produce conflicting worktrees — the one situation
this design cannot merge.

`.swarm/` paths are always permitted; that is where agents record memory.

---

## Scheduling

A subscription is a shared, finite window. Concurrency is therefore a *spending
policy*, not a throughput knob.

The `Scheduler` runs at most `maxConcurrentAgents` at once and observes every
`ratelimit` event. When the window is reported exhausted it stops launching new
agents and marks the rest skipped, rather than discovering the limit one failed
agent at a time. Failures are isolated: a task that throws resolves to an `Error`
in the results array, so one broken module never kills the mission.

---

## Incremental re-analysis

Re-running `swarm map` is cheap and safe, which matters because the useful habit
is to re-analyse whenever you sit back down at a project.

`state.json` stores a fingerprint of each module's file list. On re-run:

- unchanged modules — **skipped entirely**, memory preserved untouched
- changed modules — re-surveyed by a fresh analyst
- `--repartition` — redraw boundaries, keep memory where slugs survive
- `--force` — discard everything and start over

`detectDrift()` answers "has this repo moved since it was mapped?" with no model
call at all, which is what `swarm status` reports.

`swarm map` never overwrites `memory.md` or `decisions.md` for a module it did
not re-analyse. Accumulated knowledge is the asset; the map around it is cheap to
rebuild.

---

## Credentials

Swarm OS reads no credential, stores no credential, transmits no credential.

Authentication is entirely `claude auth login` → OS keychain → subprocess. The
only thing Swarm OS does about credentials is **remove** the environment
variables that would divert an agent onto API billing, and refuse to spawn agents
while one is set.

See `packages/core/src/runtime/env.ts` for the exact list.
