// GET /study/verify?file=<published file> -> re-hash the file now and compare with its Solana devnet memo. Public.
import { reverifyPublished } from "@/lib/notary/registry";

export async function GET(req: Request) {
  const file = new URL(req.url).searchParams.get("file") ?? "";
  if (!/^[\w.-]{1,80}$/.test(file)) return Response.json({ status: "unknown" }, { status: 400 });
  return Response.json(await reverifyPublished(file), { headers: { "Cache-Control": "no-store" } });
}
