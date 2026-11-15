import { describe, expect, it } from "vitest";
import { classify, GeminiRouter, gmiMaxTokens, gmiModelId } from "@unprompted/shared/gemini-policy";

// A fake clock and sleep, so cooldowns and throttles run instantly and deterministically.
function setup(env: Record<string, string> = {}) {
  let t = 1_000_000;
  const logs: string[] = [];
  const router = new GeminiRouter({
    env: { GEMINI_TIMEOUT_MS: "1000", ...env },
    now: () => t,
    sleep: async (ms) => {
      t += ms;
    },
    log: (l) => logs.push(l),
  });
  return { router, logs, advance: (ms: number) => (t += ms) };
}
const quota = () => Object.assign(new Error('429 RESOURCE_EXHAUSTED {"retryDelay": "5s"}'), { status: 429 });

describe("Gemini routing policy", () => {
  it("sends this call to GMI on a 429 and skips the direct key while it cools down", async () => {
    const { router, logs, advance } = setup();
    let direct = 0;
    let gmi = 0;
    const routes = {
      direct: async () => {
        direct++;
        throw quota();
      },
      gmi: async () => ++gmi,
    };
    expect((await router.call("gemini-3.6-flash", routes)).route).toBe("gmi");
    expect(logs).toEqual(["[gemini] model=gemini-3.6-flash route=direct reason=primary", "[gemini] model=gemini-3.6-flash route=gmi reason=429,cooldown=60s"]);
    // Within the cooldown the direct key isn't called at all.
    advance(30_000);
    expect((await router.call("gemini-3.6-flash", routes)).route).toBe("gmi");
    expect(direct).toBe(1);
    expect(logs.at(-1)).toMatch(/route=gmi reason=cooldown\(30s\)/);
    // After the timer, direct is tried again.
    advance(31_000);
    await router.call("gemini-3.6-flash", routes);
    expect(direct).toBe(2);
  });

  it("backs off on repeated 429s, honours Google's retry delay, caps at 10 min, and resets on success", () => {
    const { router } = setup();
    expect(router.markFailure("m", "quota", 5000)).toBe(60_000); // hint shorter than the base
    expect(router.markFailure("m", "quota")).toBe(120_000);
    expect(router.markFailure("m", "quota")).toBe(240_000);
    for (let i = 0; i < 5; i++) router.markFailure("m", "quota");
    expect(router.coolingFor("m")).toBe(600_000);
    expect(router.markFailure("x", "quota", 300_000)).toBe(300_000); // a long hint wins
    router.markSuccess("m");
    expect(router.coolingFor("m")).toBe(0);
    expect(router.markFailure("m", "quota")).toBe(60_000);
  });

  it("treats a hung call as a timeout and falls to GMI", async () => {
    const { router, logs } = setup();
    const out = await router.call("gemini-3.8-flash", { direct: () => new Promise(() => {}), gmi: async () => "ok" }, { timeoutMs: 20 });
    expect(out).toEqual({ value: "ok", route: "gmi" });
    expect(logs.at(-1)).toMatch(/route=gmi reason=timeout,cooldown=60s/);
    expect(router.coolingFor("gemini-3.8-flash")).toBe(60_000);
  });

  it("503 cools down; other errors fall through without a cooldown", async () => {
    const { router } = setup();
    await router.call("a", { direct: async () => Promise.reject(Object.assign(new Error("503 UNAVAILABLE"), { status: 503 })), gmi: async () => 1 });
    expect(router.coolingFor("a")).toBe(60_000);
    await router.call("b", { direct: async () => Promise.reject(new Error("400 bad schema")), gmi: async () => 1 });
    expect(router.coolingFor("b")).toBe(0);
  });

  it("goes to GMI when the direct key's queue would wait too long (concurrency cap)", async () => {
    const { router, logs } = setup({ GEMINI_MAX_CONCURRENCY: "1", GEMINI_QUEUE_MAX_MS: "100" });
    let release!: () => void;
    const slow = router.call("m", { direct: () => new Promise<string>((r) => (release = () => r("direct"))), gmi: async () => "gmi" }, { timeoutMs: 10_000 });
    const second = await router.call("m", { direct: async () => "direct", gmi: async () => "gmi" });
    expect(second.route).toBe("gmi");
    expect(logs.at(-1)).toMatch(/route=gmi reason=throttle/);
    release();
    expect((await slow).route).toBe("direct");
  });

  it("respects GEMINI_RPM on the direct key", async () => {
    const { router } = setup({ GEMINI_RPM: "2", GEMINI_QUEUE_MAX_MS: "100" });
    const routes = { direct: async () => "d", gmi: async () => "g" };
    expect((await router.call("m", routes)).route).toBe("direct");
    expect((await router.call("m", routes)).route).toBe("direct");
    expect((await router.call("m", routes)).route).toBe("gmi");
  });

  it("with GMI first (prefer), a failed GMI call falls to direct unless direct is cooling down", async () => {
    const { router, logs } = setup();
    const out = await router.call("m", { gmi: async () => Promise.reject(new Error("GMI 500")), direct: async () => "d" }, { prefer: "gmi" });
    expect(out.route).toBe("direct");
    router.markFailure("m", "quota");
    await expect(router.call("m", { gmi: async () => Promise.reject(new Error("GMI 500")), direct: async () => "d" }, { prefer: "gmi" })).rejects.toThrow(/GMI 500/);
    expect(logs.at(-1)).toMatch(/route=direct reason=skipped,cooldown/);
  });

  it("without GMI, a long cooldown fails fast instead of hammering the direct key", async () => {
    const { router } = setup();
    router.markFailure("m", "quota");
    await expect(router.call("m", { direct: async () => "d" })).rejects.toThrow(/cooling down/);
  });

  it("maps direct ids to GMI ids, Gemini only", () => {
    expect(gmiModelId("gemini-3.6-flash")).toBe("google/gemini-3.6-flash");
    expect(gmiModelId("google/gemini-3.8-flash")).toBe("google/gemini-3.8-flash");
    expect(gmiModelId("gemini-3.1-flash-lite")).toBe("google/gemini-3.1-flash-lite-preview");
    expect(gmiModelId("gemini-flash-latest")).toBeNull();
    expect(gmiModelId("llama-3.3-70b")).toBeNull();
    expect(gmiMaxTokens(50)).toBe(1024);
    expect(gmiMaxTokens(8192)).toBe(8192);
  });

  it("classifies Google's errors and reads the retry delay", () => {
    expect(classify(quota())).toEqual({ kind: "quota", retryAfterMs: 5000 });
    expect(classify(new Error("got status: 503 UNAVAILABLE")).kind).toBe("unavailable");
    expect(classify(Object.assign(new Error("x"), { name: "TimeoutError" })).kind).toBe("timeout");
    expect(classify(new Error("400 INVALID_ARGUMENT")).kind).toBe("other");
  });
});
