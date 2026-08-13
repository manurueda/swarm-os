/**
 * Terminal presentation.
 *
 * Swarm OS reads structured events, so the display is free to be a real status
 * board rather than a scroll of interleaved agent chatter. When several agents
 * work at once, each gets a line that updates in place; when stdout is not a
 * TTY (a pipe, a CI log) the same information degrades to plain appended lines.
 */

const useColor =
  process.stdout.isTTY === true &&
  process.env['NO_COLOR'] === undefined &&
  process.env['TERM'] !== 'dumb';

const wrap = (open: string, close: string) => (text: string) =>
  useColor ? `[${open}m${text}[${close}m` : text;

export const c = {
  bold: wrap('1', '22'),
  dim: wrap('2', '22'),
  red: wrap('31', '39'),
  green: wrap('32', '39'),
  yellow: wrap('33', '39'),
  blue: wrap('34', '39'),
  magenta: wrap('35', '39'),
  cyan: wrap('36', '39'),
  gray: wrap('90', '39'),
};

export const symbols = {
  active: '●',
  sleeping: '○',
  ok: '✓',
  fail: '✗',
  warn: '!',
  arrow: '→',
  bullet: '·',
};

export function heading(text: string): void {
  process.stdout.write(`\n${c.bold(text)}\n`);
}

export function line(text = ''): void {
  process.stdout.write(`${text}\n`);
}

export function note(text: string): void {
  process.stdout.write(`${c.gray(text)}\n`);
}

export function ok(text: string): void {
  process.stdout.write(`${c.green(symbols.ok)} ${text}\n`);
}

export function fail(text: string): void {
  process.stderr.write(`${c.red(symbols.fail)} ${text}\n`);
}

export function warn(text: string): void {
  process.stdout.write(`${c.yellow(symbols.warn)} ${text}\n`);
}

export function formatTokens(n: number | undefined): string {
  if (n === undefined) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

export function formatDuration(ms: number): string {
  if (ms < 1_000) return `${ms}ms`;
  const s = ms / 1_000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s % 60)}s`;
}

/** Truncate to `width`, adding an ellipsis when it does not fit. */
export function clip(text: string, width: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= width ? flat : `${flat.slice(0, Math.max(0, width - 1))}…`;
}

export function pad(text: string, width: number): string {
  return text.length >= width ? text : text + ' '.repeat(width - text.length);
}

/** Render a markdown-ish table with aligned columns. */
export function table(rows: string[][], opts: { head?: string[] } = {}): void {
  const all = opts.head ? [opts.head, ...rows] : rows;
  if (all.length === 0) return;
  const widths: number[] = [];
  for (const row of all) {
    row.forEach((cell, i) => {
      widths[i] = Math.max(widths[i] ?? 0, stripAnsi(cell).length);
    });
  }
  const render = (row: string[]): string =>
    row
      .map((cell, i) => {
        const width = widths[i] ?? 0;
        const visible = stripAnsi(cell).length;
        return i === row.length - 1 ? cell : cell + ' '.repeat(Math.max(0, width - visible));
      })
      .join('  ');

  if (opts.head) {
    line(c.gray(render(opts.head)));
  }
  for (const row of rows) line(render(row));
}

function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\[[0-9;]*m/g, '');
}

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/**
 * A block of lines redrawn in place.
 *
 * Each agent owns a row keyed by id. Rows persist for the life of the board, so
 * a finished agent stays visible with its outcome instead of vanishing.
 */
export class LiveBoard {
  private readonly order: string[] = [];
  private readonly rows = new Map<string, string>();
  private readonly interactive: boolean;
  private painted = 0;
  private frame = 0;
  private timer: NodeJS.Timeout | undefined;
  private footer = '';

  constructor(interactive = process.stdout.isTTY === true) {
    this.interactive = interactive;
  }

  spinner(): string {
    return SPINNER[this.frame % SPINNER.length] as string;
  }

  set(id: string, text: string): void {
    if (!this.rows.has(id)) this.order.push(id);
    const previous = this.rows.get(id);
    this.rows.set(id, text);
    if (!this.interactive && previous !== text) line(text);
    else this.paint();
  }

  setFooter(text: string): void {
    this.footer = text;
    if (this.interactive) this.paint();
  }

  /** Start animating; call `stop()` when the work is done. */
  start(): void {
    if (!this.interactive || this.timer) return;
    this.timer = setInterval(() => {
      this.frame += 1;
      this.paint();
    }, 90);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    if (this.interactive) this.paint();
  }

  private paint(): void {
    if (!this.interactive) return;
    const lines = [...this.order.map((id) => this.rows.get(id) ?? ''), ...(this.footer ? ['', this.footer] : [])];

    let out = '';
    if (this.painted > 0) out += `[${this.painted}A`;
    for (const l of lines) out += `[2K${l}\n`;
    // Clear any rows left over from a taller previous frame.
    for (let i = lines.length; i < this.painted; i += 1) out += '[2K\n';
    if (lines.length < this.painted) out += `[${this.painted - lines.length}A`;

    process.stdout.write(out);
    this.painted = Math.max(lines.length, this.painted === 0 ? lines.length : this.painted);
    this.painted = lines.length;
  }
}
