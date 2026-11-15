import { Mastra } from '@mastra/core';
import { createStep, createWorkflow } from '@mastra/core/workflows';
import { PostgresStore } from '@mastra/pg';
import { z } from 'zod';
import path from 'node:path';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { neonConfig, Pool } from '@neondatabase/serverless';
import { PGlite } from '@electric-sql/pglite';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { GoogleGenAI } from '@google/genai';

"use strict";
if (!neonConfig.webSocketConstructor && typeof WebSocket !== "undefined") {
  neonConfig.webSocketConstructor = WebSocket;
}
const API = "https://console.neon.tech/api/v2";
function wrap$1(pool) {
  return {
    async query(text, params) {
      const r = await pool.query(text, params);
      return { rows: r.rows };
    },
    async exec(sql) {
      await pool.query(sql);
    }
  };
}
class NeonBranchStore {
  constructor(opts) {
    this.opts = opts;
    const u = new URL(opts.mainUrl);
    this.roleName = decodeURIComponent(u.username);
    this.dbName = u.pathname.replace(/^\//, "") || "neondb";
  }
  opts;
  kind = "neon";
  pools = /* @__PURE__ */ new Map();
  roleName;
  dbName;
  static fromEnv(env = process.env) {
    const val = (k) => {
      const v = env[k]?.trim();
      return v && !v.startsWith("#") ? v : void 0;
    };
    const NEON_API_KEY = val("NEON_API_KEY");
    const NEON_PROJECT_ID = val("NEON_PROJECT_ID");
    const DATABASE_URL = val("DATABASE_URL");
    if (!NEON_API_KEY || !NEON_PROJECT_ID || !DATABASE_URL) return null;
    return new NeonBranchStore({ apiKey: NEON_API_KEY, projectId: NEON_PROJECT_ID, mainUrl: DATABASE_URL });
  }
  async api(method, path, body) {
    const res = await fetch(`${API}/projects/${this.opts.projectId}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.opts.apiKey}`,
        Accept: "application/json",
        ...body ? { "Content-Type": "application/json" } : {}
      },
      body: body ? JSON.stringify(body) : void 0
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Neon API ${method} ${path} -> ${res.status}: ${text.slice(0, 500)}`);
    return text ? JSON.parse(text) : {};
  }
  async waitForOperations(ops = []) {
    for (const op of ops) {
      for (let i = 0; i < 120; i++) {
        const { operation } = await this.api("GET", `/operations/${op.id}`);
        if (operation.status === "finished" || operation.status === "skipped") break;
        if (["failed", "cancelled", "error"].includes(operation.status)) {
          throw new Error(`Neon operation ${op.id} ${operation.status}`);
        }
        await new Promise((r) => setTimeout(r, 500));
      }
    }
  }
  async findBranch(name) {
    const { branches } = await this.api("GET", "/branches");
    if (name === "main") return branches.find((b) => b.default || b.primary) ?? branches.find((b) => b.name === "main");
    return branches.find((b) => b.name === name);
  }
  async connect(branch, name) {
    let pool = this.pools.get(branch.id);
    if (!pool) {
      const url = name === "main" ? this.opts.mainUrl : (await this.api(
        "GET",
        `/connection_uri?branch_id=${branch.id}&database_name=${encodeURIComponent(this.dbName)}&role_name=${encodeURIComponent(this.roleName)}&pooled=true`
      )).uri;
      pool = new Pool({ connectionString: url });
      this.pools.set(branch.id, pool);
    }
    return { name, id: branch.id, db: wrap$1(pool) };
  }
  async main() {
    const b = await this.findBranch("main");
    if (!b) throw new Error("Neon project has no default branch");
    return this.connect(b, "main");
  }
  async createBranch(name, parent = "main") {
    if (await this.findBranch(name)) throw new Error(`branch already exists: ${name}`);
    const p = await this.findBranch(parent);
    if (!p) throw new Error(`parent branch not found: ${parent}`);
    const res = await this.api("POST", "/branches", {
      branch: { name, parent_id: p.id },
      endpoints: [{ type: "read_write" }]
    });
    await this.waitForOperations(res.operations);
    return this.connect(res.branch, name);
  }
  async branch(name) {
    const b = await this.findBranch(name);
    if (!b) throw new Error(`branch not found: ${name}`);
    return this.connect(b, name);
  }
  async listBranches() {
    const { branches } = await this.api("GET", "/branches");
    return branches.map((b) => b.name);
  }
  async deleteBranch(name) {
    if (name === "main") throw new Error("refusing to delete main");
    const b = await this.findBranch(name);
    if (!b || b.default || b.primary) return;
    const pool = this.pools.get(b.id);
    if (pool) {
      await pool.end();
      this.pools.delete(b.id);
    }
    const res = await this.api("DELETE", `/branches/${b.id}`);
    await this.waitForOperations(res.operations);
  }
  async close() {
    for (const p of this.pools.values()) await p.end();
    this.pools.clear();
  }
}

"use strict";
function wrap(pg) {
  return {
    async query(text, params) {
      const r = await pg.query(text, params);
      return { rows: r.rows };
    },
    async exec(sql) {
      await pg.exec(sql);
    }
  };
}
class PGliteBranchStore {
  kind = "pglite";
  branches = /* @__PURE__ */ new Map();
  constructor(main) {
    this.branches.set("main", main);
  }
  static async create(schemaSql) {
    const main = new PGlite();
    if (schemaSql) await main.exec(schemaSql);
    return new PGliteBranchStore(main);
  }
  handle(name) {
    const pg = this.branches.get(name);
    if (!pg) throw new Error(`branch not found: ${name}`);
    return { name, id: name, db: wrap(pg) };
  }
  async main() {
    return this.handle("main");
  }
  async createBranch(name, parent = "main") {
    if (this.branches.has(name)) throw new Error(`branch already exists: ${name}`);
    const src = this.branches.get(parent);
    if (!src) throw new Error(`parent branch not found: ${parent}`);
    this.branches.set(name, await src.clone());
    return this.handle(name);
  }
  async branch(name) {
    return this.handle(name);
  }
  async listBranches() {
    return [...this.branches.keys()];
  }
  async deleteBranch(name) {
    if (name === "main") throw new Error("refusing to delete main");
    const pg = this.branches.get(name);
    if (!pg) return;
    await pg.close();
    this.branches.delete(name);
  }
  async close() {
    for (const pg of this.branches.values()) await pg.close();
    this.branches.clear();
  }
}

"use strict";

"use strict";
async function mergeVariant(store, branchName, variantId, opts = {}) {
  const withItem = opts.withItem ?? true;
  const exp = await store.branch(branchName);
  const main = await store.main();
  const { rows: variants } = await exp.db.query(
    "select * from variant_experiment where id = $1",
    [variantId]
  );
  const v = variants[0];
  if (!v) throw new Error(`variant ${variantId} not found on ${branchName}`);
  let candidateItemId = v.candidate_item_id ?? null;
  if (withItem) {
    const { rows: items } = candidateItemId ? await exp.db.query("select * from item where id = $1", [candidateItemId]) : await exp.db.query(
      `select b.* from item b where b.original_item_id = $1`,
      [v.item_id]
    );
    if (items.length !== 1) {
      throw new Error(`expected exactly one candidate item for ${variantId} on ${branchName}, found ${items.length}`);
    }
    const it = items[0];
    candidateItemId = it.id;
    await main.db.query(
      `insert into item (id, quiz_id, stem, type, choices_json, answer_key, objective, original_item_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       on conflict (id) do update set stem = excluded.stem, type = excluded.type, choices_json = excluded.choices_json,
         answer_key = excluded.answer_key, objective = excluded.objective, original_item_id = excluded.original_item_id`,
      [it.id, it.quiz_id, it.stem, it.type, json(it.choices_json), json(it.answer_key), it.objective, it.original_item_id]
    );
  }
  await main.db.query(
    `insert into variant_experiment
       (id, item_id, neon_branch, generator, strategy, candidate_json, status, reasons_json, checks_json, candidate_item_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     on conflict (id) do update set status = excluded.status, reasons_json = excluded.reasons_json,
       candidate_json = excluded.candidate_json, neon_branch = excluded.neon_branch,
       checks_json = excluded.checks_json, candidate_item_id = excluded.candidate_item_id`,
    [
      v.id,
      v.item_id,
      branchName,
      v.generator,
      v.strategy,
      json(v.candidate_json),
      v.status,
      json(v.reasons_json),
      json(v.checks_json ?? {}),
      withItem ? candidateItemId : null
    ]
  );
}
function json(x) {
  return x == null ? null : JSON.stringify(x);
}

"use strict";
const SCHEMA_PATH = fileURLToPath(new URL("../../../../db/neon/schema.sql", import.meta.url));
async function loadSchema() {
  return readFile(SCHEMA_PATH, "utf8");
}
async function openBranchStore(env = process.env) {
  const schema = await loadSchema();
  const neon = NeonBranchStore.fromEnv(env);
  if (neon) {
    const main = await neon.main();
    await main.db.exec(schema);
    return neon;
  }
  return PGliteBranchStore.create(schema);
}

"use strict";
function answerText(key) {
  return Array.isArray(key) ? [...key].map(norm).sort().join(",") : norm(key);
}
function norm(s) {
  return s.trim().toLowerCase().replace(/^\(?([a-z])\)$/, "$1").replace(/\s+/g, " ");
}
function parseNumber(s) {
  const t = s.trim().replace(/,/g, "");
  const frac = t.match(/^(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)$/);
  if (frac) {
    const d = Number(frac[2]);
    return d === 0 ? null : Number(frac[1]) / d;
  }
  const pct = t.match(/^(-?\d+(?:\.\d+)?)\s*%$/);
  if (pct) return Number(pct[1]) / 100;
  const n = Number(t);
  return t !== "" && Number.isFinite(n) ? n : null;
}
function sameAnswer(type, a, b, relTol = 1e-3) {
  if (type === "numeric") {
    const x = parseNumber(a);
    const y = parseNumber(b);
    if (x == null || y == null) return norm(a) === norm(b);
    return Math.abs(x - y) <= relTol * Math.max(1, Math.abs(x), Math.abs(y));
  }
  if (type === "multi") return answerText(a.split(/[,\s]+/).filter(Boolean)) === answerText(b.split(/[,\s]+/).filter(Boolean));
  return norm(a) === norm(b);
}
function extractFinal(text) {
  const m = [...text.matchAll(/^\s*\**FINAL\**\s*[:=]\s*\**\s*(.+?)\s*$/gim)];
  return m.length ? m[m.length - 1][1].replace(/^`+|`+$/g, "").replace(/\*+$/, "").trim() : null;
}

"use strict";
function renderItem(it) {
  const choices = it.choices?.map((c) => `  ${c.id}) ${c.text}`).join("\n") ?? "";
  const how = it.type === "mcq" ? "Choose exactly one option." : it.type === "multi" ? "Choose every correct option." : it.type === "numeric" ? "Give a single number (a fraction like 1/6 is fine)." : "Give a short answer.";
  return `[${it.type}] ${it.stem}
${choices}
(${how})`.trim();
}
const STRATEGY_BRIEF = {
  isomorphic: "ISOMORPHIC: same underlying skill and solution structure, but new numbers and a new surface context. The correct answer must differ from the original's, and no answer option may be copied from the original.",
  application: "APPLICATION: embed the skill in a concrete, realistic scenario (a lab, a clinic, a city dataset) where the student must recognize which concept applies before using it. Include only the data needed, plus at most one irrelevant detail.",
  find_error: "FIND THE ERROR: present a short worked solution (3-5 numbered steps) to a problem testing this skill, with exactly one step containing a conceptual or computational mistake. Ask which step is wrong, or what the corrected final answer is.",
  figure_dependency: "TABLE DEPENDENCY: put the needed values only in a small Markdown table inside the stem (not in the sentence), and require two dependent steps that use values from different rows.",
  counterfactual: "COUNTERFACTUAL: start from a stated baseline result, then ask what happens to it when one parameter changes (doubles, halves, flips sign, hits a boundary). The student must reason about the causal relationship, not recompute from scratch."
};
const CandidateSchema = z.object({
  stem: z.string().min(10),
  type: z.enum(["mcq", "multi", "numeric", "short"]),
  choices: z.array(z.object({ id: z.string(), text: z.string() })).optional(),
  answerKey: z.string().describe("choice id for mcq; comma-separated ids for multi; the value for numeric/short"),
  rationale: z.string().describe("one or two sentences: why this still tests the same objective and why it is harder to look up")
});
class GeminiGenerator {
  constructor(model) {
    this.model = model;
  }
  model;
  async generate(source, strategy, attempt) {
    const prompt = `You rewrite quiz questions so they still test the SAME learning objective but are harder for an AI agent to answer by lookup or pattern matching.

Learning objective (must be unchanged): ${source.objective}

Original question:
${renderItem(source)}
Correct answer: ${answerText(source.answerKey)}

Strategy (attempt ${attempt}):
${STRATEGY_BRIEF[strategy]}

Rules:
- Keep the same objective and roughly the same difficulty for a student who has the skill.
- Exactly one defensible answer. Prefer mcq with 4 options labelled a-d, or numeric.
- Double-check your answer key by working the problem fully before you answer.
- No trick wording, no "all of the above", no reference to the original question.`;
    const out = await this.model.json(prompt, CandidateSchema, { temperature: 0.9 });
    const candidate = normalizeCandidate(out, source);
    return { candidate, rationale: out.rationale, generator: this.model.name };
  }
}
function normalizeCandidate(out, source) {
  const type = out.type;
  let answerKey = out.answerKey.trim();
  let choices = out.choices?.map((c) => ({ id: c.id.trim().toLowerCase().replace(/\)$/, ""), text: c.text.trim() }));
  if (type === "mcq" || type === "multi") {
    if (!choices || choices.length < 3) throw new Error("generator returned a choice question with fewer than 3 choices");
    const ids = new Set(choices.map((c) => c.id));
    const keys = answerKey.toLowerCase().split(/[,\s]+/).map((k) => k.replace(/[()]/g, "")).filter(Boolean);
    if (keys.length === 0 || keys.some((k) => !ids.has(k))) throw new Error(`answer key "${out.answerKey}" is not one of the choices`);
    if (type === "mcq" && keys.length !== 1) throw new Error("mcq candidate has more than one key");
    answerKey = type === "mcq" ? keys[0] : keys;
  } else {
    choices = void 0;
  }
  return {
    stem: out.stem.trim(),
    type,
    ...choices ? { choices } : {},
    answerKey,
    objective: source.objective,
    originalItemId: source.id
  };
}
class GeminiCodeSolver {
  constructor(model) {
    this.model = model;
  }
  model;
  async solve(candidate, run = 0) {
    const prompt = `Solve this quiz question. Use Python code execution to compute or verify every quantitative step.

${renderItem(candidate)}

End your reply with one line exactly like:
FINAL: <answer>
where <answer> is the option letter${candidate.type === "multi" ? "s, comma-separated" : ""}${candidate.type === "numeric" ? " or, for numeric questions, the number" : ""}.`;
    const { text, usedCode } = await this.model.withCode(prompt, { temperature: 0.7, salt: `run${run}` });
    const answer = extractFinal(text);
    if (!answer) throw new Error("solver reply had no FINAL: line");
    return { answer, usedCode, model: this.model.name };
  }
}
const VoteSchema = z.object({
  objectivePreserved: z.boolean().describe("true if a student needs the same skill to answer the new question"),
  unambiguous: z.boolean().describe("true if exactly one answer is defensible AND the stated key is that answer"),
  reason: z.string().describe("one sentence; name the specific problem if either is false")
});
class ModelJudge {
  constructor(model, name = model.name, temperature = 0.2) {
    this.model = model;
    this.name = name;
    this.temperature = temperature;
  }
  model;
  name;
  temperature;
  async vote(source, candidate) {
    const prompt = `You are reviewing a rewritten quiz question for a professor. Be strict: a false "true" puts a broken question in front of students.

Learning objective: ${source.objective}

ORIGINAL:
${renderItem(source)}
Key: ${answerText(source.answerKey)}

REWRITE:
${renderItem(candidate)}
Key: ${answerText(candidate.answerKey)}

1. objectivePreserved: does answering the rewrite require the same skill, at comparable difficulty for a student who has it? Changing context or numbers is fine; testing a different concept, or adding a big extra skill, is not.
2. unambiguous: is there exactly one defensible answer, and is the given key that answer? Work it out yourself.`;
    const v = await this.model.json(prompt, VoteSchema, { temperature: this.temperature });
    return { judge: this.name, ...v };
  }
}
function buildPanel(gemini, others, geminiFallbacks) {
  if (others.length >= 2) {
    return { judges: [gemini, others[0], others[1]].map((m) => new ModelJudge(m)), independentFamilies: true };
  }
  const seats = [gemini, ...others, ...geminiFallbacks].slice(0, 3);
  if (seats.length < 3) throw new Error("objective panel needs 3 seats");
  const sameFamily = seats.filter((m) => m.name.startsWith("gemini:")).length > 1;
  return {
    judges: seats.map((m) => new ModelJudge(m, sameFamily && m.name.startsWith("gemini:") ? `${m.name} (same family)` : m.name)),
    independentFamilies: !sameFamily
  };
}
class CliAttacker {
  constructor(opts) {
    this.opts = opts;
  }
  opts;
  attack(quiz, itemIds) {
    const args = ["run", "--directory", path.join(this.opts.repoRoot, "services/agents"), "attack", "--quiz", "-", "--json"];
    args.push("--items", itemIds.join(","), "--repeats", String(this.opts.repeats ?? 3));
    if (this.opts.models) args.push("--models", this.opts.models);
    if (this.opts.agents) args.push("--agents", this.opts.agents);
    return new Promise((resolve, reject) => {
      const child = spawn("uv", args, { stdio: ["pipe", "pipe", "pipe"] });
      let out = "";
      let err = "";
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        reject(new Error(`attack timed out after ${this.opts.timeoutMs}ms`));
      }, this.opts.timeoutMs ?? 30 * 6e4);
      child.stdout.on("data", (d) => out += d);
      child.stderr.on("data", (d) => {
        err += d;
        this.opts.log?.(String(d).trimEnd());
      });
      child.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code !== 0) return reject(new Error(`attack exited ${code}: ${err.slice(-800)}`));
        try {
          const res = JSON.parse(out);
          resolve({ solveRates: res.solveRates });
        } catch (e) {
          reject(new Error(`attack output was not JSON: ${out.slice(0, 300)}`));
        }
      });
      child.stdin.end(JSON.stringify(quiz));
    });
  }
}

"use strict";
function envVal(k, env = process.env) {
  const v = env[k]?.trim();
  return v && !v.startsWith("#") ? v : void 0;
}
class InfraError extends Error {
}
const CACHE_DIR = path.resolve(import.meta.dirname, "../../.cache/llm");
async function cached(parts, fn) {
  const mode = envVal("LLM_CACHE") ?? "readwrite";
  if (mode === "off") return fn();
  const key = createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 32);
  const file = path.join(CACHE_DIR, `${key}.json`);
  try {
    return JSON.parse(await readFile(file, "utf8")).value;
  } catch {
    if (mode === "replay") throw new InfraError(`LLM_CACHE=replay and no cached response for ${String(parts[0])}`);
  }
  const value = await fn();
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(file, JSON.stringify({ parts: parts.slice(0, 2), at: (/* @__PURE__ */ new Date()).toISOString(), value }));
  return value;
}
const nextSlot = /* @__PURE__ */ new Map();
async function rateLimit(name) {
  const rpm = Number(envVal("LLM_RPM") ?? "10");
  const gap = 6e4 / Math.max(1, rpm);
  const now = Date.now();
  const at = Math.max(now, nextSlot.get(name) ?? 0);
  nextSlot.set(name, at + gap);
  if (at > now) await new Promise((r) => setTimeout(r, at - now));
}
async function withRetry(fn, label, tries = 6) {
  let last;
  for (let i = 0; i < tries; i++) {
    await rateLimit(label.replace(/ \(code\)$/, ""));
    try {
      return await fn();
    } catch (e) {
      last = e;
      const msg2 = String(e?.message ?? e);
      const quota = /\b429\b|RESOURCE_EXHAUSTED|rate.?limit/i.test(msg2);
      if (!quota && /\b(400|401|403|404)\b/.test(msg2)) break;
      const hinted = Number(msg2.match(/retryDelay"?\s*[:=]\s*"?(\d+(?:\.\d+)?)s/)?.[1] ?? NaN);
      const wait = quota ? Number.isFinite(hinted) ? hinted * 1e3 + 1e3 : 15e3 * (i + 1) : 1e3 * 2 ** i;
      if (i < tries - 1) await new Promise((r) => setTimeout(r, Math.min(wait, 9e4)));
    }
  }
  const msg = String(last?.message ?? last).slice(0, 300);
  if (/\b(400|401|403|404)\b/.test(msg) && !/\b429\b/.test(msg)) throw new Error(`${label} failed: ${msg}`);
  throw new InfraError(`${label} unavailable: ${msg}`);
}
class GeminiModel {
  constructor(apiKey, model) {
    this.model = model;
    this.ai = new GoogleGenAI({ apiKey, httpOptions: { timeout: 12e4 } });
    this.name = `gemini:${model}`;
  }
  model;
  name;
  ai;
  async json(prompt, schema, opts = {}) {
    const jsonSchema = z.toJSONSchema(schema);
    const raw = await cached([this.name, "json", prompt, jsonSchema, opts.temperature, opts.system, opts.salt], () => withRetry(async () => {
      const res = await this.ai.models.generateContent({
        model: this.model,
        contents: prompt,
        config: {
          temperature: opts.temperature,
          systemInstruction: opts.system,
          responseMimeType: "application/json",
          responseJsonSchema: jsonSchema
        }
      });
      return schema.parse(JSON.parse(res.text ?? ""));
    }, this.name));
    return schema.parse(raw);
  }
  /**
   * Free-form answer with Gemini's built-in Python code execution tool.
   * Returns the response text and whether the model actually ran code.
   */
  async withCode(prompt, opts = {}) {
    return cached([this.name, "code", prompt, opts.temperature, opts.salt], () => withRetry(async () => {
      const res = await this.ai.models.generateContent({
        model: this.model,
        contents: prompt,
        config: { temperature: opts.temperature, tools: [{ codeExecution: {} }] }
      });
      const parts = res.candidates?.[0]?.content?.parts ?? [];
      const usedCode = parts.some((p) => p.executableCode || p.codeExecutionResult);
      const text = parts.map((p) => p.text ?? "").join("\n");
      return { text, usedCode };
    }, `${this.name} (code)`));
  }
}
class OpenAICompatModel {
  constructor(baseUrl, apiKey, model, prefix = "gmi") {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this.model = model;
    this.name = `${prefix}:${model}`;
  }
  baseUrl;
  apiKey;
  model;
  name;
  async json(prompt, schema, opts = {}) {
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
            ...opts.system ? [{ role: "system", content: opts.system }] : [],
            { role: "user", content: `${prompt}

Reply with only a JSON object matching this JSON Schema:
${shape}` }
          ]
        })
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`${res.status}: ${text.slice(0, 300)}`);
      const content = JSON.parse(text).choices?.[0]?.message?.content ?? "";
      const body = content.replace(/<think>[\s\S]*?<\/think>/g, "");
      const start = body.indexOf("{");
      const end = body.lastIndexOf("}");
      return schema.parse(JSON.parse(body.slice(start, end + 1)));
    }, this.name));
    return schema.parse(raw);
  }
}
function modelsFromEnv(env = process.env) {
  const key = envVal("GEMINI_API_KEY", env);
  if (!key) return null;
  const gemini = new GeminiModel(key, envVal("GEMINI_MODEL", env) ?? "gemini-3.5-flash");
  const gmiKey = envVal("GMI_API_KEY", env);
  const others = [];
  if (gmiKey) {
    const base = envVal("GMI_BASE_URL", env) ?? "https://api.gmi-serving.com/v1";
    const ids = (envVal("GMI_PANEL_MODELS", env) ?? "deepseek-ai/DeepSeek-V3.2,Qwen/Qwen3-235B-A22B-Instruct-2507").split(",").map((s) => s.trim()).filter(Boolean);
    for (const id of ids) others.push(new OpenAICompatModel(base, gmiKey, id));
  }
  return { gemini, others };
}

"use strict";
const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
async function buildContext(opts = {}, env = process.env) {
  const models = modelsFromEnv(env);
  if (!models) throw new Error("GEMINI_API_KEY is not set in the repo-root .env.local; refusing to fake variants.");
  const key = envVal("GEMINI_API_KEY", env);
  const solverModel = new GeminiModel(key, envVal("GEMINI_SOLVER_MODEL", env) ?? "gemini-3.6-flash");
  const fallbackSeats = (envVal("GEMINI_PANEL_FALLBACKS", env) ?? "gemini-3.6-flash,gemini-3.5-flash-lite").split(",").map((m) => new GeminiModel(key, m.trim()));
  const panel = buildPanel(models.gemini, models.others, fallbackSeats);
  const attacker = opts.noAttack ? { attack: async () => Promise.reject(new Error("re-attack disabled")) } : new CliAttacker({
    repoRoot: REPO_ROOT,
    repeats: opts.attackRepeats ?? 3,
    models: opts.attackModels ?? envVal("ATTACK_MODELS", env) ?? "gemini:gemini-3.5-flash",
    log: opts.log
  });
  const store = await openBranchStore(env);
  return {
    store,
    deps: { generator: new GeminiGenerator(models.gemini), solver: new GeminiCodeSolver(solverModel), judges: panel.judges, attacker },
    describe: `generator ${models.gemini.name}, solver ${solverModel.name}, panel [${panel.judges.map((j) => j.name).join("; ")}]`,
    independentPanel: panel.independentFamilies
  };
}

"use strict";
const TYPES = ["mcq", "multi", "numeric", "short"];
function parseMarkdownQuiz(md, opts) {
  const lines = md.split(/\r?\n/);
  const title = (lines.find((l) => l.startsWith("# ")) ?? "# Untitled quiz").slice(2).trim();
  const items = [];
  let cur = null;
  const finish = () => {
    if (!cur) return;
    const { _line, ...item } = cur;
    if (!item.objective) throw new Error(`item ${item.id} (line ${_line}) has no objective:`);
    if (item.type === "mcq" || item.type === "multi") {
      const keys = item.answerKey;
      if (!item.choices?.length) throw new Error(`item ${item.id} (line ${_line}) has no choices`);
      if (keys.length === 0) throw new Error(`item ${item.id} (line ${_line}) has no (answer) choice`);
      if (item.type === "mcq" && keys.length > 1) throw new Error(`mcq item ${item.id} (line ${_line}) has several answers`);
      item.answerKey = item.type === "mcq" ? keys[0] : keys;
    } else if (!item.answerKey) {
      throw new Error(`item ${item.id} (line ${_line}) has no answer:`);
    }
    items.push(item);
    cur = null;
  };
  lines.forEach((raw, i) => {
    const line = raw.trim();
    const head = line.match(/^(\d+)\.\s*\[(\w+)\]\s*(.+)$/);
    if (head) {
      finish();
      const type = head[2].toLowerCase();
      if (!TYPES.includes(type)) throw new Error(`line ${i + 1}: unknown item type [${head[2]}]`);
      const multiChoice = type === "mcq" || type === "multi";
      cur = {
        _line: i + 1,
        id: `${opts.quizId}-q${head[1]}`,
        quizId: opts.quizId,
        stem: head[3].trim(),
        type,
        ...multiChoice ? { choices: [] } : {},
        answerKey: multiChoice ? [] : "",
        objective: "",
        originalItemId: null
      };
      return;
    }
    if (!cur) return;
    const choice = line.match(/^-\s*([a-z])\)\s*(.+?)(\s*\(answer\))?$/i);
    if (choice && cur.choices) {
      const id = choice[1].toLowerCase();
      cur.choices.push({ id, text: choice[2].trim() });
      if (choice[3]) cur.answerKey.push(id);
      return;
    }
    const kv = line.match(/^(objective|answer):\s*(.+)$/i);
    if (kv) {
      if (kv[1].toLowerCase() === "objective") cur.objective = kv[2].trim();
      else cur.answerKey = kv[2].trim();
    }
  });
  finish();
  if (items.length === 0) throw new Error("no items found in quiz markdown");
  return { id: opts.quizId, courseId: opts.courseId, title, sourceFormat: "markdown", items };
}
async function saveQuiz(db, quiz, courseTitle = quiz.title) {
  await db.query("insert into course (id, title) values ($1, $2) on conflict (id) do nothing", [quiz.courseId, courseTitle]);
  await db.query(
    `insert into quiz (id, course_id, title, source_format) values ($1, $2, $3, $4)
     on conflict (id) do update set title = excluded.title, source_format = excluded.source_format`,
    [quiz.id, quiz.courseId, quiz.title, quiz.sourceFormat]
  );
  for (const it of quiz.items) {
    await db.query(
      `insert into item (id, quiz_id, stem, type, choices_json, answer_key, objective, original_item_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (id) do update set stem = excluded.stem, type = excluded.type, choices_json = excluded.choices_json,
         answer_key = excluded.answer_key, objective = excluded.objective`,
      [
        it.id,
        quiz.id,
        it.stem,
        it.type,
        it.choices ? JSON.stringify(it.choices) : null,
        JSON.stringify(it.answerKey),
        it.objective,
        it.originalItemId ?? null
      ]
    );
  }
}
async function loadQuiz(db, quizId) {
  const { rows: qs } = await db.query(
    "select id, course_id, title, source_format from quiz where id = $1",
    [quizId]
  );
  const q = qs[0];
  if (!q) throw new Error(`quiz not found: ${quizId}`);
  const { rows } = await db.query("select * from item where quiz_id = $1 and original_item_id is null", [quizId]);
  rows.sort((a, b) => a.id.localeCompare(b.id, void 0, { numeric: true }));
  return {
    id: q.id,
    courseId: q.course_id,
    title: q.title,
    sourceFormat: q.source_format,
    items: rows.map((r) => ({
      id: r.id,
      quizId,
      stem: r.stem,
      type: r.type,
      ...r.choices_json ? { choices: r.choices_json } : {},
      answerKey: r.answer_key,
      objective: r.objective,
      originalItemId: r.original_item_id
    }))
  };
}

"use strict";

"use strict";
function generateCandidates(generator, source, strategy, k) {
  return generator.generate(source, strategy, k);
}
async function solveWithInterpreter(solver, candidate, repeats = 3) {
  const settled = await Promise.allSettled(Array.from({ length: repeats }, (_, i) => solver.solve(candidate, i)));
  const answers = settled.flatMap((s) => s.status === "fulfilled" ? [s.value] : []);
  const errors = settled.flatMap((s) => s.status === "rejected" ? [String(s.reason?.message ?? s.reason)] : []);
  const key = answerText(candidate.answerKey);
  const agreeKey = answers.filter((a) => sameAnswer(candidate.type, a.answer, key)).length;
  const incomplete = errors.length > 0;
  const passed = !incomplete && agreeKey === repeats;
  const got = answers.map((a) => a.answer).join(", ") || "none";
  const detail = passed ? `solver matched key "${key}" ${repeats}/${repeats}${answers.every((a) => a.usedCode) ? " (ran code each time)" : ""}` : incomplete ? `solver did not finish ${errors.length}/${repeats} runs: ${errors[0].slice(0, 160)}` : `answer key "${key}" not reproduced: solver gave ${got}`;
  return { passed, incomplete, answers, errors, detail };
}
async function objectivePanel(judges, source, candidate) {
  const settled = await Promise.allSettled(judges.map((j) => j.vote(source, candidate)));
  const failed = settled.flatMap((s, i) => s.status === "rejected" ? [`${judges[i].name}: ${String(s.reason?.message ?? s.reason).slice(0, 160)}`] : []);
  const votes = settled.flatMap((s) => s.status === "fulfilled" ? [s.value] : []);
  if (failed.length) {
    return { incomplete: true, objectivePreserved: false, unambiguous: false, votes, detail: `panel incomplete (${failed.length}/${judges.length} seats failed): ${failed[0]}` };
  }
  const objectivePreserved = votes.every((v) => v.objectivePreserved);
  const unambiguous = votes.every((v) => v.unambiguous);
  const dissent = votes.filter((v) => !v.objectivePreserved || !v.unambiguous);
  const detail = dissent.length ? dissent.map((v) => `${v.judge}: ${v.reason}`).join(" | ") : `panel ${votes.length}/${votes.length}: same objective, unambiguous`;
  return { incomplete: false, objectivePreserved, unambiguous, votes, detail };
}
async function reattack(attacker, quiz, candidates, batchId) {
  const variantQuiz = {
    id: `${quiz.id}-variants-${batchId}`,
    courseId: quiz.courseId,
    title: `${quiz.title} (variant candidates)`,
    sourceFormat: quiz.sourceFormat,
    items: candidates.map(({ itemId, candidate }) => ({ ...candidate, id: itemId, quizId: `${quiz.id}-variants-${batchId}` }))
  };
  const { solveRates } = await attacker.attack(variantQuiz, variantQuiz.items.map((i) => i.id));
  return { variantQuiz, solveRates: new Map(solveRates.map((s) => [s.itemId, s])) };
}
function decide(original, next, opts = {}) {
  const maxNew = opts.maxNewSolveRate ?? 0.3;
  const minDrop = opts.minDrop ?? 0.4;
  if (!next || next.runs === 0) return { survives: false, reason: "re-attack produced no runs for this candidate" };
  const r = next.solveRate;
  const fmt = (x) => `${Math.round(x * 100)}%`;
  const runs = `${next.correct}/${next.runs} agent runs`;
  if (r > maxNew) return { survives: false, reason: `agents still solve it: ${runs} (${fmt(r)}, needs <= ${fmt(maxNew)})` };
  if (original - r < minDrop - 1e-9) {
    return { survives: false, reason: `solve rate only fell from ${fmt(original)} to ${fmt(r)} (needs a drop of ${fmt(minDrop)})` };
  }
  return { survives: true, reason: `solve rate fell from ${fmt(original)} to ${fmt(r)} (${runs})` };
}
function mergeSurvivor(store, branchName, experimentId, verified) {
  return mergeVariant(store, branchName, experimentId, { withItem: verified });
}
async function writeProposed(db, source, row) {
  const c = row.experiment.candidate;
  await db.query(
    `insert into item (id, quiz_id, stem, type, choices_json, answer_key, objective, original_item_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [row.candidateItemId, source.quizId, c.stem, c.type, c.choices ? JSON.stringify(c.choices) : null, JSON.stringify(c.answerKey), c.objective, source.id]
  );
  await saveExperiment(db, row);
}
async function saveExperiment(db, row) {
  const e = row.experiment;
  await db.query(
    `insert into variant_experiment (id, item_id, neon_branch, generator, strategy, candidate_json, status, reasons_json, checks_json, candidate_item_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     on conflict (id) do update set status = excluded.status, reasons_json = excluded.reasons_json, checks_json = excluded.checks_json`,
    [e.id, e.itemId, e.neonBranch, row.generator, e.strategy, JSON.stringify(e.candidate), e.status, JSON.stringify(e.reasons), JSON.stringify(e.checks), row.candidateItemId]
  );
}
async function nextVariantNumber(db, itemId) {
  const { rows } = await db.query("select id from variant_experiment where item_id = $1", [itemId]);
  const ks = rows.map((r) => Number(r.id.slice(itemId.length + 2))).filter((n) => Number.isInteger(n));
  return (ks.length ? Math.max(...ks) : 0) + 1;
}
async function loadExperiments(db, quizId) {
  const { rows } = await db.query(
    quizId ? "select e.* from variant_experiment e join item i on i.id = e.item_id where i.quiz_id = $1 order by e.created_at, e.id" : "select * from variant_experiment order by created_at, id",
    quizId ? [quizId] : []
  );
  return rows.map((r) => ({
    id: r.id,
    itemId: r.item_id,
    neonBranch: r.neon_branch,
    strategy: r.strategy,
    candidate: r.candidate_json,
    status: r.status,
    checks: r.checks_json ?? {},
    reasons: r.reasons_json ?? []
  }));
}
function selectTargets(quiz, solveRates, leakedItemIds, opts = {}) {
  const targets = [];
  const notes = [];
  for (const item of quiz.items) {
    if (opts.itemIds && !opts.itemIds.includes(item.id)) continue;
    const r = solveRates?.find((s) => s.itemId === item.id);
    const leaked = leakedItemIds.includes(item.id);
    if (!opts.itemIds && !(r?.agentSolvable || leaked)) continue;
    let solveRate = r?.solveRate;
    if (solveRate == null) {
      if (opts.assumeSolveRate == null) throw new Error(`no solve rate for ${item.id} (A's solve_rates.json); pass assumeSolveRate to proceed`);
      solveRate = opts.assumeSolveRate;
      notes.push(`${item.id}: original solve rate ASSUMED ${opts.assumeSolveRate} (no agent runs yet)`);
    }
    targets.push({ item, solveRate, leaked });
  }
  return { targets, notes };
}
async function applyApprovals(db, decisions) {
  const changed = [];
  for (const d of decisions) {
    const reason = d.approve ? null : `Rejected by professor${d.note ? `: ${d.note}` : ""}`;
    const { rows } = await db.query(
      `update variant_experiment
          set status = $2,
              reasons_json = case when $3::text is null then reasons_json else coalesce(reasons_json, '[]'::jsonb) || to_jsonb($3::text) end
        where id = $1 and status = 'verified'
        returning id`,
      [d.id, d.approve ? "approved" : "rejected", reason]
    );
    if (rows[0]) changed.push(rows[0].id);
  }
  return changed;
}

"use strict";
const ALL_STRATEGIES = ["isomorphic", "application", "find_error", "counterfactual", "figure_dependency"];
async function pool(items, limit, fn) {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, queue.length)) }, async () => {
      for (let t = queue.shift(); t !== void 0; t = queue.shift()) await fn(t);
    })
  );
}
async function runTransform(store, quiz, targets, deps, opts = {}) {
  const n = opts.candidatesPerItem ?? 3;
  const strategies = opts.strategies?.length ? opts.strategies : ALL_STRATEGIES;
  const emit = (e) => opts.onEvent?.(e);
  const prune = opts.pruneRejectedBranches ?? store.kind === "neon";
  const main = await store.main();
  const rows = [];
  const alive = [];
  const reject = async (row, reason) => {
    row.experiment.status = "rejected";
    row.experiment.reasons.push(reason);
    const branch = await store.branch(row.experiment.neonBranch);
    await saveExperiment(branch.db, row);
    await mergeSurvivor(store, row.experiment.neonBranch, row.experiment.id, false);
    if (prune) await store.deleteBranch(row.experiment.neonBranch);
    emit({ type: "rejected", experiment: structuredClone(row.experiment) });
  };
  const leaveUnverified = async (row, reason) => {
    row.experiment.reasons.push(`not verified: ${reason}`);
    const branch = await store.branch(row.experiment.neonBranch);
    await saveExperiment(branch.db, row);
    await mergeSurvivor(store, row.experiment.neonBranch, row.experiment.id, false);
    if (prune) await store.deleteBranch(row.experiment.neonBranch);
    emit({ type: "error", experimentId: row.experiment.id, message: `not verified: ${reason}` });
  };
  const plan = [];
  for (const target of targets) {
    const first = await nextVariantNumber(main.db, target.item.id);
    for (let i = 0; i < n; i++) plan.push({ target, k: first + i, strategy: strategies[i % strategies.length] });
  }
  await pool(plan, opts.concurrency ?? 2, async ({ target, k, strategy }) => {
    const source = target.item;
    const id = `${source.id}-v${k}`;
    const branchName = `exp/${source.id}/${k}`;
    const stage = (st) => emit({ type: "stage", experimentId: id, itemId: source.id, strategy, stage: st });
    let gen;
    stage("generating");
    try {
      gen = await generateCandidates(deps.generator, source, strategy, k);
    } catch (e) {
      emit({ type: "error", experimentId: id, message: `generator (${strategy}): ${String(e.message ?? e).slice(0, 300)}` });
      return;
    }
    const row = {
      generator: gen.generator,
      candidateItemId: id,
      experiment: { id, itemId: source.id, neonBranch: branchName, strategy, candidate: gen.candidate, status: "proposed", checks: {}, reasons: [] }
    };
    rows.push(row);
    try {
      const branch = await store.createBranch(branchName);
      await writeProposed(branch.db, source, row);
      emit({ type: "proposed", experiment: structuredClone(row.experiment), rationale: gen.rationale });
      stage("solving");
      const solve = await solveWithInterpreter(deps.solver, gen.candidate, opts.solveRepeats ?? 3);
      if (solve.incomplete) return leaveUnverified(row, solve.detail);
      row.experiment.checks.answerKeyConsistent = solve.passed;
      emit({ type: "check", experimentId: id, check: "answerKeyConsistent", passed: solve.passed, detail: solve.detail });
      if (!solve.passed) return reject(row, solve.detail);
      stage("judging");
      const panel = await objectivePanel(deps.judges, source, gen.candidate);
      if (panel.incomplete) return leaveUnverified(row, panel.detail);
      row.experiment.checks.objectivePreserved = panel.objectivePreserved;
      row.experiment.checks.unambiguous = panel.unambiguous;
      const total = deps.judges.length;
      emit({ type: "check", experimentId: id, check: "objectivePreserved", passed: panel.objectivePreserved, detail: panel.detail, agree: panel.votes.filter((v) => v.objectivePreserved).length, total });
      emit({ type: "check", experimentId: id, check: "unambiguous", passed: panel.unambiguous, detail: panel.detail, agree: panel.votes.filter((v) => v.unambiguous).length, total });
      if (!panel.objectivePreserved) return reject(row, `changed the learning objective: ${panel.detail}`);
      if (!panel.unambiguous) return reject(row, `ambiguous or wrong key: ${panel.detail}`);
      await saveExperiment(branch.db, row);
      alive.push({ row, target });
    } catch (e) {
      const msg = String(e.message ?? e).slice(0, 300);
      emit({ type: "error", experimentId: id, message: msg });
      try {
        await leaveUnverified(row, `pipeline error: ${msg}`);
      } catch {
      }
    }
  });
  if (alive.length) {
    const batchId = (/* @__PURE__ */ new Date()).toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
    const ids = alive.map((a) => a.row.candidateItemId);
    for (const a of alive) emit({ type: "stage", experimentId: a.row.experiment.id, itemId: a.target.item.id, strategy: a.row.experiment.strategy, stage: "re-attacking" });
    emit({ type: "attack_started", quizId: `${quiz.id}-variants-${batchId}`, itemIds: ids });
    let rates;
    try {
      const res = await reattack(deps.attacker, quiz, alive.map((a) => ({ itemId: a.row.candidateItemId, candidate: a.row.experiment.candidate })), batchId);
      rates = res.solveRates;
      emit({ type: "attack_done", quizId: res.variantQuiz.id, solveRates: [...rates.values()] });
    } catch (e) {
      const msg = `re-attack failed, candidates left unverified: ${String(e.message ?? e).slice(0, 300)}`;
      emit({ type: "error", message: msg });
      for (const { row } of alive) {
        row.experiment.reasons.push(msg);
        await saveExperiment((await store.branch(row.experiment.neonBranch)).db, row);
        await mergeSurvivor(store, row.experiment.neonBranch, row.experiment.id, false);
      }
      rates = null;
    }
    if (rates) {
      for (const { row, target } of alive) {
        const next = rates.get(row.candidateItemId);
        row.experiment.checks.newSolveRate = next?.solveRate;
        const d = decide(target.solveRate, next, opts);
        if (!d.survives) {
          await reject(row, d.reason);
          continue;
        }
        row.experiment.status = "verified";
        row.experiment.reasons.push(d.reason);
        await saveExperiment((await store.branch(row.experiment.neonBranch)).db, row);
        await mergeSurvivor(store, row.experiment.neonBranch, row.experiment.id, true);
        emit({ type: "verified", experiment: structuredClone(row.experiment) });
      }
    }
  }
  const experiments = rows.map((r) => r.experiment);
  const survived = new Set(experiments.filter((e) => e.status === "verified").map((e) => e.itemId));
  return { experiments, probePriority: targets.map((t) => t.item.id).filter((id) => !survived.has(id)) };
}

"use strict";
let ctxPromise = null;
let ctxOptions = {};
function setTransformContext(ctx2, opts = {}) {
  ctxPromise = ctx2 ? Promise.resolve(ctx2) : null;
  ctxOptions = opts;
}
function ctx() {
  ctxPromise ??= buildContext(ctxOptions);
  return ctxPromise;
}
const Input = z.object({
  quizId: z.string(),
  itemIds: z.array(z.string()).optional(),
  solveRates: z.array(z.any()).nullable().default(null),
  leakedItemIds: z.array(z.string()).default([]),
  assumeSolveRate: z.number().nullable().default(null),
  candidatesPerItem: z.number().int().min(1).max(5).default(2)
});
const Selected = z.object({
  quizId: z.string(),
  targets: z.array(z.any()),
  notes: z.array(z.string()),
  candidatesPerItem: z.number()
});
const Transformed = z.object({
  quizId: z.string(),
  experiments: z.array(z.any()),
  probePriority: z.array(z.string()),
  notes: z.array(z.string())
});
const Waiting = z.object({
  verified: z.array(z.object({
    id: z.string(),
    itemId: z.string(),
    strategy: z.string(),
    stem: z.string(),
    reason: z.string().optional()
  }))
});
const Decisions = z.object({
  decisions: z.array(z.object({
    id: z.string(),
    approve: z.boolean(),
    note: z.string().optional()
  }))
});
const Final = z.object({
  quizId: z.string(),
  experiments: z.array(z.any()),
  probePriority: z.array(z.string()),
  notes: z.array(z.string()),
  decided: z.array(z.string())
});
const selectTargetsStep = createStep({
  id: "select-targets",
  description: "Pick agent-solvable or leaked items and attach their measured solve rates",
  inputSchema: Input,
  outputSchema: Selected,
  execute: async ({
    inputData
  }) => {
    const {
      store: store2
    } = await ctx();
    const quiz = await loadQuiz((await store2.main()).db, inputData.quizId);
    const {
      targets,
      notes
    } = selectTargets(quiz, inputData.solveRates, inputData.leakedItemIds, {
      itemIds: inputData.itemIds,
      assumeSolveRate: inputData.assumeSolveRate
    });
    return {
      quizId: quiz.id,
      targets,
      notes,
      candidatesPerItem: inputData.candidatesPerItem
    };
  }
});
const transformStep = createStep({
  id: "transform",
  description: "Rewrite, solve x3 with code, 3-model panel, agent re-attack, keep survivors (one Neon branch per candidate)",
  inputSchema: Selected,
  outputSchema: Transformed,
  execute: async ({
    inputData,
    writer
  }) => {
    const {
      store: store2,
      deps
    } = await ctx();
    const quiz = await loadQuiz((await store2.main()).db, inputData.quizId);
    const res = await runTransform(store2, quiz, inputData.targets, deps, {
      candidatesPerItem: inputData.candidatesPerItem,
      onEvent: (e) => void writer?.write(e)
    });
    return {
      quizId: quiz.id,
      experiments: res.experiments,
      probePriority: res.probePriority,
      notes: inputData.notes
    };
  }
});
const approvalStep = createStep({
  id: "professor-approval",
  description: "Pause until the professor approves or rejects each verified variant in /studio",
  inputSchema: Transformed,
  outputSchema: Final,
  suspendSchema: Waiting,
  resumeSchema: Decisions,
  execute: async ({
    inputData,
    resumeData,
    suspend
  }) => {
    const verified = inputData.experiments.filter((e) => e.status === "verified");
    if (!verified.length) return {
      ...inputData,
      decided: []
    };
    if (!resumeData) {
      return suspend({
        verified: verified.map((e) => ({
          id: e.id,
          itemId: e.itemId,
          strategy: e.strategy,
          stem: e.candidate.stem,
          reason: e.reasons.at(-1)
        }))
      });
    }
    const {
      store: store2
    } = await ctx();
    const main = (await store2.main()).db;
    const decided = await applyApprovals(main, resumeData.decisions);
    const now = await loadExperiments(main, inputData.quizId);
    const ids = new Set(inputData.experiments.map((e) => e.id));
    return {
      ...inputData,
      experiments: now.filter((e) => ids.has(e.id)),
      decided
    };
  }
});
const transformWorkflow = createWorkflow({
  id: "transform",
  description: "Make agent-solvable quiz questions agent-resistant without changing what they test",
  inputSchema: Input,
  outputSchema: Final
}).then(selectTargetsStep).then(transformStep).then(approvalStep).commit();
function storage() {
  const url = envVal("DATABASE_URL");
  return url ? new PostgresStore({
    id: "unprompted-mastra",
    connectionString: url,
    schemaName: "mastra"
  }) : void 0;
}
const store = storage();
const mastra = new Mastra({
  workflows: {
    transform: transformWorkflow
  },
  ...store ? {
    storage: store
  } : {}
});

export { approvalStep, mastra, selectTargetsStep, setTransformContext, transformStep, transformWorkflow };
