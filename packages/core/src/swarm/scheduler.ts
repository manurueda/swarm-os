/**
 * Concurrency control for agent processes.
 *
 * A subscription is a shared, finite budget: every concurrent agent draws from
 * the same rate-limit window. So this is not a throughput optimizer — it is a
 * spending policy. It runs at most `limit` agents at once and stops launching
 * new ones the moment the runtime reports the window is exhausted, rather than
 * discovering it one failed agent at a time.
 */

import type { RateLimitSnapshot, SwarmEvent } from '../types.js';

export interface SchedulerOptions {
  limit: number;
  /** Rate-limit statuses that should stop new launches. */
  pauseOnStatus?: string[];
  /** Called when the scheduler decides to hold back. */
  onPause?: (snapshot: RateLimitSnapshot) => void;
}

export class Scheduler {
  private readonly limit: number;
  private readonly pauseOnStatus: Set<string>;
  private readonly onPause: ((snapshot: RateLimitSnapshot) => void) | undefined;

  private paused = false;
  private lastRateLimit: RateLimitSnapshot | undefined;

  constructor(options: SchedulerOptions) {
    this.limit = Math.max(1, options.limit);
    this.pauseOnStatus = new Set(options.pauseOnStatus ?? ['rejected', 'blocked']);
    this.onPause = options.onPause;
  }

  /** Feed the scheduler every event so it can react to rate-limit signals. */
  observe(event: SwarmEvent): void {
    if (event.type !== 'ratelimit') return;
    this.lastRateLimit = event.snapshot;
    if (this.pauseOnStatus.has(event.snapshot.status)) {
      if (!this.paused) this.onPause?.(event.snapshot);
      this.paused = true;
    }
  }

  get rateLimit(): RateLimitSnapshot | undefined {
    return this.lastRateLimit;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  /**
   * Run every task with bounded concurrency, preserving input order in the
   * result array. Tasks that throw resolve to an Error rather than rejecting
   * the batch, so one failed module never kills a whole mission.
   */
  async run<T>(tasks: Array<() => Promise<T>>): Promise<Array<T | Error>> {
    const results = new Array<T | Error>(tasks.length);
    let next = 0;

    const worker = async (): Promise<void> => {
      while (true) {
        const index = next;
        next += 1;
        if (index >= tasks.length) return;
        if (this.paused) {
          results[index] = new Error('skipped: subscription rate limit reached');
          continue;
        }
        const task = tasks[index];
        if (!task) return;
        try {
          results[index] = await task();
        } catch (err) {
          results[index] = err instanceof Error ? err : new Error(String(err));
        }
      }
    };

    const workers = Array.from({ length: Math.min(this.limit, tasks.length) }, () => worker());
    await Promise.all(workers);
    return results;
  }
}
