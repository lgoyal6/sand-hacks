// Notary CLI (owner: D). Run from apps/web:
//   ../../services/leakscan/node_modules/.bin/tsx --conditions=react-server --env-file=../../.env.local lib/notary/cli.ts <cmd>
// Commands:
//   keygen                         create a devnet keypair and append it to the shared .env.local (prints the PUBLIC key only)
//   airdrop [sol]                  request free devnet SOL for the notary key (default 1)
//   anchor <kind> <file>           fingerprint a file (raw bytes) and anchor it; prints the signature
//   verify <kind> <file> <sig>     re-hash the file and compare with the memo on-chain
//   publish                        anchor every published file (data/open/anchors.json); re-anchors only changed or unanchored ones
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { anchor, devnetConnection, devnetSigner, sha256Hex, verify, type AnchorKind, type AnchorRecord } from "./index";

/** Files whose fingerprints are published (paths from the repo root). */
const PUBLISHED: Record<string, { kind: AnchorKind; file: string }> = {
  "leak-index-2026-11.csv": { kind: "study_dataset", file: "data/open/leak-index-2026-11.csv" },
  "leaked-homework-2026-11.csv": { kind: "study_dataset", file: "data/open/leaked-homework-2026-11.csv" },
  "leaked-homework-2026-11.json": { kind: "study_dataset", file: "data/open/leaked-homework-2026-11.json" },
  "attack_summaries.json": { kind: "attack_summary", file: "data/fixtures/attack_summaries.json" },
};

const ENV = resolve(process.cwd(), "../../.env.local");

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === "keygen") {
    if (existsSync(ENV) && /^SOLANA_DEVNET_SECRET=/m.test(readFileSync(ENV, "utf8"))) {
      console.log("SOLANA_DEVNET_SECRET already set; not replacing it.");
      return;
    }
    const kp = Keypair.generate();
    appendFileSync(ENV, `\n# Solana DEVNET notary key (D). Devnet only; never commit, never log.\nSOLANA_DEVNET_SECRET=${Buffer.from(kp.secretKey).toString("base64")}\nSOLANA_DEVNET_PUBKEY=${kp.publicKey.toBase58()}\n`);
    console.log(`created devnet key, public key ${kp.publicKey.toBase58()}`);
  } else if (cmd === "airdrop") {
    const signer = devnetSigner();
    if (!signer) throw new Error("No SOLANA_DEVNET_SECRET; run keygen first.");
    const conn = await devnetConnection();
    const sig = await conn.requestAirdrop(signer.publicKey, Math.round(Number(args[0] ?? 1) * LAMPORTS_PER_SOL));
    await conn.confirmTransaction(sig, "confirmed");
    console.log(`airdrop confirmed; balance ${(await conn.getBalance(signer.publicKey)) / LAMPORTS_PER_SOL} devnet SOL`);
  } else if (cmd === "anchor") {
    const [kind, file] = args as [AnchorKind, string];
    const r = await anchor(kind, sha256Hex(readFileSync(file)));
    console.log(JSON.stringify({ ...r }, null, 2));
  } else if (cmd === "verify") {
    const [kind, file, sig] = args as [AnchorKind, string, string];
    console.log(JSON.stringify(await verify(sig, kind, sha256Hex(readFileSync(file))), null, 2));
  } else if (cmd === "publish") {
    const reg = resolve(process.cwd(), "../../data/open/anchors.json");
    const current: Record<string, AnchorRecord & { file: string }> = existsSync(reg) ? JSON.parse(readFileSync(reg, "utf8")) : {};
    for (const [key, { kind, file }] of Object.entries(PUBLISHED)) {
      const path = resolve(process.cwd(), "../..", file);
      if (!existsSync(path)) continue;
      const sha = sha256Hex(readFileSync(path));
      const prev = current[key];
      if (prev && prev.sha256 === sha && prev.status === "anchored") {
        console.log(`${key}: already anchored (${prev.signature})`);
        continue;
      }
      const r = await anchor(kind, sha);
      current[key] = { ...r, file };
      console.log(`${key}: ${r.status}${r.signature ? ` ${r.signature}` : ` (${r.error})`}`);
    }
    writeFileSync(reg, JSON.stringify(current, null, 2) + "\n");
  } else {
    console.log("commands: keygen | airdrop [sol] | anchor <kind> <file> | verify <kind> <file> <signature>");
  }
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
