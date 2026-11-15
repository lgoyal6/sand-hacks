// Gemini only (Dat's call). Agents reach Gemini through GMI's OpenAI-compatible API when
// GMI_API_KEY is set (no free-tier cap), else Mastra's google provider on the direct key.
import { geminiRouter, gmiModelId } from "@unprompted/shared/gemini-policy";
import { envVal } from "../steps/llm.js";

export type AgentModel = string | { providerId: string; modelId: string; url: string; apiKey: string };

/**
 * Default for tool-using agents: gemini-3.5-flash-lite. Through GMI's OpenAI-compatible API, every
 * Gemini 3.x *thinking* model rejects multi-step tool calls ("invalid_thinking_signature": the
 * thought signature can't round-trip through that API). 3.5-flash-lite doesn't need one. Tested 2026-11-15.
 */
export function gemini(model = envVal("AGENT_MODEL") ?? "gemini-3.5-flash-lite"): AgentModel {
  const key = envVal("GMI_API_KEY");
  const gmiId = gmiModelId(model);
  if (key && gmiId) return { providerId: "gmi", modelId: gmiId, url: envVal("GMI_BASE_URL") ?? "https://api.gmi-serving.com/v1", apiKey: key };
  // Mastra's google provider reads GOOGLE_GENERATIVE_AI_API_KEY.
  const direct = envVal("GEMINI_API_KEY");
  if (direct && !process.env.GOOGLE_GENERATIVE_AI_API_KEY) process.env.GOOGLE_GENERATIVE_AI_API_KEY = direct;
  return `google/${model}`;
}

/**
 * Fallback list for tool-using agents: Gemini 3.6 Flash through GMI first (the FlattenToolHistory
 * processor makes multi-step tools work there), then the direct key (native thought signatures,
 * free-tier capped), then gemini-3.5-flash-lite via GMI.
 */
export function agentModels(primary = envVal("AGENT_PRIMARY_MODEL") ?? "gemini-3.6-flash") {
  const list: { model: AgentModel; maxRetries: number }[] = [];
  if (envVal("GMI_API_KEY")) list.push({ model: gemini(primary), maxRetries: 1 });
  const direct = envVal("GEMINI_API_KEY");
  // Evaluated per request: while the shared policy has this model cooling down on the direct key
  // (a 429 / 503 / timeout seen by any caller in this process), leave the direct key out.
  const cool = geminiRouter().coolingFor(primary);
  if (direct && cool > 0) console.log(`[gemini] model=${primary} route=gmi reason=cooldown(${Math.ceil(cool / 1000)}s) caller=agents`);
  if (direct && cool === 0) {
    if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) process.env.GOOGLE_GENERATIVE_AI_API_KEY = direct;
    list.push({ model: `google/${primary}`, maxRetries: 0 });
  }
  if (envVal("GMI_API_KEY")) list.push({ model: gemini("gemini-3.5-flash-lite"), maxRetries: 1 });
  if (!list.length) throw new Error("No Gemini access for agents: set GEMINI_API_KEY or GMI_API_KEY.");
  return list;
}
