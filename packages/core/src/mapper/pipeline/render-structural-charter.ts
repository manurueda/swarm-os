import type { ModuleSpec } from '../../types.js';

/** Fallback charter when a module's analyst failed — structure only, no findings. */
export function renderStructuralCharter(spec: ModuleSpec, systemSummary: string): string {
  return [
    `# ${spec.name}`,
    '',
    spec.purpose,
    '',
    '## Owns',
    '',
    ...spec.owns.map((g) => `- \`${g}\``),
    '',
    '## System context',
    '',
    systemSummary || '_Not recorded._',
    '',
    '---',
    '',
    '_This module\'s analyst did not complete. Re-run `swarm map` to survey it._',
    '',
  ].join('\n');
}
