import type { Comparison } from "./critique";

export type Match = { a: string; b: string; result: Comparison; winner: string | null };
export type Tournament = { ids: string[]; bestId: string; matches: Match[] };

/**
 * Finds the best of several revisions with n-1 comparisons: the current champion meets each
 * challenger in turn. A tie keeps the champion (the earlier pick), and the match records it.
 */
export const runTournament = async (
  ids: string[],
  compare: (a: string, b: string) => Promise<Comparison>,
): Promise<Tournament> => {
  const matches: Match[] = [];
  let champion = ids[0];
  for (const challenger of ids.slice(1)) {
    const result = await compare(champion, challenger);
    const winner = result.winner === "tie" ? null : result.winner === "a" ? champion : challenger;
    matches.push({ a: champion, b: challenger, result, winner });
    if (winner) champion = winner;
  }
  return { ids, bestId: champion, matches };
};
