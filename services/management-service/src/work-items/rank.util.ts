/**
 * Deterministic Kanban ordering via sparse numeric ranks (gap of
 * RANK_GAP between freshly-created/appended items), with midpoint
 * insertion for moves/reorders. This is simpler than a full
 * lexicographic rank (e.g. LexoRank) and sufficient for Phase 3 - the
 * backend-only move/reorder API this supports has no drag/drop UI
 * yet. Known limitation, documented honestly: enough reorders between
 * the same two neighbors exhausts floating-point precision before a
 * new midpoint can be found; rebalanceColumn() recovers by respacing
 * the whole column, and callers must call it when needsRebalance()
 * says so.
 */
export const RANK_GAP = 1024;

export function initialRank(): number {
  return RANK_GAP;
}

export function appendRank(maxRankInColumn: number | null): number {
  return (maxRankInColumn ?? 0) + RANK_GAP;
}

/** `before`/`after` are the ranks of the items the moved item should
 * land between (either may be null if moving to an end). */
export function rankBetween(before: number | null, after: number | null): number {
  if (before === null && after === null) return RANK_GAP;
  if (before === null) return after! / 2;
  if (after === null) return before + RANK_GAP;
  return (before + after) / 2;
}

export function needsRebalance(before: number | null, after: number | null): boolean {
  if (before === null || after === null) return false;
  // No representable floating-point value strictly between them.
  return (before + after) / 2 === before || (before + after) / 2 === after;
}

/** Evenly re-spaces ranks for an already-ordered list of item ids. */
export function rebalancedRanks(orderedItemIds: string[]): Map<string, number> {
  const ranks = new Map<string, number>();
  orderedItemIds.forEach((id, index) => ranks.set(id, (index + 1) * RANK_GAP));
  return ranks;
}
