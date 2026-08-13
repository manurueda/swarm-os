/**
 * Refactoring proposals.
 *
 * The deterministic signals say where to look. This agent goes and looks, then
 * says what is actually wrong and what to do about it.
 *
 * The signals matter for more than triage: handing an agent "read this 500-file
 * module and tell me what is wrong" is exactly the unbounded exploration this
 * whole tool exists to avoid. Handing it "here are eleven specific files, three
 * of them 1,200 lines, this directory has no tests — go and confirm" is a
 * bounded job it can do well.
 *
 * A proposal is only useful if it is actionable. "Improve separation of
 * concerns" is not a proposal. "Split `pipeline.py` (1,340 lines): the frame
 * scheduler at 40-380 has no dependency on the rest and is used by three other
 * modules" is.
 */

import type { AgentRuntime, ModuleSpec, SwarmEvent } from '../types.js';
import { collectAgent, type AgentOutcome } from '../runtime/collect.js';
import { standaloneAgentPrompt } from '../runtime/system-tier.js';
import type { Signal } from './signals.js';

export const REFACTOR_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'assessment', 'proposals'],
  properties: {
    verdict: {
      type: 'string',
      enum: ['healthy', 'workable', 'needs-restructuring'],
      description:
        'healthy = a new engineer could work here comfortably. workable = rough but navigable. ' +
        'needs-restructuring = the structure itself is what makes changes expensive.',
    },
    assessment: {
      type: 'string',
      description:
        'Two or three sentences on how this module is actually organised, and whether the ' +
        'flagged signals turned out to be real problems.',
    },
    proposals: {
      type: 'array',
      maxItems: 6,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'problem', 'change', 'evidence', 'severity', 'effort'],
        properties: {
          title: { type: 'string', description: 'Imperative and specific. "Split X out of Y".' },
          problem: {
            type: 'string',
            description: 'What this costs today. Concrete consequence, not a principle.',
          },
          change: {
            type: 'string',
            description: 'What to do, precisely enough that someone could start tomorrow.',
          },
          evidence: {
            type: 'array',
            items: { type: 'string' },
            description: 'Files and line ranges you actually read that establish the problem.',
          },
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
          effort: {
            type: 'string',
            enum: ['hours', 'days', 'weeks'],
            description: 'Honest estimate for someone who knows this code.',
          },
          risk: { type: 'string', description: 'What could break, and how to tell if it did.' },
        },
      },
    },
    falsePositives: {
      type: 'array',
      items: { type: 'string' },
      description: 'Flagged signals that turned out to be fine, and why. Be specific.',
    },
  },
} as const;

export interface RefactorProposal {
  title: string;
  problem: string;
  change: string;
  evidence: string[];
  severity: 'high' | 'medium' | 'low';
  effort: 'hours' | 'days' | 'weeks';
  risk?: string;
}

export interface ModuleRefactorReport {
  module: string;
  verdict: 'healthy' | 'workable' | 'needs-restructuring';
  assessment: string;
  proposals: RefactorProposal[];
  falsePositives: string[];
  costUsd?: number;
  error?: string;
}

const REFACTOR_CHARTER = `You are a Swarm OS structural reviewer.

You are looking at ONE module of a repository and judging whether its code is
organised well enough to work in. Not whether it is pretty — whether the
structure itself is what makes changes expensive.

You are given automated signals: oversized files, directories named "utils",
domains with no tests, deep nesting. Those are leads, not findings. Some will be
wrong. Go and read the specific files they point at and decide for yourself.

What counts as a real structural problem:
- One file holding several unrelated responsibilities, so every change to any of
  them risks the others.
- Logic duplicated because there was no obvious shared home for it.
- A name that lies, or a name so generic it cannot exclude anything.
- A dependency that should not exist — a low-level piece reaching up into a
  high-level one.
- Code with no test whose behaviour is not obvious from reading it.
- A hierarchy standing in for an abstraction that was never written.

What does NOT count:
- Long files that are genuinely one cohesive thing. A 900-line parser is fine.
- Conventional layouts that happen to trip a heuristic.
- Style, formatting, naming preferences, or anything a linter would say.
- Anything you would fix by "improving separation of concerns" without being
  able to name what separates from what.

For every proposal, state the concrete cost of leaving it alone. If you cannot
name what it costs, it is not a problem worth a proposal — say so instead.

Say "healthy" when the module is healthy. A reviewer who finds problems
everywhere is not being rigorous, they are being useless: if everything is
flagged, nothing is prioritised. Report the false positives you were given
explicitly — that is as valuable as the findings.

You are proposing, not doing. Change nothing.`;

export interface ReviewModuleOptions {
  runtime: AgentRuntime;
  repoRoot: string;
  module: ModuleSpec;
  /** Signals concerning this module, from `computeSignals`. */
  signals: Signal[];
  /** The module's memory, so the reviewer knows the invariants it must respect. */
  memory?: string;
  model?: string;
  onEvent?: (event: SwarmEvent) => void | Promise<void>;
  signal?: AbortSignal;
}

export async function reviewModuleStructure(
  options: ReviewModuleOptions,
): Promise<ModuleRefactorReport> {
  const { module: spec, signals } = options;

  const prompt = [
    `# Module: ${spec.name} (\`${spec.slug}\`)`,
    '',
    spec.purpose,
    '',
    '## Paths you may read',
    '',
    ...spec.owns.map((g) => `- \`${g}\``),
    '',
    '## Automated signals',
    '',
    ...(signals.length > 0
      ? signals.flatMap((s) => [
          `### ${s.kind} (${s.severity})`,
          '',
          s.summary,
          '',
          ...s.evidence.map((e) => `- ${e}`),
          '',
        ])
      : ['_Nothing flagged. Confirm that, or report what the heuristics missed._', '']),
    ...(options.memory
      ? [
          '## What is already known about this module',
          '',
          'Respect these when proposing changes — they are why the code is shaped',
          'the way it is.',
          '',
          options.memory.trim(),
          '',
        ]
      : []),
    '---',
    '',
    'Read the files the signals point at. Decide which problems are real, and',
    'propose what to do. Say so plainly if the module is fine.',
  ].join('\n');

  const outcome = await collectAgent(
    options.runtime,
    {
      id: `refactor:${spec.slug}`,
      role: 'reviewer',
      module: spec.slug,
      prompt,
      systemPromptOverride: standaloneAgentPrompt(REFACTOR_CHARTER, { scope: spec.owns }),
      cwd: options.repoRoot,
      tools: ['Read', 'Grep', 'Glob'],
      ...(options.model ? { model: options.model } : {}),
      permissionMode: 'dontAsk',
      jsonSchema: REFACTOR_SCHEMA,
      lean: true,
      ephemeral: true,
    },
    options.onEvent,
    options.signal,
  );

  return parseReport(spec.slug, outcome);
}

function parseReport(slug: string, outcome: AgentOutcome): ModuleRefactorReport {
  const raw = outcome.structured;
  const fallback: ModuleRefactorReport = {
    module: slug,
    verdict: 'workable',
    assessment: '',
    proposals: [],
    falsePositives: [],
    ...(outcome.costUsd !== undefined ? { costUsd: outcome.costUsd } : {}),
    error: outcome.error ?? 'reviewer returned no structured result',
  };

  if (typeof raw !== 'object' || raw === null) return fallback;
  const o = raw as Record<string, unknown>;

  const verdict = o['verdict'];
  if (verdict !== 'healthy' && verdict !== 'workable' && verdict !== 'needs-restructuring') {
    return fallback;
  }

  const proposals: RefactorProposal[] = Array.isArray(o['proposals'])
    ? o['proposals'].flatMap((x) => {
        if (typeof x !== 'object' || x === null) return [];
        const p = x as Record<string, unknown>;
        if (typeof p['title'] !== 'string' || typeof p['change'] !== 'string') return [];
        const severity = p['severity'];
        const effort = p['effort'];
        return [
          {
            title: p['title'],
            problem: typeof p['problem'] === 'string' ? p['problem'] : '',
            change: p['change'],
            evidence: Array.isArray(p['evidence'])
              ? p['evidence'].filter((e): e is string => typeof e === 'string')
              : [],
            severity:
              severity === 'high' || severity === 'medium' || severity === 'low'
                ? severity
                : 'medium',
            effort: effort === 'hours' || effort === 'days' || effort === 'weeks' ? effort : 'days',
            ...(typeof p['risk'] === 'string' ? { risk: p['risk'] } : {}),
          },
        ];
      })
    : [];

  return {
    module: slug,
    verdict,
    assessment: typeof o['assessment'] === 'string' ? o['assessment'] : '',
    proposals,
    falsePositives: Array.isArray(o['falsePositives'])
      ? o['falsePositives'].filter((x): x is string => typeof x === 'string')
      : [],
    ...(outcome.costUsd !== undefined ? { costUsd: outcome.costUsd } : {}),
  };
}

/** The report written to `.swarm/REFACTOR.md`. */
export function renderRefactorReport(
  repoName: string,
  reports: ModuleRefactorReport[],
  signals: Signal[],
  checkedAt: string,
): string {
  const rank = { high: 0, medium: 1, low: 2 } as const;
  const all = reports
    .flatMap((r) => r.proposals.map((p) => ({ module: r.module, ...p })))
    .sort((a, b) => rank[a.severity] - rank[b.severity]);

  const lines: string[] = [
    `# ${repoName} — structural review`,
    '',
    `${all.length} proposal(s) across ${reports.length} modules.`,
    '',
    '| module | verdict | proposals |',
    '| --- | --- | --- |',
    ...reports.map(
      (r) => `| \`${r.module}\` | ${r.verdict} | ${r.proposals.length} |`,
    ),
    '',
  ];

  if (all.length > 0) {
    lines.push('## Proposals', '');
    for (const p of all) {
      lines.push(
        `### ${p.title}`,
        '',
        `\`${p.module}\` · **${p.severity}** · ${p.effort}`,
        '',
        `**Costs today.** ${p.problem}`,
        '',
        `**Change.** ${p.change}`,
        '',
        ...(p.risk ? [`**Risk.** ${p.risk}`, ''] : []),
        ...(p.evidence.length > 0
          ? ['**Evidence.**', '', ...p.evidence.map((e) => `- ${e}`), '']
          : []),
      );
    }
  }

  lines.push('## Assessments', '');
  for (const r of reports) {
    lines.push(`### \`${r.module}\` — ${r.verdict}`, '', r.assessment || '_none_', '');
    if (r.falsePositives.length > 0) {
      lines.push('Signals that were not real problems:', '', ...r.falsePositives.map((f) => `- ${f}`), '');
    }
  }

  const unreviewed = signals.filter((s) => !s.module);
  if (unreviewed.length > 0) {
    lines.push('## Repository-wide signals', '');
    for (const s of unreviewed) {
      lines.push(`- **${s.kind}** (${s.severity}) — ${s.summary}`);
      for (const e of s.evidence.slice(0, 4)) lines.push(`  - ${e}`);
    }
    lines.push('');
  }

  lines.push('---', '', `_Reviewed ${checkedAt}. Proposals only — nothing was changed._`, '');
  return lines.join('\n');
}
