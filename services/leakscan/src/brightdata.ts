// Bright Data clients. SERP API for search results; Browser API for evidence screenshots.
// Rules (CONTRACTS.md): public pages only, keep snippets/URLs/screenshots, never copyrighted solutions,
// and never solve CAPTCHAs. The Browser API auto-solves CAPTCHAs by default, so we turn that off
// and skip any page that shows a challenge. Web Unlocker is deliberately not used.

export interface SerpResult {
  title: string;
  url: string;
  snippet: string;
  rank: number;
}

export interface SearchClient {
  search(query: string): Promise<SerpResult[]>;
}

export interface BrightDataConfig {
  token: string;
  serpZone: string;
  /** Browser API websocket endpoint (wss://brd-customer-...-zone-...:password@brd.superproxy.io:9222). */
  browserWss?: string;
}

export function brightDataFromEnv(env = process.env): BrightDataConfig | null {
  const token = env.BRIGHTDATA_API_TOKEN;
  const serpZone = env.BRIGHTDATA_SERP_ZONE;
  if (!token || !serpZone) return null;
  let browserWss = env.BRIGHTDATA_BROWSER_WSS || undefined;
  if (!browserWss && env.BRIGHTDATA_CUSTOMER_ID && env.BRIGHTDATA_BROWSER_ZONE && env.BRIGHTDATA_BROWSER_PASSWORD) {
    browserWss = `wss://brd-customer-${env.BRIGHTDATA_CUSTOMER_ID}-zone-${env.BRIGHTDATA_BROWSER_ZONE}:${env.BRIGHTDATA_BROWSER_PASSWORD}@brd.superproxy.io:9222`;
  }
  return { token, serpZone, browserWss };
}

interface GoogleParsed {
  organic?: { link?: string; url?: string; title?: string; description?: string; snippet?: string; rank?: number; global_rank?: number }[];
}

/** Google results through the Bright Data SERP API (parsed JSON via brd_json=1). */
export class BrightDataSerp implements SearchClient {
  constructor(private cfg: BrightDataConfig, private opts: { num?: number; endpoint?: string; retries?: number } = {}) {}

  /** Retries transient failures (empty or non-JSON bodies, 429, 5xx) with backoff. */
  /** Google search with extra URL params (e.g. { tbs: "cdr:1,cd_min:1/1/2026,cd_max:1/31/2026" } for a date range). */
  async searchWith(query: string, params: Record<string, string>): Promise<SerpResult[]> {
    const saved = this.extra;
    this.extra = params;
    try {
      return await this.search(query);
    } finally {
      this.extra = saved;
    }
  }
  private extra: Record<string, string> = {};

  async search(query: string): Promise<SerpResult[]> {
    const attempts = this.opts.retries ?? 3;
    let last: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        return await this.searchOnce(query);
      } catch (e) {
        last = e;
        if (!(e as { transient?: boolean }).transient) throw e;
        // Bright Data refuses a retry of the same failed query for 15 s.
        const cooldown = /minimum of 15 seconds/i.test(String((e as Error).message)) ? 16_000 : 0;
        await new Promise((r) => setTimeout(r, Math.max(cooldown, 1000 * 2 ** i)));
      }
    }
    throw last;
  }

  private async searchOnce(query: string): Promise<SerpResult[]> {
    const q = encodeURIComponent(query);
    const res = await fetch(this.opts.endpoint ?? "https://api.brightdata.com/request", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.cfg.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        zone: this.cfg.serpZone,
        url: `https://www.google.com/search?q=${q}&hl=en&gl=us&num=${this.opts.num ?? 20}&brd_json=1${Object.entries(this.extra)
          .map(([k, v]) => `&${k}=${encodeURIComponent(v)}`)
          .join("")}`,
        format: "raw",
      }),
    });
    const text = await res.text();
    if (!res.ok) throw Object.assign(new Error(`Bright Data SERP ${res.status}: ${text.slice(0, 300)}`), { transient: res.status === 429 || res.status >= 500 });
    let parsed: GoogleParsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw Object.assign(new Error(`Bright Data SERP returned non-JSON (${text.length} bytes): ${text.slice(0, 200)}`), { transient: true });
    }
    return (parsed.organic ?? [])
      .map((o, i) => ({
        title: o.title ?? "",
        url: o.link ?? o.url ?? "",
        snippet: o.description ?? o.snippet ?? "",
        rank: o.rank ?? o.global_rank ?? i + 1,
      }))
      .filter((r) => r.url);
  }
}

const CHALLENGE = /captcha|are you a robot|verify you are human|unusual traffic|access denied|cf-challenge|just a moment/i;

/**
 * Screenshot a public page through the Bright Data Browser API without solving CAPTCHAs.
 *
 * CAPTCHA policy: we never solve or bypass a challenge. Two ways to guarantee the solver is off:
 *   1. the per-session CDP call `Captcha.setAutoSolve {autoSolve:false}` succeeds, or
 *   2. the caller attests the zone has CAPTCHA Solver turned OFF in the Bright Data dashboard
 *      (`captchaOffAtZone`). For zone unprompted_browser this was checked by the team on 2026-11-14;
 *      that zone does not accept the CDP call, so use `--captcha-off-at-zone` on the CLI.
 * If neither holds, the page is not loaded. Either way, a page that shows a challenge is skipped
 * ("challenge, no screenshot"); we never try to get past it.
 */
export async function screenshot(
  wss: string,
  url: string,
  outPath: string,
  opts: { captchaOffAtZone?: boolean } = {},
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { chromium } = await import("playwright-core");
  const browser = await chromium.connectOverCDP(wss, { timeout: 60_000 });
  try {
    const page = await browser.newPage();
    const cdp = await page.context().newCDPSession(page);
    let solverOff = false;
    try {
      await cdp.send("Captcha.setAutoSolve" as never, { autoSolve: false } as never);
      solverOff = true;
    } catch {
      solverOff = !!opts.captchaOffAtZone;
    }
    if (!solverOff) return { ok: false, reason: "CAPTCHA solver not confirmed off; page not loaded" };
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    const title = await page.title();
    const body = (await page.locator("body").innerText({ timeout: 10_000 }).catch(() => "")).slice(0, 4000);
    if (CHALLENGE.test(title) || CHALLENGE.test(body) || CHALLENGE.test(page.url()))
      return { ok: false, reason: "challenge, no screenshot" };
    await page.screenshot({ path: outPath, fullPage: false });
    return { ok: true };
  } finally {
    await browser.close();
  }
}
