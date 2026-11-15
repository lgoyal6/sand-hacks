// Fresh real-world data for PRACTICE variants ("Practice with today's data").
// Fetched directly from official public APIs on an allowlist; no scraping, no bot-protection bypass.
// Every dataset carries its source, a human-readable source page and the fetch time.
// These variants are learning material with fresh context, NOT an agent-resistance claim.

const ALLOWLIST = new Set(["api.bls.gov", "data.cdc.gov"]);

export interface FreshDataset {
  id: string;
  sourceName: string;
  /** Human-readable page for the citation. */
  sourceUrl: string;
  /** Exact API URL fetched. */
  apiUrl: string;
  fetchedAt: string;
  unit: string;
  rows: { label: string; value: number }[];
  /** Precomputed from the real values so the question uses correct statistics. */
  stats: { n: number; mean: number; sd: number; min: number; max: number };
}

async function fetchJson(url: string): Promise<unknown> {
  const host = new URL(url).hostname;
  if (!ALLOWLIST.has(host)) throw new Error(`fresh data: ${host} is not on the allowlist`);
  const r = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "unprompted-practice/1.0" }, signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`fresh data: ${host} returned ${r.status}`);
  return r.json();
}

function stats(values: number[]) {
  const n = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1));
  const r = (x: number) => Math.round(x * 1000) / 1000;
  return { n, mean: r(mean), sd: r(sd), min: Math.min(...values), max: Math.max(...values) };
}

const BLS: Record<string, { name: string; unit: string }> = {
  LNS14000000: { name: "U.S. Bureau of Labor Statistics, national unemployment rate (seasonally adjusted)", unit: "percent" },
  CUUR0000SA0: { name: "U.S. Bureau of Labor Statistics, Consumer Price Index for all urban consumers (CPI-U)", unit: "index points (1982-84 = 100)" },
};

/** The last 12 monthly values of a BLS series, newest last. */
export async function blsSeries(seriesId: keyof typeof BLS | string): Promise<FreshDataset> {
  const meta = BLS[seriesId];
  if (!meta) throw new Error(`fresh data: unknown BLS series ${seriesId}`);
  const apiUrl = `https://api.bls.gov/publicAPI/v1/timeseries/data/${seriesId}`;
  const body = (await fetchJson(apiUrl)) as { status: string; Results?: { series: { data: { year: string; period: string; periodName: string; value: string }[] }[] } };
  if (body.status !== "REQUEST_SUCCEEDED") throw new Error(`fresh data: BLS returned ${body.status}`);
  const data = (body.Results?.series[0]?.data ?? []).filter((d) => /^M(0[1-9]|1[0-2])$/.test(d.period)).slice(0, 12).reverse();
  if (data.length < 6) throw new Error("fresh data: BLS returned too few monthly values");
  const rows = data.map((d) => ({ label: `${d.periodName.slice(0, 3)} ${d.year}`, value: Number(d.value) }));
  return {
    id: `bls-${seriesId}`,
    sourceName: meta.name,
    sourceUrl: `https://data.bls.gov/timeseries/${seriesId}`,
    apiUrl,
    fetchedAt: new Date().toISOString(),
    unit: meta.unit,
    rows,
    stats: stats(rows.map((r) => r.value)),
  };
}

export const FRESH_SOURCES = ["LNS14000000", "CUUR0000SA0"] as const;
