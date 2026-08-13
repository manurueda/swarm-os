/** Minimal argv parsing. Subcommand, positionals, long flags. */

export interface ParsedArgs {
  command: string;
  positionals: string[];
  flags: Record<string, string | boolean>;
}

export function parseArgs(argv: string[]): ParsedArgs {
  // `swarm --version` and `swarm --help` have no subcommand at all, so only
  // treat the first token as one when it is not a flag.
  const hasCommand = argv.length > 0 && !argv[0]?.startsWith('-');
  const command = hasCommand ? (argv[0] as string) : '';
  const rest = hasCommand ? argv.slice(1) : argv;

  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i] as string;
    if (token === '--') {
      positionals.push(...rest.slice(i + 1));
      break;
    }
    if (token.startsWith('--')) {
      const body = token.slice(2);
      const eq = body.indexOf('=');
      if (eq !== -1) {
        flags[body.slice(0, eq)] = body.slice(eq + 1);
      } else {
        const next = rest[i + 1];
        if (next !== undefined && !next.startsWith('-')) {
          flags[body] = next;
          i += 1;
        } else {
          flags[body] = true;
        }
      }
    } else if (token.startsWith('-') && token.length > 1) {
      flags[token.slice(1)] = true;
    } else {
      positionals.push(token);
    }
  }

  return { command, positionals, flags };
}

export function flagString(flags: ParsedArgs['flags'], name: string): string | undefined {
  const value = flags[name];
  return typeof value === 'string' ? value : undefined;
}

export function flagBool(flags: ParsedArgs['flags'], name: string): boolean {
  return flags[name] === true || flags[name] === 'true';
}

export function flagNumber(flags: ParsedArgs['flags'], name: string): number | undefined {
  const value = flagString(flags, name);
  if (value === undefined) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/** Comma- or space-separated list flag. */
export function flagList(flags: ParsedArgs['flags'], name: string): string[] | undefined {
  const value = flagString(flags, name);
  if (value === undefined) return undefined;
  return value
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}
