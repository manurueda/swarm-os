import type { Workspace } from '../../workspace/store.js';
import type { SwarmConfig } from '../../workspace/config.js';
import { detectVerifyCommand } from './detect-verify-command.js';

/**
 * Runs on every `swarm map`, before anything else touches config. An empty
 * `verifyCommand` disables the mission verify loop without a word of warning
 * — this is what makes that a visible, deliberate choice instead. Only ever
 * fills a blank; a value the user already set is never overwritten.
 *
 * Returns undefined when there was nothing to report — `verifyCommand` was
 * already set, so detection did not run at all.
 */
export async function applyVerifyCommandDetection(
  workspace: Workspace,
  config: SwarmConfig,
  dominantLanguage: string | undefined,
): Promise<string | undefined> {
  if (config.verifyCommand) return undefined;

  const detection = detectVerifyCommand(workspace.repoRoot, dominantLanguage);

  if (!detection.command) {
    return 'no verify command detected — missions will run without verification until verifyCommand is set.';
  }

  config.verifyCommand = detection.command;
  await workspace.writeConfig(config);

  const alternatives = detection.alternatives.map((a) => a.command);
  return (
    `detected verifyCommand: ${detection.command} because ${detection.reason}` +
    `, alternatives: [${alternatives.join(', ')}]`
  );
}
