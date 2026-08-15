/**
 * Memory claims and their citations.
 *
 * A confident, wrong invariant is worse than an empty memory file — it gets
 * loaded into every future mission and believed. The citation round trip is
 * what makes the free, deterministic half of `swarm verify` possible, so a
 * rendering change that the parser does not follow silently disarms it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseClaimLine, renderClaim } from './analyst.js';
import type { Claim } from './analyst.js';
import { checkCitation, extractClaims } from './verify.js';

const MEMORY = `# Mission Orchestration — memory

## Invariants

- Work agents always run with a fresh session id. <sub>\`src/mission/run.ts\`</sub>

## Gotchas

- Routing is skipped when --modules is passed. <sub>\`src/mission/route.ts\` [doc]</sub>
- _None recorded yet._

## Landmarks

- \`src/mission/review.ts\` — the reviewer charter lives here.
`;

test('a claim survives rendering and parsing back', () => {
  const cases: Claim[] = [
    { text: 'Frames must be written in order.', path: 'src/render.ts', source: 'code' },
    { text: 'The cache is keyed by content hash.', path: 'src/cache.ts', source: 'doc' },
  ];
  for (const claim of cases) {
    assert.deepEqual(parseClaimLine(renderClaim(claim)), claim);
  }
});

test('documentation-sourced claims are marked so a reader weights them differently', () => {
  assert.equal(
    renderClaim({ text: 'X.', path: 'a.ts', source: 'doc' }),
    '- X. <sub>`a.ts` [doc]</sub>',
  );
  assert.equal(
    renderClaim({ text: 'X.', path: 'a.ts', source: 'code' }),
    '- X. <sub>`a.ts`</sub>',
  );
});

test('an uncited claim is treated as documentation, not as read code', () => {
  const claim = parseClaimLine('- Something nobody grounded in a file.');
  assert.equal(claim?.path, '');
  assert.equal(claim?.source, 'doc');
});

test('extractClaims takes invariants and gotchas and nothing else', () => {
  const claims = extractClaims(MEMORY);

  assert.equal(claims.length, 2, 'landmarks are not claims and placeholders are not claims');
  assert.equal(claims[0]?.path, 'src/mission/run.ts');
  assert.equal(claims[0]?.source, 'code');
  assert.equal(claims[1]?.path, 'src/mission/route.ts');
  assert.equal(claims[1]?.source, 'doc');
});

test('citations resolve against the repo and the module boundary', async () => {
  const repo = await mkdtemp(join(tmpdir(), 'swarm-claims-'));
  try {
    await mkdir(join(repo, 'src', 'mission'), { recursive: true });
    await mkdir(join(repo, 'src', 'cli'), { recursive: true });
    await writeFile(join(repo, 'src', 'mission', 'run.ts'), 'export const x = 1;\n');
    await writeFile(join(repo, 'src', 'cli', 'main.ts'), 'export const y = 1;\n');

    const owns = ['src/mission/**'];
    const claim = (path: string): Claim => ({ text: 'A claim.', path, source: 'code' });

    assert.equal(checkCitation(claim('src/mission/run.ts'), repo, owns), 'resolved');
    assert.equal(checkCitation(claim('src/mission/gone.ts'), repo, owns), 'missing-file');
    assert.equal(checkCitation(claim('src/cli/main.ts'), repo, owns), 'outside-module');
    assert.equal(checkCitation(claim(''), repo, owns), 'no-citation');

    // Citing the directory a module lives in is legitimate, not a violation.
    assert.equal(checkCitation(claim('src/mission'), repo, owns), 'resolved');
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});
