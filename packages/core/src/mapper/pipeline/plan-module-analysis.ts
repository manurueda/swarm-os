/**
 * Whether a proposed module needs a fresh analyst, or its last analysis still
 * holds.
 */

import type { ModuleSpec } from '../../types.js';
import type { RepoDigest } from '../digest.js';
import { filesFor, hashFiles } from './module-files.js';

export interface ModuleAnalysisPlan {
  /** The spec, with fileCount filled in from the digest. */
  spec: ModuleSpec;
  hash: string;
  /** True when this module's fingerprint matches the last recorded one. */
  unchanged: boolean;
}

export function planModuleAnalysis(
  digest: RepoDigest,
  spec: ModuleSpec,
  previousHashes: Record<string, string>,
  force: boolean,
): ModuleAnalysisPlan {
  const owned = filesFor(digest, spec.owns);
  const hash = hashFiles(owned, digest.fingerprints);
  const unchanged = !force && previousHashes[spec.slug] === hash;
  return { spec: { ...spec, fileCount: owned.length }, hash, unchanged };
}
