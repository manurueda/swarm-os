/**
 * Mission routing.
 *
 * Deciding which modules a goal touches is itself a context problem: the naive
 * approach is to hand a model the whole repo and ask. Instead the router sees
 * only the system summary and one line per module — a few hundred tokens
 * regardless of repo size — and returns an assignment per module.
 *
 * Routing wrong is cheap to correct (`--modules` overrides it). Routing
 * expensively is not, so this stays deliberately small.
 */

import type { AgentRuntime, MissionPlan, ModuleSpec, SwarmEvent } from '../types.js';
import { collectAgent, type AgentOutcome } from '../runtime/collect.js';

export const ROUTE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'assignments'],
  properties: {
    summary: {
      type: 'string',
      description: 'One or two sentences restating the goal as work to be done.',
    },
    assignments: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['module', 'task', 'rationale'],
        properties: {
          module: { type: 'string', description: 'Module slug.' },
          task: {
            type: 'string',
            description:
              'Self-contained instructions for this module\'s agent. It will not see the other modules.',
          },
          rationale: { type: 'string', description: 'Why this module is involved.' },
        },
      },
    },
    notes: {
      type: 'string',
      description: 'Anything you could not route, or that needs a human decision.',
    },
  },
} as const;

const ROUTER_CHARTER = `You are the Swarm OS mission router.

You are given a goal and a one-line description of each module in a system. You
decide which modules must change, and write a self-contained task for each.

The agents you are writing for work in isolation: each one sees only its own
module's code and memory. It cannot read the other modules. So each task must
carry everything that agent needs to know, including any contract it must
honour at the boundary with another module.

Rules:
- Route to the FEWEST modules that can accomplish the goal. Every extra module
  is another process drawing on a shared, finite subscription budget.
- If the goal only touches one module, assign one. Do not manufacture work for
  others to look thorough.
- When two modules must agree on an interface, state the exact contract in BOTH
  tasks, identically. That shared sentence is the only coordination they get.
- If the goal is ambiguous or you cannot tell which module owns something, say
  so in notes rather than guessing across five modules.
- Never invent a module slug. Use only the slugs given to you.

Write tasks as instructions to a capable engineer who knows this module well and
has just sat down: what to change, what to preserve, how to tell it worked.`;

export interface RouteOptions {
  runtime: AgentRuntime;
  repoRoot: string;
  goal: string;
  systemSummary: string;
  modules: ModuleSpec[];
  model?: string;
  onEvent?: (event: SwarmEvent) => void | Promise<void>;
  signal?: AbortSignal;
}

export async function routeMission(
  options: RouteOptions,
): Promise<{ plan?: MissionPlan; outcome: AgentOutcome }> {
  const prompt = [
    '# Goal',
    '',
    options.goal,
    '',
    '# System',
    '',
    options.systemSummary || '_not recorded_',
    '',
    '# Modules',
    '',
    ...options.modules.map(
      (m) =>
        `- \`${m.slug}\` — ${m.purpose || m.name}` +
        (m.fileCount ? ` _(${m.fileCount} files)_` : ''),
    ),
    '',
    '---',
    '',
    'Route this goal. Assign work only to the modules that must change.',
  ].join('\n');

  const outcome = await collectAgent(
    options.runtime,
    {
      id: 'router',
      role: 'router',
      prompt,
      systemPrompt: ROUTER_CHARTER,
      cwd: options.repoRoot,
      // The router must not start exploring the repo — that is the analysts' job.
      tools: [],
      ...(options.model ? { model: options.model } : {}),
      permissionMode: 'dontAsk',
      jsonSchema: ROUTE_SCHEMA,
      lean: true,
      ephemeral: true,
    },
    options.onEvent,
    options.signal,
  );

  const plan = parsePlan(outcome.structured, options.modules);
  return { ...(plan ? { plan } : {}), outcome };
}

function parsePlan(raw: unknown, modules: ModuleSpec[]): MissionPlan | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const o = raw as Record<string, unknown>;
  const assignments = o['assignments'];
  if (!Array.isArray(assignments)) return undefined;

  const known = new Set(modules.map((m) => m.slug));
  const parsed: MissionPlan['assignments'] = [];

  for (const entry of assignments) {
    if (typeof entry !== 'object' || entry === null) continue;
    const a = entry as Record<string, unknown>;
    const slug = typeof a['module'] === 'string' ? a['module'] : undefined;
    const task = typeof a['task'] === 'string' ? a['task'] : undefined;
    // Silently dropping a hallucinated slug is better than spawning an agent
    // with no module behind it.
    if (!slug || !task || !known.has(slug)) continue;
    parsed.push({
      module: slug,
      task,
      ...(typeof a['rationale'] === 'string' ? { rationale: a['rationale'] } : {}),
    });
  }

  if (parsed.length === 0) return undefined;

  return {
    summary: typeof o['summary'] === 'string' ? o['summary'] : '',
    assignments: parsed,
    ...(typeof o['notes'] === 'string' && o['notes'] ? { notes: o['notes'] } : {}),
  };
}

/** Render the plan to `.swarm/missions/<id>/plan.md`. */
export function renderPlan(goal: string, plan: MissionPlan): string {
  return [
    '# Mission plan',
    '',
    `**Goal.** ${goal}`,
    '',
    plan.summary,
    '',
    '## Assignments',
    '',
    ...plan.assignments.flatMap((a) => [
      `### \`${a.module}\``,
      '',
      ...(a.rationale ? [`_${a.rationale}_`, ''] : []),
      a.task,
      '',
    ]),
    ...(plan.notes ? ['## Notes', '', plan.notes, ''] : []),
  ].join('\n');
}
