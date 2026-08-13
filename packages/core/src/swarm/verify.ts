/**
 * Memory verification.
 *
 * Durable memory is only worth having if it is true. A confident, wrong
 * invariant is worse than an empty file: it is loaded into every future mission
 * touching the module and believed.
 *
 * Verification runs in two stages, cheapest first:
 *
 *   1. CITATION RESOLUTION — deterministic, zero tokens. Every claim cites a
 *      file; does that file exist, and is it inside the module's globs? This
 *      catches invented paths, which is the most common way a survey goes wrong.
 *
 *   2. ADVERSARIAL RE-READ — one fresh agent per module, which sees ONLY the
 *      claims, never the analyst's reasoning or its own module's prior memory
 *      narrative. It is asked to falsify each claim against the code and mark it
 *      supported, contradicted or unverifiable, citing evidence.
 *
 * Independence is the whole point of stage 2. A verifier that sees how the claim
 * was derived tends to agree with it, so it gets the claims and the code, and
 * nothing else.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import type { AgentRuntime, ModuleSpec, SwarmEvent } from '../types.js';
import { collectAgent, type AgentOutcome } from '../runtime/collect.js';
import { parseClaimLine, type Claim } from './analyst.js';
import { standaloneAgentPrompt } from '../runtime/system-tier.js';
import { isOwned } from './ownership.js';
import type { Workspace } from '../workspace/store.js';

export type Verdict = 'supported' | 'contradicted' | 'unverifiable';

export interface ClaimVerification {
  claim: Claim;
  /** Deterministic: does the cited path exist and belong to this module? */
  citation: 'resolved' | 'missing-file' | 'outside-module' | 'no-citation';
  verdict?: Verdict;
  /** The verifier's evidence, ideally file:line. */
  evidence?: string;
}

export interface ModuleVerification {
  module: string;
  claims: ClaimVerification[];
  /** Fraction of claims with a citation that resolves. Deterministic. */
  citationRate: number;
  /** Fraction of judged claims marked supported. Undefined if stage 2 skipped. */
  accuracy?: number;
  contradicted: number;
  unverifiable: number;
  /** How many claims the analyst itself flagged as documentation-derived. */
  docSourced: number;
  costUsd?: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Stage 1 — citation resolution (deterministic)
// ---------------------------------------------------------------------------

/** Pull the claim lines back out of a rendered memory.md. */
export function extractClaims(memory: string): Claim[] {
  const claims: Claim[] = [];
  let section: 'invariants' | 'gotchas' | 'other' = 'other';

  for (const raw of memory.split('\n')) {
    const line = raw.trim();
    const heading = /^##\s+(.+)$/.exec(line);
    if (heading) {
      const title = (heading[1] ?? '').toLowerCase();
      section = title.startsWith('invariant')
        ? 'invariants'
        : title.startsWith('gotcha')
          ? 'gotchas'
          : 'other';
      continue;
    }
    if (section === 'other' || !line.startsWith('- ')) continue;
    if (/^_.*_$/.test(line.slice(2).trim())) continue; // "_None recorded yet._"
    const claim = parseClaimLine(line);
    if (claim?.text) claims.push(claim);
  }
  return claims;
}

export function checkCitation(
  claim: Claim,
  repoRoot: string,
  owns: string[],
): ClaimVerification['citation'] {
  if (!claim.path) return 'no-citation';
  // Citations sometimes name a directory rather than a file; both are fine as
  // long as they exist and belong to the module.
  if (!existsSync(join(repoRoot, claim.path))) return 'missing-file';
  const normalized = claim.path.replace(/\/+$/, '');
  if (!isOwned(normalized, owns) && !owns.some((g) => g.startsWith(normalized))) {
    return 'outside-module';
  }
  return 'resolved';
}

// ---------------------------------------------------------------------------
// Stage 2 — adversarial re-read
// ---------------------------------------------------------------------------

export const VERIFY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdicts'],
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['index', 'verdict', 'evidence'],
        properties: {
          index: { type: 'number', description: 'The claim number you were given.' },
          verdict: { type: 'string', enum: ['supported', 'contradicted', 'unverifiable'] },
          evidence: {
            type: 'string',
            description: 'What you read that decided it. Cite file:line where you can.',
          },
        },
      },
    },
    notes: { type: 'string', description: 'Anything important the claims do not mention.' },
  },
} as const;

const VERIFIER_CHARTER = `You are a Swarm OS memory verifier.

You are given a list of claims that a previous agent recorded about one module,
and access to that module's code. You did not write these claims and you owe
them nothing. Your job is to find out which ones are false.

For each claim return one of:
- supported     — you read the code and it says what the claim says
- contradicted  — you read the code and it does NOT say what the claim says,
                  or says something incompatible
- unverifiable  — you could not find the relevant code, the claim is too vague
                  to check, or it asserts something about runtime behaviour or
                  history that the source cannot settle

Rules:
- Go and read. A claim is not supported because it sounds plausible or because
  a comment repeats it. If the claim is about behaviour, check the
  implementation, not the docstring above it.
- Claims sourced from documentation are the ones most likely to be stale. Give
  them the most scrutiny, not the least.
- Check the SPECIFICS. If a claim gives numbers, an ordering, a filename or a
  function name, verify that exact detail. A claim that is directionally right
  but states a ratio backwards is CONTRADICTED, not supported.
- "unverifiable" is a perfectly good answer and much better than a guess. Do not
  mark something supported to be agreeable.
- Cite what you actually read as evidence, with file:line where you can.

You are not being asked to improve the claims or write new ones. Only to judge
the ones in front of you.`;

export interface VerifyModuleOptions {
  runtime: AgentRuntime;
  workspace: Workspace;
  module: ModuleSpec;
  /** Skip the model call and report citation resolution only. */
  citationsOnly?: boolean;
  model?: string;
  onEvent?: (event: SwarmEvent) => void | Promise<void>;
  signal?: AbortSignal;
}

export async function verifyModule(options: VerifyModuleOptions): Promise<ModuleVerification> {
  const { workspace, module: spec } = options;

  const memory = await workspace.readModuleFile(spec.slug, 'memory.md');
  const claims = extractClaims(memory);

  const verifications: ClaimVerification[] = claims.map((claim) => ({
    claim,
    citation: checkCitation(claim, workspace.repoRoot, spec.owns),
  }));

  const resolved = verifications.filter((v) => v.citation === 'resolved').length;
  const docSourced = claims.filter((c) => c.source === 'doc').length;

  const base: ModuleVerification = {
    module: spec.slug,
    claims: verifications,
    citationRate: claims.length === 0 ? 1 : resolved / Math.max(claims.length, 1),
    contradicted: 0,
    unverifiable: 0,
    docSourced,
  };

  if (options.citationsOnly || claims.length === 0) return base;

  // The verifier sees the claims as a bare numbered list — no section headings,
  // no provenance markers, no purpose statement. Nothing that signals which
  // claims the previous agent was confident about.
  const prompt = [
    `# Module: ${spec.name} (\`${spec.slug}\`)`,
    '',
    'Paths you may read:',
    '',
    ...spec.owns.map((g) => `- \`${g}\``),
    '',
    '## Claims to check',
    '',
    ...verifications.map(
      (v, i) => `${i + 1}. ${v.claim.text}${v.claim.path ? ` (about \`${v.claim.path}\`)` : ''}`,
    ),
    '',
    '---',
    '',
    'Read the code and judge each claim. Return a verdict for every number above.',
  ].join('\n');

  const outcome = await collectAgent(
    options.runtime,
    {
      id: `verify:${spec.slug}`,
      role: 'verifier',
      module: spec.slug,
      prompt,
      // Read-only, single job: its own charter beats the default prompt.
      // Measured on an equivalent analyst agent at ~25% fewer total tokens
      // with no loss of output quality.
      systemPromptOverride: standaloneAgentPrompt(VERIFIER_CHARTER, { scope: spec.owns }),
      cwd: workspace.repoRoot,
      tools: ['Read', 'Grep', 'Glob'],
      ...(options.model ? { model: options.model } : {}),
      permissionMode: 'dontAsk',
      jsonSchema: VERIFY_SCHEMA,
      lean: true,
      ephemeral: true,
    },
    options.onEvent,
    options.signal,
  );

  applyVerdicts(verifications, outcome);

  const judged = verifications.filter((v) => v.verdict !== undefined);
  const supported = judged.filter((v) => v.verdict === 'supported').length;

  return {
    ...base,
    claims: verifications,
    ...(judged.length > 0 ? { accuracy: supported / judged.length } : {}),
    contradicted: verifications.filter((v) => v.verdict === 'contradicted').length,
    unverifiable: verifications.filter((v) => v.verdict === 'unverifiable').length,
    ...(outcome.costUsd !== undefined ? { costUsd: outcome.costUsd } : {}),
    ...(outcome.ok ? {} : { error: outcome.error ?? 'verifier failed' }),
  };
}

function applyVerdicts(verifications: ClaimVerification[], outcome: AgentOutcome): void {
  const raw = outcome.structured;
  if (typeof raw !== 'object' || raw === null) return;
  const list = (raw as Record<string, unknown>)['verdicts'];
  if (!Array.isArray(list)) return;

  for (const entry of list) {
    if (typeof entry !== 'object' || entry === null) continue;
    const e = entry as Record<string, unknown>;
    const index = typeof e['index'] === 'number' ? e['index'] - 1 : -1;
    const target = verifications[index];
    if (!target) continue;
    const verdict = e['verdict'];
    if (verdict === 'supported' || verdict === 'contradicted' || verdict === 'unverifiable') {
      target.verdict = verdict;
    }
    if (typeof e['evidence'] === 'string') target.evidence = e['evidence'];
  }
}

/** The report written to `.swarm/modules/<slug>/verification.md`. */
export function renderVerification(result: ModuleVerification, checkedAt: string): string {
  const pct = (n: number | undefined): string =>
    n === undefined ? '—' : `${Math.round(n * 100)}%`;

  const bySeverity = [...result.claims].sort((a, b) => {
    const rank = (v: ClaimVerification): number =>
      v.verdict === 'contradicted' ? 0 : v.citation !== 'resolved' ? 1 : v.verdict === 'unverifiable' ? 2 : 3;
    return rank(a) - rank(b);
  });

  return [
    `# ${result.module} — memory verification`,
    '',
    `| | |`,
    `| --- | --- |`,
    `| claims | ${result.claims.length} |`,
    `| citations resolve | ${pct(result.citationRate)} |`,
    `| supported | ${pct(result.accuracy)} |`,
    `| contradicted | ${result.contradicted} |`,
    `| unverifiable | ${result.unverifiable} |`,
    `| documentation-sourced | ${result.docSourced} |`,
    '',
    ...(result.error ? [`> Verifier error: ${result.error}`, ''] : []),
    '## Claims',
    '',
    ...bySeverity.flatMap((v) => {
      const mark =
        v.verdict === 'contradicted'
          ? '**CONTRADICTED**'
          : v.verdict === 'unverifiable'
            ? 'unverifiable'
            : v.verdict === 'supported'
              ? 'supported'
              : 'unjudged';
      const cite =
        v.citation === 'resolved'
          ? `\`${v.claim.path}\``
          : v.citation === 'no-citation'
            ? '_no citation_'
            : `\`${v.claim.path}\` — **${v.citation}**`;
      return [
        `- ${mark} · ${cite}${v.claim.source === 'doc' ? ' · _doc-sourced_' : ''}`,
        `  ${v.claim.text}`,
        ...(v.evidence ? [`  > ${v.evidence}`] : []),
        '',
      ];
    }),
    '---',
    '',
    `_Checked ${checkedAt} by an independent verifier that saw only the claims._`,
    '',
  ].join('\n');
}
