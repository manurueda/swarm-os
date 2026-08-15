# Repo Mapper & Architecture Analysis — decisions

Append-only log. One entry per consequential choice, newest at the bottom.

## 2026-08-15 — Two functions hide their own logic and cannot be tested. sleepSwarm in packages/core/src/swarm/manager.ts does six things in one body: reads memory, early-returns, builds a prompt, calls an agent, files area sections, writes files and updates state. mapProject in packages/core/src/mapper/pipeline.ts is a single 500-line function whose nested closures each capture seven variables - which is exactly how surveyAreas came to be defined and never called, invisible to any test. Extract the decisions inside both into small named units that receive their dependencies as arguments instead of capturing or constructing them, in their own files, and add tests for each extracted unit. Change no behaviour whatsoever: this is a pure reorganisation. npm test must still pass.

- Follow-up: Run `npm test` (or `npm run build` + `node --test`) before merging - this refactor was verified by manual code review only, not by compiling or executing it, because the sandbox in this session rejected every node/npm/tsc invocation.
- Follow-up: If the swarm-orchestration agent's parallel work on sleepSwarm (packages/core/src/swarm/manager.ts) introduces a similar 'record-module-progress'-style serial queue, consider whether it should share this module's createSerialQueue rather than duplicating it - I could not check since that file is outside my module boundary.
