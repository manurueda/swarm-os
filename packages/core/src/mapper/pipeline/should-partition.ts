/** Should this `swarm map` run redraw module boundaries, or reuse the existing map? */
export function shouldPartition(
  options: { force?: boolean; repartition?: boolean },
  existingModuleCount: number,
): boolean {
  return options.force === true || options.repartition === true || existingModuleCount === 0;
}
