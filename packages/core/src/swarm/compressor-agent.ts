/**
 * Running the memory compressor agent itself.
 */

import type { AgentRuntime, SwarmEvent } from '../types.js';
import { collectAgent, type AgentOutcome } from '../runtime/collect.js';
import { standaloneSystemPrompt } from '../runtime/system-tier.js';

export const COMPRESSOR_CHARTER = `You are the Swarm OS memory compressor.

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

When you are told this module's memory is split by area, this file is the part
EVERY agent loads whatever it is working on, so it holds only what is true
across areas. A fact that belongs to one area is not dropped — you move it, by
writing it under a heading of exactly this form, after all the normal sections:

    ## Area: <area-slug>

    - the fact <sub>\`path/to/file\`</sub>

Everything under such a heading is filed into that area's own memory and read
only by an agent working there. That is where the budget headroom comes from,
so prefer moving a specific fact over cutting it. Facts under an area heading
do not count against the budget.
- Write facts, not narrative. No "we decided", no "the agent found". Just what
  is true about this code.

Output the markdown file and nothing else.`;

export async function runCompressorAgent(
  runtime: AgentRuntime,
  slug: string,
  prompt: string,
  cwd: string,
  model: string | undefined,
  onEvent: ((event: SwarmEvent) => void | Promise<void>) | undefined,
  signal: AbortSignal | undefined,
): Promise<AgentOutcome> {
  return collectAgent(
    runtime,
    {
      id: `compressor:${slug}`,
      role: 'compressor',
      module: slug,
      prompt,
      // The compressor returns markdown, not a structured payload.
      systemPromptOverride: standaloneSystemPrompt(COMPRESSOR_CHARTER, { structured: false }),
      cwd,
      tools: [],
      ...(model ? { model } : {}),
      permissionMode: 'dontAsk',
      lean: true,
      ephemeral: true,
    },
    onEvent,
    signal,
  );
}
