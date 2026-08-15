/**
 * Filing a module's compressed memory into its areas.
 *
 * The compressor runs with no tools, so it cannot write to an area file
 * itself — it can only mark which facts belong where. This does the filing.
 *
 * That ordering is the whole point. A compressor asked to *omit* area-specific
 * detail in order to fit a budget would destroy it, and destroying knowledge to
 * fit a budget is the failure the area mechanism exists to end.
 */

export interface AreaSections {
  /** Module-level memory, with every area section lifted out of it. */
  module: string;
  /** Area slug to the markdown filed under it. Empty sections are dropped. */
  areas: Record<string, string>;
}

const AREA_HEADING = /^##\s+Area:\s*(.+?)\s*$/;
const ANY_HEADING = /^##\s+/;

/** Separate `## Area: <slug>` sections from the rest of a memory file. */
export function splitAreaSections(markdown: string): AreaSections {
  const moduleLines: string[] = [];
  const areas = new Map<string, string[]>();
  let current: string[] | undefined;

  for (const line of markdown.split('\n')) {
    const heading = AREA_HEADING.exec(line);
    if (heading) {
      const slug = (heading[1] ?? '').trim();
      // An unnamed area names no file, so its contents have nowhere to go.
      current = slug ? (areas.get(slug) ?? areas.set(slug, []).get(slug)) : undefined;
      continue;
    }
    if (ANY_HEADING.test(line)) current = undefined;
    (current ?? moduleLines).push(line);
  }

  const filed: Record<string, string> = {};
  for (const [slug, lines] of areas) {
    const text = lines.join('\n').trim();
    if (text) filed[slug] = text;
  }

  return { module: `${moduleLines.join('\n').trimEnd()}\n`, areas: filed };
}

const MISSIONS_HEADING = '## From missions';

/**
 * Fold facts filed under an area into that area's own memory.
 *
 * Appended rather than rewritten by a model: an area file is read on demand by
 * an agent already working in that area, so it can afford to grow. What it
 * cannot afford is to lose a fact, or to repeat one.
 */
export function mergeAreaMemory(existing: string, additions: string): string {
  const bullets = (text: string): string[] =>
    text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('- '));

  const seen = new Set(bullets(existing));
  const fresh = bullets(additions).filter((line) => !seen.has(line));
  if (fresh.length === 0) return existing;

  const base = existing.trimEnd();
  // `## From missions` is only ever the last section — nothing writes below it.
  if (base.includes(MISSIONS_HEADING)) return `${base}\n${fresh.join('\n')}\n`;
  return `${base ? `${base}\n\n` : ''}${MISSIONS_HEADING}\n\n${fresh.join('\n')}\n`;
}
