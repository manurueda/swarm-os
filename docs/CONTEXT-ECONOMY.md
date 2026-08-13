# Context economy

Measurements and design notes on where an agent's context actually goes, and
what Swarm OS does about each part.

All numbers were measured on Claude Code **2.1.231**, macOS, against
`manu-viral` — a 1,742-file Python repository. Reproduce the first table on your
own machine with `swarm doctor --measure`.

---

## 1. The baseline you pay before doing anything

A developer machine accumulates MCP servers, skills, plugins and user settings.
Every one of them is injected into every agent process. The prompt below does no
work at all:

```
claude -p "Reply with exactly: OK"
```

| spawn | context consumed |
| --- | --- |
| ambient environment | **94,911 tokens** |
| lean (`--strict-mcp-config --disable-slash-commands --setting-sources ''`) | **11,796 tokens** |

**8× difference, before reading a line of code.** On a shared subscription
window that is the difference between roughly four agents and roughly thirty.
It also returns ~83k tokens of usable window to each agent.

Swarm OS spawns every agent lean. Work agents additionally get
`--setting-sources project` so the target repository's own permission rules
still apply — the saving comes from dropping the *user's* ambient environment,
not the project's configuration.

One flag deliberately **not** used: `--bare`. It strips more, but its
documentation states that Anthropic auth becomes "strictly `ANTHROPIC_API_KEY`
or `apiKeyHelper`" and that "OAuth and keychain are never read" — it would
disable subscription auth and force API billing. Exactly what this tool exists
to prevent.

---

## 2. Understanding a repository without reading it

The naive way to decide how a repo should be split is to show a model the repo.
That is the failure being designed around, so `swarm map` computes structure
deterministically instead:

- `git ls-files` (honours `.gitignore`), minus vendor and cache directories
- a directory tree with rolled-up file counts
- file-extension histogram
- root manifests (`package.json`, `pyproject.toml`, …), keys only
- headings from `README.md`, `ARCHITECTURE.md`, `CLAUDE.md`, `AGENTS.md`

| | |
| --- | --- |
| repository | 1,742 tracked files |
| digest sent to the partitioner | **~1,812 tokens** |

The tree renderer raises its inclusion threshold with depth, so a 991-file
package still exposes its internal structure:

```
src/ (1418)
  reel_core/ (991)
    analyzer/ (123)
      tests/ (30)
      … 10 smaller directories (88 files)
    music/ (70)
      … 10 smaller directories (67 files)
    captions/ (42)
    sfx/ (42)
    facecrop/ (38)
      reframe/ (31)
    …
```

Mapping cost is therefore roughly **independent of repository size**. A 20,000
file repo produces a digest in the same order of magnitude.

The partitioner runs with `--tools ""` — no tools at all. It *cannot* start
reading source, which makes the guarantee structural rather than a matter of
prompt discipline.

### Measured result

On `manu-viral` the partitioner returned 8 modules, correctly splitting the
991-file `reel_core` package into a rendering pipeline and a growth-intelligence
domain:

| module | files |
| --- | --- |
| `reel-core-render` | 561 |
| `production-ops` | 230 |
| `reel-core-growth-intelligence` | 203 |
| `reel-template-catalog` | 122 |
| `good-bad-reel` | 114 |
| `explainer-reel` | 104 |
| `lipsync-dubbing` | 89 |
| `stories-reel` | 56 |

### A note on schema retries

The first partition run cost **134,372 tokens** and 240 seconds — far more than
the 1.8k digest suggests. The cause was `StructuredOutput` being retried four
times against a JSON Schema that constrained slugs with
`pattern: '^[a-z0-9]+(-[a-z0-9]+)*$'`. Each retry re-sends the whole
conversation, so validation strictness compounds quadratically.

The pattern was removed and slugs are normalized in code instead. **Validate
cheaply-fixable things in code, not in the schema** — a regex that costs a retry
is far more expensive than the two lines that would have fixed the string.

---

## 3. What an agent actually loads

When a swarm wakes into a module it receives exactly three things:

```
system.md   prose head only — the summary and stack lines, not the module table
module.md   this module's charter: purpose, owns, read-first, depends-on
memory.md   this module's accumulated invariants, gotchas, landmarks, interface
```

Typically **2–4k tokens**. Not the repo tree, not sibling modules, not source.
The agent then explores its own globs with essentially its whole window free.

Deliberately excluded from the context pack:

- the module table from `system.md` — eleven rows about domains this agent
  cannot touch
- sibling module charters — if the agent needed them, the boundary is wrong
- the repo digest — it can run `Glob` inside its own globs for less

---

## 4. Sleeping is a compression step

A sleeping swarm holds no process and occupies no context. Its entire existence
is a markdown file of a couple of thousand tokens.

Sleeping is not merely a state change. A tool-less compressor rewrites
`memory.md` under a hard budget (`memoryBudgetTokens`, default 2000), merging
what the mission learned and deleting what it disproved. Its charter is explicit
about the priority order when something must be cut:

> Never exceed the stated token budget. If you must cut, cut landmarks first,
> then public interface. Never cut an invariant to fit.

Invariants and gotchas are the expensive knowledge — the kind that costs a
wasted mission to relearn. Landmarks are re-derivable with `Glob` in seconds.

When a swarm sleeps with no new information and is already within budget, no
model call happens at all.

---

## Summary

| mechanism | saves |
| --- | --- |
| lean spawning | ~83k tokens **per agent**, always |
| deterministic digest | reading the repo to decide how to split it |
| module-scoped context packs | everything outside one domain |
| sleeping swarms + compression | the entire cost of idle modules |
| incremental re-mapping | re-surveying modules that did not change |

The compounding effect is the point. A mission touching one module of a
1,742-file repository loads roughly 12k of baseline plus 3k of module context —
against a whole-repo approach that cannot fit at all.
