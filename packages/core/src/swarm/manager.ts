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
import { estimateTokens, Workspace } from '../workspace/store.js';
import { renderAreaIndex, type AreaSpec } from './areas.js';
import { splitAreaSections } from './area-memory.js';
import { readMemoryState } from './memory-state.js';
import { shouldSkipCompression } from './compression-budget.js';
import { buildCompressorPrompt } from './compressor-prompt.js';
import { runCompressorAgent } from './compressor-agent.js';
import { fileAreaSections } from './file-area-sections.js';
import { writeMemoryAndUpdateState } from './finalize-sleep.js';

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

export interface ContextPackOptions {
  /** Every file the module owns. Included verbatim when small enough. */
  files?: string[];
  /** Project-wide code conventions, from config. */
  codeStyle?: string;
  /** Largest list worth including. 0 disables the index. */
  maxIndexFiles?: number;
}

export async function buildContextPack(
  workspace: Workspace,
  spec: ModuleSpec,
  options: ContextPackOptions = {},
): Promise<ContextPack> {
  const [system, charter, memory] = await Promise.all([
    workspace.readSystem(),
    workspace.readModuleFile(spec.slug, 'module.md'),
    workspace.readModuleFile(spec.slug, 'memory.md'),
  ]);

  const contracts = await dependencyContracts(workspace, spec);
  const areas = await areaIndex(workspace, spec);
  const index = fileIndex(options.files ?? [], options.maxIndexFiles ?? 160);
  const conventions = await workspace.readModuleFile(spec.slug, 'conventions.md');

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
    ...(index ? ['', index] : []),
    ...(areas ? ['', areas] : []),
    ...(contracts ? ['', contracts] : []),
    ...(options.codeStyle?.trim()
      ? ['', '# How this project wants code written', '', options.codeStyle.trim()]
      : []),
    ...(conventions.trim()
      ? ['', '# Conventions specific to this module', '', conventions.trim()]
      : []),
  ].join('\n');

  return { module: spec.slug, text, tokens: estimateTokens(text) };
}

/**
 * Every file the module owns, listed.
 *
 * Measured across two real missions: work agents spent 19% of their tool calls
 * on pure discovery — grep, find, ls, glob — answering "where is X" before they
 * could start. For a module of a hundred files that list costs about a thousand
 * tokens and removes the question entirely.
 *
 * Above the cap it is dropped rather than truncated: half a file list is worse
 * than none, because an agent cannot tell the difference between "not in this
 * module" and "cut off". A module too large to list is a module that wants
 * splitting — which is what the `memory-pressure` signal already says.
 */
function fileIndex(files: string[], maxFiles: number): string {
  if (maxFiles <= 0 || files.length === 0 || files.length > maxFiles) return '';
  return ['# Every file in this module', '', '```', ...files, '```'].join('\n');
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

  const { before, beforeTokens } = await readMemoryState(workspace, slug);

  // Nothing new happened and memory is already within budget — sleeping is
  // then just a state change, and should not cost a model call.
  if (shouldSkipCompression(options.missionReport, beforeTokens, budgetTokens)) {
    const record = await writeMemoryAndUpdateState(workspace, slug, undefined, beforeTokens);
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
  const areaSlugs = await workspace.listAreas(slug);
  const prompt = buildCompressorPrompt(
    spec,
    slug,
    budgetTokens,
    beforeTokens,
    areaSlugs,
    before,
    options.missionReport,
  );

  const outcome = await runCompressorAgent(
    options.runtime,
    slug,
    prompt,
    workspace.repoRoot,
    options.model,
    options.onEvent,
    options.signal,
  );

  let afterTokens = beforeTokens;
  let compressed = false;
  let note: string | undefined;
  let moduleMemory: string | undefined;

  const rewritten = stripFence(outcome.result ?? '');
  if (outcome.ok && rewritten.length > 40) {
    const split = splitAreaSections(rewritten);
    // File area-specific facts before writing the module file, so a crash
    // between the two loses nothing that was not already on disk.
    await fileAreaSections(workspace, slug, split.areas, areaSlugs);
    moduleMemory = ensureTrailingNewline(split.module);
    afterTokens = estimateTokens(split.module);
    compressed = true;
  } else {
    note = outcome.error ?? 'compressor returned nothing usable; memory left unchanged';
  }

  const record = await writeMemoryAndUpdateState(workspace, slug, moduleMemory, afterTokens);

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
