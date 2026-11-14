// Minimal Gemini REST client. Server only; the key never reaches the browser.
import "server-only";

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export function geminiAvailable() {
  return Boolean(process.env.GEMINI_API_KEY?.trim());
}

export async function geminiJson<T>(prompt: string, schema: object, opts: { model?: string; timeoutMs?: number; temperature?: number } = {}): Promise<T> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new Error("GEMINI_API_KEY missing");
  const model = opts.model ?? process.env.GEMINI_MODEL?.trim() ?? "gemini-flash-latest";
  const res = await fetch(`${BASE}/${model}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json", responseSchema: schema, temperature: opts.temperature ?? 0.7 },
    }),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 15000),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  return JSON.parse(text) as T;
}
