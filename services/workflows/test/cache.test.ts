import { afterEach, describe, expect, it } from "vitest";
import { cached, InfraError } from "../src/steps/llm.js";

const tag = `test-${Date.now()}-${Math.random()}`;
afterEach(() => { delete process.env.LLM_CACHE; });

describe("LLM disk cache", () => {
  it("calls the model once per distinct key, and salts keep repeats separate", async () => {
    let calls = 0;
    const fn = async () => ++calls;
    expect(await cached([tag, "a"], fn)).toBe(1);
    expect(await cached([tag, "a"], fn)).toBe(1);
    expect(await cached([tag, "a", "run1"], fn)).toBe(2);
    expect(calls).toBe(2);
  });
  it("replay mode never calls the model on a miss", async () => {
    process.env.LLM_CACHE = "replay";
    let calls = 0;
    await expect(cached([tag, "miss"], async () => ++calls)).rejects.toBeInstanceOf(InfraError);
    expect(calls).toBe(0);
    expect(await cached([tag, "a"], async () => 99)).toBe(1);
  });
});
