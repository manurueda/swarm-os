/**
 * `swarm refactor [module]` — is this code organised well enough to work in?
 *
 * Deterministic signals locate the suspects; a reviewer agent per module reads
 * them and decides which are real. Proposals only — nothing is changed.
 */

import {
  Scheduler,
  computeSignals,
  countLines,
  buildImportGraph,
  buildDigest,
  extractClaims,
  renderRefactorReport,
  reviewModuleStructure,
  estimateTokens,
  type ModuleRefactorReport,
  type Signal,
} from '@swarm-os/core';

import { flagBool, type ParsedArgs } from '../args.js';
import { assertRuntimeReady, loadContext, UserError } from '../context.js';
import { LiveBoard, c, heading, line, note, ok, pad, symbols, table } from '../ui.js';

export async function refactorCommand(args: ParsedArgs): Promise<number> {
  const { workspace, runtime, config } = await loadContext(args, { requireMapped: true });

  const signalsOnly = flagBool(args.flags, 'signals-only');
  if (!signalsOnly) await assertRuntimeReady(runtime);

  const requested = args.positionals[0];
  const all = await workspace.listModules();
  const targets = requested ? all.filter((m) => m.slug === requested) : all;
  if (requested && targets.length === 0) throw new UserError(`unknown module \`${requested}\``);

  // -- deterministic pass ---------------------------------------------------
  heading('Structural signals');
  note('Computed from the file list and line counts. No agents, no tokens.');
  line();

  const digest = await buildDigest(workspace.repoRoot);
  const stats = await countLines(workspace.repoRoot, digest.files);
  const imports = await buildImportGraph(workspace.repoRoot, digest.files, all);

  const memory: Record<string, { tokens: number; landmarks: number }> = {};
  for (const spec of all) {
    const text = await workspace.readModuleFile(spec.slug, 'memory.md');
    memory[spec.slug] = {
      tokens: estimateTokens(text),
      landmarks: extractLandmarkCount(text),
    };
  }

  const analysis = computeSignals({
    modules: all,
    files: digest.files,
    memory,
    memoryBudget: config.memoryBudgetTokens,
    stats,
    imports,
  });

  if (analysis.signals.length === 0) {
    ok('nothing flagged');
  } else {
    for (const s of analysis.signals) {
      const mark =
        s.severity === 'high'
          ? c.red(symbols.fail)
          : s.severity === 'warn'
            ? c.yellow(symbols.warn)
            : c.gray(symbols.bullet);
      line(`  ${mark} ${c.gray(pad(s.kind, 20))} ${s.summary}`);
    }
  }

  line();
  line(
    `  ${digest.totalFiles} files · ${stats.length} code files · ` +
      `${Math.round(analysis.coverage * 100)}% owned by a module`,
  );
  note(
    `  ${imports.edges.length} cross-module import edge(s) from ${imports.scanned} scanned files` +
      ` · ${imports.unresolved} external imports ignored`,
  );

  if (signalsOnly) {
    line();
    note('  Run without --signals-only to have each module reviewed by an agent.');
    line();
    return 0;
  }

  // -- agent review ---------------------------------------------------------
  heading('Reviewing');
  note('Each module gets an agent that reads the flagged files and judges them.');
  line();

  const board = new LiveBoard();
  const paint = (slug: string, state: string, detail = ''): void => {
    const mark =
      state === 'done'
        ? c.green(symbols.ok)
        : state === 'failed'
          ? c.red(symbols.fail)
          : c.cyan(board.spinner());
    board.set(slug, `  ${mark} ${pad(slug, 24)} ${c.gray(detail)}`);
  };
  board.start();

  const scheduler = new Scheduler({
    limit: config.maxConcurrentAgents,
    pauseOnStatus: config.pauseOnRateLimitStatus,
  });

  const results = await scheduler.run(
    targets.map((spec) => async (): Promise<ModuleRefactorReport> => {
      const mine = analysis.signals.filter((s) => s.module === spec.slug);
      paint(spec.slug, 'working', `${mine.length} signal(s) to check…`);
      const report = await reviewModuleStructure({
        runtime,
        repoRoot: workspace.repoRoot,
        module: spec,
        signals: mine,
        memory: await workspace.readModuleFile(spec.slug, 'memory.md'),
        ...(config.systemModel ? { model: config.systemModel } : {}),
        onEvent: (e) => scheduler.observe(e),
      });
      paint(
        spec.slug,
        report.error ? 'failed' : 'done',
        report.error ?? `${report.verdict} · ${report.proposals.length} proposal(s)`,
      );
      return report;
    }),
  );

  board.stop();

  const reports = results.filter((r): r is ModuleRefactorReport => !(r instanceof Error));

  // -- summary --------------------------------------------------------------
  heading('Verdicts');
  table(
    reports.map((r) => {
      const v =
        r.verdict === 'healthy'
          ? c.green('healthy')
          : r.verdict === 'workable'
            ? c.yellow('workable')
            : c.red('needs restructuring');
      return [
        `  ${c.bold(pad(r.module, 24))}`,
        v,
        `${r.proposals.length} proposal${r.proposals.length === 1 ? '' : 's'}`,
        r.falsePositives.length > 0 ? c.gray(`${r.falsePositives.length} false positive(s)`) : '',
      ];
    }),
  );

  const proposals = reports
    .flatMap((r) => r.proposals.map((p) => ({ module: r.module, ...p })))
    .sort((a, b) => rank(a.severity) - rank(b.severity));

  if (proposals.length > 0) {
    heading(`${proposals.length} proposal(s)`);
    for (const p of proposals.slice(0, 10)) {
      const sev =
        p.severity === 'high' ? c.red('high') : p.severity === 'medium' ? c.yellow('med') : c.gray('low');
      line(`  ${sev}  ${c.bold(p.title)}`);
      note(`       ${c.gray(p.module)} · ${p.effort}`);
      for (const l of wrap(p.problem, 88)) note(`       ${l}`);
      for (const l of wrap(`→ ${p.change}`, 88)) note(`       ${c.cyan(l)}`);
      line();
    }
    if (proposals.length > 10) note(`  … and ${proposals.length - 10} more in the report`);
  } else {
    line();
    ok('no structural changes proposed');
  }

  const falsePositives = reports.flatMap((r) => r.falsePositives);
  if (falsePositives.length > 0) {
    heading(`${falsePositives.length} signal(s) that were not real problems`);
    for (const f of falsePositives.slice(0, 8)) {
      for (const [i, l] of wrap(f, 92).entries()) note(`  ${i === 0 ? symbols.bullet : ' '} ${l}`);
    }
  }

  // Persist the structured form too. Re-parsing rendered markdown to recover
  // data you already had is fragile, and the UI was doing exactly that.
  await workspace.writeSystemFile(
    'refactor.json',
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        modules: reports,
        signals: analysis.signals,
      },
      null,
      2,
    )}\n`,
  );

  await workspace.writeSystemFile(
    'REFACTOR.md',
    renderRefactorReport(
      digest.repoName,
      reports,
      analysis.signals,
      new Date().toISOString().slice(0, 10),
    ),
  );

  line();
  note(`  Full report: ${workspace.rel(workspace.root)}/REFACTOR.md`);
  note('  Nothing was changed. Turn a proposal into work with `swarm mission "<title>"`.');
  line();

  return reports.some((r) => r.verdict === 'needs-restructuring') ? 1 : 0;
}

function rank(severity: 'high' | 'medium' | 'low'): number {
  return severity === 'high' ? 0 : severity === 'medium' ? 1 : 2;
}

/** Landmarks in a memory file stand in for how many sub-domains it holds. */
function extractLandmarkCount(memory: string): number {
  let inSection = false;
  let count = 0;
  for (const raw of memory.split('\n')) {
    const l = raw.trim();
    const heading = /^##\s+(.+)$/.exec(l);
    if (heading) {
      inSection = (heading[1] ?? '').toLowerCase().startsWith('landmark');
      continue;
    }
    if (inSection && l.startsWith('- ')) count += 1;
  }
  // Fall back to counting claims when the file predates the section layout.
  return count > 0 ? count : Math.min(extractClaims(memory).length, 12);
}

function wrap(text: string, width: number): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (current && current.length + word.length + 1 > width) {
      lines.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) lines.push(current);
  return lines;
}
