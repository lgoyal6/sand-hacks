// Gemini routing policy, shared by every Gemini call path (web via probe-core, workflows, Mastra agents).
// Gemini only (team rule): the two routes are the direct Gemini API key and GMI, which is only an
// OpenAI-compatible route to the SAME google/gemini-* models. No other model family is ever used.
//
// Per model, in process memory:
//  - Cooldown ("state timer"): a 429 / RESOURCE_EXHAUSTED, 503 / UNAVAILABLE or timeout on the direct key
//    marks that model cooling down (60 s, or Google's Retry-After / RetryInfo delay; repeated 429s back off
//    up to 10 min). This call goes to GMI right away, and while the timer runs the direct key is skipped.
//  - Throttle on the direct key: at most GEMINI_MAX_CONCURRENCY in flight and GEMINI_RPM per minute. A call
//    that would wait longer than GEMINI_QUEUE_MAX_MS goes to GMI instead.
//  - Per-call timeout (GEMINI_TIMEOUT_MS, default 30 s), so a hung call falls to the next route.
// One log line per routing decision: [gemini] model=… route=direct|gmi reason=…

export type GeminiRoute = "direct" | "gmi";

/** Direct model id -> GMI id. Ids GMI doesn't serve map to null (that caller moves to its next model). */
const GMI_IDS: Record<string, string | null> = {
  "gemini-3.1-flash-lite": "google/gemini-3.1-flash-lite-preview",
  "gemini-flash-latest": null,
};
/** Google ids GMI lists under /models (2026-11-15). */
const GMI_KNOWN = new Set([
  "gemini-3-flash-preview", "gemini-3.1-flash-lite-preview", "gemini-3.1-pro-preview", "gemini-3.5-flash", "gemini-3.5-flash-lite",
  "gemini-3.6-flash", "gemini-3.7-flash", "gemini-3.8-flash", "gemini-4-argon", "gemini-4-carbon",
]);

/** "gemini-3.6-flash" | "google/gemini-3.6-flash" -> "google/gemini-3.6-flash"; null if GMI has no such Gemini model. */
export function gmiModelId(model: string): string | null {
  const bare = model.replace(/^(gmi|gemini):/, "").replace(/^google\//, "");
  if (!bare.startsWith("gemini")) return null; // Gemini only, never another family
  if (bare in GMI_IDS) return GMI_IDS[bare]!;
  return GMI_KNOWN.has(bare) ? `google/${bare}` : null;
}

/** GMI reasoning models spend tokens thinking first: a small max_tokens returns null content. */
export const GMI_MIN_TOKENS = 1024;
export const gmiMaxTokens = (requested?: number) => Math.max(GMI_MIN_TOKENS, requested ?? GMI_MIN_TOKENS);

type Env = Record<string, string | undefined>;
const num = (env: Env, k: string, d: number) => {
  const v = Number(env[k]?.trim());
  return Number.isFinite(v) && v > 0 ? v : d;
};

export interface RouterOptions {
  env?: Env;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
}

export interface CallOptions {
  /** Which route to try first (default "direct"). The other one is the fallback. */
  prefer?: GeminiRoute;
  /** Override the per-call timeout (e.g. code execution needs longer). */
  timeoutMs?: number;
}

type Run<T> = (signal: AbortSignal) => Promise<T>;

export class TransientError extends Error {}

/** Why a direct call failed, for the cooldown: quota, unavailable, timeout, or something else. */
export function classify(err: unknown): { kind: "quota" | "unavailable" | "timeout" | "other"; retryAfterMs?: number } {
  const e = err as { status?: number; code?: number; name?: string; message?: string; retryAfterMs?: number } | undefined;
  const msg = String(e?.message ?? err ?? "");
  const status = e?.status ?? e?.code;
  const hint = typeof e?.retryAfterMs === "number" ? e.retryAfterMs : parseRetryDelay(msg);
  if (status === 429 || /\b429\b|RESOURCE_EXHAUSTED|rate.?limit|too many requests/i.test(msg)) return { kind: "quota", retryAfterMs: hint };
  if (e?.name === "TimeoutError" || e?.name === "AbortError" || /timed? ?out|timeout|aborted/i.test(msg)) return { kind: "timeout" };
  if (status === 503 || /\b503\b|UNAVAILABLE|overloaded|high demand/i.test(msg)) return { kind: "unavailable", retryAfterMs: hint };
  return { kind: "other" };
}

/** Google's RetryInfo ("retryDelay": "37s") or a Retry-After value in seconds, as ms. */
export function parseRetryDelay(text: string): number | undefined {
  const m = text.match(/retryDelay"?\s*[:=]\s*"?(\d+(?:\.\d+)?)s/i) ?? text.match(/retry-after"?\s*[:=]\s*"?(\d+(?:\.\d+)?)/i);
  return m ? Math.round(Number(m[1]) * 1000) : undefined;
}

export class GeminiRouter {
  private env: Env;
  private now: () => number;
  private sleep: (ms: number) => Promise<void>;
  private log: (line: string) => void;
  private cooldown = new Map<string, { until: number; strikes: number; reason: string }>();
  private inFlight = new Map<string, number>();
  private starts = new Map<string, number[]>();

  constructor(opts: RouterOptions = {}) {
    this.env = opts.env ?? (typeof process !== "undefined" ? process.env : {});
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.log = opts.log ?? ((l) => console.log(l));
  }

  private key = (model: string) => model.replace(/^(gmi|gemini):/, "").replace(/^google\//, "");

  /** Remaining cooldown for the direct key on this model, in ms (0 = usable). */
  coolingFor(model: string): number {
    const c = this.cooldown.get(this.key(model));
    return c ? Math.max(0, c.until - this.now()) : 0;
  }

  /** Mark the direct key cooling down for this model after a failure; returns the cooldown in ms. */
  markFailure(model: string, kind: "quota" | "unavailable" | "timeout", retryAfterMs?: number): number {
    const k = this.key(model);
    const prev = this.cooldown.get(k);
    const strikes = kind === "quota" ? (prev && prev.reason === "quota" ? prev.strikes + 1 : 1) : 1;
    const base = num(this.env, "GEMINI_COOLDOWN_MS", 60_000);
    const max = num(this.env, "GEMINI_COOLDOWN_MAX_MS", 600_000);
    const backoff = kind === "quota" ? Math.min(max, base * 2 ** (strikes - 1)) : base;
    const ms = Math.min(max, Math.max(backoff, retryAfterMs ?? 0));
    this.cooldown.set(k, { until: this.now() + ms, strikes, reason: kind });
    return ms;
  }

  markSuccess(model: string) {
    this.cooldown.delete(this.key(model));
  }

  /** Wait for a direct-key slot (concurrency + RPM). False if it would take longer than maxWaitMs. */
  async acquire(model: string, maxWaitMs = num(this.env, "GEMINI_QUEUE_MAX_MS", 3000)): Promise<boolean> {
    const k = this.key(model);
    const maxConc = num(this.env, "GEMINI_MAX_CONCURRENCY", 4);
    const rpm = num(this.env, "GEMINI_RPM", 15);
    const deadline = this.now() + maxWaitMs;
    for (;;) {
      const t = this.now();
      const recent = (this.starts.get(k) ?? []).filter((s) => s > t - 60_000);
      this.starts.set(k, recent);
      const conc = this.inFlight.get(k) ?? 0;
      const rpmWait = recent.length >= rpm ? recent[0]! + 60_000 - t : 0;
      if (conc < maxConc && rpmWait <= 0) {
        recent.push(t);
        this.inFlight.set(k, conc + 1);
        return true;
      }
      const wait = conc >= maxConc ? 50 : rpmWait;
      if (t + wait > deadline) return false;
      await this.sleep(wait);
    }
  }

  release(model: string) {
    const k = this.key(model);
    this.inFlight.set(k, Math.max(0, (this.inFlight.get(k) ?? 1) - 1));
  }

  private decide(model: string, route: GeminiRoute, reason: string) {
    this.log(`[gemini] model=${this.key(model)} route=${route} reason=${reason}`);
  }

  private withTimeout<T>(run: Run<T>, ms: number): Promise<T> {
    const ctrl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        ctrl.abort();
        const e = new Error(`timed out after ${ms} ms`);
        e.name = "TimeoutError";
        reject(e);
      }, ms);
    });
    return Promise.race([run(ctrl.signal), timeout]).finally(() => clearTimeout(timer));
  }

  /**
   * Run one Gemini call through the policy. `direct` and `gmi` are the two ways to make the SAME call
   * (same model); either may be missing. Returns the value and the route that served it. Throws the
   * last error when every available route failed, so callers keep their own fallbacks.
   */
  async call<T>(model: string, routes: { direct?: Run<T>; gmi?: Run<T> }, opts: CallOptions = {}): Promise<{ value: T; route: GeminiRoute }> {
    const timeoutMs = opts.timeoutMs ?? num(this.env, "GEMINI_TIMEOUT_MS", 30_000);
    const order: GeminiRoute[] = opts.prefer === "gmi" ? ["gmi", "direct"] : ["direct", "gmi"];
    let last: unknown = new Error(`no Gemini route for ${model} (set GEMINI_API_KEY or GMI_API_KEY)`);
    let reason = "primary";
    for (const route of order) {
      const run = routes[route];
      if (!run) continue;
      if (route === "direct") {
        const cool = this.coolingFor(model);
        const gmiLater = Boolean(routes.gmi) && order.indexOf("gmi") > order.indexOf("direct");
        if (cool > 0) {
          if (gmiLater) {
            reason = `cooldown(${Math.ceil(cool / 1000)}s)`;
            continue;
          }
          if (routes.gmi) {
            // GMI already failed for this call and the direct key is cooling down: don't hammer it.
            this.decide(model, "direct", `skipped,cooldown(${Math.ceil(cool / 1000)}s)`);
            continue;
          }
          // No GMI configured: wait out a short cooldown, otherwise fail fast.
          if (cool > num(this.env, "GEMINI_QUEUE_MAX_MS", 3000)) {
            this.decide(model, "direct", `cooldown(${Math.ceil(cool / 1000)}s),no-gmi`);
            throw new TransientError(`Gemini ${this.key(model)} is cooling down for ${Math.ceil(cool / 1000)} s after a quota/availability error, and GMI isn't configured`);
          }
          await this.sleep(cool);
        }
        if (!(await this.acquire(model))) {
          if (gmiLater) {
            reason = "throttle";
            continue;
          }
          await this.acquire(model, timeoutMs); // no fallback: wait longer for a slot
        }
        this.decide(model, "direct", reason);
        try {
          const value = await this.withTimeout(run, timeoutMs);
          this.markSuccess(model);
          return { value, route };
        } catch (err) {
          last = err;
          const c = classify(err);
          if (c.kind !== "other") {
            const ms = this.markFailure(model, c.kind, c.retryAfterMs);
            reason = `${c.kind === "quota" ? "429" : c.kind === "unavailable" ? "503" : "timeout"},cooldown=${Math.round(ms / 1000)}s`;
          } else {
            reason = `error:${String((err as Error)?.message ?? err).slice(0, 60).replace(/\s+/g, "_")}`;
          }
        } finally {
          this.release(model);
        }
      } else {
        this.decide(model, "gmi", reason);
        try {
          return { value: await this.withTimeout(run, timeoutMs), route };
        } catch (err) {
          last = err;
          reason = `gmi-failed:${String((err as Error)?.message ?? err).slice(0, 60).replace(/\s+/g, "_")}`;
        }
      }
    }
    throw last;
  }
}

/** The process-wide router (cooldowns are shared by every caller in this process). */
let shared: GeminiRouter | null = null;
export function geminiRouter(): GeminiRouter {
  shared ??= new GeminiRouter();
  return shared;
}
