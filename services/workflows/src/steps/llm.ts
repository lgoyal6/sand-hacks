import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { GoogleGenAI } from "@google/genai";
import { LLM_CACHE_DIR } from "../paths.js";
import { z } from "zod";

/** Read an env var; empty, whitespace-only or comment-only values count as unset. */
export function envVal(k: string, env = process.env): string | undefined {
  const v = env[k]?.trim();
  return v && !v.startsWith("#") ? v : undefined;
}

/** A chat model that returns JSON validated against a zod schema. */
export interface JsonModel {
  name: string;
  json<T>(prompt: string, schema: z.ZodType<T>, opts?: { temperature?: number; system?: string; salt?: string }): Promise<T>;
}

/** A model call failed for infrastructure reasons (quota, network, timeout), not because of the question. */
export class InfraError extends Error {}

/**
 * Disk cache for model responses (the shared Gemini key is free tier, ~20 requests/model/day).
 * LLM_CACHE=readwrite (default) | replay (cache only; a miss is an error, spends nothing) | off.
 * `salt` separates intentionally repeated calls (e.g. the solver's 3 independent runs).
 */
const CACHE_DIR = LLM_CACHE_DIR;
export async function cached<T>(parts: unknown[], fn: () => Promise<T>): Promise<T> {
  const mode = envVal("LLM_CACHE") ?? "readwrite";
  if (mode === "off") return fn();
  const key = createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 32);
  const file = path.join(CACHE_DIR, `${key}.json`);
  try {
    return JSON.parse(await readFile(file, "utf8")).value as T;
  } catch {
    if (mode === "replay") throw new InfraError(`LLM_CACHE=replay and no cached response for ${String(parts[0])}`);
  }
  const value = await fn();
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(file, JSON.stringify({ parts: parts.slice(0, 2), at: new Date().toISOString(), value }));
  return value;
}

/** Per-model spacing so a free-tier key's requests-per-minute quota isn't blown by bursts. */
const nextSlot = new Map<string, number>();
async function rateLimit(name: string) {
  const rpm = Number(envVal("LLM_RPM") ?? "10");
  const gap = 60_000 / Math.max(1, rpm);
  const now = Date.now();
  const at = Math.max(now, nextSlot.get(name) ?? 0);
  nextSlot.set(name, at + gap);
  if (at > now) await new Promise((r) => setTimeout(r, at - now));
}

export async function withRetry<T>(fn: () => Promise<T>, label: string, tries = 6): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    await rateLimit(label.replace(/ \(code\)$/, ""));
    try {
      return await fn();
    } catch (e) {
      last = e;
      const msg = String((e as Error)?.message ?? e);
      const quota = /\b429\b|RESOURCE_EXHAUSTED|rate.?limit/i.test(msg);
      // Fail fast on auth/bad requests/unknown models; retry quota, server errors, timeouts, bad JSON.
      if (!quota && /\b(400|401|403|404)\b/.test(msg)) break;
      // Google puts the wait in the 429 body: "retryDelay": "37s".
      const hinted = Number(msg.match(/retryDelay"?\s*[:=]\s*"?(\d+(?:\.\d+)?)s/)?.[1] ?? NaN);
      const wait = quota ? (Number.isFinite(hinted) ? hinted * 1000 + 1000 : 15_000 * (i + 1)) : 1000 * 2 ** i;
      if (i < tries - 1) await new Promise((r) => setTimeout(r, Math.min(wait, 90_000)));
    }
  }
  const msg = String((last as Error)?.message ?? last).slice(0, 300);
  if (/\b(400|401|403|404)\b/.test(msg) && !/\b429\b/.test(msg)) throw new Error(`${label} failed: ${msg}`);
  throw new InfraError(`${label} unavailable: ${msg}`);
}

export class GeminiModel implements JsonModel {
  readonly name: string;
  private ai: GoogleGenAI;
  constructor(apiKey: string, readonly model: string) {
    // Some listed models hang instead of erroring; never wait forever on one call.
    this.ai = new GoogleGenAI({ apiKey, httpOptions: { timeout: 120_000 } });
    this.name = `gemini:${model}`;
  }

  async json<T>(prompt: string, schema: z.ZodType<T>, opts: { temperature?: number; system?: string; salt?: string } = {}): Promise<T> {
    const jsonSchema = z.toJSONSchema(schema);
    const raw = await cached([this.name, "json", prompt, jsonSchema, opts.temperature, opts.system, opts.salt], () => withRetry(async () => {
      const res = await this.ai.models.generateContent({
        model: this.model,
        contents: prompt,
        config: {
          temperature: opts.temperature,
          systemInstruction: opts.system,
          responseMimeType: "application/json",
          responseJsonSchema: jsonSchema,
        },
      });
      return schema.parse(JSON.parse(res.text ?? "")) as unknown;
    }, this.name));
    return schema.parse(raw);
  }

  /**
   * Free-form answer with Gemini's built-in Python code execution tool.
   * Returns the response text and whether the model actually ran code.
   */
  async withCode(prompt: string, opts: { temperature?: number; salt?: string } = {}): Promise<{ text: string; usedCode: boolean }> {
    return cached([this.name, "code", prompt, opts.temperature, opts.salt], () => withRetry(async () => {
      const res = await this.ai.models.generateContent({
        model: this.model,
        contents: prompt,
        config: { temperature: opts.temperature, tools: [{ codeExecution: {} }] },
      });
      const parts = res.candidates?.[0]?.content?.parts ?? [];
      const usedCode = parts.some((p) => p.executableCode || p.codeExecutionResult);
      const text = parts.map((p) => p.text ?? "").join("\n");
      return { text, usedCode };
    }, `${this.name} (code)`));
  }
}

/** GMI Cloud: OpenAI-compatible chat completions for open models (Qwen, DeepSeek, Llama). */
export class OpenAICompatModel implements JsonModel {
  readonly name: string;
  constructor(
    private baseUrl: string,
    private apiKey: string,
    readonly model: string,
    prefix = "gmi",
  ) {
    this.name = `${prefix}:${model}`;
  }

  async json<T>(prompt: string, schema: z.ZodType<T>, opts: { temperature?: number; system?: string; salt?: string } = {}): Promise<T> {
    const shape = JSON.stringify(z.toJSONSchema(schema));
    const raw = await cached([this.name, "json", prompt, shape, opts.temperature, opts.system, opts.salt], () => withRetry(async () => {
      const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          temperature: opts.temperature ?? 0.2,
          response_format: { type: "json_object" },
          messages: [
            ...(opts.system ? [{ role: "system", content: opts.system }] : []),
            { role: "user", content: `${prompt}\n\nReply with only a JSON object matching this JSON Schema:\n${shape}` },
          ],
        }),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`${res.status}: ${text.slice(0, 300)}`);
      const content: string = JSON.parse(text).choices?.[0]?.message?.content ?? "";
      // Some open models wrap JSON in prose or fences, or emit <think> blocks first.
      const body = content.replace(/<think>[\s\S]*?<\/think>/g, "");
      const start = body.indexOf("{");
      const end = body.lastIndexOf("}");
      return schema.parse(JSON.parse(body.slice(start, end + 1))) as unknown;
    }, this.name));
    return schema.parse(raw);
  }
}

export interface Models {
  gemini: GeminiModel;
  /** Extra panel seats from other model families; empty when GMI_API_KEY is missing. */
  others: JsonModel[];
}

/** Build models from env, or null when GEMINI_API_KEY is missing (callers then refuse to run). */
export function modelsFromEnv(env = process.env): Models | null {
  const key = envVal("GEMINI_API_KEY", env);
  if (!key) return null;
  const gemini = new GeminiModel(key, envVal("GEMINI_MODEL", env) ?? "gemini-3.5-flash");
  const gmiKey = envVal("GMI_API_KEY", env);
  const others: JsonModel[] = [];
  if (gmiKey) {
    const base = envVal("GMI_BASE_URL", env) ?? "https://api.gmi-serving.com/v1";
    // Model ids are configurable because GMI's catalog changes; check `GET $GMI_BASE_URL/models`.
    const ids = (envVal("GMI_PANEL_MODELS", env) ?? "deepseek-ai/DeepSeek-V3.2,Qwen/Qwen3-235B-A22B-Instruct-2507")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const id of ids) others.push(new OpenAICompatModel(base, gmiKey, id));
  }
  return { gemini, others };
}
