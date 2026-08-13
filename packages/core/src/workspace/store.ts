/**
 * Read/write access to a project's `.swarm/` directory.
 *
 * Everything Swarm OS knows about a repository lives here as plain markdown and
 * YAML: readable by a human, diffable in git, and — critically — loadable by an
 * agent a piece at a time instead of all at once.
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile, appendFile, rm, rename } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';

import { parse, stringify } from 'yaml';

import type { MissionRecord, ModuleSpec, SwarmEvent, SwarmRecord } from '../types.js';
import { DEFAULT_CONFIG, parseConfig, serializeConfig, type SwarmConfig } from './config.js';

export const SWARM_DIR = '.swarm';

/** Files that live inside a module's directory. */
export type ModuleFile = 'module.md' | 'memory.md' | 'decisions.md' | 'verification.md';

/** Cheap token estimate. Good enough for budgeting memory files. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** One area of a module whose memory is split, with its estimated size. */
export interface MemoryArea {
  name: string;
  tokens: number;
}

/**
 * `.swarm/state.json`.
 *
 * Every field here has to survive a round-trip. An earlier version of
 * `readState` rebuilt this object from two known keys and dropped the rest,
 * which meant every `updateSwarm` — and so every sleep, wake and mission —
 * silently erased the fingerprints. Incremental mapping then never fired, and
 * `swarm map` reported "nothing to re-analyse" on a repository that had
 * changed completely. Read it whole, write it whole.
 */
export interface StateFile {
  swarms: Record<string, SwarmRecord>;
  mappedAt?: string;
  /** Digest fingerprint at map time, so drift can be detected without a model. */
  digestHash?: string;
  /** Per-module file fingerprints, so only changed modules are re-analysed. */
  moduleHashes?: Record<string, string>;
  /** The system summary, reused when a re-map does not repartition. */
  system?: { summary: string; stack: string };
}

export class Workspace {
  readonly repoRoot: string;
  readonly root: string;

  constructor(repoRoot: string) {
    this.repoRoot = resolve(repoRoot);
    this.root = join(this.repoRoot, SWARM_DIR);
  }

  /** Walk up from `start` looking for a repo that already has `.swarm/`. */
  static find(start: string): Workspace | undefined {
    let dir = resolve(start);
    while (true) {
      if (existsSync(join(dir, SWARM_DIR, 'config.yaml'))) return new Workspace(dir);
      const parent = dirname(dir);
      if (parent === dir) return undefined;
      dir = parent;
    }
  }

  get exists(): boolean {
    return existsSync(join(this.root, 'config.yaml'));
  }

  // -- config ---------------------------------------------------------------

  async readConfig(): Promise<SwarmConfig> {
    try {
      return parseConfig(await readFile(join(this.root, 'config.yaml'), 'utf8'));
    } catch {
      return { ...DEFAULT_CONFIG };
    }
  }

  async writeConfig(config: SwarmConfig): Promise<void> {
    await mkdir(this.root, { recursive: true });
    await writeFile(join(this.root, 'config.yaml'), serializeConfig(config), 'utf8');
  }

  // -- system map -----------------------------------------------------------

  async readSystem(): Promise<string> {
    try {
      return await readFile(join(this.root, 'system.md'), 'utf8');
    } catch {
      return '';
    }
  }

  async writeSystem(markdown: string): Promise<void> {
    await mkdir(this.root, { recursive: true });
    await writeFile(join(this.root, 'system.md'), markdown, 'utf8');
  }

  /** Write a top-level report into `.swarm/`, e.g. REFACTOR.md. */
  async writeSystemFile(name: string, content: string): Promise<void> {
    await mkdir(this.root, { recursive: true });
    await writeFile(join(this.root, name), content, 'utf8');
  }

  /** Read a top-level report from `.swarm/`, e.g. REFACTOR.md. Empty if absent. */
  async readSystemFile(name: string): Promise<string> {
    try {
      return await readFile(join(this.root, name), 'utf8');
    } catch {
      return '';
    }
  }

  // -- modules --------------------------------------------------------------

  moduleDir(slug: string): string {
    return join(this.root, 'modules', slug);
  }

  async listModules(): Promise<ModuleSpec[]> {
    const dir = join(this.root, 'modules');
    let entries: string[];
    try {
      entries = (await readdir(dir, { withFileTypes: true }))
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
    } catch {
      return [];
    }
    const specs: ModuleSpec[] = [];
    for (const slug of entries.sort()) {
      const spec = await this.readModule(slug);
      if (spec) specs.push(spec);
    }
    return specs;
  }

  async readModule(slug: string): Promise<ModuleSpec | undefined> {
    try {
      const raw: unknown = parse(await readFile(join(this.moduleDir(slug), 'ownership.yaml'), 'utf8'));
      if (typeof raw !== 'object' || raw === null) return undefined;
      const partial = raw as Partial<ModuleSpec>;
      return {
        slug,
        name: partial.name ?? slug,
        purpose: partial.purpose ?? '',
        owns: partial.owns ?? [],
        entryPoints: partial.entryPoints ?? [],
        dependsOn: partial.dependsOn ?? [],
        ...(partial.fileCount !== undefined ? { fileCount: partial.fileCount } : {}),
      };
    } catch {
      return undefined;
    }
  }

  async writeModule(spec: ModuleSpec, charter: string): Promise<void> {
    const dir = this.moduleDir(spec.slug);
    await mkdir(dir, { recursive: true });

    const ownership = {
      name: spec.name,
      purpose: spec.purpose,
      owns: spec.owns,
      entryPoints: spec.entryPoints,
      dependsOn: spec.dependsOn,
      ...(spec.fileCount !== undefined ? { fileCount: spec.fileCount } : {}),
    };
    await writeFile(
      join(dir, 'ownership.yaml'),
      `# Paths this module owns. Agents are scoped to these globs and their\n` +
        `# diffs are checked against them after every mission.\n\n` +
        stringify(ownership),
      'utf8',
    );
    await writeFile(join(dir, 'module.md'), charter, 'utf8');

    // Memory and decisions start empty and are only ever appended to or
    // compressed — never regenerated from scratch by `swarm map`.
    for (const [file, seed] of [
      ['memory.md', memorySeed(spec)],
      ['decisions.md', decisionsSeed(spec)],
    ] as const) {
      const path = join(dir, file);
      if (!existsSync(path)) await writeFile(path, seed, 'utf8');
    }
  }

  /**
   * Move module directories that are no longer in the map out of the way.
   *
   * Repartitioning changes the set of slugs. Leaving the old directories behind
   * corrupts the workspace silently — `listModules()` returns both maps at once,
   * ownership overlaps everywhere, and the UI shows modules that no longer
   * exist. Deleting them would destroy accumulated memory, which is the one
   * thing here that cost real tokens to produce. So they are archived.
   *
   * Returns the slugs that were moved.
   */
  async archiveModulesNotIn(keep: string[], label: string): Promise<string[]> {
    const dir = join(this.root, 'modules');
    let present: string[];
    try {
      present = (await readdir(dir, { withFileTypes: true }))
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
    } catch {
      return [];
    }

    const keepSet = new Set(keep);
    const stale = present.filter((slug) => !keepSet.has(slug));
    if (stale.length === 0) return [];

    const target = join(this.root, 'archive', label);
    await mkdir(target, { recursive: true });
    for (const slug of stale) {
      await rename(join(dir, slug), join(target, slug)).catch(async () => {
        // A name collision from a second repartition on the same day.
        await rm(join(target, slug), { recursive: true, force: true });
        await rename(join(dir, slug), join(target, slug));
      });
    }
    return stale;
  }

  async readModuleFile(slug: string, file: ModuleFile): Promise<string> {
    try {
      return await readFile(join(this.moduleDir(slug), file), 'utf8');
    } catch {
      return '';
    }
  }

  async writeModuleFile(slug: string, file: ModuleFile, content: string): Promise<void> {
    await mkdir(this.moduleDir(slug), { recursive: true });
    await writeFile(join(this.moduleDir(slug), file), content, 'utf8');
  }

  // -- areas ----------------------------------------------------------------

  areaDir(module: string, area: string): string {
    return join(this.moduleDir(module), 'areas', area);
  }

  async listAreas(module: string): Promise<string[]> {
    try {
      return (await readdir(join(this.moduleDir(module), 'areas'), { withFileTypes: true }))
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort();
    } catch {
      return [];
    }
  }

  async readAreaFile(module: string, area: string, file = 'memory.md'): Promise<string> {
    try {
      return await readFile(join(this.areaDir(module, area), file), 'utf8');
    } catch {
      return '';
    }
  }

  async writeAreaFile(
    module: string,
    area: string,
    file: string,
    content: string,
  ): Promise<void> {
    await mkdir(this.areaDir(module, area), { recursive: true });
    await writeFile(join(this.areaDir(module, area), file), content, 'utf8');
  }

  /** Drop area directories that the current detection no longer produces. */
  async pruneAreas(module: string, keep: string[]): Promise<void> {
    const keepSet = new Set(keep);
    for (const area of await this.listAreas(module)) {
      if (!keepSet.has(area)) {
        await rm(this.areaDir(module, area), { recursive: true, force: true });
      }
    }
  }

  async appendDecision(slug: string, entry: string): Promise<void> {
    await mkdir(this.moduleDir(slug), { recursive: true });
    await appendFile(join(this.moduleDir(slug), 'decisions.md'), entry, 'utf8');
  }

  // -- swarm state ----------------------------------------------------------

  private statePath(): string {
    return join(this.root, 'state.json');
  }

  async readState(): Promise<StateFile> {
    try {
      const raw: unknown = JSON.parse(await readFile(this.statePath(), 'utf8'));
      if (typeof raw !== 'object' || raw === null) return { swarms: {} };
      // Preserve every field, including any this version does not know about.
      // Rebuilding from known keys loses the fingerprints on the next write.
      const state = raw as Partial<StateFile> & Record<string, unknown>;
      return { ...state, swarms: state.swarms ?? {} } as StateFile;
    } catch {
      return { swarms: {} };
    }
  }

  async writeState(state: StateFile): Promise<void> {
    await mkdir(this.root, { recursive: true });
    await writeFile(this.statePath(), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  }

  async updateSwarm(slug: string, patch: Partial<SwarmRecord>): Promise<SwarmRecord> {
    const state = await this.readState();
    const current: SwarmRecord = state.swarms[slug] ?? { module: slug, state: 'sleeping' };
    const next: SwarmRecord = { ...current, ...patch, module: slug };
    state.swarms[slug] = next;
    await this.writeState(state);
    return next;
  }

  /**
   * Swarm record for a module, defaulting to sleeping with its memory cost.
   *
   * When the module's memory is split by area (see `listAreas`), also returns
   * `memoryAreas`: one entry per area with its own estimated token size, so a
   * caller can show the breakdown rather than just the module-level total.
   * Absent for modules with a single, unsplit `memory.md`.
   */
  async swarmRecord(slug: string): Promise<SwarmRecord & { memoryAreas?: MemoryArea[] }> {
    const state = await this.readState();
    const record = state.swarms[slug] ?? { module: slug, state: 'sleeping' as const };
    const memory = await this.readModuleFile(slug, 'memory.md');
    const areas = await this.listAreas(slug);
    if (areas.length === 0) {
      return { ...record, memoryTokens: estimateTokens(memory) };
    }
    const memoryAreas: MemoryArea[] = [];
    for (const area of areas) {
      const text = await this.readAreaFile(slug, area);
      memoryAreas.push({ name: area, tokens: estimateTokens(text) });
    }
    return { ...record, memoryTokens: estimateTokens(memory), memoryAreas };
  }

  // -- missions -------------------------------------------------------------

  missionDir(id: string): string {
    return join(this.root, 'missions', id);
  }

  async writeMission(record: MissionRecord): Promise<void> {
    const dir = this.missionDir(record.id);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'mission.json'), `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  }

  async readMission(id: string): Promise<MissionRecord | undefined> {
    try {
      const raw: unknown = JSON.parse(await readFile(join(this.missionDir(id), 'mission.json'), 'utf8'));
      return raw as MissionRecord;
    } catch {
      return undefined;
    }
  }

  async listMissions(): Promise<MissionRecord[]> {
    const dir = join(this.root, 'missions');
    let ids: string[];
    try {
      ids = (await readdir(dir, { withFileTypes: true }))
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
    } catch {
      return [];
    }
    const out: MissionRecord[] = [];
    for (const id of ids.sort().reverse()) {
      const record = await this.readMission(id);
      if (record) out.push(record);
    }
    return out;
  }

  async writeMissionFile(id: string, name: string, content: string): Promise<void> {
    const dir = this.missionDir(id);
    await mkdir(dirname(join(dir, name)), { recursive: true });
    await writeFile(join(dir, name), content, 'utf8');
  }

  /** Append one normalized event to the mission's durable log. */
  async logEvent(id: string, event: SwarmEvent): Promise<void> {
    const dir = this.missionDir(id);
    await mkdir(dir, { recursive: true });
    await appendFile(join(dir, 'events.jsonl'), `${JSON.stringify(event)}\n`, 'utf8');
  }

  async removeMission(id: string): Promise<void> {
    await rm(this.missionDir(id), { recursive: true, force: true });
  }

  /** Path relative to the repo root, for display. */
  rel(path: string): string {
    return relative(this.repoRoot, path) || '.';
  }
}

function memorySeed(spec: ModuleSpec): string {
  return [
    `# ${spec.name} — memory`,
    '',
    'Compressed, durable knowledge about this module. Written by agents at the',
    'end of a mission and read by agents at the start of the next one. This file',
    'is what makes a sleeping swarm cheap: it replaces re-reading the code.',
    '',
    'Keep it under the project memory budget. Facts and invariants, not narration.',
    '',
    '## Invariants',
    '',
    '_None recorded yet._',
    '',
    '## Landmarks',
    '',
    '_None recorded yet._',
    '',
    '## Gotchas',
    '',
    '_None recorded yet._',
    '',
  ].join('\n');
}

function decisionsSeed(spec: ModuleSpec): string {
  return [
    `# ${spec.name} — decisions`,
    '',
    'Append-only log. One entry per consequential choice, newest at the bottom.',
    '',
  ].join('\n');
}
