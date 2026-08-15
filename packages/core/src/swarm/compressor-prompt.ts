/**
 * The prompt the memory compressor is asked to rewrite `memory.md` from.
 */

import type { ModuleSpec } from '../types.js';

export function buildCompressorPrompt(
  spec: ModuleSpec | undefined,
  slug: string,
  budgetTokens: number,
  beforeTokens: number,
  areaSlugs: string[],
  before: string,
  missionReport: string | undefined,
): string {
  return [
    `# Module: ${spec?.name ?? slug} (\`${slug}\`)`,
    '',
    `Token budget for the new memory file: ${budgetTokens}.`,
    `The current file is roughly ${beforeTokens} tokens.`,
    ...(areaSlugs.length
      ? [
          '',
          "## This module's memory is split by area",
          '',
          ...areaSlugs.map((a) => `- ${a}`),
          '',
          'Anything true of only one of these belongs under `## Area: <slug>`,',
          'which is filed into that area and does not count against the budget.',
        ]
      : []),
    '',
    '## Current memory',
    '',
    before.trim() || '_empty_',
    ...(missionReport ? ['', '## What just happened', '', missionReport.trim()] : []),
    '',
    '---',
    '',
    'Write the new memory file.',
  ].join('\n');
}
