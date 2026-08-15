/**
 * What an agent costs before it reads a line of your code.
 *
 * Every spawn carries a fixed load: the harness system prompt plus one tool
 * definition per tool, each of which ships a long description of its usage
 * rules and edge cases rather than a bare JSON schema. None of it is
 * negotiable at run time, and all of it comes out of the same window the
 * agent needs for the actual work — so it is the first thing to know when
 * asking whether a module is close to the limit.
 *
 * The anchors below were measured on Claude Code 2.1.231 with the prompt
 * `"Reply with exactly: OK"`, lean (`--strict-mcp-config
 * --disable-slash-commands --setting-sources ''`). See docs/CONTEXT-ECONOMY.md.
 * Re-measure on your own machine with `swarm doctor --measure`.
 */

/** Measured (toolCount, baseline) pairs, ascending by tool count. */
const ANCHORS: Array<[tools: number, tokens: number]> = [
  [0, 8_746],
  [3, 11_798],
  [6, 16_774],
];

/** Default context window for the models Swarm OS spawns. */
export const CONTEXT_WINDOW = 200_000;

/**
 * Estimated baseline for a lean agent holding `toolCount` tools.
 *
 * Interpolated between measured points, extrapolated from the last segment
 * beyond them. An estimate, and labelled as one wherever it is shown: tools
 * differ in size (`Bash` costs several times what `Glob` does), so the count
 * alone cannot be exact.
 */
export function agentBaselineTokens(toolCount: number): number {
  const tools = Math.max(0, toolCount);

  const first = ANCHORS[0] as [number, number];
  if (tools <= first[0]) return first[1];

  for (let i = 1; i < ANCHORS.length; i += 1) {
    const [prevTools, prevTokens] = ANCHORS[i - 1] as [number, number];
    const [nextTools, nextTokens] = ANCHORS[i] as [number, number];
    if (tools <= nextTools) {
      const span = nextTools - prevTools;
      const perTool = span === 0 ? 0 : (nextTokens - prevTokens) / span;
      return Math.round(prevTokens + (tools - prevTools) * perTool);
    }
  }

  // Past the last measurement, keep the slope of the final segment rather than
  // pretending the curve flattens.
  const [lastTools, lastTokens] = ANCHORS[ANCHORS.length - 1] as [number, number];
  const [prevTools, prevTokens] = ANCHORS[ANCHORS.length - 2] as [number, number];
  const perTool = (lastTokens - prevTokens) / (lastTools - prevTools);
  return Math.round(lastTokens + (tools - lastTools) * perTool);
}
