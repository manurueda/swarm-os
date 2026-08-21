/**
 * Guess a project's verify command by inspecting its files — never by running
 * anything.
 *
 * `swarm map` writes `.swarm/config.yaml` with `verifyCommand: ''` whenever
 * nothing overrides it, and an empty `verifyCommand` silently disables the
 * whole mission verify loop: no build, no test, no gate — an unattended
 * mission just merges on the reviewer's word. This turns that from a default
 * nobody notices into a suggestion `swarm map` and `swarm doctor` can both
 * surface, without ever shelling out to find it.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface VerifyCommandCandidate {
  command: string;
  reason: string;
}

export interface VerifyCommandDetection {
  /** The suggested command, or null when nothing in the matrix matched. */
  command: string | null;
  /** Why `command` was chosen over any other candidate. Empty when `command` is null. */
  reason: string;
  /** Every other candidate found, in case the chosen one is wrong for this repo. */
  alternatives: VerifyCommandCandidate[];
}

const NPM_PLACEHOLDER = 'no test specified';
const JS_LANGUAGES = ['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs'];

function detectNpmCandidate(repoRoot: string): (VerifyCommandCandidate & { languages: string[] }) | undefined {
  const path = join(repoRoot, 'package.json');
  if (!existsSync(path)) return undefined;

  let scripts: Record<string, unknown> | undefined;
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (typeof parsed === 'object' && parsed !== null) {
      const s = (parsed as Record<string, unknown>)['scripts'];
      if (typeof s === 'object' && s !== null) scripts = s as Record<string, unknown>;
    }
  } catch {
    return undefined;
  }
  if (!scripts) return undefined;

  const test = scripts['test'];
  if (typeof test === 'string' && !test.includes(NPM_PLACEHOLDER)) {
    return { command: 'npm test', reason: 'package.json has a scripts.test entry', languages: JS_LANGUAGES };
  }

  const build = scripts['build'];
  if (typeof build === 'string') {
    return {
      command: 'npm run build',
      reason: 'package.json has a scripts.build entry but no usable scripts.test',
      languages: JS_LANGUAGES,
    };
  }

  return undefined;
}

/** Does `dir` (searched shallowly, bounded depth) contain at least one `.py` file? */
function hasPythonFile(dir: string, depth: number): boolean {
  if (depth > 4) return false;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (entry.isFile() && entry.name.endsWith('.py')) return true;
    if (entry.isDirectory() && hasPythonFile(join(dir, entry.name), depth + 1)) return true;
  }
  return false;
}

function detectPytestReasons(repoRoot: string): string[] {
  const reasons: string[] = [];

  if (existsSync(join(repoRoot, 'pyproject.toml'))) reasons.push('pyproject.toml');
  if (existsSync(join(repoRoot, 'pytest.ini'))) reasons.push('pytest.ini');

  const setupCfg = join(repoRoot, 'setup.cfg');
  if (existsSync(setupCfg)) {
    try {
      if (/^\[tool:pytest\]/m.test(readFileSync(setupCfg, 'utf8'))) reasons.push('setup.cfg [tool:pytest] section');
    } catch {
      /* unreadable — not evidence either way */
    }
  }

  const testsDir = join(repoRoot, 'tests');
  if (existsSync(testsDir) && statSync(testsDir).isDirectory() && hasPythonFile(testsDir, 0)) {
    reasons.push('tests/ contains .py files');
  }

  return reasons;
}

function detectPytestCandidate(repoRoot: string): (VerifyCommandCandidate & { languages: string[] }) | undefined {
  const reasons = detectPytestReasons(repoRoot);
  if (reasons.length === 0) return undefined;

  const venv = existsSync(join(repoRoot, '.venv')) && statSync(join(repoRoot, '.venv')).isDirectory();
  return {
    command: venv ? '.venv/bin/python -m pytest -q' : 'pytest -q',
    reason: reasons.join(', '),
    languages: ['py'],
  };
}

function detectMakeCandidate(repoRoot: string): (VerifyCommandCandidate & { languages: string[] }) | undefined {
  const path = join(repoRoot, 'Makefile');
  if (!existsSync(path)) return undefined;
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
  if (!/^test:/m.test(text)) return undefined;
  return { command: 'make test', reason: 'Makefile has a test: target', languages: [] };
}

/**
 * Every candidate the matrix can produce, in the order the mission spec lists
 * them. At most one candidate per source (a package.json contributes either
 * `npm test` or `npm run build`, never both).
 */
function allCandidates(repoRoot: string): Array<VerifyCommandCandidate & { languages: string[] }> {
  const candidates: Array<VerifyCommandCandidate & { languages: string[] }> = [];

  const npm = detectNpmCandidate(repoRoot);
  if (npm) candidates.push(npm);

  const pytest = detectPytestCandidate(repoRoot);
  if (pytest) candidates.push(pytest);

  if (existsSync(join(repoRoot, 'Cargo.toml'))) {
    candidates.push({ command: 'cargo test', reason: 'Cargo.toml found', languages: ['rs'] });
  }

  if (existsSync(join(repoRoot, 'go.mod'))) {
    candidates.push({ command: 'go test ./...', reason: 'go.mod found', languages: ['go'] });
  }

  const make = detectMakeCandidate(repoRoot);
  if (make) candidates.push(make);

  return candidates;
}

/**
 * Detect a candidate verify command by pure filesystem inspection. Never
 * executes anything and never touches the network.
 *
 * When more than one candidate applies, the one matching `dominantLanguage`
 * (an extension, e.g. `digest.languages[0]?.[0]`) is chosen and the rest are
 * returned as alternatives; without a match, the first candidate found — in
 * matrix order — is chosen.
 */
export function detectVerifyCommand(repoRoot: string, dominantLanguage?: string): VerifyCommandDetection {
  const candidates = allCandidates(repoRoot);

  if (candidates.length === 0) {
    return { command: null, reason: '', alternatives: [] };
  }

  const matchIndex = dominantLanguage
    ? candidates.findIndex((c) => c.languages.includes(dominantLanguage))
    : -1;
  const chosenIndex = matchIndex >= 0 ? matchIndex : 0;
  const chosen = candidates[chosenIndex] as VerifyCommandCandidate & { languages: string[] };

  const alternatives = candidates
    .filter((_, i) => i !== chosenIndex)
    .map(({ command, reason }) => ({ command, reason }));

  return { command: chosen.command, reason: chosen.reason, alternatives };
}
