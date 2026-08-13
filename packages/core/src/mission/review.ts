/**
 * Mission review.
 *
 * A work agent reports on itself, and the failure mode that produces is
 * specific: it cannot flag what it could not check. The first feature this tool
 * built for itself compiled cleanly, respected its module boundary, reported
 * `complete` — and invented the CLI syntax of a neighbouring module, because
 * nothing it had access to could have told it otherwise.
 *
 * So the reviewer exists to check the things the author structurally could not:
 *
 *   - Does the diff do what the task asked, or something adjacent?
 *   - Are the verification claims true? "Tests pass" is checkable.
 *   - Do calls into other modules match their published interface?
 *   - Was what was added actually wired in, or is it unreachable?
 *
 * It reads the diff and the code around it, and it changes nothing. Its output
 * is advisory: work still lands on a branch either way, and the verdict tells
 * you where to look first.
 */

import type { AgentRuntime, ModuleSpec, SwarmEvent } from '../types.js';
import { collectAgent, type AgentOutcome } from '../runtime/collect.js';
import { standaloneAgentPrompt } from '../runtime/system-tier.js';

export const REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'summary', 'findings'],
  properties: {
    verdict: {
      type: 'string',
      enum: ['approve', 'changes-needed', 'reject'],
      description:
        'approve = land it. changes-needed = it is close but something is wrong. ' +
        'reject = it does not do the task, or it breaks something.',
    },
    summary: { type: 'string', description: 'One or two sentences on what the diff does.' },
    verificationHolds: {
      type: 'boolean',
      description:
        "Whether the author's claim about how they verified the change is actually true. " +
        'False if they claimed to run something they did not, or implied success without evidence.',
    },
    findings: {
      type: 'array',
      maxItems: 10,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['severity', 'file', 'problem'],
        properties: {
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          file: { type: 'string', description: 'Repo-relative path, with :line where you can.' },
          problem: { type: 'string', description: 'What is wrong. Concrete.' },
          fix: { type: 'string', description: 'What would resolve it.' },
        },
      },
    },
  },
} as const;

export interface ReviewFinding {
  severity: 'blocker' | 'major' | 'minor';
  file: string;
  problem: string;
  fix?: string;
}

export interface ModuleReview {
  module: string;
  verdict: 'approve' | 'changes-needed' | 'reject';
  summary: string;
  verificationHolds?: boolean;
  findings: ReviewFinding[];
  costUsd?: number;
  error?: string;
}

const REVIEWER_CHARTER = `You are a Swarm OS mission reviewer.

You are reading a change one agent made to one module. You did not write it and
you are not here to be agreeable. You are here to catch what its author could
not.

The author worked in isolation: it could see its own module and nothing else.
That produces one failure again and again — when the change touches anything
belonging to another module, the author INVENTS that thing's shape rather than
admit it does not know. A function signature, a CLI flag, a config key, an
event name. It will look completely plausible.

So check, in this order:

1. CROSS-MODULE CONTRACTS. Every reference to something outside this module —
   a call, a command string, an option name, an imported symbol. You have the
   published interfaces of the modules this one depends on. Anything that does
   not appear there and cannot be found in the code is invented until proven
   otherwise. This is the single most valuable thing you do.

2. IS IT WIRED IN. New code that is defined but never called, a branch nothing
   reaches, an option nothing reads. It compiles, so nothing complains.

3. DOES IT DO THE TASK. Compare the diff against what was actually asked. Doing
   something adjacent and useful is still not doing the task.

4. IS THE VERIFICATION REAL. The author said how it checked its work. Did it?
   "Tests pass" when no test was run is worse than "I could not verify this".

5. ORDINARY CORRECTNESS. Broken edge cases, resource leaks, swallowed errors,
   contradictions with the module's recorded invariants.

6. DISCIPLINE, but only where it has a real cost:
   - Behaviour changed and code reorganised in the same diff, so neither can be
     reviewed independently.
   - Something built that the task did not ask for: an option with one caller,
     a hook nothing calls, a parameter that is always the same value.
   - An abstraction extracted from two examples, which usually encodes a
     coincidence. Two similar blocks are fine.
   - A function that would need editing for two unrelated reasons.
   - New behaviour with no test, in a module that has tests.

Not your job: style, formatting, naming preferences, or anything a linter would
say. Do not propose refactors of code the diff did not touch. Do not rewrite the
change in your head and mark it down for differing from your version. Duplication
is not automatically a finding — say what it will cost.

Approve when it is right. A reviewer that finds something wrong every time
carries no information.`;

export interface ReviewOptions {
  runtime: AgentRuntime;
  module: ModuleSpec;
  /** The worktree the change lives in. */
  cwd: string;
  goal: string;
  task: string;
  /** Unified diff of the change. */
  diff: string;
  /** What the author said it did and how it verified. */
  authorReport?: string;
  /** Published interfaces of modules this one depends on. */
  contracts?: string;
  /** Files changed outside the module's globs, computed deterministically. */
  ownershipViolations?: string[];
  model?: string;
  onEvent?: (event: SwarmEvent) => void | Promise<void>;
  signal?: AbortSignal;
}

/** Diffs can be enormous; the reviewer needs the shape, not every hunk. */
const MAX_DIFF_CHARS = 60_000;

export async function reviewModuleChange(options: ReviewOptions): Promise<ModuleReview> {
  const { module: spec, diff } = options;

  const truncated =
    diff.length > MAX_DIFF_CHARS
      ? `${diff.slice(0, MAX_DIFF_CHARS)}\n\n… diff truncated at ${MAX_DIFF_CHARS} characters. Read the files directly for the rest.`
      : diff;

  const prompt = [
    `# Reviewing \`${spec.slug}\``,
    '',
    `**Mission goal.** ${options.goal}`,
    '',
    '**This module was asked to:**',
    '',
    options.task,
    '',
    ...(options.authorReport
      ? ['**The author reported:**', '', options.authorReport.trim(), '']
      : []),
    ...(options.ownershipViolations && options.ownershipViolations.length > 0
      ? [
          '**Files changed outside this module\'s boundary:**',
          '',
          ...options.ownershipViolations.map((f) => `- \`${f}\``),
          '',
        ]
      : []),
    ...(options.contracts ? [options.contracts, ''] : []),
    '## The change',
    '',
    '```diff',
    truncated,
    '```',
    '',
    '---',
    '',
    'You are in the worktree containing this change — read any file you need.',
    'Judge it.',
  ].join('\n');

  const outcome = await collectAgent(
    options.runtime,
    {
      id: `review:${spec.slug}`,
      role: 'reviewer',
      module: spec.slug,
      prompt,
      systemPromptOverride: standaloneAgentPrompt(REVIEWER_CHARTER, { scope: spec.owns }),
      cwd: options.cwd,
      // Read-only. A reviewer that can edit stops being a reviewer.
      tools: ['Read', 'Grep', 'Glob'],
      ...(options.model ? { model: options.model } : {}),
      permissionMode: 'dontAsk',
      jsonSchema: REVIEW_SCHEMA,
      lean: true,
      ephemeral: true,
    },
    options.onEvent,
    options.signal,
  );

  return parseReview(spec.slug, outcome);
}

function parseReview(slug: string, outcome: AgentOutcome): ModuleReview {
  const raw = outcome.structured;
  if (typeof raw !== 'object' || raw === null) {
    return {
      module: slug,
      verdict: 'approve',
      summary: '',
      findings: [],
      ...(outcome.costUsd !== undefined ? { costUsd: outcome.costUsd } : {}),
      error: outcome.error ?? 'reviewer returned no structured result',
    };
  }

  const o = raw as Record<string, unknown>;
  const verdict = o['verdict'];

  const findings: ReviewFinding[] = Array.isArray(o['findings'])
    ? o['findings'].flatMap((x) => {
        if (typeof x !== 'object' || x === null) return [];
        const f = x as Record<string, unknown>;
        if (typeof f['problem'] !== 'string') return [];
        const severity = f['severity'];
        return [
          {
            severity:
              severity === 'blocker' || severity === 'major' || severity === 'minor'
                ? severity
                : 'minor',
            file: typeof f['file'] === 'string' ? f['file'] : '',
            problem: f['problem'],
            ...(typeof f['fix'] === 'string' ? { fix: f['fix'] } : {}),
          },
        ];
      })
    : [];

  return {
    module: slug,
    verdict:
      verdict === 'approve' || verdict === 'changes-needed' || verdict === 'reject'
        ? verdict
        : 'approve',
    summary: typeof o['summary'] === 'string' ? o['summary'] : '',
    ...(typeof o['verificationHolds'] === 'boolean'
      ? { verificationHolds: o['verificationHolds'] }
      : {}),
    findings,
    ...(outcome.costUsd !== undefined ? { costUsd: outcome.costUsd } : {}),
  };
}
