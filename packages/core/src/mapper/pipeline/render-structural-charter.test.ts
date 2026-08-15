import { test } from 'node:test';
import assert from 'node:assert/strict';

import { renderStructuralCharter } from './render-structural-charter.js';
import type { ModuleSpec } from '../../types.js';

const spec: ModuleSpec = {
  slug: 'billing',
  name: 'Billing',
  purpose: 'Handles invoices.',
  owns: ['src/billing/**'],
  entryPoints: [],
  dependsOn: [],
};

test('carries the name, purpose and owned globs', () => {
  const charter = renderStructuralCharter(spec, 'A system.');
  assert.match(charter, /# Billing/);
  assert.match(charter, /Handles invoices\./);
  assert.match(charter, /`src\/billing\/\*\*`/);
});

test('falls back to "Not recorded" when there is no system summary', () => {
  assert.match(renderStructuralCharter(spec, ''), /_Not recorded\._/);
});

test('says the analyst did not complete', () => {
  assert.match(renderStructuralCharter(spec, 'A system.'), /analyst did not complete/);
});
