/**
 * Swarm lifecycle: wake, work, compress, sleep.
 *
 * A sleeping swarm is the point of this whole system. It holds no processes and
 * occupies no context window; everything it knows sits in `memory.md` on disk,
 * a couple of thousand tokens that can be reconstituted instantly. A repository
 * with twelve modules therefore costs almost nothing to keep mapped, and a
 * mission pays only for the modules it actually touches.
 *
 * Waking is reading a file. Sleeping is rewriting it, smaller.
 */

import type { AgentRuntime, ModuleSpec, SwarmEvent, SwarmRecord } from '../types.js';
import { collectAgent } from '../runtime/collect.js';
import { standaloneSystemPrompt } from '../runtime/system-tier.js';
import { estimateTokens, Workspace } from '../workspace/store.js';
import { renderAreaIndex, type AreaSpec } from './areas.js';

/**
 * The context an agent receives when it wakes into a module: the system's
 * one-paragraph shape, this module's charter, and this module's memory.
 * Deliberately nothing else — no sibling modules, no repo tree, no source.
 */
export interface ContextPack {
  module: string;
  text: string;
  tokens: number;
}

export async function buildContextPack(
  workspace: Workspace,
  spec: ModuleSpec,
): Promise<ContextPack> {
  const [system, charter, memory] = await Promise.all([
    workspace.readSystem(),
    workspace.readModuleFile(spec.slug, 'module.md'),
    workspace.readModuleFile(spec.slug, 'memory.md'),
  ]);

  const contracts = await dependencyContracts(workspace, spec);
  const areas = await areaIndex(workspace, spec);

  const text = [
    '# System context',
    '',
    summarizeSystem(system),
    '',
    '# Your module',
    '',
    charter.trim() || `## ${spec.name}\n\n${spec.purpose}`,
    '',
    '# What previous missions learned here',
    '',
    memory.trim() || '_Nothing recorded yet — you are the first agent in this module._',
    ...(areas ? ['', areas] : []),
    ...(contracts ? ['', contracts] : []),
  ].join('\n');

  return { module: spec.slug, text, tokens: estimateTokens(text) };
}

/**
 * The area index for a module, if it has been split.
 *
 * Only the index — paths and file counts. Loading every area's memory here
 * would rebuild the exact problem areas exist to solve.
 */
async function areaIndex(workspace: Workspace, spec: ModuleSpec): Promise<string> {
  const slugs = await workspace.listAreas(spec.slug);
  if (slugs.length === 0) return '';

  const areas: AreaSpec[] = [];
  for (const slug of slugs) {
    const meta = await workspace.readAreaFile(spec.slug, slug, 'area.json');
    try {
      const parsed: unknown = JSON.parse(meta);
      if (typeof parsed === 'object' && parsed !== null) areas.push(parsed as AreaSpec);
    } catch {
      /* an area without metadata is skipped rather than guessed at */
    }
  }
  return renderAreaIndex(spec.slug, areas);
}

/**
 * The public interface of the modules this one depends on.
 *
 * Isolation has a sharp edge: an agent that cannot see another module will
 * invent its contract rather than admit it does not know. Observed directly —
 * an agent generating a CLI command for a sibling module produced
 * `swarm mission <module> "<goal>"` when the real syntax is
 * `swarm mission "<goal>" --modules <module>`. It never had the syntax and
 * guessed plausibly.
 *
 * So dependencies contribute their `Public interface` section — and only that
 * section, a few hundred tokens — to the context pack. Enough to call a
 * neighbour correctly, nowhere near enough to start working inside it.
 */
export async function dependencyContracts(
  workspace: Workspace,
  spec: ModuleSpec,
): Promise<string> {
  if (spec.dependsOn.length === 0) return '';

  const blocks: string[] = [];
  for (const slug of spec.dependsOn.slice(0, 5)) {
    if (slug === spec.slug) continue;
    const memory = await workspace.readModuleFile(slug, 'memory.md');
    const iface = sectionOf(memory, 'public interface');
    if (iface) blocks.push(`## \`${slug}\``, '', iface, '');
  }

  if (blocks.length === 0) return '';
  return [
    '# What you may rely on from other modules',
    '',
    'You cannot edit these and you cannot see their source. This is their',
    'published interface — use it exactly as written. If what you need is not',
    'here, say so in your report rather than guessing at it.',
    '',
    ...blocks,
  ].join('\n');
}

/** Body of the section whose heading starts with `prefix`, case-insensitive. */
function sectionOf(markdown: string, prefix: string): string {
  const lines = markdown.split('\n');
  const out: string[] = [];
  let inside = false;
  for (const raw of lines) {
    const heading = /^##\s+(.+)$/.exec(raw.trim());
    if (heading) {
      if (inside) break;
      inside = (heading[1] ?? '').toLowerCase().startsWith(prefix);
      continue;
    }
    if (inside && raw.trim()) out.push(raw);
  }
  return out.join('\n').trim();
}

/**
 * Take only the prose head of system.md — the summary and stack lines. The
 * module table and dependency graph are for humans; an agent scoped to one
 * module does not need the other eleven rows.
 */
function summarizeSystem(system: string): string {
  if (!system.trim()) return '_Not mapped._';
  const lines = system.split('\n');
  const stop = lines.findIndex((l) => /^##\s+Modules/i.test(l));
  return (stop === -1 ? lines : lines.slice(0, stop)).join('\n').trim();
}

// ---------------------------------------------------------------------------
// Wake / sleep
// ---------------------------------------------------------------------------

export async function wakeSwarm(
  workspace: Workspace,
  slug: string,
  missionId?: string,
): Promise<SwarmRecord> {
  return workspace.updateSwarm(slug, {
    state: 'active',
    lastActiveAt: new Date().toISOString(),
    ...(missionId ? { lastMission: missionId } : {}),
  });
}

export interface SleepResult {
  record: SwarmRecord;
  beforeTokens: number;
  afterTokens: number;
  compressed: boolean;
  note?: string;
}

const COMPRESSOR_CHARTER = `You are the Swarm OS memory compressor.

You rewrite one module's memory file so the next agent to wake into this module
starts as informed as possible for as few tokens as possible.

You will be given the existing memory, plus what just happened in a mission.
Produce the new memory file — not a diff, not a summary of your edits, the
complete replacement text.

Rules:
- Merge new knowledge in. Do not simply append; integrate.
- Delete anything the mission proved wrong.
- Delete anything a future agent could rediscover in ten seconds.
- Keep invariants and gotchas above everything else — they are the expensive
  knowledge, the kind that costs a wasted mission to relearn.
- Preserve the existing section structure exactly: Invariants, Gotchas,
  Landmarks, Public interface.
- Never exceed the stated token budget. If you must cut, cut landmarks first,
  then public interface. Never cut an invariant to fit.
- Write facts, not narrative. No "we decided", no "the agent found". Just what
  is true about this code.

Output the markdown file and nothing else.`;

export async function sleepSwarm(options: {
  workspace: Workspace;
  runtime: AgentRuntime;
  slug: string;
  /** Freeform account of what just happened, from the mission runner. */
  missionReport?: string;
  budgetTokens: number;
  model?: string;
  onEvent?: (event: SwarmEvent) => void | Promise<void>;
  signal?: AbortSignal;
}): Promise<SleepResult> {
  const { workspace, slug, budgetTokens } = options;

  const before = await workspace.readModuleFile(slug, 'memory.md');
  const beforeTokens = estimateTokens(before);

  // Nothing new happened and memory is already within budget — sleeping is
  // then just a state change, and should not cost a model call.
  if (!options.missionReport && beforeTokens <= budgetTokens) {
    const record = await workspace.updateSwarm(slug, {
      state: 'sleeping',
      memoryTokens: beforeTokens,
      lastActiveAt: new Date().toISOString(),
    });
    return {
      record,
      beforeTokens,
      afterTokens: beforeTokens,
      compressed: false,
      note: 'already within budget',
    };
  }

  await workspace.updateSwarm(slug, { state: 'compressing' });

  const spec = await workspace.readModule(slug);
  const prompt = [
    `# Module: ${spec?.name ?? slug} (\`${slug}\`)`,
    '',
    `Token budget for the new memory file: ${budgetTokens}.`,
    `The current file is roughly ${beforeTokens} tokens.`,
    '',
    '## Current memory',
    '',
    before.trim() || '_empty_',
    ...(options.missionReport
      ? ['', '## What just happened', '', options.missionReport.trim()]
      : []),
    '',
    '---',
    '',
    'Write the new memory file.',
  ].join('\n');

  const outcome = await collectAgent(
    options.runtime,
    {
      id: `compressor:${slug}`,
      role: 'compressor',
      module: slug,
      prompt,
      // The compressor returns markdown, not a structured payload.
      systemPromptOverride: standaloneSystemPrompt(COMPRESSOR_CHARTER, { structured: false }),
      cwd: workspace.repoRoot,
      tools: [],
      ...(options.model ? { model: options.model } : {}),
      permissionMode: 'dontAsk',
      lean: true,
      ephemeral: true,
    },
    options.onEvent,
    options.signal,
  );

  let afterTokens = beforeTokens;
  let compressed = false;
  let note: string | undefined;

  const rewritten = stripFence(outcome.result ?? '');
  if (outcome.ok && rewritten.length > 40) {
    await workspace.writeModuleFile(slug, 'memory.md', ensureTrailingNewline(rewritten));
    afterTokens = estimateTokens(rewritten);
    compressed = true;
  } else {
    note = outcome.error ?? 'compressor returned nothing usable; memory left unchanged';
  }

  const record = await workspace.updateSwarm(slug, {
    state: 'sleeping',
    memoryTokens: afterTokens,
    lastActiveAt: new Date().toISOString(),
  });

  return { record, beforeTokens, afterTokens, compressed, ...(note ? { note } : {}) };
}

function stripFence(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/.exec(trimmed);
  return (fenced?.[1] ?? trimmed).trim();
}

function ensureTrailingNewline(text: string): string {
  return text.endsWith('\n') ? text : `${text}\n`;
}

/** Put every active swarm back to sleep. Used when a mission ends or aborts. */
export async function sleepAll(
  workspace: Workspace,
  slugs: string[],
): Promise<void> {
  for (const slug of slugs) {
    await workspace.updateSwarm(slug, { state: 'sleeping', lastActiveAt: new Date().toISOString() });
  }
}
