import { expect, test } from "vitest";
import type { Comparison } from "../../src/writer/critique";
import { runTournament } from "../../src/writer/tournament";

const result = (winner: Comparison["winner"]): Comparison => ({ winner, reason: "r", remaining: [] });

test("champion meets each challenger and the last winner is best", async () => {
  const rank: Record<string, number> = { v1: 1, v2: 3, v3: 2 };
  const calls: string[] = [];
  const t = await runTournament(["v1", "v2", "v3"], async (a, b) => {
    calls.push(`${a}-${b}`);
    return result(rank[a] >= rank[b] ? "a" : "b");
  });
  expect(calls).toEqual(["v1-v2", "v2-v3"]);
  expect(t.bestId).toBe("v2");
  expect(t.matches.map((m) => m.winner)).toEqual(["v2", "v2"]);
});

test("a tie keeps the earlier pick and is recorded without a winner", async () => {
  const t = await runTournament(["v1", "v2"], async () => result("tie"));
  expect(t.bestId).toBe("v1");
  expect(t.matches[0].winner).toBeNull();
});
