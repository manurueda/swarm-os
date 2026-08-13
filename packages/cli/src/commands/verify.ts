/**
 * `swarm verify [module]` — is what the swarms believe actually true?
 *
 * Memory is only an asset if it is accurate. This command measures that: a
 * deterministic citation check that costs nothing, and an independent verifier
 * agent per module that sees only the claims and tries to falsify them.
 */

import { Scheduler, renderVerification, verifyModule, type ModuleVerification } from '@swarm-os/core';

import { flagBool, type ParsedArgs } from '../args.js';
import { assertRuntimeReady, loadContext, UserError } from '../context.js';
import { LiveBoard, c, clip, heading, line, note, ok, pad, symbols, table, warn } from '../ui.js';

export async function verifyCommand(args: ParsedArgs): Promise<number> {
  const { workspace, runtime, config } = await loadContext(args, { requireMapped: true });

  const citationsOnly = flagBool(args.flags, 'citations-only');
  if (!citationsOnly) await assertRuntimeReady(runtime);

  const requested = args.positionals[0];
  const all = await workspace.listModules();
  const targets = requested ? all.filter((m) => m.slug === requested) : all;
  if (requested && targets.length === 0) throw new UserError(`unknown module \`${requested}\``);

  heading(citationsOnly ? 'Verifying citations' : 'Verifying memory');
  if (citationsOnly) {
    note('Deterministic check only — no agents, no tokens.');
  } else {
    note('Each module gets an independent agent that sees only the claims,');
    note('never how they were derived, and tries to falsify them.');
  }
  line();

  const board = new LiveBoard();
  const rows = new Map<string, string>();
  const paint = (slug: string, state: string, detail = ''): void => {
    rows.set(slug, state);
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
    targets.map((spec) => async (): Promise<ModuleVerification> => {
      paint(spec.slug, 'working', 'checking claims against code…');
      const result = await verifyModule({
        runtime,
        workspace,
        module: spec,
        citationsOnly,
        ...(config.systemModel ? { model: config.systemModel } : {}),
        onEvent: (e) => scheduler.observe(e),
      });
      paint(
        spec.slug,
        result.error ? 'failed' : 'done',
        result.error ??
          `${result.claims.length} claims · ${Math.round((result.accuracy ?? result.citationRate) * 100)}%`,
      );
      if (result.claims.length > 0) {
        await workspace.writeModuleFile(
          spec.slug,
          'verification.md',
          renderVerification(result, new Date().toISOString().slice(0, 10)),
        );
      }
      return result;
    }),
  );

  board.stop();

  const verified = results.filter((r): r is ModuleVerification => !(r instanceof Error));

  // -- summary --------------------------------------------------------------
  heading('Results');
  table(
    verified.map((r) => {
      const acc = r.accuracy;
      const accCell =
        acc === undefined
          ? c.gray('—')
          : acc >= 0.9
            ? c.green(`${Math.round(acc * 100)}%`)
            : acc >= 0.75
              ? c.yellow(`${Math.round(acc * 100)}%`)
              : c.red(`${Math.round(acc * 100)}%`);
      return [
        `  ${c.bold(pad(r.module, 22))}`,
        String(r.claims.length),
        `${Math.round(r.citationRate * 100)}%`,
        accCell,
        r.contradicted > 0 ? c.red(String(r.contradicted)) : '0',
        String(r.unverifiable),
        String(r.docSourced),
      ];
    }),
    { head: ['  module', 'claims', 'cited', 'supported', 'wrong', 'unver', 'doc'] },
  );

  const totals = verified.reduce(
    (acc, r) => ({
      claims: acc.claims + r.claims.length,
      contradicted: acc.contradicted + r.contradicted,
      unverifiable: acc.unverifiable + r.unverifiable,
      doc: acc.doc + r.docSourced,
      resolved: acc.resolved + r.claims.filter((v) => v.citation === 'resolved').length,
      supported:
        acc.supported + r.claims.filter((v) => v.verdict === 'supported').length,
      judged: acc.judged + r.claims.filter((v) => v.verdict !== undefined).length,
    }),
    { claims: 0, contradicted: 0, unverifiable: 0, doc: 0, resolved: 0, supported: 0, judged: 0 },
  );

  line();
  line(
    `  ${totals.claims} claims · ${pct(totals.resolved, totals.claims)} citations resolve` +
      (totals.judged > 0 ? ` · ${pct(totals.supported, totals.judged)} supported` : ''),
  );
  if (totals.doc > 0) {
    note(`  ${totals.doc} claim(s) were documentation-sourced — the likeliest to go stale.`);
  }

  // -- the interesting part: what is actually wrong -------------------------
  const wrong = verified.flatMap((r) =>
    r.claims
      .filter((v) => v.verdict === 'contradicted' || v.citation === 'missing-file')
      .map((v) => ({ module: r.module, v })),
  );

  if (wrong.length > 0) {
    heading(`${wrong.length} claim(s) the swarms believe that are not true`);
    for (const { module, v } of wrong.slice(0, 15)) {
      line(`  ${c.red(symbols.fail)} ${c.bold(module)} ${c.gray(v.claim.path || '(uncited)')}`);
      for (const l of wrapText(v.claim.text, 92)) note(`     ${l}`);
      // The evidence is the entire value of a contradiction — never clip it.
      if (v.evidence) {
        const [first, ...rest] = wrapText(v.evidence, 90);
        note(`     ${c.yellow('→')} ${first ?? ''}`);
        for (const l of rest) note(`       ${l}`);
      }
      line();
    }
    warn('These are loaded into every mission touching those modules.');
    note('  Edit the memory.md files, or re-survey with `swarm map --force`.');
  } else if (totals.judged > 0) {
    line();
    ok('No contradicted claims — the memory holds up to an independent read.');
  }

  line();
  note(`  Full reports: .swarm/modules/<slug>/verification.md`);
  line();

  return wrong.length > 0 ? 1 : 0;
}

function pct(n: number, total: number): string {
  return total === 0 ? '—' : `${Math.round((n / total) * 100)}%`;
}

/** Soft-wrap on word boundaries so long evidence stays readable. */
function wrapText(text: string, width: number): string[] {
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
