# Dependency waves: stop making parallel siblings guess

## The failure, observed

A three-module mission (intake, speech, api) ran all three concurrently. The api
task needed symbols the intake and speech tasks were creating at that moment.
The api agent did the right thing under its charter — refused to invent its
neighbours' interfaces, declared itself blocked, and wrote a follow-up spec —
but a whole agent-run was spent discovering a fact the router already knew:
`api.dependsOn ⊇ {intake, speech}`.

## Why waves alone are not the fix

Ordering the modules topologically and running dependents later changes nothing
by itself: every worktree branches from the same base commit, so a wave-2 agent
still cannot see wave-1's uncommitted branches.

## Design

1. Route as today, then topologically order the routed modules by the import
   graph (imports are a fact; `dependsOn` is an opinion — same rule as the
   refactor signals). Cycles collapse into one wave.
2. If there is more than one wave, create `swarm/<mission>/integration` from
   the base commit. After each wave, merge that wave's module branches into the
   integration branch (module ownership means files rarely collide; a collision
   aborts the merge and fails the mission honestly).
3. Wave N>1 worktrees branch from the integration branch, so dependents build
   against the siblings' real, committed interfaces.
4. Module branches stay per-module for review; the integration branch is
   machinery and is deleted after the mission unless `--keep-integration`.
5. The context pack for a wave-N agent lists, per dependency delivered in an
   earlier wave: the branch's changed files and the author's reported summary —
   the same information a human reviewer starts from.

## Cost

One extra branch, one merge per wave, and missions whose modules chain now run
in as many stages as the chain is deep — which is exactly the truth the
concurrency was papering over.
