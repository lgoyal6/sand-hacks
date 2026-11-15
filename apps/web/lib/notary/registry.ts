// Published-file anchors (owner: D): data/open/anchors.json, written by `cli.ts publish`.
import "server-only";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "@/lib/db/fixtures";
import { sha256Hex, verify, type AnchorRecord } from "./index";

export type PublishedAnchor = AnchorRecord & { file: string };

export async function loadAnchors(): Promise<Record<string, PublishedAnchor>> {
  const p = path.join(REPO_ROOT, "data/open/anchors.json");
  if (!existsSync(p)) return {};
  return JSON.parse(await fs.readFile(p, "utf8"));
}

/** Re-hash the published file as it is now and compare with the memo on-chain. */
export async function reverifyPublished(key: string) {
  const anchors = await loadAnchors();
  const a = anchors[key];
  if (!a) return { status: "unknown" as const };
  const now = sha256Hex(await fs.readFile(path.join(REPO_ROOT, a.file)));
  if (a.status !== "anchored" || !a.signature) return { status: "not_anchored" as const, sha256: now };
  const v = await verify(a.signature, a.kind, now);
  return { status: v.match ? ("match" as const) : ("mismatch" as const), sha256: now, onChainMemo: v.onChainMemo, error: v.error };
}
