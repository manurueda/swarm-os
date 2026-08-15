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
import { standaloneAgentPrompt } from '../runtime/system-tier.js';

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
      items: { $ref: '#/$defs/claim' },
      description: 'Rules that must hold. Things a future agent would break by accident.',
    },
    gotchas: {
      type: 'array',
      maxItems: 10,
      items: { $ref: '#/$defs/claim' },
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
  $defs: {
    claim: {
      type: 'object',
      additionalProperties: false,
      required: ['text', 'path', 'source'],
      properties: {
        text: { type: 'string', description: 'The claim itself. Specific and checkable.' },
        path: {
          type: 'string',
          description:
            'Repo-relative file this claim is about. Must be a file you actually opened.',
        },
        source: {
          type: 'string',
          enum: ['code', 'doc'],
          description:
            'code = you read the implementation. doc = you read a docstring, README or comment ' +
            'asserting it. Be honest: doc claims are checked against code before being trusted.',
        },
      },
    },
  },
} as const;

/**
 * One checkable assertion about a module.
 *
 * Every claim carries the file it came from and whether it was read out of the
 * implementation or merely asserted by a docstring. Both are what make
 * `swarm verify` possible: the citation can be resolved without a model at all,
 * and doc-sourced claims can be prioritised for checking against real code.
 */
export interface Claim {
  text: string;
  path: string;
  source: 'code' | 'doc';
}

export interface ModuleAnalysis {
  purpose: string;
  entryPoints: Array<{ path: string; why: string }>;
  landmarks: Array<{ path: string; role: string }>;
  invariants: Claim[];
  gotchas: Claim[];
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

Every invariant and gotcha must carry two things:
- PATH: the repo-relative file it is about. Cite a file you actually opened.
  A citation that does not resolve is treated as a fabricated claim.
- SOURCE: "code" if you read the implementation and saw it yourself; "doc" if a
  docstring, README or comment asserted it and you did not confirm it in code.

Be honest about "doc". Documentation goes stale, and a doc claim marked as code
is worse than no claim at all — it is a false statement carrying full
confidence into every future mission. Nothing bad happens to you for saying
"doc"; those claims simply get verified against the implementation later.

Be concrete and specific. Every line you write costs context in every future
mission that touches this module, so make each one earn its place.`;

export interface AnalyzeModuleOptions {
  runtime: AgentRuntime;
  repoRoot: string;
  module: ModuleSpec;
  /** Slugs of sibling modules, so dependencies can be named correctly. */
  siblings: Array<{ slug: string; purpose: string }>;
  systemSummary: string;
  /**
   * Slugs of areas already surveyed for this module, if any. Set this when the
   * caller has run `detectAreas` and written each area's own memory file
   * before calling the analyst — signals that module-level memory.md must
   * hold only what is true across every area, leaving area-specific facts to
   * the area files that already exist.
   */
  areaNames?: string[];
  model?: string;
  /**
   * 'standalone' replaces Claude Code's default system prompt with the analyst's
   * own charter plus the exploration guidance that actually applies, saving the
   * ~8.5k the default costs. 'default' appends the charter to it instead.
   */
  promptMode?: 'standalone' | 'default';
  onEvent?: (event: SwarmEvent) => void | Promise<void>;
  signal?: AbortSignal;
}

export async function analyzeModule(
  options: AnalyzeModuleOptions,
): Promise<{ analysis?: ModuleAnalysis; outcome: AgentOutcome }> {
  const { module: spec, siblings, systemSummary, areaNames } = options;
  const hasAreas = (areaNames?.length ?? 0) > 0;

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
    ...(hasAreas
      ? [
          '## This module is split into areas',
          '',
          `Per-area memory already exists for: ${(areaNames ?? []).join(', ')}.`,
          'Each area was surveyed separately and already has its own memory file for what is',
          'specific to it. The memory.md you write now is loaded by EVERY agent that wakes into',
          'this module, whichever area it is working in — so it must hold ONLY invariants,',
          'gotchas and interface facts that are true across every area. Leave anything specific',
          'to a single area out of memory.md entirely; it belongs in that area\'s own file, not',
          'here.',
          '',
        ]
      : []),
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
      ...(options.promptMode === 'default'
        ? { systemPrompt: ANALYST_CHARTER }
        : {
            systemPromptOverride: standaloneAgentPrompt(ANALYST_CHARTER, {
              scope: spec.owns,
            }),
          }),
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

  const claims = (v: unknown): Claim[] =>
    Array.isArray(v)
      ? v.flatMap((x) => {
          // Tolerate a bare string: older maps and stubborn models both produce
          // them. An uncited claim is kept but marked unverifiable.
          if (typeof x === 'string') return [{ text: x, path: '', source: 'doc' as const }];
          if (typeof x !== 'object' || x === null) return [];
          const r = x as Record<string, unknown>;
          if (typeof r['text'] !== 'string') return [];
          return [
            {
              text: r['text'],
              path: typeof r['path'] === 'string' ? r['path'] : '',
              source: r['source'] === 'code' ? ('code' as const) : ('doc' as const),
            },
          ];
        })
      : [];

  const corrected = strings(o['correctedOwns']);

  return {
    purpose: o['purpose'],
    entryPoints: pairs(o['entryPoints'], 'path', 'why') as Array<{ path: string; why: string }>,
    landmarks: pairs(o['landmarks'], 'path', 'role') as Array<{ path: string; role: string }>,
    invariants: claims(o['invariants']),
    gotchas: claims(o['gotchas']),
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
    ...section('Invariants', analysis.invariants.map(renderClaim), 'None recorded yet.'),
    ...section('Gotchas', analysis.gotchas.map(renderClaim), 'None recorded yet.'),
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

/**
 * A claim line, carrying its citation inline.
 *
 * The `[doc]` marker is deliberately visible: an agent reading this memory
 * should weight an unverified documentation claim differently from something
 * read out of the implementation.
 */
export function renderClaim(claim: Claim): string {
  const cite = claim.path ? ` <sub>\`${claim.path}\`${claim.source === 'doc' ? ' [doc]' : ''}</sub>` : '';
  return `- ${claim.text}${cite}`;
}

/** Parse a rendered claim line back out of memory.md, for verification. */
export function parseClaimLine(line: string): Claim | undefined {
  const m = /^-\s+(.*?)(?:\s*<sub>`([^`]+)`(\s*\[doc\])?<\/sub>)?\s*$/.exec(line.trim());
  if (!m?.[1]) return undefined;
  return {
    text: m[1].trim(),
    path: m[2] ?? '',
    source: m[3] ? 'doc' : m[2] ? 'code' : 'doc',
  };
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
