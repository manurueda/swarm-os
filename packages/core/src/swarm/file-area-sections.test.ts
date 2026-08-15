/**
 * Filing the compressor's `## Area: <slug>` sections into their area memory.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fileAreaSections } from './file-area-sections.js';
import type { Workspace } from '../workspace/store.js';

function recordingWorkspace(existing: Record<string, string> = {}) {
  const written: Array<{ module: string; area: string; content: string }> = [];
  const workspace = {
    async readAreaFile(_module: string, area: string) {
      return existing[area] ?? '';
    },
    async writeAreaFile(module: string, area: string, _file: string, content: string) {
      written.push({ module, area, content });
    },
  } as unknown as Workspace;
  return { workspace, written };
}

test('files a section for every area the module actually has', async () => {
  const { workspace, written } = recordingWorkspace();
  await fileAreaSections(workspace, 'billing', { invoices: '- new fact' }, ['invoices', 'refunds']);
  assert.equal(written.length, 1);
  assert.equal(written[0]?.area, 'invoices');
  assert.match(written[0]?.content ?? '', /- new fact/);
});

test('drops a section for an area slug the module does not have', async () => {
  const { workspace, written } = recordingWorkspace();
  await fileAreaSections(workspace, 'billing', { madeUp: '- a fact' }, ['invoices', 'refunds']);
  assert.equal(written.length, 0);
});

test('merges into what the area already knows rather than overwriting it', async () => {
  const { workspace, written } = recordingWorkspace({ invoices: '## From missions\n\n- old fact\n' });
  await fileAreaSections(workspace, 'billing', { invoices: '- new fact' }, ['invoices']);
  assert.match(written[0]?.content ?? '', /- old fact/);
  assert.match(written[0]?.content ?? '', /- new fact/);
});

test('no area sections means nothing is written', async () => {
  const { workspace, written } = recordingWorkspace();
  await fileAreaSections(workspace, 'billing', {}, ['invoices']);
  assert.equal(written.length, 0);
});
