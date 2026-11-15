// Minimal Gemini REST client with a model fallback chain, under the shared routing policy (@unprompted/shared).
import { geminiRouter, gmiMaxTokens, gmiModelId, parseRetryDelay } from "@unprompted/shared/gemini-policy";

// On the team's free-tier key the bigger flash models often return 503 (high demand) or 429 (quota);
// the flash-lite models answer in about a second, so they go first.
export const DEFAULT_GEMINI_CHAIN = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-flash-latest"];

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export interface GeminiOptions {
  apiKey: string;
  models?: string[];
  timeoutMs?: number;
  temperature?: number;
}

export interface GmiOptions {
  apiKey?: string;
  baseUrl?: string;
}

/** HTTP error with the status and Google's retry hint, for the routing policy. */
function httpError(route: string, model: string, res: Response, body: string) {
  const e = new Error(`${route} ${model} ${res.status}: ${body.slice(0, 200)}`) as Error & { status: number; retryAfterMs?: number };
  e.status = res.status;
  const ra = Number(res.headers.get("retry-after"));
  e.retryAfterMs = Number.isFinite(ra) && ra > 0 ? ra * 1000 : parseRetryDelay(body);
  return e;
}

async function directCall(model: string, prompt: string, schema: object, opts: GeminiOptions, signal: AbortSignal) {
  const res = await fetch(`${BASE}/${model}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": opts.apiKey },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: schema,
        temperature: opts.temperature ?? 0.7,
        thinkingConfig: { thinkingLevel: "low" },
      },
    }),
    signal,
  });
  if (!res.ok) throw httpError("Gemini", model, res, await res.text());
  const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  if (!text.trim()) throw new Error(`Gemini ${model} returned no content`);
  return JSON.parse(text);
}

async function gmiCall(gmiId: string, prompt: string, gmi: Required<GmiOptions>, temperature: number, signal: AbortSignal) {
  const res = await fetch(`${gmi.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${gmi.apiKey}` },
    body: JSON.stringify({
      model: gmiId,
      messages: [
        { role: "system", content: "Reply with a single JSON object only, no prose, no code fences." },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
      temperature,
      // Reasoning models spend tokens thinking first; a small cap returns null content.
      max_tokens: gmiMaxTokens(),
    }),
    signal,
  });
  if (!res.ok) throw httpError("GMI", gmiId, res, await res.text());
  const data = (await res.json()) as { choices?: { message?: { content?: string | null }; finish_reason?: string }[] };
  const content = data.choices?.[0]?.message?.content;
  if (!content?.trim()) throw new Error(`GMI ${gmiId} returned no content (finish_reason ${data.choices?.[0]?.finish_reason ?? "unknown"})`);
  return JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, ""));
}

/**
 * JSON from the first model in the chain that answers, each model through the shared routing policy:
 * direct key first, and on 429 / 503 / timeout the same model via GMI (google/<model>) right away, with
 * the direct key cooling down. A model GMI doesn't serve has no GMI route; then the next model is tried.
 * `_model` is the model id, prefixed "gmi:google/" when GMI served it.
 */
export async function geminiJson<T>(prompt: string, schema: object, opts: GeminiOptions & { gmi?: GmiOptions; jsonHint?: string }): Promise<T & { _model: string }> {
  const env = typeof process !== "undefined" ? process.env : ({} as Record<string, string | undefined>);
  const gmiKey = opts.gmi?.apiKey ?? env.GMI_API_KEY?.trim();
  const gmi = gmiKey ? { apiKey: gmiKey, baseUrl: opts.gmi?.baseUrl ?? env.GMI_BASE_URL?.trim() ?? "https://api.gmi-serving.com/v1" } : null;
  if (!opts.apiKey && !gmi) throw new Error("Gemini API key missing (GEMINI_API_KEY or GMI_API_KEY)");
  const errors: string[] = [];
  for (const model of [...new Set(opts.models?.length ? opts.models : DEFAULT_GEMINI_CHAIN)]) {
    const gmiId = gmiModelId(model);
    try {
      const { value, route } = await geminiRouter().call<T>(
        model,
        {
          ...(opts.apiKey ? { direct: (signal: AbortSignal) => directCall(model, prompt, schema, opts, signal) } : {}),
          ...(gmi && gmiId ? { gmi: (signal: AbortSignal) => gmiCall(gmiId, `${prompt}${opts.jsonHint ? `\n\n${opts.jsonHint}` : ""}`, gmi, opts.temperature ?? 0.7, signal) } : {}),
        },
        { timeoutMs: opts.timeoutMs ?? 8000 },
      );
      return { ...(value as T), _model: route === "gmi" ? `gmi:${gmiId}` : model };
    } catch (err) {
      errors.push(`${model}: ${(err as Error).message.slice(0, 80)}`);
    }
  }
  throw new Error(`all Gemini models failed (${errors.join("; ")})`);
}
