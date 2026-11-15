// Where a professor's Canvas connection lives (owner: B). Server only; the token never reaches the browser.
// Order: CANVAS_BASE_URL + CANVAS_TOKEN in the env, else a token the professor pasted (kept in server
// memory for this process only, per professor; a restart forgets it).
import "server-only";
import { CanvasClient } from "./client";

const pasted = new Map<string, { baseUrl: string; token: string; name: string }>();

export function canvasFor(userId: string): { client: CanvasClient; source: "env" | "pasted"; baseUrl: string } | null {
  const baseUrl = process.env.CANVAS_BASE_URL?.trim();
  const token = process.env.CANVAS_TOKEN?.trim();
  if (baseUrl && token && !baseUrl.startsWith("#")) return { client: new CanvasClient(baseUrl, token), source: "env", baseUrl };
  const p = pasted.get(userId);
  return p ? { client: new CanvasClient(p.baseUrl, p.token), source: "pasted", baseUrl: p.baseUrl } : null;
}

export async function connectCanvas(userId: string, baseUrl: string, token: string) {
  const client = new CanvasClient(baseUrl, token);
  const me = await client.self(); // validates the token before keeping it
  pasted.set(userId, { baseUrl, token, name: me.name });
  return { name: me.name };
}

export function disconnectCanvas(userId: string) {
  pasted.delete(userId);
}
