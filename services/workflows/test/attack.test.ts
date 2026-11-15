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
    expect(res.excluded).toEqual({ unsubmitted: 1, providerErrors: 1, unisolated: 0, wrongQuiz: 0, total: 3 });
  });

  it("never counts a run that ran outside the sandbox", () => {
    const res = validSolveRates(
      {
        runs: [
          { runId: "A", outcome: "submitted", submitted: true, isolated: false },
          { runId: "B", outcome: "submitted", submitted: true, isolated: true },
        ],
        agentRuns: [
          { id: "A:v1", itemId: "v1", correct: true },
          { id: "B:v1", itemId: "v1", correct: false },
        ],
      },
      ["v1"],
    );
    expect(res.solveRates[0]).toMatchObject({ runs: 1, correct: 0 });
    expect(res.excluded?.unisolated).toBe(1);
  });

  it("excludes a run that submitted a different quiz (the stage-1 calc bug)", () => {
    const res = validSolveRates(
      {
        runs: [
          { runId: "A", outcome: "wrong_quiz", submitted: false, isolated: true },
          { runId: "B", outcome: "submitted", submitted: true, isolated: true },
        ],
        agentRuns: [
          { id: "A:v1", itemId: "v1", correct: false },
          { id: "B:v1", itemId: "v1", correct: true },
        ],
      },
      ["v1"],
    );
    expect(res.solveRates[0]).toMatchObject({ runs: 1, correct: 1 });
    expect(res.excluded).toMatchObject({ wrongQuiz: 1, unsubmitted: 0 });
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
