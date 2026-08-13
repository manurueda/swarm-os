/**
 * The live view.
 *
 * `swarm ui` writes a static file that answers what is in a repository and what
 * to do about it. That is enough until you act — and then you want to watch,
 * because a mission is several agents working for minutes and the interesting
 * part is what they are doing right now.
 *
 * So this is the same page, served, with three additions: a snapshot endpoint
 * so it can refresh itself, an event stream so a running mission is visible as
 * it happens, and one endpoint that starts a mission.
 *
 * Security, for something that runs a coding agent on your machine:
 *
 * - Bound to 127.0.0.1. Never a public interface, not configurable.
 * - Every mutating request needs a token generated at startup and sent in a
 *   custom header. A web page you happen to be visiting can POST to localhost,
 *   but it cannot set a custom header without a preflight, and the preflight is
 *   refused. Reading endpoints are open — they only expose what is already in
 *   `.swarm/`, on your own machine.
 * - One mission at a time. Missions spawn agents against a shared quota, and a
 *   button that can be clicked twice should not spend it twice.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { platform } from 'node:os';

import {
  buildSnapshot,
  renderUi,
  runMission,
  type AgentRuntime,
  type SwarmConfig,
  type SwarmEvent,
  type Workspace,
} from '@swarm-os/core';

export interface ServeOptions {
  workspace: Workspace;
  runtime: AgentRuntime;
  config: SwarmConfig;
  port?: number;
  open?: boolean;
}

interface LiveState {
  missionId?: string;
  goal?: string;
  running: boolean;
  /** Per-module activity, mirroring what the terminal board shows. */
  agents: Record<string, { state: string; activity: string; tokens?: number }>;
  finished?: unknown;
  error?: string;
}

export async function serve(options: ServeOptions): Promise<{ url: string; close: () => void }> {
  const token = randomBytes(16).toString('hex');
  const clients = new Set<ServerResponse>();
  const live: LiveState = { running: false, agents: {} };

  const broadcast = (): void => {
    const payload = `data: ${JSON.stringify(live)}\n\n`;
    for (const client of clients) {
      try {
        client.write(payload);
      } catch {
        clients.delete(client);
      }
    }
  };

  const server = createServer((req, res) => {
    void handle(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');

    if (url.pathname === '/' || url.pathname === '/index.html') {
      const snapshot = await buildSnapshot(options.workspace, options.config);
      const html = renderUi(snapshot).replace(
        '</head>',
        `<script>window.__SWARM__={token:${JSON.stringify(token)}};</script></head>`,
      );
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    if (url.pathname === '/api/snapshot') {
      const snapshot = await buildSnapshot(options.workspace, options.config);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(snapshot));
      return;
    }

    if (url.pathname === '/api/events') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      res.write(`data: ${JSON.stringify(live)}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }

    if (url.pathname === '/api/mission' && req.method === 'POST') {
      // A custom header cannot be set cross-origin without a preflight, and
      // this server answers no preflight — so only our own page can get here.
      if (req.headers['x-swarm-token'] !== token) {
        res.writeHead(403).end('bad token');
        return;
      }
      if (live.running) {
        res.writeHead(409).end('a mission is already running');
        return;
      }

      const body = await readBody(req);
      const goal = typeof body['goal'] === 'string' ? body['goal'].trim() : '';
      if (!goal) {
        res.writeHead(400).end('goal required');
        return;
      }
      const modules = Array.isArray(body['modules'])
        ? body['modules'].filter((m): m is string => typeof m === 'string')
        : undefined;

      startMission(goal, modules);
      res.writeHead(202, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ started: true }));
      return;
    }

    res.writeHead(404).end();
  }

  function startMission(goal: string, modules?: string[]): void {
    live.running = true;
    live.goal = goal;
    live.agents = {};
    delete live.finished;
    delete live.error;
    broadcast();

    const touch = (module: string, patch: Partial<LiveState['agents'][string]>): void => {
      live.agents[module] = { state: 'working', activity: '', ...live.agents[module], ...patch };
      broadcast();
    };

    void runMission({
      runtime: options.runtime,
      workspace: options.workspace,
      config: options.config,
      goal,
      ...(modules && modules.length > 0 ? { modules } : {}),
      onProgress: (p) => {
        if (!p.module) return;
        if (p.phase === 'spawn') touch(p.module, { activity: 'waking' });
        else if (p.phase === 'review') touch(p.module, { activity: 'under review' });
        else if (p.phase === 'sleep') touch(p.module, { activity: 'compressing memory' });
        else if (p.phase === 'work') {
          const done = ['complete', 'partial', 'blocked', 'failed'].includes(p.message);
          touch(p.module, { state: done ? p.message : 'working', activity: done ? '' : 'working' });
        }
      },
      onEvent: (event: SwarmEvent) => {
        if (!('agentId' in event) || !event.agentId.startsWith('work:')) return;
        const module = event.agentId.slice('work:'.length);
        if (event.type === 'agent.tool') {
          touch(module, { activity: `${event.tool} ${event.summary}`.trim() });
        } else if (event.type === 'agent.usage') {
          touch(module, { tokens: event.usage.contextTokens });
        }
      },
    })
      .then((result) => {
        live.missionId = result.record.id;
        live.finished = result.modules.map((m) => ({
          module: m.module,
          ok: m.ok,
          status: m.report?.status ?? (m.ok ? 'finished' : 'failed'),
          branch: m.branch,
          changed: m.changedFiles.length,
          review: m.review
            ? { verdict: m.review.verdict, summary: m.review.summary, findings: m.review.findings }
            : undefined,
        }));
      })
      .catch((err: unknown) => {
        live.error = err instanceof Error ? err.message : String(err);
      })
      .finally(() => {
        live.running = false;
        broadcast();
      });
  }

  const port = options.port ?? 0;
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  const url = `http://127.0.0.1:${actualPort}/`;

  if (options.open !== false) openBrowser(url);

  return {
    url,
    close: () => {
      for (const client of clients) client.end();
      server.close();
    },
  };
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    // A goal is a sentence. Anything larger is not one.
    if (size > 64 * 1024) throw new Error('body too large');
    chunks.push(chunk as Buffer);
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function openBrowser(url: string): void {
  const cmd = platform() === 'darwin' ? 'open' : platform() === 'win32' ? 'start' : 'xdg-open';
  try {
    spawn(cmd, [url], { detached: true, stdio: 'ignore', shell: platform() === 'win32' }).unref();
  } catch {
    /* the url was printed */
  }
}
