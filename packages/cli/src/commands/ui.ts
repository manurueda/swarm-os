/**
 * `swarm ui` — see the repository.
 *
 * Writes one self-contained HTML file and opens it. No server, no network, no
 * build. The whole point is answering "what is in here and what is wrong with
 * it" by looking, on a codebase too large to hold in your head.
 */

import { spawn } from 'node:child_process';
import { platform } from 'node:os';
import { join } from 'node:path';

import { buildSnapshot, renderUi } from '@swarm-os/core';

import { serve } from '../server.js';

import { flagBool, flagString, type ParsedArgs } from '../args.js';
import { loadContext } from '../context.js';
import { heading, line, note, ok, table } from '../ui.js';

export async function uiCommand(args: ParsedArgs): Promise<number> {
  const { workspace, runtime, config } = await loadContext(args, { requireMapped: true });

  // Served: the page follows a running mission and can start one.
  // Written: a static snapshot, which is all you need to look and think.
  if (flagBool(args.flags, 'serve')) {
    const port = Number(flagString(args.flags, 'port') ?? 0);
    const { url } = await serve({
      workspace,
      runtime,
      config,
      ...(Number.isFinite(port) && port > 0 ? { port } : {}),
      open: !flagBool(args.flags, 'no-open'),
    });
    heading('Live');
    ok(url);
    note('  starts missions and follows them as they run');
    note('  bound to 127.0.0.1 · Ctrl-C to stop');
    line();
    // Hold the process open for the server.
    await new Promise<void>(() => {});
    return 0;
  }

  heading('Building view');
  const snapshot = await buildSnapshot(workspace, config);

  const output = flagString(args.flags, 'out') ?? join(workspace.root, 'view.html');
  await workspace.writeSystemFile(
    output.startsWith(workspace.root) ? output.slice(workspace.root.length + 1) : output,
    renderUi(snapshot),
  );

  const flagged = snapshot.modules.filter((m) => m.health !== 'ok').length;
  table(
    [
      ['modules', String(snapshot.modules.length)],
      ['files', snapshot.totalFiles.toLocaleString()],
      ['lines', snapshot.totalLines.toLocaleString()],
      ['owned by a module', `${Math.round(snapshot.coverage * 100)}%`],
      ['modules with signals', String(flagged)],
      ['import edges', String(snapshot.edges.length)],
      ['memory on disk', `${Math.round(snapshot.memoryTokens / 100) / 10}k tokens`],
    ],
    { head: ['', ''] },
  );

  line();
  ok(workspace.rel(output));

  if (!flagBool(args.flags, 'no-open')) {
    open(output);
    note('  opened in your browser');
  }
  note('  self-contained — no server, works offline, safe to commit or send');
  line();
  return 0;
}

function open(path: string): void {
  const cmd =
    platform() === 'darwin' ? 'open' : platform() === 'win32' ? 'start' : 'xdg-open';
  try {
    const child = spawn(cmd, [path], { detached: true, stdio: 'ignore', shell: platform() === 'win32' });
    child.unref();
  } catch {
    // Not being able to open a browser is not a failure; the path was printed.
  }
}
