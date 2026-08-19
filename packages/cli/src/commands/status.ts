/**
 * `swarm status` — what exists, what is awake, and what it costs.
 *
 * The number that matters is the memory column: the total context a mission
 * would load, versus the size of the repository it stands in for.
 */

import { detectDrift, estimateTokens, type ModuleSpec } from '@swarm-os/core';

import type { ParsedArgs } from '../args.js';
import { loadContext } from '../context.js';
import { c, clip, formatTokens, heading, line, note, pad, symbols, table, warn } from '../ui.js';

export async function statusCommand(args: ParsedArgs): Promise<number> {
  const { workspace, config } = await loadContext(args, { requireMapped: true });

  const modules = await workspace.listModules();
  const system = await workspace.readSystem();

  heading(workspace.repoRoot);
  const summary = firstLine(system);
  if (summary) note(summary);

  // -- swarms ---------------------------------------------------------------
  heading('Swarms');

  const rows: string[][] = [];
  const moduleAreas: { slug: string; areas: { name: string; tokens: number }[] }[] = [];
  let awake = 0;
  let totalMemory = 0;
  let totalFiles = 0;

  for (const spec of modules) {
    const record = await workspace.swarmRecord(spec.slug);
    const isAwake = record.state === 'active' || record.state === 'waking';
    if (isAwake) awake += 1;
    totalMemory += record.memoryTokens ?? 0;
    totalFiles += spec.fileCount ?? 0;

    const mark = isAwake ? c.green(symbols.active) : c.gray(symbols.sleeping);
    const state =
      record.state === 'active'
        ? c.green('active')
        : record.state === 'compressing'
          ? c.yellow('compressing')
          : c.gray('sleeping');

    const areaSlugs = await workspace.listAreas(spec.slug);
    if (areaSlugs.length > 0) {
      const areas = await Promise.all(
        areaSlugs.map(async (name) => ({
          name,
          tokens: estimateTokens(await workspace.readAreaFile(spec.slug, name)),
        })),
      );
      moduleAreas.push({ slug: spec.slug, areas });
    }
    rows.push([
      `${mark} ${c.bold(pad(spec.slug, 20))}`,
      state,
      String(spec.fileCount ?? '—'),
      formatTokens(record.memoryTokens) + (areaSlugs.length > 0 ? c.gray(` +${areaSlugs.length}a`) : ''),
      c.gray(clip(record.lastMission ?? '—', 34)),
    ]);
  }

  table(rows, { head: ['  module', 'state', 'files', 'memory', 'last mission'] });

  if (moduleAreas.length > 0) {
    for (const m of moduleAreas) {
      const detail = m.areas.map((a) => `${a.name}: ${formatTokens(a.tokens)} tok`).join(', ');
      note(`    ${c.bold(m.slug)} — ${m.areas.length} areas — ${detail}`);
    }
  }

  line();
  line(
    `  ${modules.length} modules · ${awake} awake · ${modules.length - awake} sleeping · ` +
      `${formatTokens(totalMemory)} tokens of memory across ${totalFiles} files`,
  );
  note(
    `  A mission touching one module loads roughly ${formatTokens(
      Math.round(totalMemory / Math.max(modules.length, 1)),
    )} tokens of context, not the whole repo.`,
  );

  // -- drift ----------------------------------------------------------------
  const drift = await detectDrift(workspace);
  if (drift.drifted) {
    line();
    warn(
      `${drift.changedModules.length} module(s) changed since mapping: ${drift.changedModules.join(', ') || '—'}`,
    );
    note('  Run `swarm map` to re-survey just those. Unchanged modules keep their memory.');
  }

  // -- missions -------------------------------------------------------------
  const missions = await workspace.listMissions();
  if (missions.length > 0) {
    heading('Recent missions');
    const missionRows = missions.slice(0, 8).map((m) => {
      const mark =
        m.status === 'review' || m.status === 'done'
          ? c.green(symbols.ok)
          : m.status === 'partial'
            ? c.yellow('◐')
            : m.status === 'failed'
              ? c.red(symbols.fail)
              : c.gray(symbols.bullet);
      const violations = Object.values(m.agents).reduce(
        (sum, a) => sum + (a.ownershipViolations?.length ?? 0),
        0,
      );
      return [
        `${mark} ${pad(m.id, 34)}`,
        m.status,
        m.modules.join(','),
        violations > 0 ? c.yellow(`${violations} out-of-bounds`) : '',
      ];
    });
    table(missionRows, { head: ['  mission', 'status', 'modules', ''] });
  }

  // -- config ---------------------------------------------------------------
  if (args.flags['verbose'] === true) {
    heading('Config');
    note(`  runtime            ${config.runtime}`);
    note(`  model              ${config.model}   (system: ${config.systemModel})`);
    note(`  max concurrent     ${config.maxConcurrentAgents} agents`);
    note(`  memory budget      ${config.memoryBudgetTokens} tokens per module`);
    note(`  permission mode    ${config.permissionMode}`);
  }

  line();
  return 0;
}

function firstLine(markdown: string): string {
  for (const raw of markdown.split('\n')) {
    const l = raw.trim();
    if (l && !l.startsWith('#')) return clip(l, 100);
  }
  return '';
}

/** `swarm memory <module>` — print what a swarm knows. */
export async function memoryCommand(args: ParsedArgs): Promise<number> {
  const { workspace } = await loadContext(args, { requireMapped: true });
  const slug = args.positionals[0];

  if (!slug) {
    const modules = await workspace.listModules();
    heading('Memory');
    const rows = await Promise.all(
      modules.map(async (m: ModuleSpec) => {
        const memory = await workspace.readModuleFile(m.slug, 'memory.md');
        return [`  ${c.bold(pad(m.slug, 22))}`, formatTokens(estimateTokens(memory))];
      }),
    );
    table(rows, { head: ['  module', 'tokens'] });
    line();
    note('  `swarm memory <module>` to read one.');
    line();
    return 0;
  }

  const memory = await workspace.readModuleFile(slug, 'memory.md');
  if (!memory) {
    warn(`no memory recorded for \`${slug}\``);
    return 1;
  }
  line();
  line(memory);
  return 0;
}
