/**
 * `swarm sleep [module]` / `swarm wake <module>` — manual swarm control.
 *
 * Mostly you never need these: missions wake and sleep swarms on their own.
 * They exist for the case where a mission was interrupted and left a swarm
 * marked active, and for compressing a module's memory on demand after you have
 * edited it by hand.
 */

import { sleepSwarm, wakeSwarm } from '@swarm-os/core';

import { flagBool, type ParsedArgs } from '../args.js';
import { assertRuntimeReady, loadContext, UserError } from '../context.js';
import { c, formatTokens, heading, line, note, ok, symbols, warn } from '../ui.js';

export async function sleepCommand(args: ParsedArgs): Promise<number> {
  const { workspace, runtime, config } = await loadContext(args, { requireMapped: true });

  const requested = args.positionals[0];
  const modules = await workspace.listModules();

  const targets = requested
    ? modules.filter((m) => m.slug === requested)
    : modules;

  if (requested && targets.length === 0) {
    throw new UserError(`unknown module \`${requested}\``);
  }

  // Compression costs a model call, so only reach for the runtime if asked.
  const compress = flagBool(args.flags, 'compress');
  if (compress) await assertRuntimeReady(runtime);

  heading(compress ? 'Compressing and sleeping' : 'Sleeping');

  for (const spec of targets) {
    const result = await sleepSwarm({
      workspace,
      runtime,
      slug: spec.slug,
      // Without a mission report the compressor only runs when over budget.
      budgetTokens: compress ? config.memoryBudgetTokens : Number.MAX_SAFE_INTEGER,
      ...(config.systemModel ? { model: config.systemModel } : {}),
    });

    const delta =
      result.compressed && result.beforeTokens !== result.afterTokens
        ? c.green(
            ` ${formatTokens(result.beforeTokens)} → ${formatTokens(result.afterTokens)} tokens`,
          )
        : c.gray(` ${formatTokens(result.afterTokens)} tokens`);

    line(`  ${c.gray(symbols.sleeping)} ${c.bold(spec.slug)}${delta}`);
    if (result.note && result.note !== 'already within budget') note(`    ${result.note}`);
  }

  line();
  ok(`${targets.length} swarm${targets.length === 1 ? '' : 's'} asleep — no processes, no context`);
  line();
  return 0;
}

export async function wakeCommand(args: ParsedArgs): Promise<number> {
  const { workspace } = await loadContext(args, { requireMapped: true });
  const slug = args.positionals[0];
  if (!slug) throw new UserError('which module?  swarm wake <module>');

  const spec = await workspace.readModule(slug);
  if (!spec) throw new UserError(`unknown module \`${slug}\``);

  await wakeSwarm(workspace, slug);
  const record = await workspace.swarmRecord(slug);

  heading(`${spec.name} awake`);
  note(`  memory: ${formatTokens(record.memoryTokens)} tokens`);
  note(`  owns:   ${spec.owns.join(', ')}`);
  line();
  warn('Waking a swarm by hand only marks it active — it spawns nothing.');
  note('  Give it work with:  swarm mission "<goal>" --modules ' + slug);
  line();
  return 0;
}
