/**
 * Self-contained system prompts for the tool-less "system tier" — the
 * partitioner, router and memory compressor.
 *
 * Claude Code's default system prompt is roughly 8.5k tokens, almost all of it
 * guidance for using tools, navigating a codebase and behaving well in an
 * interactive session. An agent with `--tools ""` cannot use any of it. Passing
 * `--system-prompt` replaces that default with the agent's own charter instead
 * of appending to it.
 *
 * Measured on Claude Code 2.1.231, one structured-output call with no tools:
 *
 *   default system prompt   28,925 tokens   → returned an empty result
 *   replaced with charter    1,726 tokens   → returned the correct result
 *
 * Cheaper *and* better: with nothing to act on, the tool-use guidance is pure
 * distraction, and it visibly degraded the answer.
 *
 * This is only ever correct for agents with no tools. An agent that must call
 * Read or Bash needs the instructions that make tool use work, and those agents
 * keep the default prompt with their charter appended.
 */

/**
 * Wrap a charter so it stands alone as a complete system prompt.
 *
 * The structured-output note matters: without Claude Code's default prompt the
 * model has no other instruction telling it that its answer must go through the
 * StructuredOutput tool rather than into prose.
 */
export function standaloneSystemPrompt(
  charter: string,
  options: { structured?: boolean } = {},
): string {
  const parts = [charter.trim()];

  if (options.structured !== false) {
    parts.push(
      '',
      '---',
      '',
      'You are running non-interactively with no tools available except the one',
      'that records your answer. Do not narrate, do not plan out loud, and do not',
      'ask questions — there is nobody to answer them. Produce your answer by',
      'calling the StructuredOutput tool exactly once, matching the schema you',
      'were given. Every required field must be filled with real content; an',
      'empty array or a placeholder string is a failed response.',
    );
  }

  return parts.join('\n');
}

/**
 * A self-contained system prompt for an agent that DOES have tools.
 *
 * The reasoning that makes this safe: tool *definitions* are sent separately
 * from the system prompt. An agent given `--tools Read,Grep,Glob` receives those
 * three schemas and their (already detailed) descriptions no matter what the
 * system prompt says. What the default prompt adds on top is general guidance
 * about working in a codebase — useful for an open-ended interactive session,
 * largely redundant for an agent with one narrow job and three read-only tools.
 *
 * So this replaces ~8.5k of general guidance with the ~150 tokens of it that
 * actually apply, plus the agent's own charter. Whether that trade is good is an
 * empirical question per agent type, not an assumption — measure before
 * switching an agent over, and keep the default for anything that edits or runs
 * commands until it has been measured too.
 */
export function standaloneAgentPrompt(
  charter: string,
  options: {
    /** Repo-relative globs the agent may touch. */
    scope?: string[];
    /** Answer via the StructuredOutput tool rather than prose. */
    structured?: boolean;
    /** The agent may modify files, so it needs the extra care instructions. */
    canWrite?: boolean;
  } = {},
): string {
  const parts = [charter.trim(), '', '---', ''];

  parts.push(
    'You are running non-interactively. There is no human to ask, and no follow-up',
    'turn: work until the task is done, then answer once.',
    '',
    'Working method:',
    '- Glob to see shape, Grep to trace connections, Read to confirm details.',
    '- Prefer Grep and Glob over reading files speculatively. Read a file when you',
    '  have a reason to believe it matters.',
    '- Issue independent tool calls together rather than one at a time.',
    '- Stop exploring when you can answer. Completeness is not the goal;',
    '  a correct, specific answer is.',
  );

  if (options.scope && options.scope.length > 0) {
    parts.push(
      '',
      'You are scoped to these paths:',
      ...options.scope.map((g) => `  ${g}`),
      'Reading outside them is allowed only to understand a contract you consume.',
    );
  }

  if (options.canWrite) {
    parts.push(
      '',
      'When you change code:',
      '- Read a file before editing it.',
      '- Match the surrounding style; do not reformat unrelated lines.',
      '- Verify your change by running the relevant test or command. If you cannot',
      '  verify it, say so plainly rather than implying it works.',
      '- Do not commit, push, or run destructive commands. Your work is reviewed',
      '  from a branch.',
    );
  }

  if (options.structured !== false) {
    parts.push(
      '',
      'Produce your answer by calling the StructuredOutput tool exactly once,',
      'matching the schema you were given. Every required field must contain real',
      'content — an empty array or a placeholder string is a failed response.',
    );
  }

  return parts.join('\n');
}
