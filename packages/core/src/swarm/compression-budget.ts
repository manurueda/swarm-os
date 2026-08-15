/**
 * Whether a sleep needs to spend a model call on compression at all.
 *
 * Nothing new happened and the file is already within budget — sleeping is
 * then just a state change, and should not cost a model call.
 */
export function shouldSkipCompression(
  missionReport: string | undefined,
  beforeTokens: number,
  budgetTokens: number,
): boolean {
  return !missionReport && beforeTokens <= budgetTokens;
}
