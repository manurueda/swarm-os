/**
 * Personal-mode runtime: the official `claude` CLI installed on this machine,
 * authenticated against the user's own subscription.
 *
 * Swarm OS deliberately does not implement a "Login with Claude" button, does
 * not touch OAuth tokens, and does not read the keychain. The user runs
 * `claude auth login` once; every agent is a plain subprocess that resolves
 * those credentials itself. Swarm OS's only involvement in authentication is
 * removing variables that would push agents onto API billing (see ./env.ts).
 */

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type {
  AgentRuntime,
  AgentSpec,
  PreflightCheck,
  PreflightReport,
  SwarmEvent,
} from '../types.js';
import { NdjsonBuffer, translate, type TranslateContext } from './stream-json.js';
import { detectBillingEnv, scrubEnv } from './env.js';

const execFileAsync = promisify(execFile);

export interface ClaudeCodeLocalOptions {
  /** Path to the claude binary. Defaults to `claude` on PATH. */
  bin?: string;
  /** Default model for agents that do not specify one. */
  defaultModel?: string;
  /** Refuse to run when an API key is present, rather than only warning. */
  strictSubscription?: boolean;
}

export interface AuthStatus {
  loggedIn: boolean;
  authMethod?: string;
  apiProvider?: string;
  subscriptionType?: string;
  email?: string;
}

export class ClaudeCodeLocalRuntime implements AgentRuntime {
  readonly id = 'claude-code-local';

  private readonly bin: string;
  private readonly defaultModel: string | undefined;
  private readonly strictSubscription: boolean;

  constructor(opts: ClaudeCodeLocalOptions = {}) {
    this.bin = opts.bin ?? 'claude';
    this.defaultModel = opts.defaultModel;
    this.strictSubscription = opts.strictSubscription ?? true;
  }

  // -------------------------------------------------------------------------
  // Preflight
  // -------------------------------------------------------------------------

  async version(): Promise<string | undefined> {
    try {
      const { stdout } = await execFileAsync(this.bin, ['--version'], { timeout: 15_000 });
      return stdout.trim();
    } catch {
      return undefined;
    }
  }

  async authStatus(): Promise<AuthStatus | undefined> {
    try {
      const { stdout } = await execFileAsync(this.bin, ['auth', 'status', '--json'], {
        timeout: 20_000,
        env: scrubEnv().env,
      });
      const parsed: unknown = JSON.parse(stdout);
      if (typeof parsed !== 'object' || parsed === null) return undefined;
      return parsed as AuthStatus;
    } catch {
      return undefined;
    }
  }

  async preflight(): Promise<PreflightReport> {
    const checks: PreflightCheck[] = [];

    const version = await this.version();
    checks.push(
      version
        ? { name: 'claude-code', status: 'pass', detail: version }
        : {
            name: 'claude-code',
            status: 'fail',
            detail: `\`${this.bin}\` not found on PATH. Install Claude Code first.`,
          },
    );

    if (version) {
      const auth = await this.authStatus();
      if (!auth?.loggedIn) {
        checks.push({
          name: 'authentication',
          status: 'fail',
          detail: 'Not logged in. Run `claude auth login` (Swarm OS never handles credentials).',
        });
      } else {
        const subscription = auth.authMethod === 'claude.ai';
        checks.push({
          name: 'authentication',
          status: 'pass',
          detail: `${auth.email ?? 'signed in'} · ${auth.authMethod ?? 'unknown'}`,
        });
        checks.push(
          subscription
            ? {
                name: 'billing-basis',
                status: 'pass',
                detail: `subscription (${auth.subscriptionType ?? 'unknown plan'}) — no per-token API charges`,
              }
            : {
                name: 'billing-basis',
                status: 'warn',
                detail: `authMethod=${auth.authMethod ?? 'unknown'} — agents will bill per token, not against a subscription`,
              },
        );
      }
    }

    // The single most expensive mistake this tool can prevent.
    const billingVars = detectBillingEnv();
    checks.push(
      billingVars.length === 0
        ? {
            name: 'api-key-env',
            status: 'pass',
            detail: 'no API-billing variables set — agents will use the subscription',
          }
        : {
            name: 'api-key-env',
            status: this.strictSubscription ? 'fail' : 'warn',
            detail:
              `${billingVars.join(', ')} set in this shell. Claude Code prefers these over your ` +
              `subscription, so every agent would bill per token. Swarm OS strips them from ` +
              `child processes, but unset them to be certain.`,
          },
    );

    const ok = !checks.some((c) => c.status === 'fail');
    return { ok, runtime: this.id, checks };
  }

  // -------------------------------------------------------------------------
  // Running an agent
  // -------------------------------------------------------------------------

  buildArgs(spec: AgentSpec): string[] {
    const lean = spec.lean !== false;
    const args: string[] = ['-p', spec.prompt];

    args.push('--output-format', 'stream-json', '--verbose');

    const model = spec.model ?? this.defaultModel;
    if (model) args.push('--model', model);

    if (spec.resume) {
      args.push('--resume', spec.resume);
    } else {
      args.push('--session-id', spec.sessionId ?? randomUUID());
    }

    if (spec.systemPrompt) args.push('--append-system-prompt', spec.systemPrompt);

    for (const dir of spec.addDirs ?? []) args.push('--add-dir', dir);

    // An explicitly empty list means "no tools at all", which is how system
    // agents are prevented from exploring the repo. Omitting the flag entirely
    // would hand them the full default toolset instead.
    if (spec.tools !== undefined) args.push('--tools', spec.tools.join(','));

    args.push('--permission-mode', spec.permissionMode ?? 'acceptEdits');

    if (spec.jsonSchema !== undefined) {
      args.push('--json-schema', JSON.stringify(spec.jsonSchema));
    }

    if (typeof spec.maxBudgetUsd === 'number') {
      args.push('--max-budget-usd', String(spec.maxBudgetUsd));
    }

    if (spec.ephemeral) args.push('--no-session-persistence');

    // Lean mode. Measured on Claude Code 2.1.231 with an empty prompt:
    // ambient environment ~95k baseline tokens, lean ~12k. Every agent pays
    // this before reading a single line of the user's code, so it is the
    // difference between four agents and thirty in one rate-limit window.
    if (lean) {
      args.push('--strict-mcp-config');
      args.push('--disable-slash-commands');
      args.push('--setting-sources', spec.settingSources ?? '');
    } else if (spec.settingSources !== undefined) {
      args.push('--setting-sources', spec.settingSources);
    }

    return args;
  }

  async *run(spec: AgentSpec, signal?: AbortSignal): AsyncIterable<SwarmEvent> {
    const args = this.buildArgs(spec);
    const { env } = scrubEnv();

    const ctx: TranslateContext = {
      agentId: spec.id,
      role: spec.role,
      ...(spec.module ? { module: spec.module } : {}),
      cwd: spec.cwd,
    };

    const child = spawn(this.bin, args, {
      cwd: spec.cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const queue: SwarmEvent[] = [];
    let resolveWaiter: (() => void) | undefined;
    let finished = false;
    let failure: Error | undefined;

    const wake = (): void => {
      resolveWaiter?.();
      resolveWaiter = undefined;
    };
    const emit = (event: SwarmEvent): void => {
      queue.push(event);
      wake();
    };

    const buffer = new NdjsonBuffer();
    let stderrTail = '';
    let sawDone = false;

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      for (const raw of buffer.push(chunk)) {
        for (const event of translate(raw, ctx)) {
          if (event.type === 'agent.done') sawDone = true;
          emit(event);
        }
      }
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderrTail = (stderrTail + chunk).slice(-4000);
    });

    child.on('error', (err) => {
      failure = err instanceof Error ? err : new Error(String(err));
      finished = true;
      wake();
    });

    child.on('close', (code) => {
      for (const raw of buffer.flush()) {
        for (const event of translate(raw, ctx)) {
          if (event.type === 'agent.done') sawDone = true;
          emit(event);
        }
      }
      // A non-zero exit without a result event means the process died before
      // reporting. Synthesize a terminal event so consumers always see one.
      if (!sawDone) {
        emit({
          type: 'agent.error',
          at: new Date().toISOString(),
          agentId: spec.id,
          message:
            code === 0
              ? 'agent exited without producing a result'
              : `agent exited with code ${code}${stderrTail ? `: ${stderrTail.trim()}` : ''}`,
        });
      }
      finished = true;
      wake();
    });

    const onAbort = (): void => {
      child.kill('SIGTERM');
      // Escalate if it ignores the polite request.
      setTimeout(() => {
        if (child.exitCode === null) child.kill('SIGKILL');
      }, 5_000).unref?.();
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    try {
      while (true) {
        while (queue.length > 0) {
          yield queue.shift() as SwarmEvent;
        }
        if (finished) break;
        await new Promise<void>((resolve) => {
          resolveWaiter = resolve;
        });
      }
      while (queue.length > 0) {
        yield queue.shift() as SwarmEvent;
      }
      if (failure) {
        yield {
          type: 'agent.error',
          at: new Date().toISOString(),
          agentId: spec.id,
          message:
            failure.message.includes('ENOENT')
              ? `\`${this.bin}\` not found on PATH`
              : failure.message,
        };
      }
    } finally {
      signal?.removeEventListener('abort', onAbort);
      if (child.exitCode === null) child.kill('SIGTERM');
    }
  }
}
