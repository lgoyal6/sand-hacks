// Integrity notary on Solana DEVNET (owner: D). A public notary, not a database: we anchor only the SHA-256
// fingerprint of an integrity record as an SPL Memo, "unprompted:v1:<kind>:<sha256>", and verify by re-hashing
// the record and comparing it with the memo stored on-chain. Never student data or text, only hashes.
//
// DEVNET ONLY. The RPC must be devnet by URL AND by genesis hash, or we refuse. The signing key comes from
// SOLANA_DEVNET_SECRET (shared .env.local only; never committed, never logged). Anchoring is async and must
// never block a student: callers record "not anchored yet" on failure and retry later.
import "server-only";
import { createHash } from "node:crypto";
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, sendAndConfirmTransaction } from "@solana/web3.js";

export type AnchorKind = "quiz_version" | "attack_summary" | "study_dataset" | "appeal";

export const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const DEFAULT_RPC = "https://api.devnet.solana.com";

export interface AnchorRecord {
  kind: AnchorKind;
  sha256: string;
  memo: string;
  signature: string | null;
  status: "anchored" | "not_anchored";
  error?: string;
  anchoredAt?: string;
  explorerUrl?: string;
}

/** Stable JSON (sorted keys) so the same record always hashes the same way. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
    .join(",")}}`;
}

export const sha256Hex = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
export const fingerprint = (record: unknown) => sha256Hex(canonicalJson(record));
export const memoFor = (kind: AnchorKind, sha256: string) => `unprompted:v1:${kind}:${sha256}`;
export const explorerUrl = (signature: string) => `https://explorer.solana.com/tx/${signature}?cluster=devnet`;

/** Refuses anything that isn't devnet: by URL first, then by genesis hash once connected. */
export async function devnetConnection(rpc = process.env.SOLANA_DEVNET_RPC?.trim() || DEFAULT_RPC): Promise<Connection> {
  const u = new URL(rpc);
  if (/mainnet|testnet/i.test(u.hostname + u.pathname) || !/devnet|localhost|127\.0\.0\.1/i.test(u.hostname)) {
    throw new Error(`Refusing RPC ${u.hostname}: Unprompted's notary only runs on Solana devnet.`);
  }
  const conn = new Connection(rpc, "confirmed");
  const genesis = await conn.getGenesisHash();
  if (genesis !== DEVNET_GENESIS && !/localhost|127\.0\.0\.1/.test(u.hostname)) {
    throw new Error("Refusing: the RPC's genesis hash is not Solana devnet.");
  }
  return conn;
}

/** Loads the devnet signer. Accepts a JSON array of 64 bytes or base64. Never logs the secret. */
export function devnetSigner(secret = process.env.SOLANA_DEVNET_SECRET?.trim()): Keypair | null {
  if (!secret) return null;
  const bytes = secret.startsWith("[") ? Uint8Array.from(JSON.parse(secret) as number[]) : Uint8Array.from(Buffer.from(secret, "base64"));
  return Keypair.fromSecretKey(bytes);
}

/** Anchor one fingerprint. Never throws: failures come back as status "not_anchored" for a later retry. */
export async function anchor(kind: AnchorKind, sha256: string): Promise<AnchorRecord> {
  const memo = memoFor(kind, sha256);
  if (!/^[0-9a-f]{64}$/.test(sha256)) return { kind, sha256, memo, signature: null, status: "not_anchored", error: "not a SHA-256 hex digest" };
  try {
    const signer = devnetSigner();
    if (!signer) return { kind, sha256, memo, signature: null, status: "not_anchored", error: "SOLANA_DEVNET_SECRET is not set" };
    const conn = await devnetConnection();
    const ix = new TransactionInstruction({ programId: MEMO_PROGRAM_ID, keys: [{ pubkey: signer.publicKey, isSigner: true, isWritable: false }], data: Buffer.from(memo, "utf8") });
    const signature = await sendAndConfirmTransaction(conn, new Transaction().add(ix), [signer], { commitment: "confirmed" });
    return { kind, sha256, memo, signature, status: "anchored", anchoredAt: new Date().toISOString(), explorerUrl: explorerUrl(signature) };
  } catch (e) {
    return { kind, sha256, memo, signature: null, status: "not_anchored", error: (e as Error).message.slice(0, 200) };
  }
}

/** Re-read the memo from the chain and compare it with the expected fingerprint. */
export async function verify(signature: string, kind: AnchorKind, sha256: string): Promise<{ match: boolean; onChainMemo: string | null; error?: string }> {
  try {
    const conn = await devnetConnection();
    const tx = await conn.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    if (!tx) return { match: false, onChainMemo: null, error: "transaction not found on devnet" };
    const log = tx.meta?.logMessages?.find((l) => l.includes("Memo (len"));
    const onChainMemo = log ? (log.match(/"(.*)"$/)?.[1] ?? null) : null;
    return { match: onChainMemo === memoFor(kind, sha256), onChainMemo };
  } catch (e) {
    return { match: false, onChainMemo: null, error: (e as Error).message.slice(0, 200) };
  }
}
