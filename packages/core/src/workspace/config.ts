import { parse, stringify } from 'yaml';

/**
 * Project-level configuration, stored at `.swarm/config.yaml` inside the target
 * repository. Committed on purpose: any machine that clones the repo inherits
 * the same module map and the same concurrency policy.
 *
 * Contains no credentials and no machine-specific paths.
 */
export interface SwarmConfig {
  version: 1;
  /** Runtime adapter id. Personal mode is `claude-code-local`. */
  runtime: string;
  /** Model for work agents. */
  model: string;
  /** Cheaper model for routing, mapping and memory compression. */
  systemModel: string;
  /**
   * How many agent processes may run at once. Subscription quota is shared
   * across all of them, so this is a real budget, not a performance knob.
   */
  maxConcurrentAgents: number;
  /** Hard ceiling on each module's memory.md. Sleeping swarms must stay cheap. */
  memoryBudgetTokens: number;
  /** Permission mode for work agents. */
  permissionMode: string;
  /** Where per-agent git worktrees are created, relative to the repo root. */
  worktreeRoot: string;
  /**
   * Directories to link from the repo root into every agent worktree.
   *
   * A worktree is a fresh checkout, so anything gitignored is absent from it —
   * including installed dependencies. Without these an agent cannot build, cannot
   * run a test, and cannot honour the instruction to verify its own work. It
   * will then either claim success it did not check, or report that it could
   * not verify. Both are avoidable.
   *
   * Entries that do not exist in the repo root are skipped.
   *
   * Dependency directories only. `.env` and anything else holding secrets is
   * deliberately absent: an agent needs to build, not to hold credentials, and
   * a tool whose premise is never touching your keys should not hand them to a
   * subprocess by default. Add one explicitly if a build genuinely needs it.
   */
  worktreeLinks: string[];
  /**
   * How this project wants code written, in your words.
   *
   * Handed to every work agent on top of its standing charter. Put project
   * taste here — file size, layering, testing style — not universal advice the
   * charter already carries.
   *
   * A single module can override or extend this with a `conventions.md` in its
   * own directory under `.swarm/modules/<slug>/`.
   */
  codeStyle: string;
  /**
   * Largest module file list to include in a context pack. 0 disables it.
   *
   * Above this the index is dropped rather than truncated — half a file list is
   * worse than none, because an agent cannot distinguish "not in this module"
   * from "cut off".
   */
  contextFileIndex: number;
  /**
   * The command that proves the project still works, e.g. `npm test`.
   *
   * An unattended loop merges as it goes, and a reviewer's approval is a
   * judgement while a green build is a fact. Nothing is kept unless this
   * passes; if it fails the integration branch is reset to where it was.
   * Empty means changes are kept on the reviewer's word alone.
   */
  verifyCommand: string;
  /**
   * Environment for the verify command. Relative values resolve against the
   * worktree being verified.
   *
   * This exists because a worktree is not automatically a working environment.
   * A Python project installed with `pip install -e .` has a path file in its
   * venv pointing at the ORIGINAL checkout, so inside a worktree `import
   * yourpackage` resolves to the original source while pytest collects the
   * worktree's files — every test errors with "import file mismatch", and the
   * gate can never pass no matter how good the change is.
   *
   * `PYTHONPATH` is set automatically for a Python project with a `src/`
   * directory, because PYTHONPATH precedes site-packages and so shadows the
   * editable install. Anything here overrides that.
   */
  verifyEnv: Record<string, string>;
  /** Built-in tools work agents may use. */
  tools: string[];
  /** Pause spawning when the subscription rate limit reports this status. */
  pauseOnRateLimitStatus: string[];
}

export const DEFAULT_CONFIG: SwarmConfig = {
  version: 1,
  runtime: 'claude-code-local',
  model: 'sonnet',
  systemModel: 'sonnet',
  maxConcurrentAgents: 3,
  memoryBudgetTokens: 2000,
  permissionMode: 'acceptEdits',
  worktreeRoot: '.swarm/worktrees',
  worktreeLinks: [
    'node_modules',
    '.venv',
    'venv',
    'vendor',
    'target',
    '.gradle',
  ],
  codeStyle: '',
  contextFileIndex: 160,
  verifyCommand: '',
  verifyEnv: {},
  tools: ['Read', 'Write', 'Edit', 'Grep', 'Glob', 'Bash'],
  pauseOnRateLimitStatus: ['rejected', 'blocked'],
};

export function parseConfig(text: string): SwarmConfig {
  const raw: unknown = parse(text);
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_CONFIG };
  return { ...DEFAULT_CONFIG, ...(raw as Partial<SwarmConfig>), version: 1 };
}

export function serializeConfig(config: SwarmConfig): string {
  return [
    '# Swarm OS project configuration.',
    '# Safe to commit — contains no credentials. Authentication is delegated',
    '# entirely to `claude auth` on each developer machine.',
    '',
    stringify(config),
  ].join('\n');
}
