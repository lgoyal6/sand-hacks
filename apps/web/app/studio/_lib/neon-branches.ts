// Neon branch list from the Neon API (owner: B). Server only; read-only (never creates or deletes).
// Shared by the experiment tree, the branch race and the studio's "Database" line, with a short cache so a
// busy studio doesn't call the Neon API on every render. Facts come only from the API, never estimated.
import "server-only";

export interface BranchInfo {
  id: string;
  name: string;
  isDefault: boolean;
  parentId?: string;
  parentName?: string;
  parentLsn?: string;
  parentTimestamp?: string;
  createdAt?: string;
  logicalSizeBytes?: number;
  writtenBytes?: number;
}

export interface BranchList {
  projectId: string;
  branches: BranchInfo[];
  fetchedAt: string;
}

type Raw = {
  id: string;
  name: string;
  default?: boolean;
  primary?: boolean;
  parent_id?: string;
  parent_lsn?: string;
  parent_timestamp?: string;
  created_at?: string;
  logical_size?: number;
  written_data_bytes?: number;
};

let cache: { at: number; value: BranchList } | null = null;

/** Neon console page for one branch. The project id is an identifier, not a secret. */
export function consoleUrl(projectId: string, branchId: string) {
  return `https://console.neon.tech/app/projects/${encodeURIComponent(projectId)}/branches/${encodeURIComponent(branchId)}`;
}

/** Null without NEON_API_KEY / NEON_PROJECT_ID or when the API is unreachable. `maxAgeMs: 0` forces a fresh read. */
export async function listBranches(opts: { maxAgeMs?: number } = {}): Promise<BranchList | null> {
  const maxAge = opts.maxAgeMs ?? 60_000;
  if (cache && Date.now() - cache.at < maxAge) return cache.value;
  const key = process.env.NEON_API_KEY?.trim();
  const projectId = process.env.NEON_PROJECT_ID?.trim();
  if (!key || !projectId) return null;
  try {
    const r = await fetch(`https://console.neon.tech/api/v2/projects/${encodeURIComponent(projectId)}/branches`, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!r.ok) return cache?.value ?? null;
    const raw = ((await r.json()) as { branches: Raw[] }).branches;
    const nameById = new Map(raw.map((b) => [b.id, b.name]));
    const value: BranchList = {
      projectId,
      fetchedAt: new Date().toISOString(),
      branches: raw.map((b) => ({
        id: b.id,
        name: b.name,
        isDefault: Boolean(b.default || b.primary),
        ...(b.parent_id ? { parentId: b.parent_id, parentName: nameById.get(b.parent_id) } : {}),
        ...(b.parent_lsn ? { parentLsn: b.parent_lsn } : {}),
        ...(b.parent_timestamp ? { parentTimestamp: b.parent_timestamp } : {}),
        ...(b.created_at ? { createdAt: b.created_at } : {}),
        ...(typeof b.logical_size === "number" ? { logicalSizeBytes: b.logical_size } : {}),
        ...(typeof b.written_data_bytes === "number" ? { writtenBytes: b.written_data_bytes } : {}),
      })),
    };
    cache = { at: Date.now(), value };
    return value;
  } catch {
    return cache?.value ?? null;
  }
}

export interface NeonSummary {
  available: boolean;
  main?: { name: string; id: string; consoleUrl: string };
  experiments: number;
  appeals: number;
  other: number;
  fetchedAt?: string;
}

/** "Neon: main + N experiment branches" for the studio side panel. */
export async function neonSummary(): Promise<NeonSummary> {
  const list = await listBranches();
  if (!list) return { available: false, experiments: 0, appeals: 0, other: 0 };
  const main = list.branches.find((b) => b.isDefault) ?? list.branches.find((b) => b.name === "main");
  const experiments = list.branches.filter((b) => b.name.startsWith("exp/")).length;
  const appeals = list.branches.filter((b) => b.name.startsWith("appeal/")).length;
  return {
    available: true,
    ...(main ? { main: { name: main.name, id: main.id, consoleUrl: consoleUrl(list.projectId, main.id) } } : {}),
    experiments,
    appeals,
    other: list.branches.length - experiments - appeals - (main ? 1 : 0),
    fetchedAt: list.fetchedAt,
  };
}
