/**
 * `swarm map [path]` — understand a repository as a set of modules.
 *
 * Runs the full pipeline: deterministic digest, then a partitioner that sees
 * only that digest, then one analyst agent per module reading only its own
 * paths, in parallel. Re-running is incremental — unchanged modules keep their
 * accumulated memory and are not re-read.
 */

import { resolve } from 'node:path';

import {
  DEFAULT_CONFIG,
  Workspace,
  detectDrift,
  isGitRepo,
  mapProject,
  type MapProgress,
  type MapResult,
} from '@swarm-os/core';

import { flagBool, type ParsedArgs } from '../args.js';
import { applyOverrides, assertRuntimeReady, buildRuntime, UserError } from '../context.js';
import { LiveBoard, c, clip, formatTokens, heading, line, note, ok, pad, symbols, table, warn } from '../ui.js';

export async function mapCommand(args: ParsedArgs): Promise<number> {
  const target = resolve(args.positionals[0] ?? process.cwd());
  const workspace = new Workspace(target);

  const existing = workspace.exists;
  const config = applyOverrides(
    existing ? await workspace.readConfig() : { ...DEFAULT_CONFIG },
    args,
  );
  const runtime = buildRuntime(config, args);
  await assertRuntimeReady(runtime);

  if (!(await isGitRepo(target))) {
    warn('not a git repository — mapping will work, but missions cannot isolate agents in worktrees');
  }

  const force = flagBool(args.flags, 'force');
  const repartition = flagBool(args.flags, 'repartition') || force;

  if (existing && !force && !repartition) {
    const drift = await detectDrift(workspace);
    if (!drift.drifted) {
      note(`Already mapped and unchanged since ${drift.mappedAt?.slice(0, 10) ?? 'last run'}.`);
      note('Nothing to re-analyse. Use --force to redo everything, --repartition to redraw boundaries.');
      await printMap(workspace);
      return 0;
    }
    note(
      `${drift.changedModules.length} module(s) changed since mapping — re-analysing only those.`,
    );
  }

  // Persist config first so the project is usable even if mapping is interrupted.
  await workspace.writeConfig(config);

  heading(`Mapping ${c.bold(target)}`);

  const board = new LiveBoard();
  const moduleRows = new Map<string, { status: string; detail: string }>();
  let phaseLine = '';

  const paintPhase = (text: string): void => {
    phaseLine = text;
    board.set('__phase', `${c.cyan(board.spinner())} ${text}`);
  };

  const paintModule = (slug: string): void => {
    const row = moduleRows.get(slug);
    if (!row) return;
    const mark =
      row.status === 'done'
        ? c.green(symbols.ok)
        : row.status === 'failed'
          ? c.red(symbols.fail)
          : row.status === 'reused'
            ? c.gray(symbols.sleeping)
            : c.cyan(board.spinner());
    board.set(`m:${slug}`, `  ${mark} ${pad(slug, 22)} ${c.gray(row.detail)}`);
  };

  board.start();

  const onProgress = (p: MapProgress): void => {
    if (p.module) {
      const status =
        p.message === 'surveyed' ? 'done' : p.message === 'survey failed' ? 'failed' : 'working';
      moduleRows.set(p.module, {
        status,
        detail:
          status === 'working'
            ? 'reading its own paths…'
            : status === 'done'
              ? 'surveyed'
              : 'survey failed',
      });
      paintModule(p.module);
      if (p.total) paintPhase(`analysing modules  ${p.done ?? 0}/${p.total}`);
      return;
    }
    paintPhase(`${p.phase}  ${c.gray(clip(p.message, 70))}`);
  };

  let result: MapResult;
  try {
    result = await mapProject({
      runtime,
      workspace,
      config,
      force,
      repartition,
      onProgress,
    });
  } catch (err) {
    board.stop();
    throw err instanceof Error ? new UserError(err.message) : err;
  }

  board.set('__phase', `${c.green(symbols.ok)} ${phaseLine.replace(/^\S+\s/, '')}`);
  board.stop();

  await printMapResult(workspace, result);
  return result.modules.some((m) => m.status === 'failed') ? 1 : 0;
}

async function printMapResult(workspace: Workspace, result: MapResult): Promise<void> {
  heading(`${result.repoName} — ${result.modules.length} modules, ${result.totalFiles} files`);

  const rows = result.modules.map((m) => {
    const mark =
      m.status === 'analysed'
        ? c.green(symbols.ok)
        : m.status === 'reused'
          ? c.gray(symbols.sleeping)
          : c.red(symbols.fail);
    return [
      `${mark} ${c.bold(m.spec.slug)}`,
      String(m.spec.fileCount ?? '—'),
      formatTokens(m.memoryTokens),
      c.gray(clip(m.error ?? m.spec.purpose, 58)),
    ];
  });

  table(rows, { head: ['  module', 'files', 'memory', 'purpose'] });

  // Two swarms claiming the same file would edit it in separate worktrees,
  // which is the one thing this design cannot merge for you.
  line();
  if (result.conflicts.length > 0) {
    warn(`${result.conflicts.length} pair(s) of modules claim the same files:`);
    for (const conflict of result.conflicts.slice(0, 6)) {
      note(`  ${conflict.a} ↔ ${conflict.b}  (${conflict.count} files)`);
      for (const file of conflict.files) note(`      ${file}`);
    }
    note('  Edit the `owns` globs in .swarm/modules/<slug>/ownership.yaml.');
    line();
  }

  if (result.archived.length > 0) {
    note(`  archived ${result.archived.length} module(s) no longer in the map:`);
    note(`    ${result.archived.join(', ')}`);
    note(`    their memory is preserved under .swarm/archive/`);
    line();
  }

  const analysed = result.modules.filter((m) => m.status === 'analysed').length;
  const reused = result.modules.filter((m) => m.status === 'reused').length;

  ok(
    `${analysed} module${analysed === 1 ? '' : 's'} surveyed` +
      (reused > 0 ? `, ${reused} unchanged and preserved` : ''),
  );
  note(`  Every swarm is asleep. Total memory on disk: ${formatTokens(result.totalMemoryTokens)} tokens.`);
  note(`  That is what a mission loads — not the ${result.totalFiles} files.`);
  line();
  note(`  ${workspace.rel(workspace.root)}/`);
  note(`    system.md            the map`);
  note(`    modules/<slug>/      charter, memory, decisions, ownership`);
  line();
  note('Next: `swarm status` to see the swarms, or `swarm mission "<goal>"` to put them to work.');
  line();
}

/** Summary shown when there is nothing to re-map. */
async function printMap(workspace: Workspace): Promise<void> {
  const modules = await workspace.listModules();
  line();
  const rows = await Promise.all(
    modules.map(async (m) => {
      const record = await workspace.swarmRecord(m.slug);
      return [
        `${c.gray(symbols.sleeping)} ${c.bold(m.slug)}`,
        String(m.fileCount ?? '—'),
        formatTokens(record.memoryTokens),
        c.gray(clip(m.purpose, 58)),
      ];
    }),
  );
  table(rows, { head: ['  module', 'files', 'memory', 'purpose'] });
  line();
}
