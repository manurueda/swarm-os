/**
 * Filing compressed memory into areas.
 *
 * This is the step that lets a module stop paying for knowledge it is not
 * using. The compressor has no tools, so it can only *mark* which facts belong
 * to an area — if the filing is wrong the facts are silently destroyed, which
 * is the exact failure the whole area mechanism exists to prevent.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { mergeAreaMemory, splitAreaSections } from './area-memory.js';

const COMPRESSED = `# Rendering — memory

## Invariants

- Frames are written in order. <sub>\`src/render/write.ts\`</sub>

## Landmarks

- \`src/render/write.ts\` — the writer.

## Area: captions

- BOLD_POP must never change. <sub>\`src/captions/presets.py\`</sub>

## Area: audio

- Loudness is normalised to -14 LUFS. <sub>\`src/audio/norm.py\`</sub>
`;

test('area sections are lifted out of the module memory', () => {
  const split = splitAreaSections(COMPRESSED);

  assert.match(split.module, /## Invariants/);
  assert.match(split.module, /Frames are written in order/);
  assert.equal(split.module.includes('BOLD_POP'), false, 'area facts must leave the module file');
  assert.equal(split.module.includes('## Area:'), false);
  assert.ok(split.module.endsWith('\n'));
});

test('each area gets exactly the facts filed under it', () => {
  const { areas } = splitAreaSections(COMPRESSED);

  assert.deepEqual(Object.keys(areas).sort(), ['audio', 'captions']);
  assert.match(areas['captions'] ?? '', /BOLD_POP must never change/);
  assert.equal((areas['captions'] ?? '').includes('LUFS'), false);
  assert.match(areas['audio'] ?? '', /-14 LUFS/);
});

test('a normal heading after an area section returns to the module', () => {
  const split = splitAreaSections(
    '## Area: one\n\n- filed here\n\n## Gotchas\n\n- back at module level\n',
  );
  assert.match(split.areas['one'] ?? '', /filed here/);
  assert.match(split.module, /back at module level/);
  assert.equal(split.module.includes('filed here'), false);
});

test('memory with no area sections is returned untouched', () => {
  const plain = '# M\n\n## Invariants\n\n- Something true.\n';
  const split = splitAreaSections(plain);
  assert.deepEqual(split.areas, {});
  assert.equal(split.module.trim(), plain.trim());
});

test('an empty or unnamed area section files nothing', () => {
  assert.deepEqual(splitAreaSections('## Area: empty\n\n').areas, {});
  assert.deepEqual(splitAreaSections('## Area:\n\n- orphaned\n').areas, {});
});

test('merging appends new facts under one heading', () => {
  const merged = mergeAreaMemory('# captions — memory\n\n## Invariants\n\n- Existing.\n', '- New.');
  assert.match(merged, /## From missions/);
  assert.match(merged, /- New\./);
  assert.match(merged, /- Existing\./);
});

test('merging never writes the same fact twice', () => {
  const once = mergeAreaMemory('## From missions\n\n- A fact.\n', '- A fact.');
  assert.equal(once.match(/- A fact\./g)?.length, 1);

  const twice = mergeAreaMemory('## From missions\n\n- A fact.\n', '- A fact.\n- Another.');
  assert.equal(twice.match(/- A fact\./g)?.length, 1);
  assert.match(twice, /- Another\./);
});

test('merging reuses the heading instead of stacking them', () => {
  const merged = mergeAreaMemory('## From missions\n\n- One.\n', '- Two.');
  assert.equal(merged.match(/## From missions/g)?.length, 1);
});

test('nothing new leaves the file byte-identical', () => {
  const existing = '## From missions\n\n- A fact.\n';
  assert.equal(mergeAreaMemory(existing, '- A fact.'), existing);
  assert.equal(mergeAreaMemory(existing, ''), existing);
  assert.equal(mergeAreaMemory(existing, 'prose, not a fact'), existing);
});

test('merging into an empty area file still produces a readable one', () => {
  const merged = mergeAreaMemory('', '- First thing learned here.');
  assert.match(merged, /^## From missions/);
  assert.match(merged, /- First thing learned here\./);
});
