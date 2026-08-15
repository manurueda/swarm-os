# Swarm Orchestration — decisions

Append-only log. One entry per consequential choice, newest at the bottom.

## 2026-08-15 — Two functions hide their own logic and cannot be tested. sleepSwarm in packages/core/src/swarm/manager.ts does six things in one body: reads memory, early-returns, builds a prompt, calls an agent, files area sections, writes files and updates state. mapProject in packages/core/src/mapper/pipeline.ts is a single 500-line function whose nested closures each capture seven variables - which is exactly how surveyAreas came to be defined and never called, invisible to any test. Extract the decisions inside both into small named units that receive their dependencies as arguments instead of capturing or constructing them, in their own files, and add tests for each extracted unit. Change no behaviour whatsoever: this is a pure reorganisation. npm test must still pass.

- Follow-up: Someone with the ability to run `npm test` in this worktree should do so to get real, executed confirmation before merge — I could not execute anything beyond read-only/git commands in this sandbox.
- Follow-up: The sibling task on mapProject/surveyAreas in packages/core/src/mapper/pipeline.ts is out of my module's ownership (mapper module's globs) and was not touched here.
