import { describe, expect, it } from "vitest";
import { validSolveRates } from "../src/steps/adapters.js";
import { wilson } from "../src/steps/answers.js";

describe("variant re-attack evidence", () => {
  it("counts only submitted, provider-clean runs (an unsubmitted run is not 'agent failed')", () => {
    // Shape of the real case: run B picked the right answers, hit max_steps, never submitted.
    const res = validSolveRates(
      {
        runs: [
          { runId: "A", submitted: true, infraError: false },
          { runId: "B", submitted: false, infraError: false },
          { runId: "C", submitted: false, infraError: true },
        ],
        agentRuns: [
          { id: "A:v1", itemId: "v1", correct: false },
          { id: "B:v1", itemId: "v1", correct: false }, // scored wrong only because it never submitted
          { id: "C:v1", itemId: "v1", correct: false },
        ],
      },
      ["v1"],
    );
    expect(res.solveRates).toEqual([{ itemId: "v1", runs: 1, correct: 0, solveRate: 0, agentSolvable: false }]);
    expect(res.excluded).toEqual({ unsubmitted: 1, providerErrors: 1, total: 3 });
  });

  it("Wilson interval matches known values", () => {
    const [lo, hi] = wilson(0, 5);
    expect(lo).toBe(0);
    expect(hi).toBeCloseTo(0.4345, 3);
    const [lo2, hi2] = wilson(10, 10);
    expect(lo2).toBeCloseTo(0.7225, 3);
    expect(hi2).toBe(1);
  });
});
