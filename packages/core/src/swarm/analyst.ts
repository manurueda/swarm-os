/**
 * Per-module analysis.
 *
 * After the repository is partitioned, each module gets its own analyst agent.
 * The analyst reads only the globs its module owns — never the whole repo — and
 * writes back a code-grounded charter plus the first real entries in that
 * module's memory.
 *
 * This is the moment a swarm comes into existence. The analyst is the same
 * shape as the agents that will later wake for missions: scoped to one domain,
 * ignorant of the others, cheap enough to run many of at once.
 *
 * Cost is bounded by construction: N modules × one read-only agent each, in
 * parallel, none of which can see more than its own slice.
 */

import type { AgentRuntime, ModuleSpec, SwarmEvent } from '../types.js';
import { collectAgent, type AgentOutcome } from '../runtime/collect.js';

export const MODULE_ANALYSIS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['purpose', 'entryPoints', 'landmarks', 'invariants', 'gotchas', 'publicInterface', 'dependsOn'],
  properties: {
    purpose: {
      type: 'string',
      description: 'What this module is responsible for, grounded in what you actually read.',
    },
    entryPoints: {
      type: 'array',
      maxItems: 8,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'why'],
        properties: {
          path: { type: 'string' },
          why: { type: 'string', description: 'Why an agent should open this first.' },
        },
      },
    },
    landmarks: {
      type: 'array',
      maxItems: 12,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'role'],
        properties: {
          path: { type: 'string' },
          role: { type: 'string', description: 'One line: what lives here.' },
        },
      },
    },
    invariants: {
      type: 'array',
      maxItems: 10,
      items: { type: 'string' },
      description: 'Rules that must hold. Things a future agent would break by accident.',
    },
    gotchas: {
      type: 'array',
      maxItems: 10,
      items: { type: 'string' },
      description: 'Surprises, traps, misleading names, load-bearing hacks.',
    },
    publicInterface: {
      type: 'array',
      maxItems: 12,
      items: { type: 'string' },
      description: 'What other modules import or call from this one.',
    },
    dependsOn: {
      type: 'array',
      items: { type: 'string' },
      description: 'Slugs of other modules this one genuinely depends on.',
    },
    correctedOwns: {
      type: 'array',
      items: { type: 'string' },
      description: 'Only if the assigned globs were wrong. Otherwise omit.',
    },
  },
} as const;

export interface ModuleAnalysis {
  purpose: string;
  entryPoints: Array<{ path: string; why: string }>;
  landmarks: Array<{ path: string; role: string }>;
  invariants: string[];
  gotchas: string[];
  publicInterface: string[];
  dependsOn: string[];
  correctedOwns?: string[];
}

const ANALYST_CHARTER = `You are a Swarm OS module analyst.

You are being given ONE module of a larger repository. You will never see the
other modules, and you do not need to. Your job is to produce the durable
knowledge that lets future agents work on this module without re-reading it.

Method:
1. Start from the entry points you were given. Use Glob to see the module's real
   shape, Grep to trace how the important pieces connect, Read for the files
   that matter.
2. Stay inside your assigned globs. If something outside them matters, note it
   as a dependency rather than opening it.
3. Read selectively. You are looking for structure, contracts and traps — not
   completeness. Twenty well-chosen files beat two hundred skimmed ones.

What is worth recording:
- INVARIANTS: rules a future agent would violate by accident. "Frames must be
  written in order", "this cache is keyed by content hash, not path".
- GOTCHAS: misleading names, load-bearing hacks, non-obvious coupling, code
  that looks dead but is not.
- LANDMARKS: the handful of files that orient someone new.
- PUBLIC INTERFACE: what the rest of the system consumes from here.

What is not worth recording: anything a future agent could rediscover in ten
seconds with Glob, restatements of file names, or generic advice.

Be concrete and specific. Every line you write costs context in every future
mission that touches this module, so make each one earn its place.`;

export interface AnalyzeModuleOptions {
  runtime: AgentRuntime;
  repoRoot: string;
  module: ModuleSpec;
  /** Slugs of sibling modules, so dependencies can be named correctly. */
  siblings: Array<{ slug: string; purpose: string }>;
  systemSummary: string;
  model?: string;
  onEvent?: (event: SwarmEvent) => void | Promise<void>;
  signal?: AbortSignal;
}

export async function analyzeModule(
  options: AnalyzeModuleOptions,
): Promise<{ analysis?: ModuleAnalysis; outcome: AgentOutcome }> {
  const { module: spec, siblings, systemSummary } = options;

  const prompt = [
    `# Module: ${spec.name} (\`${spec.slug}\`)`,
    '',
    `Provisional purpose (from the structural map — correct it if wrong):`,
    spec.purpose || '_none given_',
    '',
    '## You own these paths',
    '',
    ...spec.owns.map((g) => `- \`${g}\``),
    '',
    '## Suggested entry points',
    '',
    ...(spec.entryPoints.length > 0
      ? spec.entryPoints.map((f) => `- \`${f}\``)
      : ['_none suggested — find them yourself_']),
    '',
    '## The wider system',
    '',
    systemSummary || '_not recorded_',
    '',
    'Sibling modules you may name as dependencies:',
    '',
    ...siblings.map((s) => `- \`${s.slug}\` — ${s.purpose}`),
    '',
    '---',
    '',
    'Explore your module and report what a future agent needs to know.',
    'Stay inside your globs. Do not modify anything — this is a read-only survey.',
  ].join('\n');

  const outcome = await collectAgent(
    options.runtime,
    {
      id: `analyst:${spec.slug}`,
      role: 'analyst',
      module: spec.slug,
      prompt,
      systemPrompt: ANALYST_CHARTER,
      cwd: options.repoRoot,
      // Read-only by construction. An analyst cannot edit the repo.
      tools: ['Read', 'Grep', 'Glob'],
      ...(options.model ? { model: options.model } : {}),
      permissionMode: 'dontAsk',
      jsonSchema: MODULE_ANALYSIS_SCHEMA,
      lean: true,
      ephemeral: true,
    },
    options.onEvent,
    options.signal,
  );

  const analysis = parseAnalysis(outcome.structured);
  return { ...(analysis ? { analysis } : {}), outcome };
}

function parseAnalysis(raw: unknown): ModuleAnalysis | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const o = raw as Record<string, unknown>;
  if (typeof o['purpose'] !== 'string') return undefined;

  const pairs = (v: unknown, a: string, b: string): Array<Record<string, string>> =>
    Array.isArray(v)
      ? v.flatMap((x) => {
          if (typeof x !== 'object' || x === null) return [];
          const r = x as Record<string, unknown>;
          return typeof r[a] === 'string' && typeof r[b] === 'string'
            ? [{ [a]: r[a] as string, [b]: r[b] as string }]
            : [];
        })
      : [];

  const strings = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

  const corrected = strings(o['correctedOwns']);

  return {
    purpose: o['purpose'],
    entryPoints: pairs(o['entryPoints'], 'path', 'why') as Array<{ path: string; why: string }>,
    landmarks: pairs(o['landmarks'], 'path', 'role') as Array<{ path: string; role: string }>,
    invariants: strings(o['invariants']),
    gotchas: strings(o['gotchas']),
    publicInterface: strings(o['publicInterface']),
    dependsOn: strings(o['dependsOn']),
    ...(corrected.length > 0 ? { correctedOwns: corrected } : {}),
  };
}

/**
 * Render an analysis into the module's memory.md.
 *
 * This file is read at the start of every future mission touching this module,
 * so it is written to be read by an agent in a hurry: no preamble, no prose
 * padding, everything scannable.
 */
export function renderMemory(spec: ModuleSpec, analysis: ModuleAnalysis, generatedAt: string): string {
  const section = (title: string, items: string[], empty: string): string[] => [
    `## ${title}`,
    '',
    ...(items.length > 0 ? items : [`_${empty}_`]),
    '',
  ];

  return [
    `# ${spec.name} — memory`,
    '',
    `_Durable knowledge for the \`${spec.slug}\` swarm. Read on wake, rewritten on sleep._`,
    '',
    ...section('Invariants', analysis.invariants.map((i) => `- ${i}`), 'None recorded yet.'),
    ...section('Gotchas', analysis.gotchas.map((g) => `- ${g}`), 'None recorded yet.'),
    ...section(
      'Landmarks',
      analysis.landmarks.map((l) => `- \`${l.path}\` — ${l.role}`),
      'None recorded yet.',
    ),
    ...section(
      'Public interface',
      analysis.publicInterface.map((p) => `- ${p}`),
      'Not recorded.',
    ),
    '---',
    '',
    `_Surveyed ${generatedAt} by the \`${spec.slug}\` analyst, reading only this module's paths._`,
    '',
  ].join('\n');
}

/** Render an analysis into the module's charter (module.md). */
export function renderCharter(spec: ModuleSpec, analysis: ModuleAnalysis, systemSummary: string): string {
  return [
    `# ${spec.name}`,
    '',
    analysis.purpose,
    '',
    '## Owns',
    '',
    ...(analysis.correctedOwns ?? spec.owns).map((g) => `- \`${g}\``),
    '',
    '## Read first',
    '',
    ...(analysis.entryPoints.length > 0
      ? analysis.entryPoints.map((e) => `- \`${e.path}\` — ${e.why}`)
      : spec.entryPoints.map((f) => `- \`${f}\``)),
    '',
    '## Depends on',
    '',
    ...(analysis.dependsOn.length > 0
      ? analysis.dependsOn.map((d) => `- \`${d}\``)
      : ['_Nothing — this module stands alone._']),
    '',
    '## System context',
    '',
    systemSummary || '_Not recorded._',
    '',
    '---',
    '',
    '_Charter written by this module\'s analyst. `swarm map` will not overwrite it',
    'without `--force`, and never touches memory.md or decisions.md._',
    '',
  ].join('\n');
}
