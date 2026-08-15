/**
 * The prompt handed to the memory compressor agent.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildCompressorPrompt } from './compressor-prompt.js';
import type { ModuleSpec } from '../types.js';

const SPEC: ModuleSpec = {
  slug: 'billing',
  name: 'Billing',
  purpose: 'Invoicing.',
  owns: ['src/billing/**'],
  entryPoints: [],
  dependsOn: [],
};

test('names the module and states the budget and current size', () => {
  const prompt = buildCompressorPrompt(SPEC, 'billing', 2000, 3500, [], '- a fact', undefined);
  assert.match(prompt, /# Module: Billing \(`billing`\)/);
  assert.match(prompt, /budget for the new memory file: 2000/);
  assert.match(prompt, /roughly 3500 tokens/);
});

test('falls back to the slug when there is no spec', () => {
  const prompt = buildCompressorPrompt(undefined, 'billing', 2000, 100, [], '', undefined);
  assert.match(prompt, /# Module: billing \(`billing`\)/);
});

test('includes the current memory verbatim', () => {
  const prompt = buildCompressorPrompt(SPEC, 'billing', 2000, 100, [], '- invariant one', undefined);
  assert.match(prompt, /- invariant one/);
});

test('an empty current memory is shown as empty, not a blank block', () => {
  const prompt = buildCompressorPrompt(SPEC, 'billing', 2000, 0, [], '   ', undefined);
  assert.match(prompt, /_empty_/);
});

test('a mission report is appended under its own heading', () => {
  const prompt = buildCompressorPrompt(SPEC, 'billing', 2000, 100, [], '', 'agent renamed X to Y');
  assert.match(prompt, /## What just happened/);
  assert.match(prompt, /agent renamed X to Y/);
});

test('no mission report means no "what just happened" section', () => {
  const prompt = buildCompressorPrompt(SPEC, 'billing', 2000, 100, [], '', undefined);
  assert.doesNotMatch(prompt, /What just happened/);
});

test('area slugs are listed and explained when the module is split', () => {
  const prompt = buildCompressorPrompt(SPEC, 'billing', 2000, 100, ['invoices', 'refunds'], '', undefined);
  assert.match(prompt, /split by area/);
  assert.match(prompt, /- invoices/);
  assert.match(prompt, /- refunds/);
});

test('no areas means no area section at all', () => {
  const prompt = buildCompressorPrompt(SPEC, 'billing', 2000, 100, [], '', undefined);
  assert.doesNotMatch(prompt, /split by area/);
});
