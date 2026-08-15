# Mission Orchestration — decisions

Append-only log. One entry per consequential choice, newest at the bottom.

## 2026-08-15 — changedFiles and commitAll in packages/core/src/git/worktree.ts now take a third argument, a list of linked dependency paths to exclude, because a symlink named node_modules is not matched by the conventional 'node_modules/' ignore rule and was being committed into every mission branch and reported as an ownership violation. The fix is currently inert: run.ts is the only production caller and still calls both with two arguments. createWorktree returns the names on WorktreeHandle.linked at run.ts:359. Carry that value through to the changedFiles call at run.ts:437 and the commitAll call at run.ts:475 so the exclusion actually takes effect. This is a wiring change only - change no other behaviour. npm test must pass.

- Follow-up: Someone with an environment where the node_modules symlink is reachable (or with the sandbox lifted) should run `npm test` to give the actual green light this task required.
