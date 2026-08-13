/**
 * Everything the UI needs, in one serializable object.
 *
 * Assembled here rather than in the renderer so the same snapshot can feed a
 * local HTML page today and an editor extension later without either of them
 * reaching into `.swarm/` themselves.
 */

import type { MissionRecord, ModuleSpec, SwarmRecord } from '../types.js';
import { Workspace, estimateTokens } from '../workspace/store.js';
import { buildDigest } from '../mapper/digest.js';
import { countLines, isCodeFile, isTestFile } from '../architecture/code-stats.js';
import { buildImportGraph, type ModuleEdge } from '../architecture/import-graph.js';
import { computeSignals, type Signal } from '../architecture/signals.js';
import { isOwned } from '../swarm/ownership.js';
import { extractClaims } from '../swarm/verify.js';
import type { Claim } from '../swarm/analyst.js';
import type { SwarmConfig } from '../workspace/config.js';

export interface ModuleView {
  slug: string;
  name: string;
  purpose: string;
  owns: string[];
  entryPoints: string[];
  /** Files matched by this module's globs. */
  files: number;
  codeFiles: number;
  testFiles: number;
  lines: number;
  /** Biggest files, for the "where is the mass" question. */
  largest: Array<{ path: string; lines: number }>;
  memoryTokens: number;
  state: SwarmRecord['state'];
  lastMission?: string;
  invariants: Claim[];
  gotchas: Claim[];
  landmarks: string[];
  signals: Signal[];
  /** Slugs this module imports from, and that import it. */
  importsFrom: Array<{ slug: string; count: number }>;
  importedBy: Array<{ slug: string; count: number }>;
  /** Worst signal severity affecting this module. */
  health: 'ok' | 'warn' | 'high';
  /** How many areas this module's memory is split into, if any. */
  areas: number;
}

/** A single structural-refactor proposal, from `.swarm/REFACTOR.md`. */
export interface ProposalView {
  /** Slug of the module this proposal was raised against. */
  module: string;
  title: string;
  problem: string;
  change: string;
  evidence: string[];
  severity: 'high' | 'medium' | 'low';
  effort: 'hours' | 'days' | 'weeks';
  risk?: string;
}

export interface UiSnapshot {
  repoName: string;
  repoRoot: string;
  generatedAt: string;
  totalFiles: number;
  codeFiles: number;
  totalLines: number;
  coverage: number;
  memoryTokens: number;
  memoryBudget: number;
  modules: ModuleView[];
  /** Signals not attached to any one module. */
  globalSignals: Signal[];
  edges: ModuleEdge[];
  cycles: string[][];
  unownedTop: Array<{ dir: string; files: number }>;
  missions: Array<Pick<MissionRecord, 'id' | 'goal' | 'status' | 'modules' | 'createdAt'>>;
  /** Open structural-refactor proposals, from the last `swarm refactor` run. */
  proposals: ProposalView[];
  config: { model: string; concurrency: number; runtime: string };
}

export async function buildSnapshot(
  workspace: Workspace,
  config: SwarmConfig,
): Promise<UiSnapshot> {
  const specs = await workspace.listModules();
  const digest = await buildDigest(workspace.repoRoot);
  const stats = await countLines(workspace.repoRoot, digest.files);
  const imports = await buildImportGraph(workspace.repoRoot, digest.files, specs);

  const linesByPath = new Map(stats.map((s) => [s.path, s.lines]));

  const memoryInput: Record<string, { tokens: number; landmarks: number }> = {};
  const memoryText = new Map<string, string>();
  for (const spec of specs) {
    const text = await workspace.readModuleFile(spec.slug, 'memory.md');
    memoryText.set(spec.slug, text);
    memoryInput[spec.slug] = { tokens: estimateTokens(text), landmarks: countLandmarks(text) };
  }

  const analysis = computeSignals({
    modules: specs,
    files: digest.files,
    memory: memoryInput,
    memoryBudget: config.memoryBudgetTokens,
    stats,
    imports,
  });

  const state = await workspace.readState();

  const modules: ModuleView[] = [];
  for (const spec of specs) {
    const owned = filesOwnedBy(spec, digest.files);
    const code = owned.filter(isCodeFile);
    const lines = code.reduce((sum, f) => sum + (linesByPath.get(f) ?? 0), 0);
    const text = memoryText.get(spec.slug) ?? '';
    const signals = analysis.signals.filter((s) => s.module === spec.slug);

    modules.push({
      slug: spec.slug,
      name: spec.name,
      purpose: spec.purpose,
      owns: spec.owns,
      entryPoints: spec.entryPoints,
      files: owned.length,
      codeFiles: code.length,
      testFiles: owned.filter(isTestFile).length,
      lines,
      largest: code
        .map((f) => ({ path: f, lines: linesByPath.get(f) ?? 0 }))
        .sort((a, b) => b.lines - a.lines)
        .slice(0, 6),
      memoryTokens: estimateTokens(text),
      state: state.swarms[spec.slug]?.state ?? 'sleeping',
      ...(state.swarms[spec.slug]?.lastMission
        ? { lastMission: state.swarms[spec.slug]?.lastMission }
        : {}),
      ...splitClaims(text),
      landmarks: extractSection(text, 'landmark'),
      signals,
      importsFrom: imports.edges
        .filter((e) => e.from === spec.slug)
        .map((e) => ({ slug: e.to, count: e.count })),
      importedBy: imports.edges
        .filter((e) => e.to === spec.slug)
        .map((e) => ({ slug: e.from, count: e.count })),
      health: worstSeverity(signals),
      areas: (await workspace.listAreas(spec.slug)).length,
    });
  }

  const unownedByDir = new Map<string, number>();
  for (const file of analysis.unowned) {
    const root = file.split('/')[0] ?? file;
    unownedByDir.set(root, (unownedByDir.get(root) ?? 0) + 1);
  }

  const missions = (await workspace.listMissions()).slice(0, 12).map((m) => ({
    id: m.id,
    goal: m.goal,
    status: m.status,
    modules: m.modules,
    createdAt: m.createdAt,
  }));

  const moduleSlugs = new Set(specs.map((s) => s.slug));
  // Prefer the structured artifact; fall back to parsing the report for
  // workspaces written before `swarm refactor` persisted JSON.
  const proposals = (
    (await readProposalsJson(workspace)) ??
    parseRefactorProposals(await workspace.readSystemFile('REFACTOR.md'))
  ).filter((p) => moduleSlugs.has(p.module));

  return {
    repoName: digest.repoName,
    repoRoot: workspace.repoRoot,
    generatedAt: new Date().toISOString(),
    totalFiles: digest.totalFiles,
    codeFiles: stats.length,
    totalLines: stats.reduce((sum, s) => sum + s.lines, 0),
    coverage: analysis.coverage,
    memoryTokens: modules.reduce((sum, m) => sum + m.memoryTokens, 0),
    memoryBudget: config.memoryBudgetTokens,
    modules: modules.sort((a, b) => b.files - a.files),
    globalSignals: analysis.signals.filter((s) => !s.module),
    edges: imports.edges,
    cycles: imports.cycles,
    unownedTop: [...unownedByDir.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([dir, files]) => ({ dir, files })),
    missions,
    proposals,
    config: {
      model: config.model,
      concurrency: config.maxConcurrentAgents,
      runtime: config.runtime,
    },
  };
}

function filesOwnedBy(spec: ModuleSpec, files: string[]): string[] {
  return files.filter((file) => isOwned(file, spec.owns));
}

function worstSeverity(signals: Signal[]): 'ok' | 'warn' | 'high' {
  if (signals.some((s) => s.severity === 'high')) return 'high';
  if (signals.some((s) => s.severity === 'warn')) return 'warn';
  return 'ok';
}

function countLandmarks(memory: string): number {
  return extractSection(memory, 'landmark').length;
}

/** Bullet lines under a section whose heading starts with `prefix`. */
function extractSection(memory: string, prefix: string): string[] {
  const out: string[] = [];
  let inside = false;
  for (const raw of memory.split('\n')) {
    const line = raw.trim();
    const heading = /^##\s+(.+)$/.exec(line);
    if (heading) {
      inside = (heading[1] ?? '').toLowerCase().startsWith(prefix);
      continue;
    }
    if (!inside || !line.startsWith('- ')) continue;
    const text = line.slice(2).trim();
    if (/^_.*_$/.test(text)) continue;
    out.push(text);
  }
  return out;
}

function splitClaims(memory: string): { invariants: Claim[]; gotchas: Claim[] } {
  const all = extractClaims(memory);
  // extractClaims walks both sections in order; re-split by scanning headings.
  const invariantTexts = new Set(extractSection(memory, 'invariant').map(stripCitation));
  return {
    invariants: all.filter((c) => invariantTexts.has(c.text)),
    gotchas: all.filter((c) => !invariantTexts.has(c.text)),
  };
}

function stripCitation(line: string): string {
  return line.replace(/\s*<sub>.*?<\/sub>\s*$/, '').trim();
}

/** Structured proposals, when `swarm refactor` has been run since this landed. */
async function readProposalsJson(workspace: Workspace): Promise<ProposalView[] | undefined> {
  const raw = await workspace.readSystemFile('refactor.json');
  if (!raw.trim()) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const modules = (parsed as Record<string, unknown>)['modules'];
    if (!Array.isArray(modules)) return undefined;
    return modules.flatMap((m) => {
      if (typeof m !== 'object' || m === null) return [];
      const r = m as Record<string, unknown>;
      const slug = typeof r['module'] === 'string' ? r['module'] : '';
      const list = Array.isArray(r['proposals']) ? r['proposals'] : [];
      return list.flatMap((p) => {
        if (typeof p !== 'object' || p === null) return [];
        const q = p as Record<string, unknown>;
        if (typeof q['title'] !== 'string') return [];
        return [
          {
            module: slug,
            title: q['title'],
            problem: typeof q['problem'] === 'string' ? q['problem'] : '',
            change: typeof q['change'] === 'string' ? q['change'] : '',
            evidence: Array.isArray(q['evidence'])
              ? q['evidence'].filter((e): e is string => typeof e === 'string')
              : [],
            severity: (q['severity'] === 'high' || q['severity'] === 'low'
              ? q['severity']
              : 'medium') as ProposalView['severity'],
            effort: (q['effort'] === 'hours' || q['effort'] === 'weeks'
              ? q['effort']
              : 'days') as ProposalView['effort'],
            ...(typeof q['risk'] === 'string' ? { risk: q['risk'] } : {}),
          },
        ];
      });
    });
  } catch {
    return undefined;
  }
}

/**
 * Recovers structured proposals from `.swarm/REFACTOR.md`, the markdown
 * rendered by `architecture/refactor.ts#renderRefactorReport`. There is no
 * structured artifact of `swarm refactor`'s output on disk, so the UI reads
 * back the one thing that is: its own report, in the exact shape that
 * function writes it in.
 */
function parseRefactorProposals(markdown: string): ProposalView[] {
  const start = markdown.indexOf('## Proposals');
  if (start === -1) return [];
  const afterHeading = markdown.slice(start + '## Proposals'.length);
  const end = afterHeading.search(/\n##\s/);
  const section = end === -1 ? afterHeading : afterHeading.slice(0, end);

  const proposals: ProposalView[] = [];
  for (const block of section.split(/\n###\s+/).slice(1)) {
    const lines = block.split('\n');
    const title = (lines[0] ?? '').trim();
    const paragraphs = lines
      .slice(1)
      .join('\n')
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter(Boolean);

    const meta = /^`([^`]+)`\s*·\s*\*\*(high|medium|low)\*\*\s*·\s*(hours|days|weeks)/.exec(
      paragraphs[0] ?? '',
    );
    if (!title || !meta) continue;
    const module = meta[1] ?? '';
    const rawSeverity = meta[2];
    const rawEffort = meta[3];
    const severity =
      rawSeverity === 'high' || rawSeverity === 'medium' || rawSeverity === 'low'
        ? rawSeverity
        : 'medium';
    const effort =
      rawEffort === 'hours' || rawEffort === 'days' || rawEffort === 'weeks' ? rawEffort : 'days';

    let problem = '';
    let change = '';
    let risk: string | undefined;
    let evidence: string[] = [];

    // `renderRefactorReport` puts the "**Evidence.**" label and its bullet
    // list in separate paragraphs (a blank line sits between them), so the
    // bullets have to be read off the paragraph that follows the label.
    let expectEvidence = false;
    for (const para of paragraphs.slice(1)) {
      if (expectEvidence) {
        evidence = para
          .split('\n')
          .map((l) => l.replace(/^-\s*/, '').trim())
          .filter(Boolean);
        expectEvidence = false;
      } else if (para.startsWith('**Costs today.**')) {
        problem = para.slice('**Costs today.**'.length).trim();
      } else if (para.startsWith('**Change.**')) {
        change = para.slice('**Change.**'.length).trim();
      } else if (para.startsWith('**Risk.**')) {
        risk = para.slice('**Risk.**'.length).trim();
      } else if (para.trim() === '**Evidence.**') {
        expectEvidence = true;
      }
    }

    proposals.push({
      module,
      title,
      problem,
      change,
      evidence,
      severity,
      effort,
      ...(risk ? { risk } : {}),
    });
  }
  return proposals;
}
