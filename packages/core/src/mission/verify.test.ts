import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runVerify } from './verify.js';

test('an empty verify command is skipped without touching the worktree', async () => {
  const result = await runVerify('test-module', '/nonexistent/worktree', '');
  assert.deepEqual(result, { outcome: 'skipped-no-command', output: '' });
});
