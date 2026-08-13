/**
 * Turn a repository into a module map.
 *
 * One agent, one turn, no tools. It sees the deterministic digest and nothing
 * else — never the source. That keeps mapping a ~10k-token operation regardless
 * of whether the repo has 200 files or 20,000.
 */

import type { AgentRuntime, ModuleSpec, SwarmEvent } from '../types.js';
import { collectAgent, type AgentOutcome } from '../runtime/collect.js';
import { isOwned } from '../swarm/ownership.js';
import { standaloneSystemPrompt } from '../runtime/system-tier.js';
import { buildDigest, renderDigest, type RepoDigest } from './digest.js';

export const MODULE_MAP_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['system', 'modules'],
  properties: {
    system: {
      type: 'object',
      additionalProperties: false,
      required: ['summary', 'stack'],
      properties: {
        summary: {
          type: 'string',
          description: 'Two or three sentences: what this system does, for whom.',
        },
        stack: { type: 'string', description: 'Primary languages, frameworks and runtimes.' },
      },
    },
    modules: {
      type: 'array',
      minItems: 2,
      maxItems: 12,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['slug', 'name', 'purpose', 'owns', 'entryPoints', 'dependsOn'],
        properties: {
          // No `pattern` here on purpose. A regex constraint makes the model
          // retry the whole structured output when it emits `reel_core` instead
          // of `reel-core`, and each retry re-sends the conversation. Slugs are
          // normalized in code below instead, which costs nothing.
          slug: { type: 'string' },
          name: { type: 'string' },
          purpose: { type: 'string' },
          owns: {
            type: 'array',
            minItems: 1,
            items: { type: 'string' },
            description: 'Glob patterns relative to the repo root.',
          },
          entryPoints: { type: 'array', items: { type: 'string' } },
          dependsOn: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
} as const;

export interface ModuleMapResult {
  system: { summary: string; stack: string };
  modules: ModuleSpec[];
  digest: RepoDigest;
  outcome: AgentOutcome;
}

const MAPPER_CHARTER = `You are the Swarm OS mapper.

You decompose a repository into MODULES: durable domain boundaries that agent
teams can own independently. A good module map is the difference between an
agent loading 5% of a codebase and an agent loading all of it.

Rules:
- Modules are DOMAINS, not layers. "billing", "rendering", "auth" — not
  "components", "utils", "helpers".
- Every module must be ownable by one small team of agents without needing to
  read the others. If two proposed modules would constantly need each other's
  source, merge them.
- Ownership globs must partition the repo's meaningful source. Overlap is a bug:
  two swarms editing the same files will conflict in their worktrees.
- Prefer 4-8 modules. Fewer than 4 means you have not decomposed anything;
  more than 10 means the boundaries are too fine to be worth waking separately.
- Split oversized directories. A single directory holding most of the repo is a
  signal to look inside it for domains, not to make it one module.
- Include a module for shared infrastructure only if real shared code exists.
- Tests, fixtures and docs belong to the module they exercise, not to a
  separate "tests" module.

You receive only a structural digest — file counts, directory shapes, manifests
and documentation headings. You never see source code. Infer domains from names,
sizes and documentation. Say so in the purpose when you are inferring.`;

export function buildMapperPrompt(digest: RepoDigest): string {
  return [
    renderDigest(digest),
    '',
    '---',
    '',
    'Propose the module map for this repository.',
    '',
    'For each module give: a kebab-case slug, a human name, a one-or-two sentence',
    'purpose, the glob patterns it owns, the files an agent should read first when',
    'waking into it, and which other modules it depends on.',
    '',
    'Ownership globs must be relative to the repo root and must not overlap',
    'between modules.',
  ].join('\n');
}

export async function mapRepository(options: {
  runtime: AgentRuntime;
  repoRoot: string;
  model?: string;
  onEvent?: (event: SwarmEvent) => void | Promise<void>;
  signal?: AbortSignal;
}): Promise<ModuleMapResult> {
  const digest = await buildDigest(options.repoRoot);

  const outcome = await collectAgent(
    options.runtime,
    {
      id: 'mapper',
      role: 'mapper',
      prompt: buildMapperPrompt(digest),
      // Tool-less: replace Claude Code's default prompt rather than append to it.
      systemPromptOverride: standaloneSystemPrompt(MAPPER_CHARTER),
      cwd: options.repoRoot,
      // No tools at all: the mapper must not be able to start reading the repo.
      tools: [],
      ...(options.model ? { model: options.model } : {}),
      permissionMode: 'dontAsk',
      jsonSchema: MODULE_MAP_SCHEMA,
      lean: true,
      ephemeral: true,
    },
    options.onEvent,
    options.signal,
  );

  let parsed = parseModuleMap(outcome.structured);
  if (!parsed) {
    throw new Error(
      outcome.error ?? 'mapper did not return a usable module map (no structured output)',
    );
  }

  // A module owning zero files is useless, and it is detectable for free — so
  // never accept one. The partitioner sees only structure, so it can invent a
  // path that does not exist; showing it exactly which globs matched nothing,
  // alongside the real paths, fixes it in one cheap round.
  let repair = outcome;
  const emptyIn = (map: { modules: ModuleSpec[] }): ModuleSpec[] =>
    map.modules.filter((m) => countFiles(digest, m.owns) === 0);

  const unmatched = emptyIn(parsed);
  if (unmatched.length > 0) {
    repair = await collectAgent(
      options.runtime,
      {
        id: 'mapper-repair',
        role: 'mapper',
        prompt: [
          buildMapperPrompt(digest),
          '',
          '---',
          '',
          '# Your previous answer had modules that own nothing',
          '',
          'These globs matched zero files in the repository:',
          '',
          ...unmatched.flatMap((m) => [`- \`${m.slug}\``, ...m.owns.map((g) => `    ${g}`)]),
          '',
          'Every path you write must exist. The file list above is complete and',
          'authoritative — do not infer paths from names.',
          '',
          'Produce the whole map again, corrected.',
        ].join('\n'),
        systemPromptOverride: standaloneSystemPrompt(MAPPER_CHARTER),
        cwd: options.repoRoot,
        tools: [],
        ...(options.model ? { model: options.model } : {}),
        permissionMode: 'dontAsk',
        jsonSchema: MODULE_MAP_SCHEMA,
        lean: true,
        ephemeral: true,
      },
      options.onEvent,
      options.signal,
    );
    const repaired = parseModuleMap(repair.structured);
    // Only accept the repair if it is actually better.
    if (repaired && emptyIn(repaired).length < unmatched.length) parsed = repaired;
  }

  // Whatever survives, drop modules that still own nothing rather than create
  // an empty directory for them.
  parsed = { ...parsed, modules: parsed.modules.filter((m) => countFiles(digest, m.owns) > 0) };
  if (parsed.modules.length === 0) {
    throw new Error('every proposed module owned zero files — the map is unusable');
  }

  // Attach file counts from the digest so `swarm status` can show module sizes
  // without re-walking the repo.
  const modules = parsed.modules.map((m) => ({
    ...m,
    fileCount: countFiles(digest, m.owns),
  }));

  return { system: parsed.system, modules, digest, outcome: repair };
}

function parseModuleMap(
  raw: unknown,
): { system: { summary: string; stack: string }; modules: ModuleSpec[] } | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const obj = raw as Record<string, unknown>;
  const system = obj['system'];
  const modules = obj['modules'];
  if (!Array.isArray(modules) || modules.length === 0) return undefined;

  const specs: ModuleSpec[] = [];
  const seen = new Set<string>();
  for (const entry of modules) {
    if (typeof entry !== 'object' || entry === null) continue;
    const m = entry as Record<string, unknown>;
    const slug = typeof m['slug'] === 'string' ? slugify(m['slug']) : undefined;
    // A duplicate slug would make two modules share a directory and overwrite
    // each other's memory.
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    specs.push({
      slug,
      name: typeof m['name'] === 'string' ? m['name'] : slug,
      purpose: typeof m['purpose'] === 'string' ? m['purpose'] : '',
      owns: asStringArray(m['owns']),
      entryPoints: asStringArray(m['entryPoints']),
      dependsOn: asStringArray(m['dependsOn']),
    });
  }
  if (specs.length === 0) return undefined;

  const sys =
    typeof system === 'object' && system !== null
      ? (system as Record<string, unknown>)
      : {};

  return {
    system: {
      summary: typeof sys['summary'] === 'string' ? sys['summary'] : '',
      stack: typeof sys['stack'] === 'string' ? sys['stack'] : '',
    },
    modules: specs,
  };
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/** Normalize a proposed slug into a safe directory name. */
export function slugify(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

/** Exact file count for a module, by matching its globs against the file list. */
function countFiles(digest: RepoDigest, globs: string[]): number {
  return digest.files.filter((f) => isOwned(f, globs)).length;
}

/** The prose charter written to `.swarm/modules/<slug>/module.md`. */
export function renderModuleCharter(spec: ModuleSpec, systemSummary: string): string {
  return [
    `# ${spec.name}`,
    '',
    spec.purpose,
    '',
    '## Owns',
    '',
    ...spec.owns.map((g) => `- \`${g}\``),
    '',
    '## Read first',
    '',
    ...(spec.entryPoints.length > 0
      ? spec.entryPoints.map((f) => `- \`${f}\``)
      : ['_No entry points recorded._']),
    '',
    '## Depends on',
    '',
    ...(spec.dependsOn.length > 0
      ? spec.dependsOn.map((d) => `- ${d}`)
      : ['_Nothing — this module stands alone._']),
    '',
    '## System context',
    '',
    systemSummary || '_Not recorded._',
    '',
    '---',
    '',
    '_Generated by `swarm map`. Edit freely — `swarm map` will not overwrite your',
    'changes without `--force`, and never touches memory.md or decisions.md._',
    '',
  ].join('\n');
}

/** The top-level map written to `.swarm/system.md`. */
export function renderSystemMap(
  system: { summary: string; stack: string },
  modules: ModuleSpec[],
  digest: RepoDigest,
): string {
  return [
    `# ${digest.repoName}`,
    '',
    system.summary,
    '',
    `**Stack.** ${system.stack}`,
    '',
    `**Size.** ${digest.totalFiles} tracked files across ${modules.length} modules.`,
    '',
    '## Modules',
    '',
    '| Module | Purpose | Owns | Files |',
    '| --- | --- | --- | --- |',
    ...modules.map(
      (m) =>
        `| \`${m.slug}\` | ${m.purpose.replace(/\|/g, '\\|')} | ${m.owns
          .map((g) => `\`${g}\``)
          .join(' ')} | ${m.fileCount ?? '—'} |`,
    ),
    '',
    '## Dependencies',
    '',
    '```',
    ...modules.flatMap((m) =>
      m.dependsOn.length > 0 ? m.dependsOn.map((d) => `${m.slug} → ${d}`) : [`${m.slug}`],
    ),
    '```',
    '',
    '---',
    '',
    `_Generated by \`swarm map\` from a structural digest (fingerprint \`${digest.hash}\`)._`,
    '_No source code was read to produce this map._',
    '',
  ].join('\n');
}
