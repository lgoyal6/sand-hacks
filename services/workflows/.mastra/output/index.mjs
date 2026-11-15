import { scoreTracesWorkflow } from '@mastra/core/evals/scoreTraces';
import { Mastra } from '@mastra/core';
import { createWorkflow, createStep } from '@mastra/core/workflows';
import { PostgresStore } from '@mastra/pg';
import { z } from 'zod';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { Pool, neonConfig } from '@neondatabase/serverless';
import { PGlite } from '@electric-sql/pglite';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { GoogleGenAI } from '@google/genai';
import { existsSync as existsSync$1, createReadStream, statSync } from 'fs';
import { readFile as readFile$1 } from 'fs/promises';
import { join, dirname } from 'path';
import { Readable, Writable } from 'stream';
import { fileURLToPath } from 'url';
import * as https from 'https';
import { createServer, ServerResponse, STATUS_CODES } from 'http';
import { Http2ServerRequest, constants } from 'http2';
import process$1, { versions } from 'process';
import { aJ as escapeToBuffer, aK as raw, aL as resolveCallbackSync, aM as stringBufferToString, aN as HTTPException, ap as Hono, aO as InMemoryTaskStore, aH as isZodError, ae as findMatchingCustomRoute, ao as isCustomRoutePublic, aj as coreAuthMiddleware } from './routes-CmkPohqd.mjs';
import { Tool } from '@mastra/core/tools';
import { M as MastraServer, n as normalizeQueryParams, i as isSafeObjectKey, b as applyMcpRequestAuth, p as propagateRequestAbort, g as getCustomHTTPExceptionResponse, e as getHTTPErrorResponse, f as MASTRA_FRAMEWORK_PUBLIC_KEY, h as getFGAProvider, j as checkRouteFGA, r as redactStreamChunk, s as serializeStreamChunk } from './server-adapter-BywLWVKp.mjs';
import util from 'util';
import { Buffer as Buffer$1 } from 'buffer';
import { RequestContext } from '@mastra/core/request-context';
import { tools } from './tools.mjs';
import './rolldown-runtime-CQI-hT2b.mjs';
import 'zod/v4';
import 'zod/v3';
import 'module';
import '@mastra/core/schema';
import '@mastra/core/utils/zod-to-json';
import '@mastra/core/auth/ee';
import '@mastra/core/memory';
import '@mastra/core/stream';
import '@mastra/core/agent';
import '@mastra/core/agent/durable';
import '@mastra/core/di';
import '@mastra/core/error';
import '@mastra/core/llm';
import '@mastra/core/server';
import '@mastra/core/a2a';
import '@mastra/core/a2a/v1';
import 'dns/promises';
import 'net';
import '@mastra/core/storage';
import '@mastra/core/features';
import '@mastra/core/knowledge';
import '@mastra/core/utils';
import '@mastra/core/evals';
import '@mastra/core/observability';
import '@mastra/core/processors';
import '@mastra/core/workspace';
import 'stream/promises';

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

function findRepoRoot() {
  const starts = [process.env.UNPROMPTED_ROOT, process.cwd(), import.meta.dirname].filter(Boolean);
  for (const start of starts) {
    let dir = path.resolve(start);
    for (let i = 0; i < 8; i++) {
      if (existsSync(path.join(dir, "pnpm-workspace.yaml")) && existsSync(path.join(dir, "db/neon/schema.sql"))) return dir;
      const up = path.dirname(dir);
      if (up === dir) break;
      dir = up;
    }
  }
  throw new Error("Can't find the repo root (pnpm-workspace.yaml + db/neon/schema.sql). Set UNPROMPTED_ROOT.");
}
const REPO_ROOT = findRepoRoot();
const SCHEMA_PATH = path.join(REPO_ROOT, "db/neon/schema.sql");
path.join(REPO_ROOT, "data/fixtures");
const LLM_CACHE_DIR = path.join(REPO_ROOT, "services/workflows/.cache/llm");

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

function envVal(k, env = process.env) {
  const v = env[k]?.trim();
  return v && !v.startsWith("#") ? v : void 0;
}
class InfraError extends Error {
}
const CACHE_DIR = LLM_CACHE_DIR;
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

let ctxPromise = null;
let ctxOptions = {};
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

/**
* Ensures that server.studioBase is normalized:
* - Adds leading slash if missing (e.g., 'admin' → '/admin')
* - Removes trailing slashes (e.g., '/admin/' → '/admin')
* - Normalizes multiple slashes to single slash (e.g., '//api' → '/api')
* - Returns empty string for root paths ('/' or '')
*
* @param studioBase - The studioBase path to normalize
* @returns Normalized studioBase path string
* @throws Error if path contains invalid characters ('..', '?', '#')
*/
function normalizeStudioBase(studioBase) {
	studioBase = studioBase.trim();
	if (studioBase.includes("..") || studioBase.includes("?") || studioBase.includes("#")) throw new Error(`Invalid base path: "${studioBase}". Base path cannot contain '..', '?', or '#'`);
	studioBase = studioBase.replace(/\/+/g, "/");
	if (studioBase === "/" || studioBase === "") return "";
	if (studioBase.endsWith("/")) studioBase = studioBase.slice(0, -1);
	if (!studioBase.startsWith("/")) studioBase = `/${studioBase}`;
	return studioBase;
}
/**
* Replace all `%%MASTRA_*%%` placeholders in the Studio `index.html` with the
* supplied configuration values.
*
* The `<base href>` tag and the `window.MASTRA_STUDIO_BASE_PATH` assignment
* use `basePath` as a plain string (no surrounding quotes), while all other
* placeholders replace `'%%TOKEN%%'` (with surrounding single-quotes in the
* source HTML) with the provided expression verbatim.
*/
function injectStudioHtmlConfig(html, config) {
	const replace = (token, value) => {
		html = html.replace(token, () => value);
	};
	replace(`'%%MASTRA_DEV_SERVER_INSTANCE_ID%%'`, config.devServerInstanceId ?? "''");
	replace(`'%%MASTRA_SERVER_HOST%%'`, config.host);
	replace(`'%%MASTRA_SERVER_PORT%%'`, config.port);
	replace(`'%%MASTRA_SERVER_PROTOCOL%%'`, config.protocol);
	replace(`'%%MASTRA_API_PREFIX%%'`, config.apiPrefix);
	replace(`'%%MASTRA_HIDE_CLOUD_CTA%%'`, config.hideCloudCta);
	replace(`'%%MASTRA_CLOUD_API_ENDPOINT%%'`, config.cloudApiEndpoint);
	replace(`'%%MASTRA_EXPERIMENTAL_FEATURES%%'`, config.experimentalFeatures);
	replace(`'%%MASTRA_TEMPLATES%%'`, config.templates);
	replace(`'%%MASTRA_TELEMETRY_DISABLED%%'`, config.telemetryDisabled);
	replace(`'%%MASTRA_REQUEST_CONTEXT_PRESETS%%'`, config.requestContextPresets);
	replace(`'%%MASTRA_EXPERIMENTAL_UI%%'`, config.experimentalUI);
	replace(`'%%MASTRA_AGENT_SIGNALS%%'`, config.agentSignals);
	replace(`'%%MASTRA_SIGNALS_UI%%'`, config.signalsUI);
	replace(`'%%MASTRA_ORGANIZATION_ID%%'`, config.organizationId);
	replace(`'%%MASTRA_PLATFORM_PROJECT_ID%%'`, config.platformProjectId);
	replace(`'%%MASTRA_PLATFORM_OBSERVABILITY_ENDPOINT%%'`, config.platformObservabilityEndpoint);
	if (config.autoDetectUrl) replace(`'%%MASTRA_AUTO_DETECT_URL%%'`, config.autoDetectUrl);
	html = html.replaceAll("%%MASTRA_STUDIO_BASE_PATH%%", () => config.basePath);
	return html;
}
/**
* Escape a dynamic value for embedding inside a single-quoted JavaScript
* string literal in the Studio `index.html` (e.g. `window.X = '<value>'`).
* Without it, an env-derived value containing `'` or `<\/script>` breaks out
* of the literal and corrupts (or injects into) the served page.
*/
function escapeStudioHtmlValue(value) {
	return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

//#region src/utils/mime.ts
/**
* @module
* MIME utility.
*/
const getMimeType = (filename, mimes = baseMimes) => {
	const match = filename.match(/\.([a-zA-Z0-9]+?)$/);
	if (!match) return;
	return mimes[match[1].toLowerCase()];
};
const baseMimes = {
	aac: "audio/aac",
	avi: "video/x-msvideo",
	avif: "image/avif",
	av1: "video/av1",
	bin: "application/octet-stream",
	bmp: "image/bmp",
	css: "text/css; charset=utf-8",
	csv: "text/csv; charset=utf-8",
	eot: "application/vnd.ms-fontobject",
	epub: "application/epub+zip",
	gif: "image/gif",
	gz: "application/gzip",
	htm: "text/html; charset=utf-8",
	html: "text/html; charset=utf-8",
	ico: "image/x-icon",
	ics: "text/calendar; charset=utf-8",
	jpeg: "image/jpeg",
	jpg: "image/jpeg",
	js: "text/javascript; charset=utf-8",
	json: "application/json",
	jsonld: "application/ld+json",
	map: "application/json",
	mid: "audio/x-midi",
	midi: "audio/x-midi",
	mjs: "text/javascript; charset=utf-8",
	mp3: "audio/mpeg",
	mp4: "video/mp4",
	mpeg: "video/mpeg",
	oga: "audio/ogg",
	ogv: "video/ogg",
	ogx: "application/ogg",
	opus: "audio/opus",
	otf: "font/otf",
	pdf: "application/pdf",
	png: "image/png",
	rtf: "application/rtf",
	svg: "image/svg+xml; charset=utf-8",
	tif: "image/tiff",
	tiff: "image/tiff",
	ts: "video/mp2t",
	ttf: "font/ttf",
	txt: "text/plain; charset=utf-8",
	wasm: "application/wasm",
	webm: "video/webm",
	weba: "audio/webm",
	webmanifest: "application/manifest+json",
	webp: "image/webp",
	woff: "font/woff",
	woff2: "font/woff2",
	xhtml: "application/xhtml+xml; charset=utf-8",
	xml: "application/xml; charset=utf-8",
	zip: "application/zip",
	"3gp": "video/3gpp",
	"3g2": "video/3gpp2",
	gltf: "model/gltf+json",
	glb: "model/gltf-binary"
};

//#region src/helper/html/index.ts
/**
* @module
* html Helper for Hono.
*/
const html = (strings, ...values) => {
	const buffer = [""];
	for (let i = 0, len = strings.length - 1; i < len; i++) {
		buffer[0] += strings[i];
		const children = Array.isArray(values[i]) ? values[i].flat(Infinity) : [values[i]];
		for (let i = 0, len = children.length; i < len; i++) {
			const child = children[i];
			if (typeof child === "string") escapeToBuffer(child, buffer);
			else if (typeof child === "number") buffer[0] += child;
			else if (typeof child === "boolean" || child === null || child === void 0) continue;
			else if (typeof child === "object" && child.isEscaped) {
				if (child.callbacks) buffer.unshift("", child);
				else {
					const tmp = child.toString();
					if (tmp instanceof Promise) buffer.unshift("", tmp);
					else buffer[0] += tmp;
				}
			} else if (child instanceof Promise) buffer.unshift("", child);
			else escapeToBuffer(child.toString(), buffer);
		}
	}
	buffer[0] += strings.at(-1);
	return buffer.length === 1 ? "callbacks" in buffer ? raw(resolveCallbackSync(raw(buffer[0], buffer.callbacks))) : raw(buffer[0]) : stringBufferToString(buffer, buffer.callbacks);
};

//#region src/middleware/body-limit/index.ts
const ERROR_MESSAGE = "Payload Too Large";
/**
* Body Limit Middleware for Hono.
*
* @see {@link https://hono.dev/docs/middleware/builtin/body-limit}
*
* @param {BodyLimitOptions} options - The options for the body limit middleware.
* @param {number} options.maxSize - The maximum body size allowed.
* @param {OnError} [options.onError] - The error handler to be invoked if the specified body size is exceeded.
* @returns {MiddlewareHandler} The middleware handler function.
*
* @example
* ```ts
* const app = new Hono()
*
* app.post(
*   '/upload',
*   bodyLimit({
*     maxSize: 50 * 1024, // 50kb
*     onError: (c) => {
*       return c.text('overflow :(', 413)
*     },
*   }),
*   async (c) => {
*     const body = await c.req.parseBody()
*     if (body['file'] instanceof File) {
*       console.log(`Got file sized: ${body['file'].size}`)
*     }
*     return c.text('pass :)')
*   }
* )
* ```
*/
const bodyLimit = (options) => {
	const onError = options.onError || (() => {
		const res = new Response(ERROR_MESSAGE, { status: 413 });
		throw new HTTPException(413, { res });
	});
	const maxSize = options.maxSize;
	return async function bodyLimit(c, next) {
		if (!c.req.raw.body) return next();
		const hasTransferEncoding = c.req.raw.headers.has("transfer-encoding");
		if (c.req.raw.headers.has("content-length") && !hasTransferEncoding) return parseInt(c.req.raw.headers.get("content-length") || "0", 10) > maxSize ? onError(c) : next();
		let size = 0;
		let buffer = /* @__PURE__ */ new Uint8Array(0);
		const rawReader = c.req.raw.body.getReader();
		for (;;) {
			const { done, value } = await rawReader.read();
			if (done) break;
			const offset = size;
			size += value.length;
			if (size > maxSize) return onError(c);
			if (size > buffer.length) {
				const grown = new Uint8Array(Math.min(maxSize, Math.max(size, buffer.length * 2)));
				grown.set(buffer.subarray(0, offset));
				buffer = grown;
			}
			buffer.set(value, offset);
		}
		c.req.raw = new Request(c.req.raw, { body: buffer.subarray(0, size) });
		return next();
	};
};

//#region src/utils/stream.ts
/**
* @module
* Stream utility.
*/
var StreamingApi = class {
	writer;
	encoder;
	writable;
	abortSubscribers = [];
	responseReadable;
	/**
	* Whether the stream has been aborted.
	*/
	aborted = false;
	/**
	* Whether the stream has been closed normally.
	*/
	closed = false;
	constructor(writable, _readable) {
		this.writable = writable;
		this.writer = writable.getWriter();
		this.encoder = new TextEncoder();
		const reader = _readable.getReader();
		this.abortSubscribers.push(async () => {
			await reader.cancel();
		});
		this.responseReadable = new ReadableStream({
			async pull(controller) {
				const { done, value } = await reader.read();
				done ? controller.close() : controller.enqueue(value);
			},
			cancel: () => {
				if (!this.closed) this.abort();
			}
		});
	}
	async write(input) {
		try {
			if (typeof input === "string") input = this.encoder.encode(input);
			await this.writer.write(input);
		} catch {}
		return this;
	}
	async writeln(input) {
		await this.write(input + "\n");
		return this;
	}
	sleep(ms) {
		return new Promise((res) => setTimeout(res, ms));
	}
	async close() {
		this.closed = true;
		try {
			await this.writer.close();
		} catch {}
	}
	async pipe(body) {
		this.writer.releaseLock();
		try {
			await body.pipeTo(this.writable, {
				preventClose: true,
				preventAbort: true
			});
		} finally {
			this.writer = this.writable.getWriter();
		}
	}
	onAbort(listener) {
		this.abortSubscribers.push(listener);
	}
	/**
	* Abort the stream.
	* You can call this method when stream is aborted by external event.
	*/
	abort() {
		if (!this.aborted) {
			this.aborted = true;
			this.abortSubscribers.forEach((subscriber) => {
				try {
					Promise.resolve(subscriber()).catch(() => {});
				} catch {}
			});
		}
	}
};

//#region src/helper/streaming/utils.ts
let isOldBunVersion = () => {
	const version = typeof Bun !== "undefined" ? Bun.version : void 0;
	if (version === void 0) return false;
	const result = version.startsWith("1.1") || version.startsWith("1.0") || version.startsWith("0.");
	isOldBunVersion = () => result;
	return result;
};

//#region src/helper/streaming/stream.ts
const contextStash = /* @__PURE__ */ new WeakMap();
const stream = (c, cb, onError) => {
	const { readable, writable } = new TransformStream();
	const stream = new StreamingApi(writable, readable);
	if (isOldBunVersion()) c.req.raw.signal.addEventListener("abort", () => {
		if (!stream.closed) stream.abort();
	});
	contextStash.set(stream.responseReadable, c);
	(async () => {
		try {
			await cb(stream);
		} catch (e) {
			if (e === void 0) ; else if (e instanceof Error && onError) await onError(e, stream);
			else console.error(e);
		} finally {
			stream.close();
		}
	})();
	return c.newResponse(stream.responseReadable);
};

// src/server/browser-stream/viewer-registry.ts
/**
* ViewerRegistry manages WebSocket connections per agent and controls screencast lifecycle.
*
* Key responsibilities:
* - Track connected viewers per agentId
* - Start screencast when browser becomes active (not on viewer connect)
* - Stop screencast when last viewer disconnects
* - Broadcast frames to all viewers for an agent
*
* The browser is NOT launched when viewers connect - it only starts streaming
* when the browser is already running from agent tool usage.
*
* @example
* ```typescript
* const registry = new ViewerRegistry();
*
* // When a viewer connects
* registry.addViewer('agent-123', ws, getToolset);
*
* // When a viewer disconnects
* registry.removeViewer('agent-123', ws);
* ```
*/
var ViewerRegistry = class {
	/** Map of agentId to set of connected WebSocket contexts */
	viewers = /* @__PURE__ */ new Map();
	/** Map of agentId to active screencast stream */
	screencasts = /* @__PURE__ */ new Map();
	/** Set of viewerKeys currently starting a screencast (to prevent race conditions) */
	startingScreencasts = /* @__PURE__ */ new Set();
	/** Map of agentId to cleanup function for onBrowserReady callback */
	browserReadyCleanups = /* @__PURE__ */ new Map();
	/** Map of agentId to cleanup function for onBrowserClosed callback */
	browserClosedCleanups = /* @__PURE__ */ new Map();
	/** Map of agentId to last known URL (for dedup) */
	lastUrls = /* @__PURE__ */ new Map();
	/** Map of agentId to last known viewport dimensions (for change detection) */
	lastViewports = /* @__PURE__ */ new Map();
	/** Map of viewerKey to last broadcast status (for replay to new viewers) */
	lastStatuses = /* @__PURE__ */ new Map();
	/**
	* Add a viewer for an agent. Starts screencast if this is the first viewer.
	*
	* @param viewerKey - The viewer key (agentId or agentId:threadId for thread-scoped)
	* @param ws - The WebSocket context for this viewer
	* @param getToolset - Function to retrieve the BrowserToolset for this agent
	* @param agentId - The actual agent ID for toolset lookup (optional, defaults to viewerKey)
	* @param threadId - The thread ID for thread-scoped screencasts (optional)
	*/
	async addViewer(viewerKey, ws, getToolset, agentId, threadId) {
		let viewerSet = this.viewers.get(viewerKey);
		if (!viewerSet) {
			viewerSet = /* @__PURE__ */ new Set();
			this.viewers.set(viewerKey, viewerSet);
		}
		const wasEmpty = viewerSet.size === 0;
		viewerSet.add(ws);
		if (wasEmpty || !this.browserReadyCleanups.has(viewerKey)) await this.startScreencast(viewerKey, getToolset, agentId ?? viewerKey, threadId);
		else this.sendCurrentState(viewerKey, ws);
	}
	/**
	* Send current state (URL, viewport) to a newly connected viewer.
	*/
	sendCurrentState(viewerKey, ws) {
		try {
			const lastUrl = this.lastUrls.get(viewerKey);
			if (lastUrl) ws.send(JSON.stringify({ url: lastUrl }));
			const lastViewport = this.lastViewports.get(viewerKey);
			if (lastViewport) ws.send(JSON.stringify({ viewport: lastViewport }));
			const lastStatus = this.lastStatuses.get(viewerKey);
			if (lastStatus) ws.send(JSON.stringify({ status: lastStatus }));
		} catch (error) {
			console.warn("[ViewerRegistry] Error sending current state to new viewer:", error);
		}
	}
	/**
	* Remove a viewer. Stops screencast if this was the last viewer.
	*
	* @param viewerKey - The viewer key (agentId or agentId:threadId for thread-scoped)
	* @param ws - The WebSocket context to remove
	*/
	async removeViewer(viewerKey, ws) {
		const viewerSet = this.viewers.get(viewerKey);
		if (!viewerSet) return;
		viewerSet.delete(ws);
		if (viewerSet.size === 0) {
			this.viewers.delete(viewerKey);
			this.lastUrls.delete(viewerKey);
			this.lastViewports.delete(viewerKey);
			const readyCleanup = this.browserReadyCleanups.get(viewerKey);
			if (readyCleanup) {
				readyCleanup();
				this.browserReadyCleanups.delete(viewerKey);
			}
			const closedCleanup = this.browserClosedCleanups.get(viewerKey);
			if (closedCleanup) {
				closedCleanup();
				this.browserClosedCleanups.delete(viewerKey);
			}
			await this.stopScreencast(viewerKey);
		}
	}
	/**
	* Broadcast a binary frame to all viewers.
	*
	* @param viewerKey - The viewer key (agentId or agentId:threadId for thread-scoped)
	* @param data - The binary frame data (base64 encoded)
	*/
	broadcastFrame(viewerKey, data) {
		const viewerSet = this.viewers.get(viewerKey);
		if (!viewerSet) return;
		for (const ws of viewerSet) try {
			ws.send(data);
		} catch (error) {
			console.warn("[ViewerRegistry] Error broadcasting frame:", error);
		}
	}
	/**
	* Broadcast a status message to all viewers.
	*
	* @param viewerKey - The viewer key (agentId or agentId:threadId for thread-scoped)
	* @param status - The status message to send
	*/
	broadcastStatus(viewerKey, status) {
		if (status.status) this.lastStatuses.set(viewerKey, status.status);
		const viewerSet = this.viewers.get(viewerKey);
		if (!viewerSet) return;
		const message = JSON.stringify(status);
		for (const ws of viewerSet) try {
			ws.send(message);
		} catch (error) {
			console.warn("[ViewerRegistry] Error broadcasting status:", error);
		}
	}
	/**
	* Broadcast a URL update to all viewers (only if changed).
	*/
	broadcastUrlIfChanged(viewerKey, url) {
		if (!url) return;
		if (this.lastUrls.get(viewerKey) === url) return;
		this.lastUrls.set(viewerKey, url);
		const viewerSet = this.viewers.get(viewerKey);
		if (!viewerSet) return;
		const message = JSON.stringify({ url });
		for (const ws of viewerSet) try {
			ws.send(message);
		} catch (error) {
			console.warn("[ViewerRegistry] Error broadcasting URL:", error);
		}
	}
	/**
	* Broadcast viewport metadata to all viewers.
	* Only sends if dimensions have changed from last broadcast.
	* Called on stream start and on each frame to detect dimension changes.
	*/
	broadcastViewportIfChanged(viewerKey, viewport) {
		const last = this.lastViewports.get(viewerKey);
		if (last && last.width === viewport.width && last.height === viewport.height) return;
		this.lastViewports.set(viewerKey, {
			width: viewport.width,
			height: viewport.height
		});
		const viewerSet = this.viewers.get(viewerKey);
		if (!viewerSet) return;
		const message = { viewport: {
			width: viewport.width,
			height: viewport.height
		} };
		const json = JSON.stringify(message);
		for (const ws of viewerSet) try {
			ws.send(json);
		} catch (error) {
			console.warn("[ViewerRegistry] Error broadcasting viewport:", error);
		}
	}
	/**
	* Start screencast for a viewer. Only starts if browser is already running.
	* If browser not running, registers a callback to start when browser becomes ready.
	* If no toolset can be resolved, nothing is registered; `addViewer` retries the
	* lookup the next time a viewer connects for this key.
	*
	* @param viewerKey - The viewer key (for registry keying)
	* @param getToolset - Function to retrieve the BrowserToolset
	* @param agentId - The actual agent ID for toolset lookup
	* @param threadId - The thread ID for thread-scoped page selection (optional)
	*/
	async startScreencast(viewerKey, getToolset, agentId, threadId) {
		const toolset = await getToolset(agentId);
		if (!this.viewers.has(viewerKey)) return;
		if (!toolset) {
			console.info(`[ViewerRegistry] No browser toolset for ${viewerKey}; will retry on next viewer connect`);
			return;
		}
		if (!this.browserReadyCleanups.has(viewerKey)) {
			const cleanup = toolset.onBrowserReady(() => {
				if (!this.viewers.has(viewerKey)) return;
				const existingStream = this.screencasts.get(viewerKey);
				if (existingStream) {
					console.info(`[ViewerRegistry] Stopping old screencast for ${viewerKey} before reconnecting...`);
					this.screencasts.delete(viewerKey);
					existingStream.stop().catch(() => {});
				}
				console.info(`[ViewerRegistry] Browser ready for ${viewerKey}, starting screencast...`);
				this.doStartScreencast(viewerKey, toolset, threadId).catch((error) => {
					console.error(`[ViewerRegistry] Failed to start screencast on browser ready for ${viewerKey}:`, error);
				});
			}, threadId);
			this.browserReadyCleanups.set(viewerKey, cleanup);
		}
		if (!this.browserClosedCleanups.has(viewerKey)) {
			const cleanup = toolset.onBrowserClosed(() => {
				console.info(`[ViewerRegistry] Browser closed for ${viewerKey}, notifying viewers...`);
				this.screencasts.delete(viewerKey);
				this.broadcastStatus(viewerKey, { status: "browser_closed" });
			}, threadId);
			this.browserClosedCleanups.set(viewerKey, cleanup);
		}
		if (toolset.isBrowserRunning(threadId)) await this.doStartScreencast(viewerKey, toolset, threadId);
		else console.info(`[ViewerRegistry] Browser not running for ${viewerKey}, waiting for browser to start...`);
	}
	/**
	* Internal method to actually start the screencast stream.
	*
	* @param viewerKey - The viewer key (for registry keying and logging)
	* @param toolset - The browser toolset
	* @param threadId - The thread ID for thread-scoped page selection (optional)
	*/
	async doStartScreencast(viewerKey, toolset, threadId) {
		if (this.screencasts.has(viewerKey) || this.startingScreencasts.has(viewerKey)) return;
		this.startingScreencasts.add(viewerKey);
		try {
			this.broadcastStatus(viewerKey, { status: "browser_starting" });
			const stream = await toolset.startScreencastIfBrowserActive(threadId ? { threadId } : void 0);
			if (!stream) {
				console.warn(`[ViewerRegistry] No browser session for ${viewerKey}`);
				this.broadcastStatus(viewerKey, { status: "browser_closed" });
				return;
			}
			this.screencasts.set(viewerKey, stream);
			const currentStream = stream;
			stream.on("frame", (frame) => {
				if (this.screencasts.get(viewerKey) !== currentStream) return;
				this.broadcastFrame(viewerKey, frame.data);
				this.broadcastViewportIfChanged(viewerKey, frame.viewport);
			});
			stream.on("url", (url) => {
				if (this.screencasts.get(viewerKey) !== currentStream) return;
				this.broadcastUrlIfChanged(viewerKey, url);
			});
			stream.on("stop", (reason) => {
				if (this.screencasts.get(viewerKey) !== currentStream) {
					console.info(`[ViewerRegistry] Ignoring stop from superseded stream for ${viewerKey}`);
					return;
				}
				console.info(`[ViewerRegistry] Screencast stopped for ${viewerKey}: ${reason}`);
				this.screencasts.delete(viewerKey);
				this.broadcastStatus(viewerKey, { status: "browser_closed" });
			});
			stream.on("error", (error) => {
				if (this.screencasts.get(viewerKey) !== currentStream) return;
				console.error(`[ViewerRegistry] Screencast error for ${viewerKey}:`, error);
				this.screencasts.delete(viewerKey);
				currentStream.stop().catch((stopError) => {
					console.warn(`[ViewerRegistry] Error stopping errored screencast for ${viewerKey}:`, stopError);
				});
				this.broadcastStatus(viewerKey, { status: "browser_closed" });
			});
			this.broadcastStatus(viewerKey, { status: "streaming" });
			const initialUrl = await toolset.getCurrentUrl(threadId);
			this.broadcastUrlIfChanged(viewerKey, initialUrl);
		} catch (error) {
			console.error(`[ViewerRegistry] Failed to start screencast for ${viewerKey}:`, error);
		} finally {
			this.startingScreencasts.delete(viewerKey);
		}
	}
	/**
	* Stop screencast for an agent. Called when last viewer disconnects.
	*/
	async stopScreencast(agentId) {
		const stream = this.screencasts.get(agentId);
		if (!stream) return;
		try {
			await stream.stop();
		} catch (error) {
			console.warn(`[ViewerRegistry] Error stopping screencast for ${agentId}:`, error);
		} finally {
			this.screencasts.delete(agentId);
		}
	}
	/**
	* Get the number of viewers for an agent.
	*
	* @param agentId - The agent ID
	* @returns The number of connected viewers
	*/
	getViewerCount(agentId) {
		return this.viewers.get(agentId)?.size ?? 0;
	}
	/**
	* Check if an agent has an active screencast.
	*
	* @param agentId - The agent ID
	* @returns True if screencast is active
	*/
	hasActiveScreencast(agentId) {
		return this.screencasts.has(agentId);
	}
	/**
	* Close the browser session for an agent.
	* Stops screencast and broadcasts browser_closed status.
	* Call this before calling toolset.close() to ensure UI is notified.
	*
	* @param viewerKey - The viewer key (agentId or agentId:threadId for thread-scoped)
	*/
	async closeBrowserSession(viewerKey) {
		this.lastUrls.delete(viewerKey);
		this.lastViewports.delete(viewerKey);
		this.lastStatuses.delete(viewerKey);
		const stream = this.screencasts.get(viewerKey);
		if (stream) try {
			await stream.stop();
		} catch (error) {
			console.warn(`[ViewerRegistry] Error stopping screencast for ${viewerKey}:`, error);
			this.screencasts.delete(viewerKey);
			this.broadcastStatus(viewerKey, { status: "browser_closed" });
		}
		else this.broadcastStatus(viewerKey, { status: "browser_closed" });
	}
};
// src/server/browser-stream/input-handler.ts
const VALID_MOUSE_EVENTS = /* @__PURE__ */ new Set([
	"mousePressed",
	"mouseReleased",
	"mouseMoved",
	"mouseWheel"
]);
const VALID_KEYBOARD_EVENTS = /* @__PURE__ */ new Set([
	"keyDown",
	"keyUp",
	"char"
]);
const inputQueues = /* @__PURE__ */ new Map();
/**
* Serialize input dispatch to maintain event ordering.
* Input events must be processed in order to avoid race conditions.
*/
function enqueueInput(key, fn) {
	const next = (inputQueues.get(key) ?? Promise.resolve()).then(fn).catch(() => {});
	inputQueues.set(key, next);
}
/**
* Map of key names to Windows virtual key codes.
* Required for non-printable keys (Enter, Tab, Arrow keys, etc.)
* See: https://docs.microsoft.com/en-us/windows/win32/inputdev/virtual-key-codes
*/
const VIRTUAL_KEY_CODES = {
	Backspace: 8,
	Tab: 9,
	Enter: 13,
	Shift: 16,
	Control: 17,
	Alt: 18,
	Pause: 19,
	CapsLock: 20,
	Escape: 27,
	Space: 32,
	" ": 32,
	PageUp: 33,
	PageDown: 34,
	End: 35,
	Home: 36,
	ArrowLeft: 37,
	ArrowUp: 38,
	ArrowRight: 39,
	ArrowDown: 40,
	Insert: 45,
	Delete: 46,
	F1: 112,
	F2: 113,
	F3: 114,
	F4: 115,
	F5: 116,
	F6: 117,
	F7: 118,
	F8: 119,
	F9: 120,
	F10: 121,
	F11: 122,
	F12: 123
};
/**
* Get the Windows virtual key code for a key.
* For printable characters, uses the character code.
* For special keys, looks up in the mapping.
*/
function getVirtualKeyCode(key) {
	if (!key) return void 0;
	if (VIRTUAL_KEY_CODES[key] !== void 0) return VIRTUAL_KEY_CODES[key];
	if (key.length === 1) return key.toUpperCase().charCodeAt(0);
}
/**
* Handle an incoming WebSocket message by parsing, validating,
* and routing to the appropriate toolset injection method.
*
* Fire-and-forget: no acknowledgment sent back to client.
* Silently ignores malformed or unrecognized messages.
*
* @param data - Raw string data from WebSocket message
* @param getToolset - Function to retrieve MastraBrowser for an agent
* @param agentId - The agent ID this WebSocket connection is for
* @param threadId - The thread ID for thread-scoped operations (optional)
*/
async function handleInputMessage(data, getToolset, agentId, threadId) {
	let message;
	try {
		message = JSON.parse(data);
	} catch {
		return;
	}
	if (!isValidInputMessage(message)) return;
	const toolset = await getToolset(agentId);
	if (!toolset) return;
	const queueKey = `${agentId}:${threadId ?? "default"}`;
	switch (message.type) {
		case "mouse":
			enqueueInput(queueKey, async () => {
				try {
					await injectMouse(toolset, message, threadId);
				} catch (err) {
					if (isDisconnectionError(err)) notifyBrowserClosed(toolset, threadId);
					else if (!isExpectedInjectionError(err)) console.warn("[InputHandler] Mouse injection error:", err);
				}
			});
			break;
		case "keyboard": enqueueInput(queueKey, async () => {
			try {
				await injectKeyboard(toolset, message, threadId);
			} catch (err) {
				if (isDisconnectionError(err)) notifyBrowserClosed(toolset, threadId);
				else if (!isExpectedInjectionError(err)) console.warn("[InputHandler] Keyboard injection error:", err);
			}
		});
	}
}
/**
* Check if an error indicates browser disconnection (target closed).
* These errors mean the browser was externally closed.
*/
function isDisconnectionError(err) {
	if (!(err instanceof Error)) return false;
	const msg = err.message.toLowerCase();
	return msg.includes("target closed") || msg.includes("browser has been closed") || msg.includes("page has been closed") || msg.includes("session closed") || msg.includes("browser has disconnected");
}
/**
* Check if an injection error is expected (browser not ready yet).
* These are silently ignored to avoid log spam.
*/
function isExpectedInjectionError(err) {
	if (!(err instanceof Error)) return false;
	const msg = err.message.toLowerCase();
	return msg.includes("no cdp session") || msg.includes("browser not launched") || msg.includes("not connected to browser") || msg.includes("no active target") || msg.includes("target") && msg.includes("not attached");
}
/**
* Notify the browser that it was closed externally.
* This triggers the onBrowserClosed callbacks to update the UI.
* If threadId is provided and the browser supports thread-specific closing,
* only that thread's session is closed.
*/
function notifyBrowserClosed(toolset, threadId) {
	const browser = toolset;
	if (threadId && typeof browser.closeThreadSession === "function") {
		browser.closeThreadSession(threadId).catch(() => {
			browser.handleBrowserDisconnected?.();
		});
		return;
	}
	browser.handleBrowserDisconnected?.();
}
/**
* Inject a mouse event into the browser.
*/
async function injectMouse(toolset, msg, threadId) {
	await toolset.injectMouseEvent({
		type: msg.eventType,
		x: msg.x,
		y: msg.y,
		button: msg.button,
		clickCount: msg.clickCount,
		deltaX: msg.deltaX,
		deltaY: msg.deltaY,
		modifiers: msg.modifiers
	}, threadId);
}
/**
* Inject a keyboard event into the browser.
*/
async function injectKeyboard(toolset, msg, threadId) {
	const windowsVirtualKeyCode = getVirtualKeyCode(msg.key);
	await toolset.injectKeyboardEvent({
		type: msg.eventType,
		key: msg.key,
		code: msg.code,
		text: msg.text,
		modifiers: msg.modifiers,
		windowsVirtualKeyCode
	}, threadId);
}
/**
* Type guard to validate incoming messages.
* Validates structure and rejects invalid event types at the boundary.
*/
function isValidInputMessage(msg) {
	if (typeof msg !== "object" || msg === null) return false;
	const typed = msg;
	if (typed.type === "mouse") {
		if (typeof typed.eventType !== "string" || !VALID_MOUSE_EVENTS.has(typed.eventType)) return false;
		if (typeof typed.x !== "number" || typeof typed.y !== "number") return false;
		if (typed.button !== void 0 && typeof typed.button !== "string") return false;
		if (typed.deltaX !== void 0 && typeof typed.deltaX !== "number") return false;
		if (typed.deltaY !== void 0 && typeof typed.deltaY !== "number") return false;
		return true;
	}
	if (typed.type === "keyboard") {
		if (typeof typed.eventType !== "string" || !VALID_KEYBOARD_EVENTS.has(typed.eventType)) return false;
		const hasKey = typeof typed.key === "string";
		const hasCode = typeof typed.code === "string";
		const hasText = typeof typed.text === "string";
		if (!hasKey && !hasCode && !hasText) return false;
		if (typed.modifiers !== void 0 && typeof typed.modifiers !== "number") return false;
		return true;
	}
	return false;
}

//#region src/utils/accept.ts
const isWhitespace = (char) => char === 32 || char === 9 || char === 10 || char === 13;
const consumeWhitespace = (acceptHeader, startIndex) => {
	while (startIndex < acceptHeader.length) {
		if (!isWhitespace(acceptHeader.charCodeAt(startIndex))) break;
		startIndex++;
	}
	return startIndex;
};
const ignoreTrailingWhitespace = (acceptHeader, startIndex) => {
	while (startIndex > 0) {
		if (!isWhitespace(acceptHeader.charCodeAt(startIndex - 1))) break;
		startIndex--;
	}
	return startIndex;
};
const skipInvalidParam = (acceptHeader, startIndex) => {
	while (startIndex < acceptHeader.length) {
		const char = acceptHeader.charCodeAt(startIndex);
		if (char === 59) return [startIndex + 1, true];
		if (char === 44) return [startIndex + 1, false];
		startIndex++;
	}
	return [startIndex, false];
};
const skipInvalidAcceptValue = (acceptHeader, startIndex) => {
	let i = startIndex;
	let inQuotes = false;
	while (i < acceptHeader.length) {
		const char = acceptHeader.charCodeAt(i);
		if (inQuotes && char === 92) i++;
		else if (char === 34) inQuotes = !inQuotes;
		else if (!inQuotes && char === 44) return i + 1;
		i++;
	}
	return i;
};
const getNextParam = (acceptHeader, startIndex) => {
	startIndex = consumeWhitespace(acceptHeader, startIndex);
	let i = startIndex;
	let key;
	let value;
	let hasNext = false;
	while (i < acceptHeader.length) {
		const char = acceptHeader.charCodeAt(i);
		if (char === 61) {
			key = acceptHeader.slice(startIndex, ignoreTrailingWhitespace(acceptHeader, i));
			i++;
			break;
		}
		if (char === 59) return [
			i + 1,
			void 0,
			void 0,
			true
		];
		if (char === 44) return [
			i + 1,
			void 0,
			void 0,
			false
		];
		i++;
	}
	if (key === void 0) return [
		i,
		void 0,
		void 0,
		false
	];
	i = consumeWhitespace(acceptHeader, i);
	if (acceptHeader.charCodeAt(i) === 61) {
		const skipResult = skipInvalidParam(acceptHeader, i + 1);
		return [
			skipResult[0],
			key,
			void 0,
			skipResult[1]
		];
	}
	let inQuotes = false;
	const paramStartIndex = i;
	while (i < acceptHeader.length) {
		const char = acceptHeader.charCodeAt(i);
		if (inQuotes && char === 92) i++;
		else if (char === 34) {
			if (inQuotes) {
				let nextIndex = consumeWhitespace(acceptHeader, i + 1);
				const nextChar = acceptHeader.charCodeAt(nextIndex);
				if (nextIndex < acceptHeader.length && !(nextChar === 59 || nextChar === 44)) {
					const skipResult = skipInvalidParam(acceptHeader, nextIndex);
					return [
						skipResult[0],
						key,
						void 0,
						skipResult[1]
					];
				}
				value = acceptHeader.slice(paramStartIndex + 1, i);
				if (value.includes("\\")) value = value.replace(/\\(.)/g, "$1");
				if (nextChar === 44) return [
					nextIndex + 1,
					key,
					value,
					false
				];
				if (nextChar === 59) {
					hasNext = true;
					nextIndex++;
				}
				i = nextIndex;
				break;
			}
			inQuotes = true;
		} else if (!inQuotes && (char === 59 || char === 44)) {
			value = acceptHeader.slice(paramStartIndex, ignoreTrailingWhitespace(acceptHeader, i));
			if (char === 59) hasNext = true;
			i++;
			break;
		}
		i++;
	}
	return [
		i,
		key,
		value ?? acceptHeader.slice(paramStartIndex, ignoreTrailingWhitespace(acceptHeader, i)),
		hasNext
	];
};
const getNextAcceptValue = (acceptHeader, startIndex) => {
	const accept = {
		type: "",
		params: Object.create(null),
		q: 1
	};
	startIndex = consumeWhitespace(acceptHeader, startIndex);
	let i = startIndex;
	while (i < acceptHeader.length) {
		const char = acceptHeader.charCodeAt(i);
		if (char === 59 || char === 44) {
			accept.type = acceptHeader.slice(startIndex, ignoreTrailingWhitespace(acceptHeader, i));
			i++;
			if (char === 44) return [i, accept.type ? accept : void 0];
			if (!accept.type) return [skipInvalidAcceptValue(acceptHeader, i), void 0];
			break;
		}
		i++;
	}
	if (!accept.type) {
		accept.type = acceptHeader.slice(startIndex, ignoreTrailingWhitespace(acceptHeader, acceptHeader.length));
		return [acceptHeader.length, accept.type ? accept : void 0];
	}
	let param;
	let value;
	let hasNext;
	while (i < acceptHeader.length) {
		[i, param, value, hasNext] = getNextParam(acceptHeader, i);
		if (param && value) accept.params[param] = value;
		if (!hasNext) break;
	}
	return [i, accept];
};
const parseAccept = (acceptHeader) => {
	if (!acceptHeader) return [];
	const values = [];
	let i = 0;
	let accept;
	let requiresSort = false;
	let lastAccept;
	while (i < acceptHeader.length) {
		[i, accept] = getNextAcceptValue(acceptHeader, i);
		if (accept) {
			accept.q = parseQuality(accept.params.q ?? accept.params.Q);
			values.push(accept);
			if (lastAccept && lastAccept.q < accept.q) requiresSort = true;
			lastAccept = accept;
		}
	}
	if (requiresSort) values.sort((a, b) => b.q - a.q);
	return values;
};
const parseQuality = (qVal) => {
	if (qVal === void 0) return 1;
	if (qVal === "") return 1;
	if (qVal === "NaN") return 0;
	const num = Number(qVal);
	if (Number.isNaN(num)) return 1;
	if (num < 0) return 0;
	if (num > 1) return 1;
	return num;
};

//#region src/utils/compress.ts
/**
* @module
* Constants for compression.
*/
/**
* Match for compressible content type.
*/
const COMPRESSIBLE_CONTENT_TYPE_REGEX$1 = /^\s*(?:text\/(?!event-stream(?:[;\s]|$))[^;\s]+|application\/(?:javascript|json|xml|xml-dtd|ecmascript|dart|msgpack|postscript|rtf|tar|toml|vnd\.dart|vnd\.ms-fontobject|vnd\.ms-opentype|vnd\.msgpack|wasm|x-httpd-php|x-javascript|x-msgpack|x-ns-proxy-autoconfig|x-sh|x-tar|x-virtualbox-hdd|x-virtualbox-ova|x-virtualbox-ovf|x-virtualbox-vbox|x-virtualbox-vdi|x-virtualbox-vhd|x-virtualbox-vmdk|x-www-form-urlencoded)|font\/(?:otf|ttf)|image\/(?:bmp|vnd\.adobe\.photoshop|vnd\.microsoft\.icon|vnd\.ms-dds|x-icon|x-ms-bmp)|message\/rfc822|model\/gltf-binary|x-shader\/x-fragment|x-shader\/x-vertex|[^;\s]+?\+(?:json|text|xml|yaml|msgpack))(?:[;\s]|$)/i;

//#region src/middleware/compress/index.ts
const ENCODING_TYPES = ["gzip", "deflate"];
const cacheControlNoTransformRegExp = /(?:^|,)\s*?no-transform\s*?(?:,|$)/i;
const selectEncoding = (header, candidates) => {
	if (header === void 0) return;
	const accepts = parseAccept(header);
	const wildcardQ = accepts.find((a) => a.type === "*")?.q;
	let best;
	for (const enc of candidates) {
		const explicit = accepts.find((a) => a.type.toLowerCase() === enc);
		const q = explicit ? explicit.q : wildcardQ ?? 0;
		if (q === 1) return enc;
		else if (q > 0 && (!best || q > best.q)) best = {
			encoding: enc,
			q
		};
	}
	return best?.encoding;
};
const varyAcceptEncodingRegExp = /(?:^|,)\s*accept-encoding\s*(?:,|$)/i;
/**
* Compress Middleware for Hono.
*
* @see {@link https://hono.dev/docs/middleware/builtin/compress}
*
* @param {CompressionOptions} [options] - The options for the compress middleware.
* @param {'gzip' | 'deflate'} [options.encoding] - The compression scheme to allow for response compression. Either 'gzip' or 'deflate'. If not defined, both are allowed and will be used based on the Accept-Encoding header. 'gzip' is prioritized if this option is not provided and the client provides both in the Accept-Encoding header.
* @param {number} [options.threshold=1024] - The minimum size in bytes to compress. Defaults to 1024 bytes.
* @param {RegExp | Function} [options.contentTypeFilter=COMPRESSIBLE_CONTENT_TYPE_REGEX] - A RegExp or function to determine if the response Content-Type should be compressed.
* @returns {MiddlewareHandler} The middleware handler function.
*
* @example
* ```ts
* const app = new Hono()
*
* app.use(compress())
*
* // Compress only JSON responses
* app.use(compress({ contentTypeFilter: /^application\/json/ }))
*
* // Compress based on custom Content-Type logic
* app.use(compress({ contentTypeFilter: (type) => COMPRESSIBLE_CONTENT_TYPE_REGEX.test(type) || type === "application/x-myformat" }))
* ```
*/
const compress = (options) => {
	const threshold = 1024;
	const candidates = ENCODING_TYPES;
	const contentTypeFilter = COMPRESSIBLE_CONTENT_TYPE_REGEX$1;
	const shouldCompress = typeof contentTypeFilter === "function" ? (res) => {
		const type = res.headers.get("Content-Type");
		return type && contentTypeFilter(type);
	} : (res) => {
		const type = res.headers.get("Content-Type");
		return type && contentTypeFilter.test(type);
	};
	return async function compress(ctx, next) {
		await next();
		const contentLength = ctx.res.headers.get("Content-Length");
		if (ctx.res.status === 206 || ctx.res.headers.has("Content-Encoding") || ctx.res.headers.has("Transfer-Encoding") || ctx.req.method === "HEAD" || contentLength && Number(contentLength) < threshold || !shouldCompress(ctx.res) || !shouldTransform(ctx.res)) return;
		const current = ctx.res.headers.get("Vary");
		if (current !== "*" && !(current && varyAcceptEncodingRegExp.test(current))) ctx.header("Vary", current ? `${current}, Accept-Encoding` : "Accept-Encoding");
		const accepted = ctx.req.header("Accept-Encoding");
		const encoding = selectEncoding(accepted, candidates);
		if (!encoding || !ctx.res.body) return;
		const stream = new CompressionStream(encoding);
		ctx.res = new Response(ctx.res.body.pipeThrough(stream), ctx.res);
		ctx.res.headers.delete("Content-Length");
		ctx.res.headers.set("Content-Encoding", encoding);
		const etag = ctx.res.headers.get("ETag");
		if (etag && !etag.startsWith("W/")) ctx.res.headers.set("ETag", `W/${etag}`);
	};
};
const shouldTransform = (res) => {
	const cacheControl = res.headers.get("Cache-Control");
	return !cacheControl || !cacheControlNoTransformRegExp.test(cacheControl);
};

//#region src/middleware/cors/index.ts
/**
* CORS Middleware for Hono.
*
* @see {@link https://hono.dev/docs/middleware/builtin/cors}
*
* @param {CORSOptions} [options] - The options for the CORS middleware.
* @param {string | string[] | ((origin: string, c: Context) => Promise<string | undefined | null> | string | undefined | null)} [options.origin='*'] - The value of "Access-Control-Allow-Origin" CORS header.
* @param {string[] | ((origin: string, c: Context) => Promise<string[]> | string[])} [options.allowMethods=['GET', 'HEAD', 'PUT', 'POST', 'DELETE', 'PATCH', 'QUERY']] - The value of "Access-Control-Allow-Methods" CORS header.
* @param {string[]} [options.allowHeaders=[]] - The value of "Access-Control-Allow-Headers" CORS header.
* @param {number} [options.maxAge] - The value of "Access-Control-Max-Age" CORS header.
* @param {boolean} [options.credentials] - The value of "Access-Control-Allow-Credentials" CORS header.
* @param {string[]} [options.exposeHeaders=[]] - The value of "Access-Control-Expose-Headers" CORS header.
* @returns {MiddlewareHandler} The middleware handler function.
*
* @example
* ```ts
* const app = new Hono()
*
* app.use('/api/*', cors())
* app.use(
*   '/api2/*',
*   cors({
*     origin: 'http://example.com',
*     allowHeaders: ['X-Custom-Header', 'Upgrade-Insecure-Requests'],
*     allowMethods: ['POST', 'GET', 'OPTIONS'],
*     exposeHeaders: ['Content-Length', 'X-Kuma-Revision'],
*     maxAge: 600,
*     credentials: true,
*   })
* )
*
* app.all('/api/abc', (c) => {
*   return c.json({ success: true })
* })
* app.all('/api2/abc', (c) => {
*   return c.json({ success: true })
* })
* ```
*/
const cors = (options) => {
	const opts = {
		origin: "*",
		allowMethods: [
			"GET",
			"HEAD",
			"PUT",
			"POST",
			"DELETE",
			"PATCH",
			"QUERY"
		],
		allowHeaders: [],
		exposeHeaders: [],
		...options
	};
	const exposeHeadersStr = opts.exposeHeaders?.length ? opts.exposeHeaders.join(",") : void 0;
	const allowHeadersStr = opts.allowHeaders?.length ? opts.allowHeaders.join(",") : void 0;
	const findAllowOrigin = ((optsOrigin) => {
		if (typeof optsOrigin === "string") {
			if (optsOrigin === "*") return () => optsOrigin;
			else return (origin) => optsOrigin === origin ? origin : null;
		} else if (typeof optsOrigin === "function") return optsOrigin;
		else return (origin) => optsOrigin.includes(origin) ? origin : null;
	})(opts.origin);
	const findAllowMethods = ((optsAllowMethods) => {
		if (typeof optsAllowMethods === "function") return async (origin, c) => (await optsAllowMethods(origin, c)).join(",");
		else if (Array.isArray(optsAllowMethods)) {
			const methodsStr = optsAllowMethods.join(",");
			return () => methodsStr;
		} else return () => "";
	})(opts.allowMethods);
	return async function cors(c, next) {
		function set(key, value) {
			c.res.headers.set(key, value);
		}
		const allowOrigin = await findAllowOrigin(c.req.header("origin") || "", c);
		if (allowOrigin) set("Access-Control-Allow-Origin", allowOrigin);
		if (opts.credentials) set("Access-Control-Allow-Credentials", "true");
		if (exposeHeadersStr) set("Access-Control-Expose-Headers", exposeHeadersStr);
		if (c.req.method === "OPTIONS") {
			if (opts.origin !== "*") c.res.headers.append("Vary", "Origin");
			if (opts.maxAge != null) set("Access-Control-Max-Age", opts.maxAge.toString());
			const allowMethods = await findAllowMethods(c.req.header("origin") || "", c);
			if (allowMethods) set("Access-Control-Allow-Methods", allowMethods);
			let headersStr = allowHeadersStr;
			if (!headersStr) {
				const requestHeaders = c.req.header("Access-Control-Request-Headers");
				if (requestHeaders) headersStr = requestHeaders.split(",").map((h) => h.trim()).join(",");
			}
			if (headersStr) {
				set("Access-Control-Allow-Headers", headersStr);
				c.res.headers.append("Vary", "Access-Control-Request-Headers");
			}
			c.res.headers.delete("Content-Length");
			c.res.headers.delete("Content-Type");
			return new Response(null, {
				headers: c.res.headers,
				status: 204,
				statusText: "No Content"
			});
		}
		await next();
		if (opts.origin !== "*") c.header("Vary", "Origin", { append: true });
	};
};

//#region src/utils/color.ts
/**
* @module
* Color utility.
*/
/**
* Get whether color change on terminal is enabled or disabled.
* If `NO_COLOR` environment variable is set, this function returns `false`.
* Unlike getColorEnabledAsync(), this cannot check Cloudflare environment variables.
* @see {@link https://no-color.org/}
*
* @returns {boolean}
*/
function getColorEnabled() {
	const { process, Deno } = globalThis;
	return !(typeof Deno?.noColor === "boolean" ? Deno.noColor : process !== void 0 ? "NO_COLOR" in process?.env : false);
}
/**
* Get whether color change on terminal is enabled or disabled.
* If `NO_COLOR` environment variable is set, this function returns `false`.
* @see {@link https://no-color.org/}
*
* @returns {boolean}
*/
async function getColorEnabledAsync() {
	const { navigator } = globalThis;
	const cfWorkers = "cloudflare:workers";
	return !(navigator !== void 0 && navigator.userAgent === "Cloudflare-Workers" ? await (async () => {
		try {
			return "NO_COLOR" in ((await import(cfWorkers)).env ?? {});
		} catch {
			return false;
		}
	})() : !getColorEnabled());
}

//#region src/middleware/logger/index.ts
const humanize = (times) => {
	const [delimiter, separator] = [",", "."];
	return times.map((v) => v.replace(/(\d)(?=(\d\d\d)+(?!\d))/g, "$1" + delimiter)).join(separator);
};
const time = (start) => {
	const delta = Date.now() - start;
	return humanize([delta < 1e3 ? delta + "ms" : Math.round(delta / 1e3) + "s"]);
};
const colorStatus = async (status) => {
	if (await getColorEnabledAsync()) switch (status / 100 | 0) {
		case 5: return `\x1b[31m${status}\x1b[0m`;
		case 4: return `\x1b[33m${status}\x1b[0m`;
		case 3: return `\x1b[36m${status}\x1b[0m`;
		case 2: return `\x1b[32m${status}\x1b[0m`;
	}
	return `${status}`;
};
async function log(fn, prefix, method, path, status = 0, elapsed) {
	fn(prefix === "<--" ? `${prefix} ${method} ${path}` : `${prefix} ${method} ${path} ${await colorStatus(status)} ${elapsed}`);
}
/**
* Logger Middleware for Hono.
*
* @see {@link https://hono.dev/docs/middleware/builtin/logger}
*
* @param {PrintFunc} [fn=console.log] - Optional function for customized logging behavior.
* @returns {MiddlewareHandler} The middleware handler function.
*
* @example
* ```ts
* const app = new Hono()
*
* app.use(logger())
* app.get('/', (c) => c.text('Hello Hono!'))
* ```
*/
const logger = (fn = console.log) => {
	return async function logger(c, next) {
		const { method, url } = c.req;
		const path = url.slice(url.indexOf("/", 8));
		await log(fn, "<--", method, path);
		const start = Date.now();
		await next();
		await log(fn, "-->", method, path, c.res.status, time(start));
	};
};

//#region src/middleware/timeout/index.ts
const defaultTimeoutException = new HTTPException(504, { message: "Gateway Timeout" });
/**
* Timeout Middleware for Hono.
*
* @param {number} duration - The timeout duration in milliseconds.
* @param {HTTPExceptionFunction | HTTPException} [exception=defaultTimeoutException] - The exception to throw when the timeout occurs. Can be a function that returns an HTTPException or an HTTPException object.
* @returns {MiddlewareHandler} The middleware handler function.
*
* @example
* ```ts
* const app = new Hono()
*
* app.use(
*   '/long-request',
*   timeout(5000) // Set timeout to 5 seconds
* )
*
* app.get('/long-request', async (c) => {
*   await someLongRunningFunction()
*   return c.text('Completed within time limit')
* })
* ```
*/
const timeout = (duration, exception = defaultTimeoutException) => {
	return async function timeout(context, next) {
		let timer;
		const timeoutPromise = new Promise((_, reject) => {
			timer = setTimeout(() => {
				reject(typeof exception === "function" ? exception(context) : exception);
			}, duration);
		});
		try {
			await Promise.race([next(), timeoutPromise]);
		} finally {
			if (timer !== void 0) clearTimeout(timer);
		}
	};
};

// ../../../../../setup-pnpm/node_modules/.bin/store/v11/links/@hono/node-server/2.1.6/fdc2ef0c1fce27248082afaacb1b446b5df0c539a71d22f10b0596ee5aa343f0/node_modules/@hono/node-server/dist/index.mjs
var RequestError = class extends Error {
	constructor(message, options) {
		super(message, options);
		this.name = "RequestError";
	}
};
const nonJoinedHeaders = /* @__PURE__ */ new Set([
	"age",
	"authorization",
	"content-length",
	"content-type",
	"etag",
	"expires",
	"from",
	"host",
	"if-modified-since",
	"if-unmodified-since",
	"last-modified",
	"location",
	"max-forwards",
	"proxy-authorization",
	"referer",
	"retry-after",
	"server",
	"user-agent"
]);
const validHeaderName = /^[!#$%&'*+\-.^_`|~\dA-Za-z]+$/;
const isHttpWhitespace = (code) => code === 9 || code === 10 || code === 13 || code === 32;
const normalizeHeaderValue = (value) => {
	if (!isHttpWhitespace(value.charCodeAt(0)) && !isHttpWhitespace(value.charCodeAt(value.length - 1))) return value;
	let start = 0;
	let end = value.length;
	while (start < end && isHttpWhitespace(value.charCodeAt(start))) start++;
	while (end > start && isHttpWhitespace(value.charCodeAt(end - 1))) end--;
	return value.slice(start, end);
};
const forbiddenHeaderValue = /[\0\r\n]/;
const GlobalHeaders = globalThis.Headers;
const materializeHeaders = (rawHeaders, HeadersCtor = GlobalHeaders) => {
	const headers = new HeadersCtor();
	for (let i = 0; i < rawHeaders.length; i += 2) {
		const name = rawHeaders[i];
		if (!name.startsWith(":")) headers.append(name, rawHeaders[i + 1]);
	}
	return headers;
};
var RequestHeaders = class {
	#incoming;
	#rawHeaders;
	#headers;
	#invalidValue;
	constructor(incoming) {
		this.#incoming = incoming;
		if (incoming instanceof Http2ServerRequest) this.#rawHeaders = incoming.rawHeaders.slice();
	}
	get #lazyRawHeaders() {
		return this.#rawHeaders ??= this.#incoming.rawHeaders.slice();
	}
	get #native() {
		if (!this.#headers) {
			this.#headers = materializeHeaders(this.#lazyRawHeaders);
			this.#rawHeaders = void 0;
		}
		return this.#headers;
	}
	#normalizedName(name) {
		if (typeof name !== "string") return;
		if (!validHeaderName.test(name)) throw new TypeError(`Invalid header name: ${name}`);
		return name.toLowerCase();
	}
	#lookupHttp1(lowerName) {
		const headers = this.#incoming instanceof Http2ServerRequest ? void 0 : this.#incoming.headers;
		if (!headers || nonJoinedHeaders.has(lowerName) || lowerName === "set-cookie" || lowerName === "__proto__") return;
		if (!Object.hasOwn(headers, lowerName)) return null;
		const rawValue = headers[lowerName];
		if (typeof rawValue === "string") {
			const value = normalizeHeaderValue(rawValue);
			return forbiddenHeaderValue.test(value) ? void 0 : value;
		}
	}
	#lookup(rawHeaders, lowerName) {
		const separator = lowerName === "cookie" ? "; " : ", ";
		let value = null;
		for (let i = 0; i < rawHeaders.length; i += 2) {
			const rawName = rawHeaders[i];
			if (rawName.length === lowerName.length && rawName.toLowerCase() === lowerName) {
				const rawValue = normalizeHeaderValue(rawHeaders[i + 1]);
				if (forbiddenHeaderValue.test(rawValue)) {
					this.#invalidValue = true;
					return;
				}
				value = value === null ? rawValue : value + separator + rawValue;
			}
		}
		return value;
	}
	append(name, value) {
		this.#native.append(name, value);
	}
	delete(name) {
		this.#native.delete(name);
	}
	get(name) {
		const lowerName = this.#normalizedName(name);
		if (lowerName && !this.#headers && !this.#invalidValue) {
			const http1Value = this.#lookupHttp1(lowerName);
			if (http1Value !== void 0) return http1Value;
			const value = this.#lookup(this.#lazyRawHeaders, lowerName);
			if (value !== void 0) return value;
		}
		return this.#native.get(name);
	}
	has(name) {
		const lowerName = this.#normalizedName(name);
		if (lowerName && !this.#headers && !this.#invalidValue) {
			const http1Value = this.#lookupHttp1(lowerName);
			if (http1Value !== void 0) return http1Value !== null;
			const value = this.#lookup(this.#lazyRawHeaders, lowerName);
			if (value !== void 0) return value !== null;
		}
		return this.#native.has(name);
	}
	set(name, value) {
		this.#native.set(name, value);
	}
	getSetCookie() {
		return this.#native.getSetCookie();
	}
	keys() {
		return this.#native.keys();
	}
	values() {
		return this.#native.values();
	}
	entries() {
		return this.#native.entries();
	}
	forEach(callback, thisArg) {
		this.#native.forEach((value, key) => {
			callback.call(thisArg, value, key, this);
		});
	}
	[Symbol.iterator]() {
		return this.entries();
	}
};
Object.defineProperty(RequestHeaders.prototype, Symbol.for("nodejs.util.inspect.custom"), { value: function(depth, options, inspectFn) {
	return `Headers (lightweight) ${inspectFn(Object.fromEntries(this), {
		...options,
		depth: depth == null ? null : depth - 1
	})}`;
} });
Object.setPrototypeOf(RequestHeaders.prototype, GlobalHeaders.prototype);
const newHeadersFromIncoming = (incoming) => globalThis.Headers === GlobalHeaders ? new RequestHeaders(incoming) : materializeHeaders(incoming.rawHeaders, globalThis.Headers);
const reValidRequestUrl = /^\/[!#$&-;=?-\[\]_a-z~]*$/;
const reDotSegment = /\/\.\.?(?:[/?#]|$)/;
const reValidHost = /^[a-z0-9._-]+(?::(?:[1-5]\d{3,4}|[6-9]\d{3}))?$/;
const validateRequestTarget = (target) => {
	const backslash = target.indexOf("\\");
	if (backslash !== -1) {
		const query = target.indexOf("?");
		if (query === -1 || backslash < query) throw new RequestError("Backslash in request path");
	}
};
const buildUrl = (scheme, host, incomingUrl) => {
	const url = `${scheme}://${host}${incomingUrl}`;
	if (!reValidHost.test(host)) {
		validateRequestTarget(incomingUrl);
		const urlObj = new URL(url);
		if (urlObj.hostname.length !== host.length && urlObj.hostname !== (host.includes(":") ? host.replace(/:\d+$/, "") : host).toLowerCase()) throw new RequestError("Invalid host header");
		return urlObj.href;
	} else if (incomingUrl.length === 0) return url + "/";
	else {
		if (incomingUrl.charCodeAt(0) !== 47) throw new RequestError("Invalid URL");
		if (!reValidRequestUrl.test(incomingUrl) || reDotSegment.test(incomingUrl)) {
			validateRequestTarget(incomingUrl);
			return new URL(url).href;
		}
		return url;
	}
};
const toRequestError = (e) => {
	if (e instanceof RequestError) return e;
	return new RequestError(e.message, { cause: e });
};
const GlobalRequest = global.Request;
var Request$1 = class extends GlobalRequest {
	constructor(input, options) {
		if (typeof input === "object" && getRequestCache in input) {
			const hasReplacementBody = options !== void 0 && "body" in options && options.body != null;
			if (input[bodyConsumedDirectlyKey] && !hasReplacementBody) throw new TypeError("Cannot construct a Request with a Request object that has already been used.");
			input = input[getRequestCache]();
		}
		if (typeof (options?.body)?.getReader !== "undefined") options.duplex ??= "half";
		super(input, options);
	}
};
const wrapBodyStream = Symbol("wrapBodyStream");
const byteExactEncodings = /* @__PURE__ */ new Set([
	"latin1",
	"binary",
	"hex",
	"base64",
	"base64url"
]);
const isByteExactEncoding = (encoding) => encoding === null || byteExactEncodings.has(encoding);
const bodyBufferedBeforeDisconnectKey = Symbol("bodyBufferedBeforeDisconnect");
const bodyBufferedLengthBeforeDisconnectKey = Symbol("bodyBufferedLengthBeforeDisconnect");
const toBufferChunk = (chunk, encoding) => Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding ?? "utf8");
const isRecoverableDisconnectedIncoming = (incoming) => !(incoming instanceof Http2ServerRequest) && !!incoming.complete && !!incoming.readableAborted && typeof incoming.read === "function" && isByteExactEncoding(incoming.readableEncoding);
const recordBodyBufferedBeforeDisconnect = (incoming) => {
	if (incoming.readableDidRead || !isRecoverableDisconnectedIncoming(incoming)) return;
	const incomingWithRecovery = incoming;
	incomingWithRecovery[bodyBufferedLengthBeforeDisconnectKey] ??= incoming.readableLength;
};
const readBodyBufferedBeforeDisconnect = (incoming, chunks) => {
	if (incoming.readableDidRead && !chunks || !isRecoverableDisconnectedIncoming(incoming)) return;
	const incomingWithRecovery = incoming;
	if (incomingWithRecovery[bodyBufferedBeforeDisconnectKey] !== void 0) return incomingWithRecovery[bodyBufferedBeforeDisconnectKey];
	let result;
	const errored = incoming.errored;
	if (errored && errored.code !== "ECONNRESET") result = errored;
	else if (incomingWithRecovery[bodyBufferedLengthBeforeDisconnectKey] !== void 0 && incoming.readableLength !== incomingWithRecovery[bodyBufferedLengthBeforeDisconnectKey]) result = newBodyUnusableError();
	else {
		const bodyChunks = chunks ?? [];
		const chunk = incoming.read();
		if (chunk !== null) bodyChunks.push(toBufferChunk(chunk, incoming.readableEncoding));
		const buffer = bodyChunks.length === 1 ? bodyChunks[0] : Buffer.concat(bodyChunks);
		result = buffer;
		const contentLength = incoming.headers["content-length"];
		if (typeof contentLength === "string" && /^\d+$/.test(contentLength)) {
			const expectedLength = Number(contentLength);
			if (Number.isSafeInteger(expectedLength) && buffer.length !== expectedLength) result = newBodyUnusableError();
		}
	}
	incomingWithRecovery[bodyBufferedBeforeDisconnectKey] = result;
	return result;
};
const enqueueBufferedBody = (controller, buffered) => {
	if (buffered instanceof Error) {
		controller.error(buffered);
		return;
	}
	if (buffered.length > 0) controller.enqueue(buffered);
	controller.close();
};
const newRequestFromIncoming = (method, url, headers, incoming, abortController) => {
	const init = {
		method,
		headers,
		signal: abortController.signal
	};
	if (method === "TRACE") {
		init.method = "GET";
		const req = new Request$1(url, init);
		Object.defineProperty(req, "method", { get() {
			return "TRACE";
		} });
		return req;
	}
	if (!(method === "GET" || method === "HEAD")) if ("rawBody" in incoming && incoming.rawBody instanceof Buffer) init.body = new ReadableStream({ start(controller) {
		controller.enqueue(incoming.rawBody);
		controller.close();
	} });
	else if (incoming[wrapBodyStream]) {
		let reader;
		init.body = new ReadableStream({ async pull(controller) {
			try {
				if (!reader) {
					const buffered = readBodyBufferedBeforeDisconnect(incoming);
					if (buffered !== void 0) {
						enqueueBufferedBody(controller, buffered);
						return;
					}
				}
				reader ||= Readable.toWeb(incoming).getReader();
				const { done, value } = await reader.read();
				if (done) controller.close();
				else controller.enqueue(value);
			} catch (error) {
				controller.error(error);
			}
		} });
	} else {
		const buffered = readBodyBufferedBeforeDisconnect(incoming);
		if (buffered !== void 0) init.body = new ReadableStream({ start(controller) {
			enqueueBufferedBody(controller, buffered);
		} });
		else init.body = Readable.toWeb(incoming);
	}
	return new Request$1(url, init);
};
const getRequestCache = Symbol("getRequestCache");
const requestCache = Symbol("requestCache");
const incomingKey = Symbol("incomingKey");
const urlKey = Symbol("urlKey");
const methodKey = Symbol("methodKey");
const headersKey = Symbol("headersKey");
const abortControllerKey = Symbol("abortControllerKey");
const getAbortController = Symbol("getAbortController");
const abortRequest = Symbol("abortRequest");
const bodyBufferKey = Symbol("bodyBuffer");
const bodyReadPromiseKey = Symbol("bodyReadPromise");
const bodyConsumedDirectlyKey = Symbol("bodyConsumedDirectly");
const bodyLockReaderKey = Symbol("bodyLockReader");
const abortReasonKey = Symbol("abortReason");
const newBodyUnusableError = () => {
	return /* @__PURE__ */ new TypeError("Body is unusable");
};
const rejectBodyUnusable = () => {
	return Promise.reject(newBodyUnusableError());
};
const textDecoder = new TextDecoder();
const consumeBodyDirectOnce = (request) => {
	if (request[bodyConsumedDirectlyKey]) return rejectBodyUnusable();
	request[bodyConsumedDirectlyKey] = true;
};
const toArrayBuffer = (buf) => {
	return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
};
const contentType = (request) => {
	return (request[headersKey] ||= newHeadersFromIncoming(request[incomingKey])).get("content-type") || "";
};
const methodTokenRegExp = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const normalizeIncomingMethod = (method) => {
	if (typeof method !== "string" || method.length === 0) return "GET";
	switch (method) {
		case "DELETE":
		case "GET":
		case "HEAD":
		case "OPTIONS":
		case "PATCH":
		case "POST":
		case "PUT":
		case "QUERY": return method;
	}
	const upper = method.toUpperCase();
	switch (upper) {
		case "DELETE":
		case "GET":
		case "HEAD":
		case "OPTIONS":
		case "POST":
		case "PUT": return upper;
		default: return method;
	}
};
const validateDirectReadMethod = (method) => {
	if (!methodTokenRegExp.test(method)) return /* @__PURE__ */ new TypeError(`'${method}' is not a valid HTTP method.`);
	const normalized = method.toUpperCase();
	if (normalized === "CONNECT" || normalized === "TRACK" || normalized === "TRACE" && method !== "TRACE") return /* @__PURE__ */ new TypeError(`'${method}' HTTP method is unsupported.`);
};
const readBodyWithFastPath = (request, method, fromBuffer) => {
	if (request[bodyConsumedDirectlyKey]) return rejectBodyUnusable();
	const methodName = request.method;
	if (methodName === "GET" || methodName === "HEAD") return request[getRequestCache]()[method]();
	const methodValidationError = validateDirectReadMethod(methodName);
	if (methodValidationError) return Promise.reject(methodValidationError);
	if (request[requestCache]) {
		if (methodName !== "TRACE") return request[requestCache][method]();
	}
	const alreadyUsedError = consumeBodyDirectOnce(request);
	if (alreadyUsedError) return alreadyUsedError;
	const raw = readRawBodyIfAvailable(request);
	if (raw) {
		const result = Promise.resolve(fromBuffer(raw, request));
		request[bodyBufferKey] = void 0;
		return result;
	}
	return readBodyDirect(request).then((buf) => {
		const result = fromBuffer(buf, request);
		request[bodyBufferKey] = void 0;
		return result;
	});
};
const readRawBodyIfAvailable = (request) => {
	const incoming = request[incomingKey];
	if ("rawBody" in incoming && incoming.rawBody instanceof Buffer) return incoming.rawBody;
};
const normalizeAbortError = (request, incoming) => {
	if (incoming.errored) return incoming.errored;
	const reason = request[abortReasonKey];
	if (reason !== void 0) return reason instanceof Error ? reason : new Error(String(reason));
	return /* @__PURE__ */ new Error("Client connection prematurely closed.");
};
const readBodyDirect = (request) => {
	if (request[bodyBufferKey]) return Promise.resolve(request[bodyBufferKey]);
	if (request[bodyReadPromiseKey]) return request[bodyReadPromiseKey];
	const incoming = request[incomingKey];
	if (incoming.readableDidRead) return rejectBodyUnusable();
	const buffered = readBodyBufferedBeforeDisconnect(incoming);
	if (buffered !== void 0) {
		if (buffered instanceof Error) return Promise.reject(buffered);
		request[bodyBufferKey] = buffered;
		return Promise.resolve(buffered);
	}
	const promise = new Promise((resolve, reject) => {
		const chunks = [];
		let settled = false;
		const finish = (callback) => {
			if (settled) return;
			settled = true;
			cleanup();
			callback();
		};
		const recoverCompleteBodyAfterDisconnect = (error) => {
			const streamError = incoming.errored ?? error;
			if (!isRecoverableDisconnectedIncoming(incoming) || streamError && streamError.code !== "ECONNRESET") return false;
			finish(() => {
				const recovered = readBodyBufferedBeforeDisconnect(incoming, chunks);
				if (recovered instanceof Error) reject(recovered);
				else if (recovered === void 0) reject(error ?? normalizeAbortError(request, incoming));
				else {
					request[bodyBufferKey] = recovered;
					resolve(recovered);
				}
			});
			return true;
		};
		const onData = (chunk) => {
			chunks.push(toBufferChunk(chunk, incoming.readableEncoding));
		};
		const onEnd = () => {
			finish(() => {
				const buffer = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks);
				request[bodyBufferKey] = buffer;
				resolve(buffer);
			});
		};
		const onError = (error) => {
			if (recoverCompleteBodyAfterDisconnect(error)) return;
			finish(() => {
				reject(error);
			});
		};
		const onClose = () => {
			if (incoming.readableEnded) {
				onEnd();
				return;
			}
			if (recoverCompleteBodyAfterDisconnect()) return;
			finish(() => {
				reject(normalizeAbortError(request, incoming));
			});
		};
		const cleanup = () => {
			incoming.off("data", onData);
			incoming.off("end", onEnd);
			incoming.off("error", onError);
			incoming.off("close", onClose);
			request[bodyReadPromiseKey] = void 0;
		};
		incoming.on("data", onData);
		incoming.on("end", onEnd);
		incoming.on("error", onError);
		incoming.on("close", onClose);
		queueMicrotask(() => {
			if (settled) return;
			if (incoming.readableEnded) onEnd();
			else if (incoming.errored) onError(incoming.errored);
			else if (incoming.destroyed) onClose();
		});
	});
	request[bodyReadPromiseKey] = promise;
	return promise;
};
const requestPrototype = {
	get method() {
		return this[methodKey];
	},
	get url() {
		return this[urlKey];
	},
	get headers() {
		return this[headersKey] ||= newHeadersFromIncoming(this[incomingKey]);
	},
	[abortRequest](reason) {
		if (this[abortReasonKey] === void 0) this[abortReasonKey] = reason;
		const abortController = this[abortControllerKey];
		if (abortController && !abortController.signal.aborted) abortController.abort(reason);
	},
	[getAbortController]() {
		this[abortControllerKey] ||= new AbortController();
		if (this[abortReasonKey] !== void 0 && !this[abortControllerKey].signal.aborted) this[abortControllerKey].abort(this[abortReasonKey]);
		return this[abortControllerKey];
	},
	[getRequestCache]() {
		const abortController = this[getAbortController]();
		if (this[requestCache]) return this[requestCache];
		const method = this.method;
		if (this[bodyConsumedDirectlyKey] && !(method === "GET" || method === "HEAD")) {
			this[bodyBufferKey] = void 0;
			const init = {
				method: method === "TRACE" ? "GET" : method,
				headers: this.headers,
				signal: abortController.signal
			};
			if (method !== "TRACE") {
				init.body = new ReadableStream({ start(c) {
					c.close();
				} });
				init.duplex = "half";
			}
			const req = new Request$1(this[urlKey], init);
			if (method === "TRACE") Object.defineProperty(req, "method", { get() {
				return "TRACE";
			} });
			return this[requestCache] = req;
		}
		return this[requestCache] = newRequestFromIncoming(this.method, this[urlKey], this.headers, this[incomingKey], abortController);
	},
	get body() {
		if (!this[bodyConsumedDirectlyKey]) return this[getRequestCache]().body;
		const request = this[getRequestCache]();
		if (!this[bodyLockReaderKey] && request.body) this[bodyLockReaderKey] = request.body.getReader();
		return request.body;
	},
	get bodyUsed() {
		if (this[bodyConsumedDirectlyKey]) return true;
		if (this[requestCache]) return this[requestCache].bodyUsed;
		return false;
	}
};
Object.defineProperty(requestPrototype, "signal", { get() {
	return this[getAbortController]().signal;
} });
[
	"cache",
	"credentials",
	"destination",
	"integrity",
	"mode",
	"redirect",
	"referrer",
	"referrerPolicy",
	"keepalive"
].forEach((k) => {
	Object.defineProperty(requestPrototype, k, { get() {
		return this[getRequestCache]()[k];
	} });
});
["clone", "formData"].forEach((k) => {
	Object.defineProperty(requestPrototype, k, { value: function() {
		if (this[bodyConsumedDirectlyKey]) {
			if (k === "clone") throw newBodyUnusableError();
			return rejectBodyUnusable();
		}
		return this[getRequestCache]()[k]();
	} });
});
Object.defineProperty(requestPrototype, "text", { value: function() {
	return readBodyWithFastPath(this, "text", (buf) => textDecoder.decode(buf));
} });
Object.defineProperty(requestPrototype, "arrayBuffer", { value: function() {
	return readBodyWithFastPath(this, "arrayBuffer", (buf) => toArrayBuffer(buf));
} });
Object.defineProperty(requestPrototype, "blob", { value: function() {
	return readBodyWithFastPath(this, "blob", (buf, request) => {
		const type = contentType(request);
		return new Response(buf, type ? { headers: { "content-type": type } } : void 0).blob();
	});
} });
Object.defineProperty(requestPrototype, "json", { value: function() {
	if (this[bodyConsumedDirectlyKey]) return rejectBodyUnusable();
	return this.text().then(JSON.parse);
} });
Object.defineProperty(requestPrototype, Symbol.for("nodejs.util.inspect.custom"), { value: function(depth, options, inspectFn) {
	return `Request (lightweight) ${inspectFn({
		method: this.method,
		url: this.url,
		headers: this.headers,
		nativeRequest: this[requestCache]
	}, {
		...options,
		depth: depth == null ? null : depth - 1
	})}`;
} });
Object.setPrototypeOf(requestPrototype, Request$1.prototype);
const newRequest = (incoming, defaultHostname) => {
	const req = Object.create(requestPrototype);
	req[incomingKey] = incoming;
	req[methodKey] = normalizeIncomingMethod(incoming.method);
	const incomingUrl = incoming.url || "";
	if (incomingUrl[0] !== "/" && (incomingUrl.startsWith("http://") || incomingUrl.startsWith("https://"))) {
		if (incoming instanceof Http2ServerRequest) throw new RequestError("Absolute URL for :path is not allowed in HTTP/2");
		try {
			validateRequestTarget(incomingUrl);
			req[urlKey] = new URL(incomingUrl).href;
		} catch (e) {
			throw new RequestError("Invalid absolute URL", { cause: e });
		}
		return req;
	}
	const host = (incoming instanceof Http2ServerRequest ? incoming.authority : incoming.headers.host) || defaultHostname;
	if (!host) throw new RequestError("Missing host header");
	let scheme;
	if (incoming instanceof Http2ServerRequest) {
		scheme = incoming.scheme;
		if (!(scheme === "http" || scheme === "https")) throw new RequestError("Unsupported scheme");
	} else scheme = incoming.socket && incoming.socket.encrypted ? "https" : "http";
	try {
		req[urlKey] = buildUrl(scheme, host, incomingUrl);
	} catch (e) {
		if (e instanceof RequestError) throw e;
		else throw new RequestError("Invalid URL", { cause: e });
	}
	return req;
};
const defaultContentType = "text/plain; charset=UTF-8";
const responseCache = Symbol("responseCache");
const getResponseCache = Symbol("getResponseCache");
const cacheKey = Symbol("cache");
const GlobalResponse = global.Response;
var Response$1 = class Response$1 {
	#body;
	#init;
	[getResponseCache]() {
		const cache = this[cacheKey];
		const liveHeaders = cache && cache[2] instanceof Headers ? cache[2] : void 0;
		delete this[cacheKey];
		return this[responseCache] ||= new GlobalResponse(this.#body, liveHeaders ? {
			status: this.#init?.status,
			statusText: this.#init?.statusText,
			headers: liveHeaders
		} : this.#init);
	}
	constructor(body, init) {
		let headers;
		this.#body = body;
		if (init instanceof GlobalResponse) {
			const cachedGlobalResponse = init[responseCache];
			if (cachedGlobalResponse) {
				this.#init = cachedGlobalResponse;
				this[getResponseCache]();
				return;
			}
			this.#init = init instanceof Response$1 ? init.#init : init;
			headers = new Headers(init.headers);
		} else this.#init = init;
		if (body == null || typeof body === "string" || typeof body?.getReader !== "undefined" || body instanceof Blob || body instanceof Uint8Array) this[cacheKey] = [
			init?.status || 200,
			body ?? null,
			headers || init?.headers
		];
	}
	get headers() {
		const cache = this[cacheKey];
		if (cache) {
			if (!(cache[2] instanceof Headers)) cache[2] = new Headers(cache[2] || (cache[1] === null ? void 0 : { "content-type": defaultContentType }));
			return cache[2];
		}
		return this[getResponseCache]().headers;
	}
	get status() {
		return this[cacheKey]?.[0] ?? this[getResponseCache]().status;
	}
	get ok() {
		const status = this.status;
		return status >= 200 && status < 300;
	}
};
[
	"body",
	"bodyUsed",
	"redirected",
	"statusText",
	"trailers",
	"type",
	"url"
].forEach((k) => {
	Object.defineProperty(Response$1.prototype, k, { get() {
		return this[getResponseCache]()[k];
	} });
});
[
	"arrayBuffer",
	"blob",
	"clone",
	"formData",
	"json",
	"text"
].forEach((k) => {
	Object.defineProperty(Response$1.prototype, k, { value: function() {
		return this[getResponseCache]()[k]();
	} });
});
Object.defineProperty(Response$1.prototype, Symbol.for("nodejs.util.inspect.custom"), { value: function(depth, options, inspectFn) {
	return `Response (lightweight) ${inspectFn({
		status: this.status,
		headers: this.headers,
		ok: this.ok,
		nativeResponse: this[responseCache]
	}, {
		...options,
		depth: depth == null ? null : depth - 1
	})}`;
} });
Object.setPrototypeOf(Response$1, GlobalResponse);
Object.setPrototypeOf(Response$1.prototype, GlobalResponse.prototype);
const validRedirectUrl = /^https?:\/\/[!#-;=?-[\]_a-z~A-Z]+$/;
const parseRedirectUrl = (url) => {
	if (url instanceof URL) return url.href;
	if (validRedirectUrl.test(url)) return url;
	return new URL(url).href;
};
const validRedirectStatuses = /* @__PURE__ */ new Set([
	301,
	302,
	303,
	307,
	308
]);
Object.defineProperty(Response$1, "redirect", {
	value: function redirect(url, status = 302) {
		if (!validRedirectStatuses.has(status)) throw new RangeError("Invalid status code");
		return new Response$1(null, {
			status,
			headers: { location: parseRedirectUrl(url) }
		});
	},
	writable: true,
	configurable: true
});
Object.defineProperty(Response$1, "json", {
	value: function json(data, init) {
		const body = JSON.stringify(data);
		if (body === void 0) throw new TypeError("The data is not JSON serializable");
		const initHeaders = init?.headers;
		let headers;
		if (initHeaders) {
			headers = new Headers(initHeaders);
			if (!headers.has("content-type")) headers.set("content-type", "application/json");
		} else headers = { "content-type": "application/json" };
		return new Response$1(body, {
			status: init?.status ?? 200,
			statusText: init?.statusText,
			headers
		});
	},
	writable: true,
	configurable: true
});
async function readWithoutBlocking(readPromise) {
	return Promise.race([readPromise, Promise.resolve().then(() => Promise.resolve(void 0))]);
}
function writeFromReadableStreamDefaultReader(reader, writable, currentReadPromise) {
	const cancel = (error) => {
		reader.cancel(error).catch(() => {});
	};
	writable.on("close", cancel);
	writable.on("error", cancel);
	(currentReadPromise ?? reader.read()).then(flow, handleStreamError);
	return reader.closed.finally(() => {
		writable.off("close", cancel);
		writable.off("error", cancel);
	});
	function handleStreamError(error) {
		if (error) writable.destroy(error);
	}
	function onDrain() {
		reader.read().then(flow, handleStreamError);
	}
	function flow({ done, value }) {
		try {
			if (done) writable.end();
			else if (!writable.write(value)) writable.once("drain", onDrain);
			else return reader.read().then(flow, handleStreamError);
		} catch (e) {
			handleStreamError(e);
		}
	}
}
function writeFromReadableStream(stream, writable) {
	if (stream.locked) throw new TypeError("ReadableStream is locked.");
	else if (writable.destroyed) return;
	return writeFromReadableStreamDefaultReader(stream.getReader(), writable);
}
const buildOutgoingHttpHeaders = (headers, defaultContentType) => {
	const res = {};
	if (!(headers instanceof Headers)) headers = new Headers(headers ?? void 0);
	if (headers.has("set-cookie")) {
		const cookies = [];
		for (const [k, v] of headers) if (k === "set-cookie") cookies.push(v);
		else res[k] = v;
		if (cookies.length > 0) res["set-cookie"] = cookies;
	} else for (const [k, v] of headers) res[k] = v;
	if (defaultContentType) res["content-type"] ??= defaultContentType;
	return res;
};
const outgoingEnded = Symbol("outgoingEnded");
const incomingDraining = Symbol("incomingDraining");
const DRAIN_TIMEOUT_MS = 500;
const MAX_DRAIN_BYTES = 67108864;
const drainIncoming = (incoming) => {
	const incomingWithDrainState = incoming;
	if (incoming.destroyed || incomingWithDrainState[incomingDraining]) return;
	incomingWithDrainState[incomingDraining] = true;
	if (incoming instanceof Http2ServerRequest) {
		try {
			incoming.stream?.close?.(constants.NGHTTP2_NO_ERROR);
		} catch {}
		return;
	}
	let bytesRead = 0;
	const cleanup = () => {
		clearTimeout(timer);
		incoming.off("data", onData);
		incoming.off("end", cleanup);
		incoming.off("error", cleanup);
	};
	const forceClose = () => {
		cleanup();
		const socket = incoming.socket;
		if (socket && !socket.destroyed) {
			if (typeof socket.destroySoon === "function") socket.destroySoon();
			else if (typeof socket.destroy === "function") socket.destroy();
		}
	};
	const timer = setTimeout(forceClose, DRAIN_TIMEOUT_MS);
	timer.unref?.();
	const onData = (chunk) => {
		bytesRead += chunk.length;
		if (bytesRead > MAX_DRAIN_BYTES) forceClose();
	};
	incoming.on("data", onData);
	incoming.on("end", cleanup);
	incoming.on("error", cleanup);
	incoming.resume();
};
const makeCloseHandler = (req, incoming, outgoing, needsBodyCleanup) => () => {
	if (incoming.errored) {
		recordBodyBufferedBeforeDisconnect(incoming);
		req[abortRequest](incoming.errored.toString());
	} else if (!outgoing.writableFinished || incoming instanceof Http2ServerRequest && incoming.aborted) {
		recordBodyBufferedBeforeDisconnect(incoming);
		req[abortRequest]("Client connection prematurely closed.");
	}
	if (needsBodyCleanup && !incoming.readableEnded) setTimeout(() => {
		if (!incoming.readableEnded) setTimeout(() => {
			drainIncoming(incoming);
		});
	});
};
const isImmediateCacheableResponse = (res) => {
	if (!(cacheKey in res)) return false;
	const body = res[cacheKey][1];
	return body === null || typeof body === "string" || body instanceof Uint8Array;
};
const handleRequestError = () => new Response(null, { status: 400 });
const handleFetchError = (e) => new Response(null, { status: e instanceof Error && (e.name === "TimeoutError" || e.constructor.name === "TimeoutError") ? 504 : 500 });
const handleResponseError = (e, outgoing) => {
	const err = e instanceof Error ? e : new Error("unknown error", { cause: e });
	if (err.code === "ERR_STREAM_PREMATURE_CLOSE") console.info("The user aborted a request.");
	else {
		console.error(e);
		if (!outgoing.headersSent) {
			if (outgoing instanceof ServerResponse) outgoing._contentLength = null;
			outgoing.writeHead(500, { "Content-Type": "text/plain" });
		}
		outgoing.end(`Error: ${err.message}`);
		outgoing.destroy(err);
	}
};
const flushHeaders = (outgoing) => {
	if ("flushHeaders" in outgoing && outgoing.writable) outgoing.flushHeaders();
};
const trySetContentLength = (outgoing, status, length) => {
	const http1 = outgoing;
	if (http1._contentLength === null && http1._hasBody && http1.useChunkedEncodingByDefault && !http1._removedContLen && status >= 200 && status !== 204 && status !== 304 && !outgoing.hasHeader("content-length") && !outgoing.hasHeader("transfer-encoding") && !outgoing.hasHeader("trailer")) {
		http1._contentLength = length;
		return true;
	}
	return false;
};
const writeDefaultHeaders = (outgoing, status, length) => {
	if (trySetContentLength(outgoing, status, length)) outgoing.writeHead(status, { "Content-Type": defaultContentType });
	else outgoing.writeHead(status, {
		"Content-Type": defaultContentType,
		"Content-Length": length
	});
};
const responseViaCache = async (res, outgoing) => {
	let [status, body, header] = res[cacheKey];
	if (!header) {
		if (body === null) {
			outgoing.writeHead(status);
			outgoing.end();
		} else if (typeof body === "string") {
			writeDefaultHeaders(outgoing, status, Buffer.byteLength(body));
			outgoing.end(body);
		} else if (body instanceof Uint8Array) {
			writeDefaultHeaders(outgoing, status, body.byteLength);
			outgoing.end(body);
		} else if (body instanceof Blob) {
			writeDefaultHeaders(outgoing, status, body.size);
			outgoing.end(new Uint8Array(await body.arrayBuffer()));
		} else {
			outgoing.writeHead(status, { "Content-Type": defaultContentType });
			flushHeaders(outgoing);
			await writeFromReadableStream(body, outgoing)?.catch((e) => handleResponseError(e, outgoing));
		}
		outgoing[outgoingEnded]?.();
		return;
	}
	let hasContentLength = false;
	let plainHeaders = false;
	let canAutoLength = true;
	if (header instanceof Headers) {
		hasContentLength = header.has("content-length");
		header = buildOutgoingHttpHeaders(header, body === null ? void 0 : defaultContentType);
	} else if (Array.isArray(header)) {
		const headerObj = new Headers(header);
		hasContentLength = headerObj.has("content-length");
		header = buildOutgoingHttpHeaders(headerObj, body === null ? void 0 : defaultContentType);
	} else {
		plainHeaders = true;
		for (const key in header) {
			if (key.length === 14 && key.toLowerCase() === "content-length") {
				hasContentLength = true;
				break;
			}
			if (key.length === 17 && key.toLowerCase() === "transfer-encoding" || key.length === 7 && key.toLowerCase() === "trailer") canAutoLength = false;
		}
	}
	if (!hasContentLength) {
		let length;
		if (typeof body === "string") length = Buffer.byteLength(body);
		else if (body instanceof Uint8Array) length = body.byteLength;
		else if (body instanceof Blob) length = body.size;
		if (length !== void 0 && (!plainHeaders || !canAutoLength || !trySetContentLength(outgoing, status, length))) {
			if (plainHeaders) header = { ...header };
			header["Content-Length"] = length;
		}
	}
	outgoing.writeHead(status, header);
	if (body == null) outgoing.end();
	else if (typeof body === "string" || body instanceof Uint8Array) outgoing.end(body);
	else if (body instanceof Blob) outgoing.end(new Uint8Array(await body.arrayBuffer()));
	else {
		flushHeaders(outgoing);
		await writeFromReadableStream(body, outgoing)?.catch((e) => handleResponseError(e, outgoing));
	}
	outgoing[outgoingEnded]?.();
};
const isPromise = (res) => typeof res.then === "function";
const responseViaResponseObject = async (res, outgoing, options = {}) => {
	if (isPromise(res)) if (options.errorHandler) try {
		res = await res;
	} catch (err) {
		const errRes = await options.errorHandler(err);
		if (!errRes) return;
		res = errRes;
	}
	else res = await res.catch(handleFetchError);
	if (cacheKey in res) return responseViaCache(res, outgoing);
	const resHeaderRecord = buildOutgoingHttpHeaders(res.headers, res.body === null ? void 0 : defaultContentType);
	if (res.body) {
		const reader = res.body.getReader();
		const values = [];
		let done = false;
		let currentReadPromise = void 0;
		if (resHeaderRecord["transfer-encoding"] !== "chunked") {
			let maxReadCount = 2;
			for (let i = 0; i < maxReadCount; i++) {
				currentReadPromise ||= reader.read();
				const chunk = await readWithoutBlocking(currentReadPromise).catch((e) => {
					console.error(e);
					done = true;
				});
				if (!chunk) {
					if (i === 1) {
						await new Promise((resolve) => setTimeout(resolve));
						maxReadCount = 3;
						continue;
					}
					break;
				}
				currentReadPromise = void 0;
				if (chunk.value) values.push(chunk.value);
				if (chunk.done) {
					done = true;
					break;
				}
			}
			if (done && !("content-length" in resHeaderRecord)) resHeaderRecord["content-length"] = values.reduce((acc, value) => acc + value.length, 0);
		}
		outgoing.writeHead(res.status, resHeaderRecord);
		values.forEach((value) => {
			outgoing.write(value);
		});
		if (done) outgoing.end();
		else {
			if (values.length === 0) flushHeaders(outgoing);
			await writeFromReadableStreamDefaultReader(reader, outgoing, currentReadPromise);
		}
	} else if (resHeaderRecord["x-hono-already-sent"]) ; else {
		outgoing.writeHead(res.status, resHeaderRecord);
		outgoing.end();
	}
	outgoing[outgoingEnded]?.();
};
const getRequestListener = (fetchCallback, options = {}) => {
	const autoCleanupIncoming = options.autoCleanupIncoming ?? true;
	if (options.overrideGlobalObjects !== false && global.Request !== Request$1) {
		Object.defineProperty(global, "Request", { value: Request$1 });
		Object.defineProperty(global, "Response", { value: Response$1 });
	}
	return async (incoming, outgoing) => {
		let res, req;
		let needsBodyCleanup = false;
		let closeHandlerAttached = false;
		const ensureCloseHandler = () => {
			if (!req || closeHandlerAttached) return;
			closeHandlerAttached = true;
			outgoing.on("close", makeCloseHandler(req, incoming, outgoing, needsBodyCleanup));
		};
		try {
			req = newRequest(incoming, options.hostname);
			needsBodyCleanup = autoCleanupIncoming && !(incoming.method === "GET" || incoming.method === "HEAD");
			if (needsBodyCleanup) {
				incoming[wrapBodyStream] = true;
				if (incoming instanceof Http2ServerRequest) outgoing[outgoingEnded] = () => {
					if (!incoming.readableEnded) setTimeout(() => {
						if (!incoming.readableEnded) setTimeout(() => {
							incoming.destroy();
							outgoing.destroy();
						});
					});
				};
			}
			res = fetchCallback(req, {
				incoming,
				outgoing
			});
			if (!isPromise(res) && isImmediateCacheableResponse(res)) {
				if (needsBodyCleanup && !incoming.readableEnded) outgoing.once("finish", () => {
					if (!incoming.readableEnded) drainIncoming(incoming);
				});
				return responseViaCache(res, outgoing);
			}
			ensureCloseHandler();
		} catch (e) {
			if (!res) if (options.errorHandler) {
				ensureCloseHandler();
				res = await options.errorHandler(req ? e : toRequestError(e));
				if (!res) return;
			} else if (!req) res = handleRequestError();
			else res = handleFetchError(e);
			else return handleResponseError(e, outgoing);
		}
		try {
			return await responseViaResponseObject(res, outgoing, options);
		} catch (e) {
			return handleResponseError(e, outgoing);
		}
	};
};
const CONNECTION_SYMBOL_KEY = Symbol("CONNECTION_SYMBOL_KEY");
const WAIT_FOR_WEBSOCKET_SYMBOL = Symbol("WAIT_FOR_WEBSOCKET_SYMBOL");
const responseHeadersToSkip = /* @__PURE__ */ new Set([
	"connection",
	"content-length",
	"keep-alive",
	"proxy-authenticate",
	"proxy-authorization",
	"te",
	"trailer",
	"transfer-encoding",
	"upgrade",
	"sec-websocket-accept",
	"sec-websocket-extensions",
	"sec-websocket-protocol"
]);
const appendResponseHeaders = (headers, responseHeaders) => {
	if (!responseHeaders) return;
	responseHeaders.forEach((value, key) => {
		if (responseHeadersToSkip.has(key.toLowerCase())) return;
		headers.push(`${key}: ${value}`);
	});
};
const rejectUpgradeRequest = (socket, status, responseHeaders) => {
	if (socket.destroyed) return;
	const responseLines = ["Connection: close", "Content-Length: 0"];
	appendResponseHeaders(responseLines, responseHeaders);
	socket.end(`HTTP/1.1 ${status.toString()} ${STATUS_CODES[status] ?? ""}\r\n${responseLines.join("\r\n")}\r\n\r
`);
};
const createUpgradeRequest = (request) => {
	const protocol = request.socket.encrypted ? "https" : "http";
	const incomingUrl = request.url ?? "/";
	let url;
	if (incomingUrl[0] !== "/" && (incomingUrl.startsWith("http://") || incomingUrl.startsWith("https://"))) {
		validateRequestTarget(incomingUrl);
		url = new URL(incomingUrl).href;
	} else url = buildUrl(protocol, request.headers.host ?? "localhost", incomingUrl);
	const headers = new Headers();
	for (const key in request.headers) {
		const value = request.headers[key];
		if (!value) continue;
		headers.append(key, Array.isArray(value) ? value[0] : value);
	}
	return new Request(url, { headers });
};
const setupWebSocket = (options) => {
	const { server, fetchCallback, wss } = options;
	const waiterMap = /* @__PURE__ */ new Map();
	wss.on("connection", (ws, request) => {
		const waiter = waiterMap.get(request);
		if (waiter) {
			waiter.resolve(ws);
			waiterMap.delete(request);
		}
	});
	const rejectWaiter = (request) => {
		const waiter = waiterMap.get(request);
		if (waiter) {
			waiterMap.delete(request);
			waiter.reject(/* @__PURE__ */ new Error("WebSocket handshake aborted"));
		}
	};
	const waitForWebSocket = (request, connectionSymbol) => {
		return new Promise((resolve, reject) => {
			waiterMap.set(request, {
				resolve,
				reject,
				connectionSymbol
			});
		});
	};
	server.on("upgrade", async (request, socket, head) => {
		if (request.headers.upgrade?.toLowerCase() !== "websocket") return;
		const ignoreSocketError = () => {};
		const reclaimWaiterOnClose = () => rejectWaiter(request);
		socket.on("error", ignoreSocketError);
		socket.once("close", reclaimWaiterOnClose);
		const env = {
			incoming: request,
			outgoing: void 0,
			wss,
			[WAIT_FOR_WEBSOCKET_SYMBOL]: waitForWebSocket
		};
		let status = 400;
		let responseHeaders;
		try {
			const response = await fetchCallback(createUpgradeRequest(request), env);
			if (response instanceof Response) {
				status = response.status;
				responseHeaders = response.headers;
			}
		} catch (error) {
			if (server.listenerCount("upgrade") === 1) rejectUpgradeRequest(socket, error instanceof RequestError ? 400 : 500);
			return;
		}
		if (socket.destroyed) {
			rejectWaiter(request);
			return;
		}
		const waiter = waiterMap.get(request);
		if (!waiter || waiter.connectionSymbol !== env[CONNECTION_SYMBOL_KEY]) {
			rejectWaiter(request);
			if (server.listenerCount("upgrade") === 1) rejectUpgradeRequest(socket, status, responseHeaders);
			return;
		}
		const addResponseHeaders = (headers) => {
			appendResponseHeaders(headers, responseHeaders);
		};
		wss.on("headers", addResponseHeaders);
		try {
			wss.handleUpgrade(request, socket, head, (ws) => {
				socket.off("close", reclaimWaiterOnClose);
				socket.off("error", ignoreSocketError);
				wss.emit("connection", ws, request);
			});
		} finally {
			wss.off("headers", addResponseHeaders);
		}
	});
	server.on("close", () => {
		wss.close();
	});
};
const createAdaptorServer = (options) => {
	const fetchCallback = options.fetch;
	const requestListener = getRequestListener(fetchCallback, {
		hostname: options.hostname,
		overrideGlobalObjects: options.overrideGlobalObjects,
		autoCleanupIncoming: options.autoCleanupIncoming
	});
	const server = (options.createServer || createServer)(options.serverOptions || {}, requestListener);
	if (options.websocket && options.websocket.server) {
		if (options.websocket.server.options.noServer !== true) throw new Error("WebSocket server must be created with { noServer: true } option");
		setupWebSocket({
			server,
			fetchCallback,
			wss: options.websocket.server
		});
	}
	return server;
};
const serve = (options, listeningListener) => {
	const server = createAdaptorServer(options);
	server.listen(options?.port ?? 3e3, options.hostname, () => {
		const serverInfo = server.address();
		listeningListener && listeningListener(serverInfo);
	});
	return server;
};
// ../../../../../setup-pnpm/node_modules/.bin/store/v11/links/@hono/node-server/2.1.6/fdc2ef0c1fce27248082afaacb1b446b5df0c539a71d22f10b0596ee5aa343f0/node_modules/@hono/node-server/dist/utils/stream.mjs
const pr54206Applied = () => {
	const [major, minor] = versions.node.split(".").map((component) => parseInt(component));
	return major >= 23 || major === 22 && minor >= 7 || major === 20 && minor >= 18;
};
const useReadableToWeb = pr54206Applied();
const createStreamBody = (stream, useNativeReadableToWeb = useReadableToWeb) => {
	if (useNativeReadableToWeb) return Readable.toWeb(stream);
	let controller;
	let settled = false;
	const cleanup = () => {
		stream.off("data", onData);
		stream.off("error", onError);
		stream.off("end", onTerminate);
		stream.off("close", onTerminate);
	};
	const settle = (callback) => {
		if (settled) return;
		settled = true;
		cleanup();
		callback?.();
	};
	const onData = (chunk) => {
		if (settled || !controller) return;
		controller.enqueue(chunk);
		if ((controller.desiredSize ?? 0) <= 0) stream.pause();
	};
	const onError = (error) => {
		settle(() => {
			controller?.error(error);
		});
	};
	const onTerminate = () => {
		settle(() => {
			controller?.close();
		});
	};
	return new ReadableStream({
		start(streamController) {
			controller = streamController;
			stream.on("data", onData);
			stream.on("error", onError);
			stream.on("end", onTerminate);
			stream.on("close", onTerminate);
			stream.pause();
		},
		pull() {
			if (!settled) stream.resume();
		},
		cancel() {
			settle();
			const ignoreError = () => {};
			stream.on("error", ignoreError);
			stream.once("close", () => stream.off("error", ignoreError));
			stream.destroy();
		}
	});
};
// ../../../../../setup-pnpm/node_modules/.bin/store/v11/links/@hono/node-server/2.1.6/fdc2ef0c1fce27248082afaacb1b446b5df0c539a71d22f10b0596ee5aa343f0/node_modules/@hono/node-server/dist/serve-static.mjs
const COMPRESSIBLE_CONTENT_TYPE_REGEX = /^\s*(?:text\/[^;\s]+|application\/(?:javascript|json|xml|xml-dtd|ecmascript|dart|postscript|rtf|tar|toml|vnd\.dart|vnd\.ms-fontobject|vnd\.ms-opentype|wasm|x-httpd-php|x-javascript|x-ns-proxy-autoconfig|x-sh|x-tar|x-virtualbox-hdd|x-virtualbox-ova|x-virtualbox-ovf|x-virtualbox-vbox|x-virtualbox-vdi|x-virtualbox-vhd|x-virtualbox-vmdk|x-www-form-urlencoded)|font\/(?:otf|ttf)|image\/(?:bmp|vnd\.adobe\.photoshop|vnd\.microsoft\.icon|vnd\.ms-dds|x-icon|x-ms-bmp)|message\/rfc822|model\/gltf-binary|x-shader\/x-fragment|x-shader\/x-vertex|[^;\s]+?\+(?:json|text|xml|yaml))(?:[;\s]|$)/i;
const ENCODINGS = {
	br: ".br",
	zstd: ".zst",
	gzip: ".gz"
};
const ENCODINGS_ORDERED_KEYS = Object.keys(ENCODINGS);
const getStats = (path) => {
	let stats;
	try {
		stats = statSync(path);
	} catch {}
	return stats;
};
const BYTE_RANGE_PATTERN = /^(?:bytes=)?(?!-$)(\d*)-(\d*)$/;
const parseByteRange = (range) => {
	const match = range.match(BYTE_RANGE_PATTERN);
	if (!match) return;
	const [, start, end] = match;
	if (start === "") return {
		type: "suffix",
		length: Number(end)
	};
	if (end === "") return {
		type: "open-ended",
		start: Number(start)
	};
	return {
		type: "bounded",
		start: Number(start),
		end: Number(end)
	};
};
const resolveByteRange = (spec, size) => {
	if (size === 0) return;
	if (spec.type === "suffix") {
		if (spec.length === 0) return;
		return {
			start: Math.max(size - spec.length, 0),
			end: size - 1
		};
	}
	const end = spec.type === "bounded" ? Math.min(spec.end, size - 1) : size - 1;
	if (spec.start >= size || spec.start > end) return;
	return {
		start: spec.start,
		end
	};
};
const tryDecode = (str, decoder) => {
	try {
		return decoder(str);
	} catch {
		return str.replace(/(?:%[0-9A-Fa-f]{2})+/g, (match) => {
			try {
				return decoder(match);
			} catch {
				return match;
			}
		});
	}
};
const tryDecodeURI = (str) => tryDecode(str, decodeURI);
const serveStatic = (options = { root: "" }) => {
	const root = options.root || "";
	const optionPath = options.path;
	if (root !== "" && !existsSync$1(root)) console.error(`serveStatic: root path '${root}' is not found, are you sure it's correct?`);
	return async (c, next) => {
		if (c.finalized) return next();
		if (c.req.method !== "GET" && c.req.method !== "HEAD") return next();
		let filename;
		if (optionPath) filename = optionPath;
		else try {
			if (!options.allowPercentInPath && c.req.path.includes("%")) throw new Error();
			filename = tryDecodeURI(c.req.path);
			if (/(?:^|[\/\\])\.{1,2}(?:$|[\/\\])|[\/\\]{2,}|\\/.test(filename)) throw new Error();
		} catch {
			await options.onNotFound?.(c.req.path, c);
			return next();
		}
		let path = join(root, !optionPath && options.rewriteRequestPath ? options.rewriteRequestPath(filename, c) : filename);
		let stats = getStats(path);
		if (stats && stats.isDirectory()) {
			const indexFile = options.index ?? "index.html";
			path = join(path, indexFile);
			stats = getStats(path);
		}
		if (!stats) {
			await options.onNotFound?.(path, c);
			return next();
		}
		const mimeType = getMimeType(path);
		c.header("Content-Type", mimeType || "application/octet-stream");
		if (options.precompressed && (!mimeType || mimeType === "application/octet-stream" || COMPRESSIBLE_CONTENT_TYPE_REGEX.test(mimeType))) {
			const acceptEncodingSet = new Set(c.req.header("Accept-Encoding")?.split(",").map((encoding) => encoding.trim()));
			for (const encoding of ENCODINGS_ORDERED_KEYS) {
				if (!acceptEncodingSet.has(encoding)) continue;
				const precompressedStats = getStats(path + ENCODINGS[encoding]);
				if (precompressedStats) {
					c.header("Content-Encoding", encoding);
					c.header("Vary", "Accept-Encoding", { append: true });
					stats = precompressedStats;
					path = path + ENCODINGS[encoding];
					break;
				}
			}
		}
		let result;
		const size = stats.size;
		const range = c.req.header("range") || "";
		c.header("Last-Modified", stats.mtime.toUTCString());
		if (c.req.method === "HEAD") {
			c.header("Content-Length", size.toString());
			c.status(200);
			result = c.body(null);
		} else if (!range) {
			c.header("Content-Length", size.toString());
			result = c.body(createStreamBody(createReadStream(path)), 200);
		} else {
			c.header("Accept-Ranges", "bytes");
			const resolvedRange = resolveByteRange(parseByteRange(range) ?? {
				type: "open-ended",
				start: 0
			}, size);
			if (!resolvedRange) {
				c.header("Content-Range", `bytes */${size}`);
				result = c.body(null, 416);
			} else {
				const { start, end } = resolvedRange;
				const chunkSize = end - start + 1;
				const stream = createReadStream(path, {
					start,
					end
				});
				c.header("Content-Length", chunkSize.toString());
				c.header("Content-Range", `bytes ${start}-${end}/${size}`);
				result = c.body(createStreamBody(stream), 206);
			}
		}
		await options.onFound?.(path, c);
		return result;
	};
};
// ../../../../../setup-pnpm/node_modules/.bin/store/v11/links/@hono/swagger-ui/0.5.3/2d64a3444a8e781b9d0909ff286ca728dbe5419d9721688c851938b2e50a9382/node_modules/@hono/swagger-ui/dist/index.js
const RENDER_TYPE = {
	STRING_ARRAY: "string_array",
	STRING: "string",
	JSON_STRING: "json_string",
	RAW: "raw"
};
const RENDER_TYPE_MAP = {
	configUrl: RENDER_TYPE.STRING,
	deepLinking: RENDER_TYPE.RAW,
	presets: RENDER_TYPE.STRING_ARRAY,
	plugins: RENDER_TYPE.STRING_ARRAY,
	spec: RENDER_TYPE.JSON_STRING,
	url: RENDER_TYPE.STRING,
	urls: RENDER_TYPE.JSON_STRING,
	layout: RENDER_TYPE.STRING,
	docExpansion: RENDER_TYPE.STRING,
	maxDisplayedTags: RENDER_TYPE.RAW,
	operationsSorter: RENDER_TYPE.RAW,
	requestInterceptor: RENDER_TYPE.RAW,
	responseInterceptor: RENDER_TYPE.RAW,
	persistAuthorization: RENDER_TYPE.RAW,
	defaultModelsExpandDepth: RENDER_TYPE.RAW,
	defaultModelExpandDepth: RENDER_TYPE.RAW,
	defaultModelRendering: RENDER_TYPE.STRING,
	displayRequestDuration: RENDER_TYPE.RAW,
	filter: RENDER_TYPE.RAW,
	showExtensions: RENDER_TYPE.RAW,
	showCommonExtensions: RENDER_TYPE.RAW,
	queryConfigEnabled: RENDER_TYPE.RAW,
	displayOperationId: RENDER_TYPE.RAW,
	tagsSorter: RENDER_TYPE.RAW,
	onComplete: RENDER_TYPE.RAW,
	syntaxHighlight: RENDER_TYPE.JSON_STRING,
	tryItOutEnabled: RENDER_TYPE.RAW,
	requestSnippetsEnabled: RENDER_TYPE.RAW,
	requestSnippets: RENDER_TYPE.JSON_STRING,
	oauth2RedirectUrl: RENDER_TYPE.STRING,
	showMutabledRequest: RENDER_TYPE.RAW,
	request: RENDER_TYPE.JSON_STRING,
	supportedSubmitMethods: RENDER_TYPE.JSON_STRING,
	validatorUrl: RENDER_TYPE.STRING,
	withCredentials: RENDER_TYPE.RAW,
	modelPropertyMacro: RENDER_TYPE.RAW,
	parameterMacro: RENDER_TYPE.RAW
};
const renderSwaggerUIOptions = (options) => {
	return Object.entries(options).map(([k, v]) => {
		const key = k;
		if (!RENDER_TYPE_MAP[key] || v === void 0) return "";
		switch (RENDER_TYPE_MAP[key]) {
			case RENDER_TYPE.STRING: return `${key}: '${v}'`;
			case RENDER_TYPE.STRING_ARRAY:
				if (!Array.isArray(v)) return "";
				return `${key}: [${v.map((ve) => `${ve}`).join(",")}]`;
			case RENDER_TYPE.JSON_STRING: return `${key}: ${JSON.stringify(v)}`;
			case RENDER_TYPE.RAW: return `${key}: ${v}`;
			default: return "";
		}
	}).filter((item) => item !== "").join(",");
};
const remoteAssets = ({ version }) => {
	const url = `https://cdn.jsdelivr.net/npm/swagger-ui-dist${version !== void 0 ? `@${version}` : ""}`;
	return {
		css: [`${url}/swagger-ui.css`],
		js: [`${url}/swagger-ui-bundle.js`]
	};
};
const SwaggerUI = (options) => {
	const asset = remoteAssets({ version: options?.version });
	delete options.version;
	if (options.manuallySwaggerUIHtml) return options.manuallySwaggerUIHtml(asset);
	const optionsStrings = renderSwaggerUIOptions(options);
	return `
    <div>
      <div id="swagger-ui"></div>
      ${asset.css.map((url) => html`<link rel="stylesheet" href="${url}" />`)}
      ${asset.js.map((url) => html`<script src="${url}" crossorigin="anonymous"><\/script>`)}
      <script>
        window.onload = () => {
          window.ui = SwaggerUIBundle({
            dom_id: '#swagger-ui',${optionsStrings},
          })
        }
      <\/script>
    </div>
  `;
};
const middleware = (options) => async (c) => {
	const title = options?.title ?? "SwaggerUI";
	return c.html(`
      <!doctype html>
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <meta name="description" content="SwaggerUI" />
          <title>${title}</title>
        </head>
        <body>
          ${SwaggerUI(options)}
        </body>
      </html>
    `);
};
// ../../../../../setup-pnpm/node_modules/.bin/store/v11/links/@/fetch-to-node/2.1.0/75a085586b95f3a18a440f8655a7cb5c851846ab2c5e6ad2c4ae036e3bbaa05c/node_modules/fetch-to-node/dist/utils/errors.js
const classRegExp = /^([A-Z][a-z0-9]*)+$/;
const kTypes = [
	"string",
	"function",
	"number",
	"object",
	"Function",
	"Object",
	"boolean",
	"bigint",
	"symbol"
];
/**
* Determine the specific type of a value for type-mismatch errors.
* @param {*} value
* @returns {string}
*/
function determineSpecificType(value) {
	if (value == null) return "" + value;
	if (typeof value === "function" && value.name) return `function ${value.name}`;
	if (typeof value === "object") {
		if (value.constructor?.name) return `an instance of ${value.constructor.name}`;
		return `${util.inspect(value, { depth: -1 })}`;
	}
	let inspected = util.inspect(value, { colors: false });
	if (inspected.length > 28) inspected = `${inspected.slice(0, 25)}...`;
	return `type ${typeof value} (${inspected})`;
}
var ERR_HTTP_BODY_NOT_ALLOWED = class extends Error {
	constructor() {
		super("Adding content for this request method or response status is not allowed.");
	}
};
var ERR_HTTP_CONTENT_LENGTH_MISMATCH = class extends Error {
	constructor(actual, expected) {
		super(`Response body's content-length of ${actual} byte(s) does not match the content-length of ${expected} byte(s) set in header`);
	}
};
var ERR_HTTP_HEADERS_SENT = class extends Error {
	constructor(arg) {
		super(`Cannot ${arg} headers after they are sent to the client`);
	}
};
var ERR_INVALID_ARG_VALUE = class extends TypeError {
	constructor(name, value, reason = "is invalid") {
		let inspected = util.inspect(value);
		if (inspected.length > 128) inspected = `${inspected.slice(0, 128)}...`;
		const type = name.includes(".") ? "property" : "argument";
		super(`The ${type} '${name}' ${reason}. Received ${inspected}`);
	}
};
var ERR_INVALID_CHAR = class extends TypeError {
	constructor(name, field) {
		let msg = `Invalid character in ${name}`;
		if (field !== void 0) msg += ` ["${field}"]`;
		super(msg);
	}
};
var ERR_HTTP_INVALID_HEADER_VALUE = class extends TypeError {
	constructor(value, name) {
		super(`Invalid value "${value}" for header "${name}"`);
	}
};
var ERR_HTTP_INVALID_STATUS_CODE = class extends RangeError {
	originalStatusCode;
	constructor(originalStatusCode) {
		super(`Invalid status code: ${originalStatusCode}`);
		this.originalStatusCode = originalStatusCode;
	}
};
var ERR_HTTP_TRAILER_INVALID = class extends Error {
	constructor() {
		super(`Trailers are invalid with this transfer encoding`);
	}
};
var ERR_INVALID_ARG_TYPE = class extends TypeError {
	constructor(name, expected, actual) {
		if (!Array.isArray(expected)) expected = [expected];
		let msg = "The ";
		if (name.endsWith(" argument")) msg += `${name} `;
		else {
			const type = name.includes(".") ? "property" : "argument";
			msg += `"${name}" ${type} `;
		}
		msg += "must be ";
		const types = [];
		const instances = [];
		const other = [];
		for (const value of expected) if (kTypes.includes(value)) types.push(value.toLowerCase());
		else if (classRegExp.exec(value) !== null) instances.push(value);
		else other.push(value);
		if (instances.length > 0) {
			const pos = types.indexOf("object");
			if (pos !== -1) {
				types.splice(pos, 1);
				instances.push("Object");
			}
		}
		if (types.length > 0) {
			if (types.length > 2) {
				const last = types.pop();
				msg += `one of type ${types.join(", ")}, or ${last}`;
			} else if (types.length === 2) msg += `one of type ${types[0]} or ${types[1]}`;
			else msg += `of type ${types[0]}`;
			if (instances.length > 0 || other.length > 0) msg += " or ";
		}
		if (instances.length > 0) {
			if (instances.length > 2) {
				const last = instances.pop();
				msg += `an instance of ${instances.join(", ")}, or ${last}`;
			} else {
				msg += `an instance of ${instances[0]}`;
				if (instances.length === 2) msg += ` or ${instances[1]}`;
			}
			if (other.length > 0) msg += " or ";
		}
		if (other.length > 0) {
			if (other.length > 2) {
				const last = other.pop();
				msg += `one of ${other.join(", ")}, or ${last}`;
			} else if (other.length === 2) msg += `one of ${other[0]} or ${other[1]}`;
			else {
				if (other[0].toLowerCase() !== other[0]) msg += "an ";
				msg += `${other[0]}`;
			}
		}
		msg += `. Received ${determineSpecificType(actual)}`;
		super(msg);
	}
};
var ERR_INVALID_HTTP_TOKEN = class extends TypeError {
	constructor(name, field) {
		super(`${name} must be a valid HTTP token ["${field}"]`);
	}
};
var ERR_METHOD_NOT_IMPLEMENTED = class extends Error {
	constructor(methodName) {
		super(`The ${methodName} method is not implemented`);
	}
};
var ERR_STREAM_ALREADY_FINISHED = class extends Error {
	constructor(methodName) {
		super(`Cannot call ${methodName} after a stream was finished`);
	}
};
var ERR_STREAM_CANNOT_PIPE = class extends Error {
	constructor() {
		super(`Cannot pipe, not readable`);
	}
};
var ERR_STREAM_DESTROYED = class extends Error {
	constructor(methodName) {
		super(`Cannot call ${methodName} after a stream was destroyed`);
	}
};
var ERR_STREAM_NULL_VALUES = class extends TypeError {
	constructor() {
		super(`May not write null values to stream`);
	}
};
var ERR_STREAM_WRITE_AFTER_END = class extends Error {
	constructor() {
		super(`write after end`);
	}
};
// ../../../../../setup-pnpm/node_modules/.bin/store/v11/links/@/fetch-to-node/2.1.0/75a085586b95f3a18a440f8655a7cb5c851846ab2c5e6ad2c4ae036e3bbaa05c/node_modules/fetch-to-node/dist/fetch-to-node/http-incoming.js
const kHeaders = Symbol("kHeaders");
const kHeadersDistinct = Symbol("kHeadersDistinct");
const kHeadersCount = Symbol("kHeadersCount");
const kTrailers = Symbol("kTrailers");
const kTrailersDistinct = Symbol("kTrailersDistinct");
const kTrailersCount = Symbol("kTrailersCount");
/**
* This is an implementation of IncomingMessage from Node.js intended to run in
* a WinterTC runtime. The 'Readable' interface of this class is wired to a 'Request'
* object's 'body'.
*
* This instance can be used in normal ways, but it does not give access to the
* underlying socket (because there isn't one. req.socket will always return null).
*
* Some code in this class is transplanted/adapted from node/lib/_http_incoming.js
*/
var FetchIncomingMessage = class extends Readable {
	get socket() {
		return null;
	}
	set socket(_val) {
		throw new ERR_METHOD_NOT_IMPLEMENTED("socket");
	}
	httpVersionMajor;
	httpVersionMinor;
	httpVersion;
	complete = false;
	[kHeaders] = null;
	[kHeadersDistinct] = null;
	[kHeadersCount] = 0;
	rawHeaders = [];
	[kTrailers] = null;
	[kTrailersDistinct] = null;
	[kTrailersCount] = 0;
	rawTrailers = [];
	joinDuplicateHeaders = false;
	aborted = false;
	upgrade = false;
	url = "";
	method;
	_consuming;
	_dumped;
	_stream = null;
	constructor() {
		super({});
		this._readableState.readingMore = true;
		this._consuming = false;
		this._dumped = false;
	}
	get connection() {
		return null;
	}
	set connection(_socket) {
		console.error("No support for IncomingMessage.connection");
	}
	get headers() {
		if (!this[kHeaders]) {
			this[kHeaders] = {};
			const src = this.rawHeaders;
			const dst = this[kHeaders];
			for (let n = 0; n < this[kHeadersCount]; n += 2) this._addHeaderLine(src[n], src[n + 1], dst);
		}
		return this[kHeaders];
	}
	set headers(val) {
		this[kHeaders] = val;
	}
	get headersDistinct() {
		if (!this[kHeadersDistinct]) {
			this[kHeadersDistinct] = {};
			const src = this.rawHeaders;
			const dst = this[kHeadersDistinct];
			for (let n = 0; n < this[kHeadersCount]; n += 2) this._addHeaderLineDistinct(src[n], src[n + 1], dst);
		}
		return this[kHeadersDistinct];
	}
	set headersDistinct(val) {
		this[kHeadersDistinct] = val;
	}
	get trailers() {
		if (!this[kTrailers]) {
			this[kTrailers] = {};
			const src = this.rawTrailers;
			const dst = this[kTrailers];
			for (let n = 0; n < this[kTrailersCount]; n += 2) this._addHeaderLine(src[n], src[n + 1], dst);
		}
		return this[kTrailers];
	}
	set trailers(val) {
		this[kTrailers] = val;
	}
	get trailersDistinct() {
		if (!this[kTrailersDistinct]) {
			this[kTrailersDistinct] = {};
			const src = this.rawTrailers;
			const dst = this[kTrailersDistinct];
			for (let n = 0; n < this[kTrailersCount]; n += 2) this._addHeaderLineDistinct(src[n], src[n + 1], dst);
		}
		return this[kTrailersDistinct];
	}
	set trailersDistinct(val) {
		this[kTrailersDistinct] = val;
	}
	setTimeout(msecs, callback) {
		return this;
	}
	async _read(n) {
		if (!this._consuming) {
			this._readableState.readingMore = false;
			this._consuming = true;
		}
		if (this._stream == null) {
			this.complete = true;
			this.push(null);
			return;
		}
		const reader = this._stream.getReader();
		try {
			const data = await reader.read();
			if (data.done) {
				this.complete = true;
				this.push(null);
			} else this.push(data.value);
		} catch (e) {
			this.destroy(e);
		} finally {
			reader.releaseLock();
		}
	}
	_destroy(err, cb) {
		if (!this.readableEnded || !this.complete) {
			this.aborted = true;
			this.emit("aborted");
		}
		setTimeout(onError$1, 0, this, err, cb);
	}
	_addHeaderLines(headers, n) {
		if (headers?.length) {
			let dest;
			if (this.complete) {
				this.rawTrailers = headers;
				this[kTrailersCount] = n;
				dest = this[kTrailers];
			} else {
				this.rawHeaders = headers;
				this[kHeadersCount] = n;
				dest = this[kHeaders];
			}
			if (dest) for (let i = 0; i < n; i += 2) this._addHeaderLine(headers[i], headers[i + 1], dest);
		}
	}
	_addHeaderLine(field, value, dest) {
		field = matchKnownFields(field);
		const flag = field.charCodeAt(0);
		if (flag === 0 || flag === 2) {
			field = field.slice(1);
			if (typeof dest[field] === "string") dest[field] += (flag === 0 ? ", " : "; ") + value;
			else dest[field] = value;
		} else if (flag === 1) {
			if (dest["set-cookie"] !== void 0) dest["set-cookie"].push(value);
			else dest["set-cookie"] = [value];
		} else if (this.joinDuplicateHeaders) {
			if (dest[field] === void 0) dest[field] = value;
			else dest[field] += ", " + value;
		} else if (dest[field] === void 0) dest[field] = value;
	}
	_addHeaderLineDistinct(field, value, dest) {
		field = field.toLowerCase();
		if (!dest[field]) dest[field] = [value];
		else dest[field].push(value);
	}
	_dump() {
		if (!this._dumped) {
			this._dumped = true;
			this.removeAllListeners("data");
			this.resume();
		}
	}
};
function matchKnownFields(field, lowercased = false) {
	switch (field.length) {
		case 3:
			if (field === "Age" || field === "age") return "age";
			break;
		case 4:
			if (field === "Host" || field === "host") return "host";
			if (field === "From" || field === "from") return "from";
			if (field === "ETag" || field === "etag") return "etag";
			if (field === "Date" || field === "date") return "\0date";
			if (field === "Vary" || field === "vary") return "\0vary";
			break;
		case 6:
			if (field === "Server" || field === "server") return "server";
			if (field === "Cookie" || field === "cookie") return "cookie";
			if (field === "Origin" || field === "origin") return "\0origin";
			if (field === "Expect" || field === "expect") return "\0expect";
			if (field === "Accept" || field === "accept") return "\0accept";
			break;
		case 7:
			if (field === "Referer" || field === "referer") return "referer";
			if (field === "Expires" || field === "expires") return "expires";
			if (field === "Upgrade" || field === "upgrade") return "\0upgrade";
			break;
		case 8:
			if (field === "Location" || field === "location") return "location";
			if (field === "If-Match" || field === "if-match") return "\0if-match";
			break;
		case 10:
			if (field === "User-Agent" || field === "user-agent") return "user-agent";
			if (field === "Set-Cookie" || field === "set-cookie") return "";
			if (field === "Connection" || field === "connection") return "\0connection";
			break;
		case 11:
			if (field === "Retry-After" || field === "retry-after") return "retry-after";
			break;
		case 12:
			if (field === "Content-Type" || field === "content-type") return "content-type";
			if (field === "Max-Forwards" || field === "max-forwards") return "max-forwards";
			break;
		case 13:
			if (field === "Authorization" || field === "authorization") return "authorization";
			if (field === "Last-Modified" || field === "last-modified") return "last-modified";
			if (field === "Cache-Control" || field === "cache-control") return "\0cache-control";
			if (field === "If-None-Match" || field === "if-none-match") return "\0if-none-match";
			break;
		case 14:
			if (field === "Content-Length" || field === "content-length") return "content-length";
			break;
		case 15:
			if (field === "Accept-Encoding" || field === "accept-encoding") return "\0accept-encoding";
			if (field === "Accept-Language" || field === "accept-language") return "\0accept-language";
			if (field === "X-Forwarded-For" || field === "x-forwarded-for") return "\0x-forwarded-for";
			break;
		case 16:
			if (field === "Content-Encoding" || field === "content-encoding") return "\0content-encoding";
			if (field === "X-Forwarded-Host" || field === "x-forwarded-host") return "\0x-forwarded-host";
			break;
		case 17:
			if (field === "If-Modified-Since" || field === "if-modified-since") return "if-modified-since";
			if (field === "Transfer-Encoding" || field === "transfer-encoding") return "\0transfer-encoding";
			if (field === "X-Forwarded-Proto" || field === "x-forwarded-proto") return "\0x-forwarded-proto";
			break;
		case 19:
			if (field === "Proxy-Authorization" || field === "proxy-authorization") return "proxy-authorization";
			if (field === "If-Unmodified-Since" || field === "if-unmodified-since") return "if-unmodified-since";
	}
	if (lowercased) return "\0" + field;
	return matchKnownFields(field.toLowerCase(), true);
}
function onError$1(self, error, cb) {
	if (self.listenerCount("error") === 0) cb();
	else cb(error);
}
// ../../../../../setup-pnpm/node_modules/.bin/store/v11/links/@/fetch-to-node/2.1.0/75a085586b95f3a18a440f8655a7cb5c851846ab2c5e6ad2c4ae036e3bbaa05c/node_modules/fetch-to-node/dist/utils/types.js
function validateString(value, name) {
	if (typeof value !== "string") throw new ERR_INVALID_ARG_TYPE(name, "string", value);
}
const linkValueRegExp = /^(?:<[^>]*>)(?:\s*;\s*[^;"\s]+(?:=(")?[^;"\s]*\1)?)*$/;
function validateLinkHeaderFormat(value, name) {
	if (typeof value === "undefined" || !linkValueRegExp.exec(value)) throw new ERR_INVALID_ARG_VALUE(name, value, "must be an array or string of format \"</styles.css>; rel=preload; as=style\"");
}
function validateLinkHeaderValue(hints) {
	if (typeof hints === "string") {
		validateLinkHeaderFormat(hints, "hints");
		return hints;
	} else if (Array.isArray(hints)) {
		const hintsLength = hints.length;
		let result = "";
		if (hintsLength === 0) return result;
		for (let i = 0; i < hintsLength; i++) {
			const link = hints[i];
			validateLinkHeaderFormat(link, "hints");
			result += link;
			if (i !== hintsLength - 1) result += ", ";
		}
		return result;
	}
	throw new ERR_INVALID_ARG_VALUE("hints", hints, "must be an array or string of format \"</styles.css>; rel=preload; as=style\"");
}
function isUint8Array(value) {
	return value != null && value[Symbol.toStringTag] === "Uint8Array";
}
// ../../../../../setup-pnpm/node_modules/.bin/store/v11/links/@/fetch-to-node/2.1.0/75a085586b95f3a18a440f8655a7cb5c851846ab2c5e6ad2c4ae036e3bbaa05c/node_modules/fetch-to-node/dist/fetch-to-node/internal-http.js
const kNeedDrain = Symbol("kNeedDrain");
const kOutHeaders = Symbol("kOutHeaders");
function utcDate() {
	return (/* @__PURE__ */ new Date()).toUTCString();
}
// ../../../../../setup-pnpm/node_modules/.bin/store/v11/links/@/fetch-to-node/2.1.0/75a085586b95f3a18a440f8655a7cb5c851846ab2c5e6ad2c4ae036e3bbaa05c/node_modules/fetch-to-node/dist/fetch-to-node/internal-streams-state.js
function getDefaultHighWaterMark(objectMode) {
	return objectMode ? 16 : 65536;
}
// ../../../../../setup-pnpm/node_modules/.bin/store/v11/links/@/fetch-to-node/2.1.0/75a085586b95f3a18a440f8655a7cb5c851846ab2c5e6ad2c4ae036e3bbaa05c/node_modules/fetch-to-node/dist/fetch-to-node/http-common.js
const tokenRegExp = /^[\^_`a-zA-Z\-0-9!#$%&'*+.|~]+$/;
/**
* Verifies that the given val is a valid HTTP token
* per the rules defined in RFC 7230
* See https://tools.ietf.org/html/rfc7230#section-3.2.6
*/
function checkIsHttpToken(val) {
	return tokenRegExp.test(val);
}
const headerCharRegex$1 = /[^\t\x20-\x7e\x80-\xff]/;
/**
* True if val contains an invalid field-vchar
*  field-value    = *( field-content / obs-fold )
*  field-content  = field-vchar [ 1*( SP / HTAB ) field-vchar ]
*  field-vchar    = VCHAR / obs-text
*/
function checkInvalidHeaderChar$1(val) {
	return headerCharRegex$1.test(val);
}
const chunkExpression = /(?:^|\W)chunked(?:$|\W)/i;
// ../../../../../setup-pnpm/node_modules/.bin/store/v11/links/@/fetch-to-node/2.1.0/75a085586b95f3a18a440f8655a7cb5c851846ab2c5e6ad2c4ae036e3bbaa05c/node_modules/fetch-to-node/dist/fetch-to-node/http-outgoing.js
const kCorked = Symbol("corked");
const kChunkedBuffer = Symbol("kChunkedBuffer");
const kChunkedLength = Symbol("kChunkedLength");
const kUniqueHeaders = Symbol("kUniqueHeaders");
const kBytesWritten = Symbol("kBytesWritten");
const kErrored = Symbol("errored");
const kHighWaterMark = Symbol("kHighWaterMark");
const kRejectNonStandardBodyWrites = Symbol("kRejectNonStandardBodyWrites");
const nop = () => {};
const RE_CONN_CLOSE = /(?:^|\W)close(?:$|\W)/i;
function isCookieField(s) {
	return s.length === 6 && s.toLowerCase() === "cookie";
}
function isContentDispositionField(s) {
	return s.length === 19 && s.toLowerCase() === "content-disposition";
}
/**
* An in-memory buffer that stores the chunks that have been streamed to an
* OutgoingMessage instance.
*/
var WrittenDataBuffer = class {
	[kCorked] = 0;
	[kHighWaterMark] = getDefaultHighWaterMark();
	entries = [];
	onWrite;
	constructor(params = {}) {
		this.onWrite = params.onWrite;
	}
	write(data, encoding, callback) {
		this.entries.push({
			data,
			length: data.length,
			encoding,
			callback,
			written: false
		});
		this._flush();
		return true;
	}
	cork() {
		this[kCorked]++;
	}
	uncork() {
		this[kCorked]--;
		this._flush();
	}
	_flush() {
		if (this[kCorked] <= 0) {
			for (const [index, entry] of this.entries.entries()) if (!entry.written) {
				entry.written = true;
				if (this.onWrite != null) this.onWrite(index, entry);
				if (entry.callback != null) entry.callback.call(void 0);
			}
		}
	}
	get writableLength() {
		return this.entries.reduce((acc, entry) => {
			return acc + (entry.written && entry.length ? entry.length : 0);
		}, 0);
	}
	get writableHighWaterMark() {
		return this[kHighWaterMark];
	}
	get writableCorked() {
		return this[kCorked];
	}
};
/**
* This is an implementation of OutgoingMessage from Node.js intended to run in
* a WinterTC runtime. The 'Writable' interface of this class is wired to an in-memory
* buffer.
*
* This instance can be used in normal ways, but it does not give access to the
* underlying socket (because there isn't one. req.socket will always return null).
*
* Some code in this class is transplanted/adapted from node/lib/_http_outgoing.js
*/
var FetchOutgoingMessage = class extends Writable {
	req;
	outputData;
	outputSize;
	writtenHeaderBytes = 0;
	_last;
	chunkedEncoding;
	shouldKeepAlive;
	maxRequestsOnConnectionReached;
	_defaultKeepAlive;
	useChunkedEncodingByDefault;
	sendDate;
	_removedConnection;
	_removedContLen;
	_removedTE;
	strictContentLength;
	[kBytesWritten];
	_contentLength;
	_hasBody;
	_trailer;
	[kNeedDrain];
	finished;
	_headerSent;
	[kCorked];
	[kChunkedBuffer];
	[kChunkedLength];
	_closed;
	_header;
	[kOutHeaders];
	_keepAliveTimeout;
	_maxRequestsPerSocket;
	_onPendingData;
	[kUniqueHeaders];
	[kErrored];
	[kHighWaterMark];
	[kRejectNonStandardBodyWrites];
	_writtenDataBuffer = new WrittenDataBuffer({ onWrite: this._onDataWritten.bind(this) });
	constructor(req, options) {
		super();
		this.req = req;
		this.outputData = [];
		this.outputSize = 0;
		this.destroyed = false;
		this._last = false;
		this.chunkedEncoding = false;
		this.shouldKeepAlive = true;
		this.maxRequestsOnConnectionReached = false;
		this._defaultKeepAlive = true;
		this.useChunkedEncodingByDefault = true;
		this.sendDate = false;
		this._removedConnection = false;
		this._removedContLen = false;
		this._removedTE = false;
		this.strictContentLength = false;
		this[kBytesWritten] = 0;
		this._contentLength = null;
		this._hasBody = true;
		this._trailer = "";
		this[kNeedDrain] = false;
		this.finished = false;
		this._headerSent = false;
		this[kCorked] = 0;
		this[kChunkedBuffer] = [];
		this[kChunkedLength] = 0;
		this._closed = false;
		this._header = null;
		this[kOutHeaders] = null;
		this._keepAliveTimeout = 0;
		this._onPendingData = nop;
		this[kErrored] = null;
		this[kHighWaterMark] = options?.highWaterMark ?? getDefaultHighWaterMark();
		this[kRejectNonStandardBodyWrites] = options?.rejectNonStandardBodyWrites ?? false;
		this[kUniqueHeaders] = null;
	}
	_renderHeaders() {
		if (this._header) throw new ERR_HTTP_HEADERS_SENT("render");
		const headersMap = this[kOutHeaders];
		const headers = {};
		if (headersMap !== null) {
			const keys = Object.keys(headersMap);
			for (let i = 0, l = keys.length; i < l; i++) {
				const key = keys[i];
				headers[headersMap[key][0]] = headersMap[key][1];
			}
		}
		return headers;
	}
	cork() {
		this[kCorked]++;
		if (this._writtenDataBuffer != null) this._writtenDataBuffer.cork();
	}
	uncork() {
		this[kCorked]--;
		if (this._writtenDataBuffer != null) this._writtenDataBuffer.uncork();
		if (this[kCorked] || this[kChunkedBuffer].length === 0) return;
		const buf = this[kChunkedBuffer];
		for (const { data, encoding, callback } of buf) this._send(data ?? "", encoding, callback);
		this[kChunkedBuffer].length = 0;
		this[kChunkedLength] = 0;
	}
	setTimeout(msecs, callback) {
		return this;
	}
	destroy(error) {
		if (this.destroyed) return this;
		this.destroyed = true;
		this[kErrored] = error;
		return this;
	}
	_send(data, encoding, callback, byteLength) {
		if (!this._headerSent) {
			const header = this._header;
			if (typeof data === "string" && (encoding === "utf8" || encoding === "latin1" || !encoding)) data = header + data;
			else {
				this.outputData.unshift({
					data: header,
					encoding: "latin1",
					callback: void 0
				});
				this.outputSize += header.length;
				this._onPendingData(header.length);
			}
			this._headerSent = true;
			this.writtenHeaderBytes = header.length;
			const [statusLine, ...headerLines] = this._header.split("\r\n");
			const statusLineResult = /^HTTP\/1\.1 (?<statusCode>\d+) (?<statusMessage>.*)$/.exec(statusLine);
			if (statusLineResult == null) throw new Error("Unexpected! Status line was " + statusLine);
			const { statusCode: statusCodeText, statusMessage } = statusLineResult.groups ?? {};
			const statusCode = parseInt(statusCodeText, 10);
			const headers = [];
			for (const headerLine of headerLines) if (headerLine !== "") {
				const pos = headerLine.indexOf(": ");
				const k = headerLine.slice(0, pos);
				const v = headerLine.slice(pos + 2);
				headers.push([k, v]);
			}
			const event = {
				statusCode,
				statusMessage,
				headers
			};
			this.emit("_headersSent", event);
		}
		return this._writeRaw(data, encoding, callback, byteLength);
	}
	_writeRaw(data, encoding, callback, size) {
		if (typeof encoding === "function") {
			callback = encoding;
			encoding = null;
		}
		if (this._writtenDataBuffer != null) {
			if (this.outputData.length) this._flushOutput(this._writtenDataBuffer);
			return this._writtenDataBuffer.write(data, encoding, callback);
		}
		this.outputData.push({
			data,
			encoding,
			callback
		});
		this.outputSize += data.length;
		this._onPendingData(data.length);
		return this.outputSize < this[kHighWaterMark];
	}
	_onDataWritten(index, entry) {
		const event = {
			index,
			entry
		};
		this.emit("_dataWritten", event);
	}
	_storeHeader(firstLine, headers) {
		const state = {
			connection: false,
			contLen: false,
			te: false,
			date: false,
			expect: false,
			trailer: false,
			header: firstLine
		};
		if (headers) {
			if (headers === this[kOutHeaders]) for (const key in headers) {
				const entry = headers[key];
				processHeader(this, state, entry[0], entry[1], false);
			}
			else if (Array.isArray(headers)) {
				if (headers.length && Array.isArray(headers[0])) for (let i = 0; i < headers.length; i++) {
					const entry = headers[i];
					processHeader(this, state, entry[0], entry[1], true);
				}
				else {
					if (headers.length % 2 !== 0) throw new ERR_INVALID_ARG_VALUE("headers", headers);
					for (let n = 0; n < headers.length; n += 2) processHeader(this, state, headers[n], headers[n + 1], true);
				}
			} else for (const key in headers) if (headers.hasOwnProperty(key)) {
				const _headers = headers;
				processHeader(this, state, key, _headers[key], true);
			}
		}
		let { header } = state;
		if (this.sendDate && !state.date) header += "Date: " + utcDate() + "\r\n";
		if (this.chunkedEncoding && (this.statusCode === 204 || this.statusCode === 304)) {
			this.chunkedEncoding = false;
			this.shouldKeepAlive = false;
		}
		if (this._removedConnection) this._last = !this.shouldKeepAlive;
		else if (!state.connection) {
			const shouldSendKeepAlive = this.shouldKeepAlive && (state.contLen || this.useChunkedEncodingByDefault);
			if (shouldSendKeepAlive && this.maxRequestsOnConnectionReached) header += "Connection: close\r\n";
			else if (shouldSendKeepAlive) {
				header += "Connection: keep-alive\r\n";
				if (this._keepAliveTimeout && this._defaultKeepAlive) {
					const timeoutSeconds = Math.floor(this._keepAliveTimeout / 1e3);
					let max = "";
					if (this._maxRequestsPerSocket && ~~this._maxRequestsPerSocket > 0) max = `, max=${this._maxRequestsPerSocket}`;
					header += `Keep-Alive: timeout=${timeoutSeconds}${max}\r\n`;
				}
			} else {
				this._last = true;
				header += "Connection: close\r\n";
			}
		}
		if (!state.contLen && !state.te) {
			if (!this._hasBody) this.chunkedEncoding = false;
			else if (!this.useChunkedEncodingByDefault) this._last = true;
			else if (!state.trailer && !this._removedContLen && typeof this._contentLength === "number") header += "Content-Length: " + this._contentLength + "\r\n";
			else if (!this._removedTE) {
				header += "Transfer-Encoding: chunked\r\n";
				this.chunkedEncoding = true;
			} else this._last = true;
		}
		if (this.chunkedEncoding !== true && state.trailer) throw new ERR_HTTP_TRAILER_INVALID();
		this._header = header + "\r\n";
		this._headerSent = false;
		if (state.expect) this._send("");
	}
	get _headers() {
		console.warn("DEP0066: OutgoingMessage.prototype._headers is deprecated");
		return this.getHeaders();
	}
	set _headers(val) {
		console.warn("DEP0066: OutgoingMessage.prototype._headers is deprecated");
		if (val == null) this[kOutHeaders] = null;
		else if (typeof val === "object") {
			const headers = this[kOutHeaders] = Object.create(null);
			const keys = Object.keys(val);
			for (let i = 0; i < keys.length; ++i) {
				const name = keys[i];
				headers[name.toLowerCase()] = [name, val[name]];
			}
		}
	}
	get connection() {
		return null;
	}
	set connection(_socket) {
		console.error("No support for OutgoingMessage.connection");
	}
	get socket() {
		return null;
	}
	set socket(_socket) {
		console.error("No support for OutgoingMessage.socket");
	}
	get _headerNames() {
		console.warn("DEP0066: OutgoingMessage.prototype._headerNames is deprecated");
		const headers = this[kOutHeaders];
		if (headers !== null) {
			const out = Object.create(null);
			const keys = Object.keys(headers);
			for (let i = 0; i < keys.length; ++i) {
				const key = keys[i];
				out[key] = headers[key][0];
			}
			return out;
		}
		return null;
	}
	set _headerNames(val) {
		console.warn("DEP0066: OutgoingMessage.prototype._headerNames is deprecated");
		if (typeof val === "object" && val !== null) {
			const headers = this[kOutHeaders];
			if (!headers) return;
			const keys = Object.keys(val);
			for (let i = 0; i < keys.length; ++i) {
				const header = headers[keys[i]];
				if (header) header[0] = val[keys[i]];
			}
		}
	}
	setHeader(name, value) {
		if (this._header) throw new ERR_HTTP_HEADERS_SENT("set");
		validateHeaderName(name);
		validateHeaderValue(name, value);
		let headers = this[kOutHeaders];
		if (headers === null) this[kOutHeaders] = headers = { __proto__: null };
		headers[name.toLowerCase()] = [name, value];
		return this;
	}
	setHeaders(headers) {
		if (this._header) throw new ERR_HTTP_HEADERS_SENT("set");
		if (!headers || Array.isArray(headers) || typeof headers.keys !== "function" || typeof headers.get !== "function") throw new ERR_INVALID_ARG_TYPE("headers", ["Headers", "Map"], headers);
		const cookies = [];
		for (const { 0: key, 1: value } of headers) {
			if (key === "set-cookie") {
				if (Array.isArray(value)) cookies.push(...value);
				else cookies.push(value);
				continue;
			}
			this.setHeader(key, value);
		}
		if (cookies.length) this.setHeader("set-cookie", cookies);
		return this;
	}
	appendHeader(name, value) {
		if (this._header) throw new ERR_HTTP_HEADERS_SENT("append");
		validateHeaderName(name);
		validateHeaderValue(name, value);
		const field = name.toLowerCase();
		const headers = this[kOutHeaders];
		if (headers === null || !headers[field]) return this.setHeader(name, value);
		if (!Array.isArray(headers[field][1])) headers[field][1] = [headers[field][1]];
		const existingValues = headers[field][1];
		if (Array.isArray(value)) for (let i = 0, length = value.length; i < length; i++) existingValues.push(value[i]);
		else existingValues.push(value);
		return this;
	}
	getHeader(name) {
		validateString(name, "name");
		const headers = this[kOutHeaders];
		if (headers === null) return;
		return headers[name.toLowerCase()]?.[1];
	}
	getHeaderNames() {
		return this[kOutHeaders] !== null ? Object.keys(this[kOutHeaders]) : [];
	}
	getRawHeaderNames() {
		const headersMap = this[kOutHeaders];
		if (headersMap === null) return [];
		const values = Object.values(headersMap);
		const headers = Array(values.length);
		for (let i = 0, l = values.length; i < l; i++) headers[i] = values[i][0];
		return headers;
	}
	getHeaders() {
		const headers = this[kOutHeaders];
		const ret = { __proto__: null };
		if (headers) {
			const keys = Object.keys(headers);
			for (let i = 0; i < keys.length; ++i) {
				const key = keys[i];
				ret[key] = headers[key][1];
			}
		}
		return ret;
	}
	hasHeader(name) {
		validateString(name, "name");
		return this[kOutHeaders] !== null && !!this[kOutHeaders][name.toLowerCase()];
	}
	removeHeader(name) {
		validateString(name, "name");
		if (this._header) throw new ERR_HTTP_HEADERS_SENT("remove");
		const key = name.toLowerCase();
		switch (key) {
			case "connection":
				this._removedConnection = true;
				break;
			case "content-length":
				this._removedContLen = true;
				break;
			case "transfer-encoding":
				this._removedTE = true;
				break;
			case "date": this.sendDate = false;
		}
		if (this[kOutHeaders] !== null) delete this[kOutHeaders][key];
	}
	_implicitHeader() {
		throw new ERR_METHOD_NOT_IMPLEMENTED("_implicitHeader()");
	}
	get headersSent() {
		return !!this._header;
	}
	write(chunk, encoding, callback) {
		if (typeof encoding === "function") {
			callback = encoding;
			encoding = null;
		}
		const ret = write_(this, chunk, encoding, callback, false);
		if (!ret) this[kNeedDrain] = true;
		return ret;
	}
	addTrailers(headers) {
		this._trailer = "";
		const isArray = Array.isArray(headers);
		const keys = isArray ? [...headers.keys()] : Object.keys(headers);
		for (let i = 0, l = keys.length; i < l; i++) {
			let field, value;
			if (isArray) {
				const _headers = headers;
				const key = keys[i];
				field = _headers[key][0];
				value = _headers[key][1];
			} else {
				const _headers = headers;
				const key = keys[i];
				field = key;
				value = _headers[key];
			}
			validateHeaderName(field, "Trailer name");
			if (Array.isArray(value) && value.length > 1 && (!this[kUniqueHeaders] || !this[kUniqueHeaders].has(field.toLowerCase()))) for (let j = 0, l = value.length; j < l; j++) {
				if (checkInvalidHeaderChar$1(value[j])) {
					throw new ERR_INVALID_CHAR("trailer content", field);
				}
				this._trailer += field + ": " + value[j] + "\r\n";
			}
			else {
				if (Array.isArray(value)) value = value.join("; ");
				if (checkInvalidHeaderChar$1(String(value))) {
					throw new ERR_INVALID_CHAR("trailer content", field);
				}
				this._trailer += field + ": " + value + "\r\n";
			}
		}
	}
	end(chunk, encoding, callback) {
		if (typeof chunk === "function") {
			callback = chunk;
			chunk = null;
			encoding = null;
		} else if (typeof encoding === "function") {
			callback = encoding;
			encoding = null;
		}
		if (chunk) {
			if (this.finished) {
				onError(this, new ERR_STREAM_WRITE_AFTER_END(), typeof callback !== "function" ? nop : callback);
				return this;
			}
			if (this._writtenDataBuffer != null) this._writtenDataBuffer.cork();
			write_(this, chunk, encoding, null, true);
		} else if (this.finished) {
			if (typeof callback === "function") {
				if (!this.writableFinished) this.on("finish", callback);
				else callback(new ERR_STREAM_ALREADY_FINISHED("end"));
			}
			return this;
		} else if (!this._header) {
			if (this._writtenDataBuffer != null) this._writtenDataBuffer.cork();
			this._contentLength = 0;
			this._implicitHeader();
		}
		if (typeof callback === "function") this.once("finish", callback);
		if (strictContentLength(this) && this[kBytesWritten] !== this._contentLength) throw new ERR_HTTP_CONTENT_LENGTH_MISMATCH(this[kBytesWritten], this._contentLength);
		const finish = onFinish.bind(void 0, this);
		if (this._hasBody && this.chunkedEncoding) this._send("", "latin1", finish);
		else if (!this._headerSent || this.writableLength || chunk) this._send("", "latin1", finish);
		else setTimeout(finish, 0);
		if (this._writtenDataBuffer != null) this._writtenDataBuffer.uncork();
		this[kCorked] = 1;
		this.uncork();
		this.finished = true;
		if (this.outputData.length === 0 && this._writtenDataBuffer != null) this._finish();
		return this;
	}
	_finish() {
		this.emit("prefinish");
	}
	_flush() {
		if (this._writtenDataBuffer != null) {
			const ret = this._flushOutput(this._writtenDataBuffer);
			if (this.finished) this._finish();
			else if (ret && this[kNeedDrain]) {
				this[kNeedDrain] = false;
				this.emit("drain");
			}
		}
	}
	_flushOutput(dataBuffer) {
		while (this[kCorked]) {
			this[kCorked]--;
			dataBuffer.cork();
		}
		const outputLength = this.outputData.length;
		if (outputLength <= 0) return;
		const outputData = this.outputData;
		dataBuffer.cork();
		let ret;
		for (let i = 0; i < outputLength; i++) {
			const { data, encoding, callback } = outputData[i];
			outputData[i].data = null;
			ret = dataBuffer.write(data ?? "", encoding, callback);
		}
		dataBuffer.uncork();
		this.outputData = [];
		this._onPendingData(-this.outputSize);
		this.outputSize = 0;
		return ret;
	}
	flushHeaders() {
		if (!this._header) this._implicitHeader();
		this._send("");
	}
	pipe(destination) {
		this.emit("error", new ERR_STREAM_CANNOT_PIPE());
		return destination;
	}
};
function processHeader(self, state, key, value, validate) {
	if (validate) validateHeaderName(key);
	if (isContentDispositionField(key) && self._contentLength) {
		if (Array.isArray(value)) for (let i = 0; i < value.length; i++) value[i] = String(Buffer$1.from(String(value[i]), "latin1"));
		else value = String(Buffer$1.from(String(value), "latin1"));
	}
	if (Array.isArray(value)) {
		if ((value.length < 2 || !isCookieField(key)) && (!self[kUniqueHeaders] || !self[kUniqueHeaders].has(key.toLowerCase()))) {
			for (let i = 0; i < value.length; i++) storeHeader(self, state, key, value[i], validate);
			return;
		}
		value = value.join("; ");
	}
	storeHeader(self, state, key, String(value), validate);
}
function storeHeader(self, state, key, value, validate) {
	if (validate) validateHeaderValue(key, value);
	state.header += key + ": " + value + "\r\n";
	matchHeader(self, state, key, value);
}
function validateHeaderName(name, label) {
	if (typeof name !== "string" || !name || !checkIsHttpToken(name)) throw new ERR_INVALID_HTTP_TOKEN(label || "Header name", name);
}
function validateHeaderValue(name, value) {
	if (value === void 0) throw new ERR_HTTP_INVALID_HEADER_VALUE(String(value), name);
	if (checkInvalidHeaderChar$1(String(value))) {
		throw new ERR_INVALID_CHAR("header content", name);
	}
}
function matchHeader(self, state, field, value) {
	if (field.length < 4 || field.length > 17) return;
	field = field.toLowerCase();
	switch (field) {
		case "connection":
			state.connection = true;
			self._removedConnection = false;
			if (RE_CONN_CLOSE.exec(value) !== null) self._last = true;
			else self.shouldKeepAlive = true;
			break;
		case "transfer-encoding":
			state.te = true;
			self._removedTE = false;
			if (chunkExpression.exec(value) !== null) self.chunkedEncoding = true;
			break;
		case "content-length":
			state.contLen = true;
			self._contentLength = +value;
			self._removedContLen = false;
			break;
		case "date":
		case "expect":
		case "trailer":
			state[field] = true;
			break;
		case "keep-alive": self._defaultKeepAlive = false;
	}
}
function onError(msg, err, callback) {
	if (msg.destroyed) return;
	setTimeout(emitErrorNt, 0, msg, err, callback);
}
function emitErrorNt(msg, err, callback) {
	callback(err);
	if (typeof msg.emit === "function" && !msg.destroyed) msg.emit("error", err);
}
function strictContentLength(msg) {
	return msg.strictContentLength && msg._contentLength != null && msg._hasBody && !msg._removedContLen && !msg.chunkedEncoding && !msg.hasHeader("transfer-encoding");
}
function write_(msg, chunk, encoding, callback, fromEnd) {
	if (typeof callback !== "function") callback = nop;
	if (chunk === null) throw new ERR_STREAM_NULL_VALUES();
	else if (typeof chunk !== "string" && !isUint8Array(chunk)) throw new ERR_INVALID_ARG_TYPE("chunk", [
		"string",
		"Buffer",
		"Uint8Array"
	], chunk);
	let err = void 0;
	if (msg.finished) err = new ERR_STREAM_WRITE_AFTER_END();
	else if (msg.destroyed) err = new ERR_STREAM_DESTROYED("write");
	if (err) {
		if (!msg.destroyed) onError(msg, err, callback);
		else setTimeout(callback, 0, err);
		return false;
	}
	let len = void 0;
	if (msg.strictContentLength) {
		len ??= typeof chunk === "string" ? Buffer$1.byteLength(chunk, encoding ?? void 0) : chunk.byteLength;
		if (strictContentLength(msg) && (fromEnd ? msg[kBytesWritten] + len !== msg._contentLength : msg[kBytesWritten] + len > (msg._contentLength ?? 0))) throw new ERR_HTTP_CONTENT_LENGTH_MISMATCH(len + msg[kBytesWritten], msg._contentLength);
		msg[kBytesWritten] += len;
	}
	if (!msg._header) {
		if (fromEnd) {
			len ??= typeof chunk === "string" ? Buffer$1.byteLength(chunk, encoding ?? void 0) : chunk.byteLength;
			msg._contentLength = len;
		}
		msg._implicitHeader();
	}
	if (!msg._hasBody) {
		if (msg[kRejectNonStandardBodyWrites]) throw new ERR_HTTP_BODY_NOT_ALLOWED();
		else {
			setTimeout(callback, 0);
			return true;
		}
	}
	if (!fromEnd && msg._writtenDataBuffer != null && !msg._writtenDataBuffer.writableCorked) {
		msg._writtenDataBuffer.cork();
		setTimeout(connectionCorkNT, 0, msg._writtenDataBuffer);
	}
	let ret;
	if (msg.chunkedEncoding && chunk.length !== 0) {
		len ??= typeof chunk === "string" ? Buffer$1.byteLength(chunk, encoding ?? void 0) : chunk.byteLength;
		if (msg[kCorked] && msg._headerSent) {
			msg[kChunkedBuffer].push({
				data: chunk,
				encoding,
				callback
			});
			msg[kChunkedLength] += len;
			ret = msg[kChunkedLength] < msg[kHighWaterMark];
		} else ret = msg._send(chunk, encoding, callback, len);
	} else ret = msg._send(chunk, encoding, callback, len);
	"" + ret;
	return ret;
}
function connectionCorkNT(dataBuffer) {
	dataBuffer.uncork();
}
function onFinish(outmsg) {
	outmsg.emit("finish");
}
Object.defineProperties(FetchOutgoingMessage.prototype, {
	errored: { get() {
		return this[kErrored];
	} },
	closed: { get() {
		return this._closed;
	} },
	writableFinished: { get() {
		return this.finished && this.outputSize === 0 && (this._writtenDataBuffer == null || this._writtenDataBuffer.writableLength === 0);
	} },
	writableObjectMode: { get() {
		return false;
	} },
	writableLength: { get() {
		return this.outputSize + this[kChunkedLength] + (this._writtenDataBuffer != null ? this._writtenDataBuffer.writableLength : 0);
	} },
	writableHighWaterMark: { get() {
		return this._writtenDataBuffer != null ? this._writtenDataBuffer.writableHighWaterMark : this[kHighWaterMark];
	} },
	writableCorked: { get() {
		return this[kCorked];
	} },
	writableEnded: { get() {
		return this.finished;
	} },
	writableNeedDrain: { get() {
		return !this.destroyed && !this.finished && this[kNeedDrain];
	} }
});
// ../../../../../setup-pnpm/node_modules/.bin/store/v11/links/@/fetch-to-node/2.1.0/75a085586b95f3a18a440f8655a7cb5c851846ab2c5e6ad2c4ae036e3bbaa05c/node_modules/fetch-to-node/dist/fetch-to-node/http-server.js
const headerCharRegex = /[^\t\x20-\x7e\x80-\xff]/;
/**
* True if val contains an invalid field-vchar
*  field-value    = *( field-content / obs-fold )
*  field-content  = field-vchar [ 1*( SP / HTAB ) field-vchar ]
*  field-vchar    = VCHAR / obs-text
*/
function checkInvalidHeaderChar(val) {
	return headerCharRegex.test(val);
}
const STATUS_CODES$1 = {
	100: "Continue",
	101: "Switching Protocols",
	102: "Processing",
	103: "Early Hints",
	200: "OK",
	201: "Created",
	202: "Accepted",
	203: "Non-Authoritative Information",
	204: "No Content",
	205: "Reset Content",
	206: "Partial Content",
	207: "Multi-Status",
	208: "Already Reported",
	226: "IM Used",
	300: "Multiple Choices",
	301: "Moved Permanently",
	302: "Found",
	303: "See Other",
	304: "Not Modified",
	305: "Use Proxy",
	307: "Temporary Redirect",
	308: "Permanent Redirect",
	400: "Bad Request",
	401: "Unauthorized",
	402: "Payment Required",
	403: "Forbidden",
	404: "Not Found",
	405: "Method Not Allowed",
	406: "Not Acceptable",
	407: "Proxy Authentication Required",
	408: "Request Timeout",
	409: "Conflict",
	410: "Gone",
	411: "Length Required",
	412: "Precondition Failed",
	413: "Payload Too Large",
	414: "URI Too Long",
	415: "Unsupported Media Type",
	416: "Range Not Satisfiable",
	417: "Expectation Failed",
	418: "I'm a Teapot",
	421: "Misdirected Request",
	422: "Unprocessable Entity",
	423: "Locked",
	424: "Failed Dependency",
	425: "Too Early",
	426: "Upgrade Required",
	428: "Precondition Required",
	429: "Too Many Requests",
	431: "Request Header Fields Too Large",
	451: "Unavailable For Legal Reasons",
	500: "Internal Server Error",
	501: "Not Implemented",
	502: "Bad Gateway",
	503: "Service Unavailable",
	504: "Gateway Timeout",
	505: "HTTP Version Not Supported",
	506: "Variant Also Negotiates",
	507: "Insufficient Storage",
	508: "Loop Detected",
	509: "Bandwidth Limit Exceeded",
	510: "Not Extended",
	511: "Network Authentication Required"
};
/**
* This is an implementation of ServerResponse from Node.js intended to run in
* a WinterTC runtime. The 'Writable' interface of this class is wired to an in-memory
* buffer. This class also provides a method that creates a Response object that
* can be handled by the runtime.
*
* This instance can be used in normal ways, but it does not give access to the
* underlying socket (because there isn't one. req.socket will always return null).
*
* Some code in this class is transplanted/adapted from node/lib/_httpserver.js
*
* NOTE: Node.js doesn't really separate the body from headers, the entire "stream"
* contains the headers and the body. So we provide functions that lets us pull
* the headers and body out individually at a later time.
*/
var FetchServerResponse = class FetchServerResponse extends FetchOutgoingMessage {
	static encoder = new TextEncoder();
	statusCode = 200;
	statusMessage;
	_sent100;
	_expect_continue;
	[kOutHeaders] = null;
	constructor(req, options) {
		super(req, options);
		if (req.method === "HEAD") this._hasBody = false;
		this.sendDate = true;
		this._sent100 = false;
		this._expect_continue = false;
		if (req.httpVersionMajor < 1 || req.httpVersionMinor < 1) {
			this.useChunkedEncodingByDefault = chunkExpression.exec(String(req.headers.te)) !== null;
			this.shouldKeepAlive = false;
		}
		this.fetchResponse = new Promise((resolve) => {
			let finished = false;
			this.on("finish", () => {
				finished = true;
			});
			const initialDataChunks = [];
			const initialDataWrittenHandler = (e) => {
				if (finished) return;
				initialDataChunks[e.index] = this.dataFromDataWrittenEvent(e);
			};
			this.on("_dataWritten", initialDataWrittenHandler);
			this.on("_headersSent", (e) => {
				this.off("_dataWritten", initialDataWrittenHandler);
				const { statusCode, statusMessage, headers } = e;
				resolve(this._toFetchResponse(statusCode, statusMessage, headers, initialDataChunks, finished));
			});
		});
	}
	dataFromDataWrittenEvent(e) {
		const { index, entry } = e;
		let { data, encoding } = entry;
		if (index === 0) {
			if (typeof data !== "string") {
				console.error("First chunk should be string, not sure what happened.");
				throw new ERR_INVALID_ARG_TYPE("packet.data", [
					"string",
					"Buffer",
					"Uint8Array"
				], data);
			}
			data = data.slice(this.writtenHeaderBytes);
		}
		if (typeof data === "string") {
			if (encoding === void 0 || encoding === "utf8" || encoding === "utf-8") data = FetchServerResponse.encoder.encode(data);
			else data = Buffer$1.from(data, encoding ?? void 0);
		}
		return data ?? Buffer$1.from([]);
	}
	_finish() {
		super._finish();
	}
	assignSocket(socket) {
		throw new ERR_METHOD_NOT_IMPLEMENTED("assignSocket");
	}
	detachSocket(socket) {
		throw new ERR_METHOD_NOT_IMPLEMENTED("detachSocket");
	}
	writeContinue(callback) {
		this._writeRaw("HTTP/1.1 100 Continue\r\n\r\n", "ascii", callback);
		this._sent100 = true;
	}
	writeProcessing(callback) {
		this._writeRaw("HTTP/1.1 102 Processing\r\n\r\n", "ascii", callback);
	}
	writeEarlyHints(hints, callback) {
		let head = "HTTP/1.1 103 Early Hints\r\n";
		if (hints.link === null || hints.link === void 0) return;
		const link = validateLinkHeaderValue(hints.link);
		if (link.length === 0) return;
		head += "Link: " + link + "\r\n";
		for (const key of Object.keys(hints)) if (key !== "link") head += key + ": " + hints[key] + "\r\n";
		head += "\r\n";
		this._writeRaw(head, "ascii", callback);
	}
	_implicitHeader() {
		this.writeHead(this.statusCode);
	}
	writeHead(statusCode, reason, obj) {
		if (this._header) throw new ERR_HTTP_HEADERS_SENT("write");
		const originalStatusCode = statusCode;
		statusCode |= 0;
		if (statusCode < 100 || statusCode > 999) throw new ERR_HTTP_INVALID_STATUS_CODE(originalStatusCode);
		if (typeof reason === "string") this.statusMessage = reason;
		else {
			this.statusMessage ||= STATUS_CODES$1[statusCode] || "unknown";
			obj ??= reason;
		}
		this.statusCode = statusCode;
		let headers;
		if (this[kOutHeaders]) {
			let k;
			if (Array.isArray(obj)) {
				if (obj.length % 2 !== 0) throw new ERR_INVALID_ARG_VALUE("headers", obj);
				for (let n = 0; n < obj.length; n += 2) {
					k = obj[n + 0];
					this.removeHeader(String(k));
				}
				for (let n = 0; n < obj.length; n += 2) {
					k = obj[n];
					if (k) this.appendHeader(String(k), obj[n + 1]);
				}
			} else if (obj) {
				const keys = Object.keys(obj);
				for (let i = 0; i < keys.length; i++) {
					k = keys[i];
					if (k) this.setHeader(k, obj[k]);
				}
			}
			headers = this[kOutHeaders];
		} else headers = obj;
		if (checkInvalidHeaderChar(this.statusMessage)) throw new ERR_INVALID_CHAR("statusMessage");
		const statusLine = `HTTP/1.1 ${statusCode} ${this.statusMessage}\r\n`;
		if (statusCode === 204 || statusCode === 304 || statusCode >= 100 && statusCode <= 199) this._hasBody = false;
		if (this._expect_continue && !this._sent100) this.shouldKeepAlive = false;
		const convertedHeaders = headers && !Array.isArray(headers) ? headers : headers;
		this._storeHeader(statusLine, convertedHeaders ?? null);
		return this;
	}
	writeHeader = this.writeHead;
	fetchResponse;
	_toFetchResponse(status, statusText, sentHeaders, initialDataChunks, finished) {
		const headers = new Headers();
		for (const [header, value] of sentHeaders) headers.append(header, value);
		const _this = this;
		let body = this._hasBody ? new ReadableStream({ start(controller) {
			for (const dataChunk of initialDataChunks) controller.enqueue(dataChunk);
			if (finished) controller.close();
			else {
				_this.on("finish", () => {
					finished = true;
					controller.close();
				});
				_this.on("_dataWritten", (e) => {
					if (finished) return;
					const data = _this.dataFromDataWrittenEvent(e);
					controller.enqueue(data);
				});
			}
		} }) : null;
		if (body != null && typeof FixedLengthStream !== "undefined") {
			const contentLength = parseInt(headers.get("content-length") ?? "", 10);
			if (contentLength >= 0) body = body.pipeThrough(new FixedLengthStream(contentLength));
		}
		return new Response(body, {
			status,
			statusText,
			headers
		});
	}
};
function toReqRes(req, options) {
	const { createIncomingMessage = () => new FetchIncomingMessage(), createServerResponse = (incoming) => new FetchServerResponse(incoming), ctx } = {};
	const incoming = createIncomingMessage(ctx);
	const serverResponse = createServerResponse(incoming, ctx);
	const reqUrl = new URL(req.url);
	const versionMajor = 1;
	const versionMinor = 1;
	incoming.httpVersionMajor = versionMajor;
	incoming.httpVersionMinor = versionMinor;
	incoming.httpVersion = `${versionMajor}.${versionMinor}`;
	incoming.url = reqUrl.pathname + reqUrl.search;
	incoming.upgrade = false;
	const headers = [];
	for (const [headerName, headerValue] of req.headers) {
		headers.push(headerName);
		headers.push(headerValue);
	}
	incoming._addHeaderLines(headers, headers.length);
	incoming.method = req.method;
	incoming._stream = req.body;
	return {
		req: incoming,
		res: serverResponse
	};
}
function toFetchResponse(res) {
	if (!(res instanceof FetchServerResponse)) throw new Error("toFetchResponse must be called on a ServerResponse generated by toReqRes");
	return res.fetchResponse;
}
// ../../server-adapters/hono/dist/index.js
/**
* Propagates a client disconnect to the simulated Node response produced by `toReqRes`.
*
* `fetch-to-node` builds the outgoing body from `res` events but never observes cancellation
* of the stream it hands back. When an MCP Streamable HTTP client drops its session, nothing
* tells `res` that the socket is gone, so the MCP transport keeps its SSE keep-alive timer
* armed. The next keep-alive tick writes into an already-closed stream controller, and because
* that write originates in a timer callback the resulting `ERR_INVALID_STATE` is unhandled and
* takes down the process.
*
* Emitting `close` on `res` is the signal the MCP Node transport listens for: it aborts the
* request's AbortController, which breaks the write loop and tears down the SSE stream,
* clearing the keep-alive timer. No post-disconnect write is ever attempted.
*/
function propagateClientDisconnect(fetchResponse, res) {
	const upstream = fetchResponse.body;
	if (!upstream) return fetchResponse;
	let disconnected = false;
	const disconnect = () => {
		if (disconnected) return;
		disconnected = true;
		try {
			res.emit("close");
		} catch {}
		reader.read().then(function drain({ done }) {
			return done ? void 0 : reader.read().then(drain);
		}, () => {});
	};
	const reader = upstream.getReader();
	const body = new ReadableStream({
		async pull(controller) {
			const { done, value } = await reader.read();
			if (done) {
				controller.close();
				return;
			}
			controller.enqueue(value);
		},
		cancel() {
			disconnect();
		}
	});
	return new Response(body, {
		status: fetchResponse.status,
		statusText: fetchResponse.statusText,
		headers: fetchResponse.headers
	});
}
function createAuthMiddleware({ mastra, requiresAuth = true }) {
	return async (c, next) => {
		if (!requiresAuth) return next();
		const authConfig = mastra.getServer()?.auth;
		if (!authConfig) return next();
		const requestContext = c.get("requestContext") ?? new RequestContext();
		c.set("requestContext", requestContext);
		c.set("mastra", c.get("mastra") ?? mastra);
		const path = c.req.path;
		const method = c.req.method;
		const customRouteAuthConfig = new Map(c.get("customRouteAuthConfig") ?? []);
		if (!isCustomRoutePublic(path, method, customRouteAuthConfig)) customRouteAuthConfig.set(`${method}:${path}`, true);
		const authHeader = c.req.header("Authorization");
		let token = authHeader ? authHeader.replace("Bearer ", "") : null;
		if (!token) token = c.req.query("apiKey") || null;
		const result = await coreAuthMiddleware({
			path,
			method,
			getHeader: (name) => c.req.header(name),
			mastra,
			authConfig,
			customRouteAuthConfig,
			requestContext,
			rawRequest: c.req.raw,
			token,
			buildAuthorizeContext: () => c
		});
		for (const [key, value] of Object.entries(result.headers ?? {})) c.header(key, value, key.toLowerCase() === "set-cookie" ? { append: true } : void 0);
		if (result.action === "next") return next();
		return c.json(result.body, result.status);
	};
}
const TICKET_BYTES = 32;
/**
* How long an issued ticket stays valid. A ticket is minted immediately before
* the socket is opened, so this only has to cover the round trip plus the
* handshake — short enough that a ticket leaked from a log is useless by the
* time anyone can act on it.
*/
const UPGRADE_TICKET_TTL_MS = 3e4;
/**
* Ceiling on tracked per-agent issuance counters, so the limiter can't grow
* without bound as agent ids are invented. Counters are evicted oldest first.
*/
const MAX_TRACKED_AGENTS = 500;
/** 256 bits of base64url, so the ticket can't be guessed or enumerated. */
function createTicketValue() {
	const bytes = new Uint8Array(TICKET_BYTES);
	globalThis.crypto.getRandomValues(bytes);
	return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
/**
* Short-lived, single-use credentials for browser WebSocket upgrades.
*
* A browser cannot set an `Authorization` header on a WebSocket handshake, so a
* deployment that authenticates with a header token would otherwise have to put
* that reusable token in the handshake URL, where proxies and access logs can
* retain it. Instead the client asks an authenticated HTTP route for a ticket,
* and the ticket — worthless once spent, and scoped to one agent and thread —
* travels in the URL instead.
*
* In-process, like the `ViewerRegistry` and the browser sessions it serves: a
* screencast is bound to the process holding the browser, so a ticket store
* shared across replicas would buy nothing. A ticket presented to a different
* replica fails for the same reason the stream itself would.
*
* Issuance is bounded so the mint endpoint can't be turned into memory or CPU
* exhaustion: tickets that are never spent live at most one TTL, a full store
* rejects instead of growing, and each agent has a request allowance. Expiry is
* swept from the front of the insertion-ordered map, so cleanup costs the
* number of entries actually expired rather than a scan of every outstanding
* ticket per request.
*/
var UpgradeTicketStore = class {
	#tickets = /* @__PURE__ */ new Map();
	#issuance = /* @__PURE__ */ new Map();
	#now;
	constructor(now = () => Date.now()) {
		this.#now = now;
	}
	/**
	* Issue a ticket bound to one agent and thread. Returns `{ ok: false }` when
	* the agent exceeded its allowance or the store is at capacity.
	*/
	issue(agentId, threadId, ttlMs = UPGRADE_TICKET_TTL_MS) {
		const now = this.#now();
		this.#prune(now);
		if (this.#tickets.size >= 500) return {
			ok: false,
			reason: "capacity"
		};
		const window = this.#issuance.get(agentId);
		if (!window || now - window.windowStart >= 6e4) this.#trackIssuance(agentId, {
			windowStart: now,
			count: 0
		});
		else if (window.count >= 30) return {
			ok: false,
			reason: "rate-limited"
		};
		this.#issuance.get(agentId).count += 1;
		const ticket = createTicketValue();
		this.#tickets.set(ticket, {
			agentId,
			threadId,
			expiresAt: now + ttlMs
		});
		return {
			ok: true,
			ticket,
			expiresIn: Math.ceil(ttlMs / 1e3)
		};
	}
	/**
	* Spend a ticket. Returns `true` only when the ticket is unexpired and was
	* issued for this exact agent and thread, in which case it is consumed and a
	* second presentation fails.
	*/
	consume(ticket, agentId, threadId) {
		const entry = this.#tickets.get(ticket);
		if (!entry) return false;
		if (entry.expiresAt <= this.#now()) return false;
		if (entry.agentId !== agentId) return false;
		if ((entry.threadId ?? void 0) !== (threadId ?? void 0)) return false;
		this.#tickets.delete(ticket);
		return true;
	}
	/**
	* Drop expired tickets from the front of the insertion-ordered map. Tickets
	* are inserted in issue order and share a TTL, so the entries after the first
	* live one are live too and the sweep can stop there.
	*/
	#prune(now) {
		for (const [ticket, entry] of this.#tickets) {
			if (entry.expiresAt > now) break;
			this.#tickets.delete(ticket);
		}
	}
	/** Record an issuance window, evicting the oldest counter when at the cap. */
	#trackIssuance(agentId, window) {
		this.#issuance.delete(agentId);
		this.#issuance.set(agentId, window);
		if (this.#issuance.size > MAX_TRACKED_AGENTS) {
			const oldest = this.#issuance.keys().next().value;
			if (oldest !== void 0) this.#issuance.delete(oldest);
		}
	}
};
const TICKET_BODY_MAX_BYTES = 4096;
/**
* Resolve an `allowedOrigins` value against the request's `Origin` header.
*
* Mirrors Hono's `cors.origin` semantics so the same config value means the same
* thing on the upgrade as it does on the HTTP routes: `'*'` allows everything,
* array entries match literally, and a callback is only an approval when it
* returns the request's own origin (the value Hono would echo back) or `'*'`.
*/
async function isOriginAllowed(allowedOrigins, origin, c) {
	if (Array.isArray(allowedOrigins)) return allowedOrigins.includes(origin);
	if (typeof allowedOrigins === "function") {
		const allowed = await allowedOrigins(origin, c);
		return allowed === origin || allowed === "*";
	}
	return allowedOrigins === "*" || allowedOrigins === origin;
}
/**
* Is the `Origin` header the server's own origin?
*
* A Studio served by this server connects back to the same host, and operators
* don't add their own origin to a CORS allowlist because same-origin requests
* never needed CORS. Comparing hosts (rather than scheme + host) keeps that
* working behind TLS-terminating proxies, where the server sees `http` while the
* browser sends `https`.
*/
function isSameOrigin(origin, requestHost) {
	if (!requestHost) return false;
	let originHost;
	try {
		originHost = new URL(origin).host;
	} catch {
		return false;
	}
	const host = (requestHost.split(",")[0] ?? "").trim();
	return originHost !== "" && originHost.toLowerCase() === host.toLowerCase();
}
/**
* Set up WebSocket-based browser stream endpoint for real-time screencast viewing.
*
* Creates a WebSocket route at `/browser/:agentId/stream` that:
* - Accepts viewer connections
* - Starts screencast when first viewer connects
* - Broadcasts frames to all connected viewers
* - Stops screencast when last viewer disconnects
*
* All routes are authenticated with the server's auth configuration. Browsers
* cannot attach an `Authorization` header to a WebSocket upgrade, so
* session-cookie providers authenticate from the upgrade request's cookies.
* Clients that authenticate with a header token instead request a short-lived,
* single-use ticket from `POST ${apiPrefix}/agents/:agentId/browser/stream-ticket`
* and pass it to the upgrade as `?ticket=`, which keeps the reusable credential
* out of the URL. Non-browser clients can pass the token as the `apiKey` query
* parameter — use a short-lived token, since a URL can be retained in proxy and
* access logs, and prefer the `Authorization` header on the HTTP routes where the
* client can set one.
*
* **Note**: Requires `ws` package to be installed. If not available, returns null
* and logs a warning. Browser streaming will be disabled but everything else works.
*
* @param app - The Hono application instance
* @param config - Configuration for browser stream
* @returns Object containing injectWebSocket function and registry instance, or null if ws is not available
*
* @example
* ```typescript
* import { Hono } from 'hono';
* import { serve } from '@hono/node-server';
* import { setupBrowserStream } from '@mastra/hono';
*
* const app = new Hono();
* const browserStream = await setupBrowserStream(app, {
*   mastra,
*   getToolset: (agentId) => browserToolsets.get(agentId),
* });
*
* const server = serve({ fetch: app.fetch, port: 4111 });
* browserStream?.injectWebSocket(server);
* ```
*/
async function setupBrowserStream(app, config) {
	let createNodeWebSocket;
	try {
		createNodeWebSocket = (await import(
			/* @vite-ignore */
			/* webpackIgnore: true */
			'./dist.mjs'
)).createNodeWebSocket;
	} catch {
		return null;
	}
	const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });
	const registry = new ViewerRegistry();
	const rawPrefix = config.apiPrefix ?? "/api";
	const apiPrefix = (rawPrefix.endsWith("/") ? rawPrefix.slice(0, -1) : rawPrefix) || "/api";
	const authenticate = createAuthMiddleware({ mastra: config.mastra });
	const upgradeTickets = new UpgradeTicketStore();
	const authorizeUpgrade = async (c, next) => {
		const ticket = c.req.query("ticket");
		if (!ticket) return authenticate(c, next);
		const agentId = c.req.param("agentId");
		if (!upgradeTickets.consume(ticket, agentId, c.req.query("threadId"))) return c.json({ error: "Invalid or expired upgrade ticket" }, 401);
		return next();
	};
	const allowedOrigins = config.allowedOrigins;
	const checkOrigin = async (c, next) => {
		const origin = c.req.header("origin");
		if (!allowedOrigins || !origin) return next();
		if (isSameOrigin(origin, c.req.header("x-forwarded-host") ?? c.req.header("host"))) return next();
		if (!await isOriginAllowed(allowedOrigins, origin, c)) return c.text("Forbidden", 403);
		return next();
	};
	app.get("/browser/:agentId/stream", checkOrigin, authorizeUpgrade, upgradeWebSocket((c) => {
		const agentId = c.req.param("agentId");
		const threadId = c.req.query("threadId");
		const viewerKey = threadId ? `${agentId}:${threadId}` : agentId;
		return {
			onOpen(_event, ws) {
				ws.send(JSON.stringify({ status: "connected" }));
				registry.addViewer(viewerKey, ws, config.getToolset, agentId, threadId);
			},
			onMessage(event, _ws) {
				const data = typeof event.data === "string" ? event.data : null;
				if (data) handleInputMessage(data, config.getToolset, agentId, threadId);
			},
			onClose(_event, ws) {
				registry.removeViewer(viewerKey, ws);
			},
			onError(event, ws) {
				console.error("[BrowserStream] WebSocket error:", event);
				registry.removeViewer(viewerKey, ws);
			}
		};
	}));
	const ticketBodyLimit = bodyLimit({
		maxSize: TICKET_BODY_MAX_BYTES,
		onError: (c) => c.json({ error: "Request body too large" }, 413)
	});
	app.post(`${apiPrefix}/agents/:agentId/browser/stream-ticket`, authenticate, ticketBodyLimit, async (c) => {
		const agentId = c.req.param("agentId");
		if (!agentId) return c.json({ error: "Agent ID is required" }, 400);
		let threadId = c.req.query("threadId");
		try {
			const body = await c.req.json();
			if (!threadId && typeof body?.threadId === "string") threadId = body.threadId;
		} catch {}
		const issued = upgradeTickets.issue(agentId, threadId);
		if (!issued.ok) {
			const error = issued.reason === "capacity" ? "Too many outstanding browser stream upgrade tickets" : "Too many browser stream upgrade tickets requested";
			return c.json({ error }, 429);
		}
		return c.json({
			ticket: issued.ticket,
			expiresIn: issued.expiresIn
		});
	});
	app.get(`${apiPrefix}/agents/:agentId/browser/session`, authenticate, async (c) => {
		const agentId = c.req.param("agentId");
		if (!agentId) return c.json({ error: "Agent ID is required" }, 400);
		const threadId = c.req.query("threadId");
		const toolset = await config.getToolset(agentId);
		if (!toolset) return c.json({
			hasSession: false,
			screencastAvailable: true
		});
		const hasSession = threadId ? toolset.hasThreadSession(threadId) : false;
		return c.json({
			hasSession,
			screencastAvailable: true
		});
	});
	app.post(`${apiPrefix}/agents/:agentId/browser/close`, authenticate, ticketBodyLimit, async (c) => {
		const agentId = c.req.param("agentId");
		if (!agentId) return c.json({ error: "Agent ID is required" }, 400);
		const toolset = await config.getToolset(agentId);
		if (!toolset) return c.json({ error: "No browser session for this agent" }, 404);
		try {
			let threadId;
			try {
				threadId = (await c.req.json())?.threadId;
			} catch {}
			const scope = toolset.getScope();
			const viewerKey = threadId ? `${agentId}:${threadId}` : agentId;
			if (scope === "thread" && threadId) {
				await registry.closeBrowserSession(viewerKey);
				if ("closeThreadSession" in toolset && typeof toolset.closeThreadSession === "function") await toolset.closeThreadSession(threadId);
			} else {
				await registry.closeBrowserSession(viewerKey);
				await toolset.close();
			}
			return c.json({ success: true });
		} catch (error) {
			console.error(`[BrowserStream] Error closing browser for ${agentId}:`, error);
			return c.json({ error: "Failed to close browser" }, 500);
		}
	});
	return {
		injectWebSocket,
		registry
	};
}
/**
* Wrap a Hono middleware handler so it becomes a no-op for framework-public
* routes (routes registered with `requiresAuth: false`).
*
* Adapters that expose user-provided middleware — for example `serverMiddleware`
* on the Mastra instance or `server.middleware` in Mastra config — MUST wrap
* those handlers with this before registering them. This is the framework's
* guarantee that user middleware cannot accidentally (or intentionally) 401
* routes the framework needs to keep reachable (e.g. Studio sign-in endpoints).
*
* The framework-public flag is computed once per request by
* {@link MastraServer.registerContextMiddleware} and stashed on the Hono
* context under `MASTRA_FRAMEWORK_PUBLIC_KEY`.
*/
const skipIfFrameworkPublic = (handler) => {
	return async (c, next) => {
		if (c.get(MASTRA_FRAMEWORK_PUBLIC_KEY)) return next();
		return handler(c, next);
	};
};
/**
* Context key holding a pristine clone of the incoming request, captured by
* the context middleware before user middleware runs. The custom-route bridge
* reads the body from this clone so user middleware that consumes the request
* body (e.g. `await c.req.json()`) does not break custom API routes.
*/
const MASTRA_PRISTINE_REQUEST_KEY = "__mastraPristineRequest";
const BODY_METHODS = /* @__PURE__ */ new Set([
	"POST",
	"PUT",
	"PATCH",
	"DELETE"
]);
/**
* Cancels a response body the runtime never started reading once the request aborts. @hono/node-server skips the body
* of a request that closed while the route handler ran without cancelling it. A body the runtime already reads is
* locked, and the runtime cancels that one itself on disconnect.
*
* `body` is only read after the abort: reading it earlier turns off @hono/node-server's fast path for string and byte
* bodies, which is what sets `Content-Length` and the default content type.
*/
function cancelUnreadBodyOnAbort(response, signal) {
	const cancel = () => {
		let body;
		try {
			body = response.body;
		} catch {
			return;
		}
		if (body && !body.locked) body.cancel("request aborted").catch(() => {});
	};
	if (signal.aborted) cancel();
	else signal.addEventListener("abort", cancel, { once: true });
}
const requestClones = /* @__PURE__ */ new WeakMap();
/**
* Clones a request and keeps the clone alive for as long as the request itself. Node 22 makes a request's body
* unreadable once a clone of it is garbage collected, which loses the body for anything that reads the original
* later, such as the MCP transport.
*/
function cloneRequest(request) {
	const clone = request.clone();
	const clones = requestClones.get(request);
	if (clones) clones.push(clone);
	else requestClones.set(request, [clone]);
	return clone;
}
var MastraServer$2 = class extends MastraServer {
	createContextMiddleware() {
		return async (c, next) => {
			if (this.hasCustomRouteHandler && BODY_METHODS.has(c.req.method) && c.req.raw.body) c.set(MASTRA_PRISTINE_REQUEST_KEY, c.req.raw.clone());
			const originalJson = c.req.json.bind(c.req);
			let jsonPromise;
			c.req.json = () => {
				if (!jsonPromise) jsonPromise = originalJson().then((body) => {
					c.set("cachedBody", body);
					return body;
				});
				return jsonPromise;
			};
			let bodyRequestContext;
			let paramsRequestContext;
			if (c.req.method === "POST" || c.req.method === "PUT") {
				const contentType = c.req.header("content-type");
				const contentLength = c.req.header("content-length");
				if (contentType?.includes("application/json") && contentLength !== "0") try {
					const body = await cloneRequest(c.req.raw).json();
					if (body.requestContext) bodyRequestContext = body.requestContext;
				} catch {}
			}
			if (c.req.method === "GET" || c.req.method === "POST") try {
				const encodedRequestContext = c.req.query("requestContext");
				if (encodedRequestContext) try {
					paramsRequestContext = JSON.parse(encodedRequestContext);
				} catch {
					try {
						const json = Buffer.from(encodedRequestContext, "base64").toString("utf-8");
						paramsRequestContext = JSON.parse(json);
					} catch {}
				}
			} catch {}
			const requestContext = this.mergeRequestContext({
				paramsRequestContext,
				bodyRequestContext
			});
			this.applyRequestMetadataToContext({
				requestContext,
				getHeader: (name) => c.req.header(name)
			});
			c.set("requestContext", requestContext);
			c.set("mastra", this.mastra);
			c.set("registeredTools", this.tools || {});
			c.set("taskStore", this.taskStore);
			c.set("abortSignal", c.req.raw.signal);
			c.set("customRouteAuthConfig", this.customRouteAuthConfig);
			return next();
		};
	}
	async stream(route, res, result) {
		const streamFormat = route.streamFormat || "stream";
		if (streamFormat === "sse") {
			res.header("Content-Type", "text/event-stream");
			res.header("Cache-Control", "no-cache");
			res.header("Connection", "keep-alive");
			res.header("X-Accel-Buffering", "no");
		} else res.header("Content-Type", "text/plain");
		res.header("Transfer-Encoding", "chunked");
		return stream(res, async (stream) => {
			const reader = (result instanceof ReadableStream ? result : result.fullStream).getReader();
			stream.onAbort(() => {
				reader.cancel("request aborted").catch(() => {});
			});
			const signal = res.req.raw.signal;
			const abortStream = () => stream.abort();
			if (signal.aborted) abortStream();
			else signal.addEventListener("abort", abortStream, { once: true });
			try {
				if (streamFormat === "sse" && route.sseFlushOnConnect) await stream.write(": connected\n\n");
				while (true) {
					const { done, value } = await reader.read();
					if (done) break;
					if (value) {
						if (streamFormat === "sse" && typeof value === "string" && value.startsWith(":")) {
							await stream.write(value);
							continue;
						}
						const outputValue = this.streamOptions?.redact ?? true ? redactStreamChunk(value) : value;
						const serialized = serializeStreamChunk(outputValue);
						if (!serialized.ok) {
							this.mastra.getLogger()?.error("Failed to serialize stream chunk, skipping", {
								path: route.path,
								chunkType: outputValue?.type,
								error: serialized.error.message
							});
							continue;
						}
						if (streamFormat === "sse") await stream.write(`data: ${serialized.json}\n\n`);
						else await stream.write(serialized.json + "");
					}
				}
				if (streamFormat === "sse") await stream.write("data: [DONE]\n\n");
			} catch (error) {
				this.mastra.getLogger()?.error("Error in stream processing", { error: error instanceof Error ? {
					message: error.message,
					stack: error.stack
				} : error });
			} finally {
				signal.removeEventListener("abort", abortStream);
				await stream.close();
			}
		}, async (err) => {
			this.mastra.getLogger()?.error("Stream error callback", { error: err instanceof Error ? {
				message: err.message,
				stack: err.stack
			} : err });
		});
	}
	async getParams(route, request) {
		const urlParams = request.param();
		const queryParams = normalizeQueryParams(request.queries());
		let body;
		let bodyParseError;
		if (route.method === "POST" || route.method === "PUT" || route.method === "PATCH" || route.method === "DELETE") {
			const contentType = request.header("content-type") || "";
			if (contentType.includes("multipart/form-data")) try {
				const formData = await request.formData();
				body = await this.parseFormData(formData);
			} catch (error) {
				this.mastra.getLogger()?.error("Failed to parse multipart form data", { error: error instanceof Error ? {
					message: error.message,
					stack: error.stack
				} : error });
				if (error instanceof Error && error.message.toLowerCase().includes("size")) throw error;
				bodyParseError = { message: error instanceof Error ? error.message : "Failed to parse multipart form data" };
			}
			else if (contentType.includes("application/json")) {
				const bodyText = await cloneRequest(request.raw).text();
				if (bodyText && bodyText.trim().length > 0) try {
					body = JSON.parse(bodyText);
				} catch (error) {
					this.mastra.getLogger()?.error("Failed to parse JSON body", { error: error instanceof Error ? {
						message: error.message,
						stack: error.stack
					} : error });
					bodyParseError = { message: error instanceof Error ? error.message : "Invalid JSON in request body" };
				}
			}
		}
		return {
			urlParams,
			queryParams,
			body,
			bodyParseError
		};
	}
	/**
	* Parse FormData into a plain object, converting File objects to Buffers.
	*/
	async parseFormData(formData) {
		const result = {};
		for (const [key, value] of formData.entries()) {
			if (!isSafeObjectKey(key)) continue;
			if (value instanceof File) {
				const arrayBuffer = await value.arrayBuffer();
				result[key] = Buffer.from(arrayBuffer);
			} else if (typeof value === "string") try {
				result[key] = JSON.parse(value);
			} catch {
				result[key] = value;
			}
			else result[key] = value;
		}
		return result;
	}
	/** Adapter `mcpOptions` win; otherwise use `server.mcpOptions` from the Mastra config. */
	resolveMcpOptions() {
		return this.mcpOptions ?? this.mastra.getServer()?.mcpOptions;
	}
	async sendResponse(route, response, result, prefix) {
		const resolvedPrefix = prefix ?? this.prefix ?? "";
		if (result && typeof result === "object" && "__refreshHeaders" in result) {
			const refreshHeaders = result.__refreshHeaders;
			for (const [key, value] of Object.entries(refreshHeaders)) response.header(key, value);
			delete result.__refreshHeaders;
		}
		if (route.responseType === "json") return response.json(result, 200);
		else if (route.responseType === "stream") return this.stream(route, response, result);
		else if (route.responseType === "datastream-response") {
			const fetchResponse = result;
			cancelUnreadBodyOnAbort(fetchResponse, response.req.raw.signal);
			return fetchResponse;
		} else if (route.responseType === "mcp-http") {
			const { server, httpPath, mcpOptions: routeMcpOptions } = result;
			const { req, res } = toReqRes(response.req.raw);
			const { setRequestAuth, ...options } = {
				...this.resolveMcpOptions(),
				...routeMcpOptions
			};
			await applyMcpRequestAuth({
				req,
				requestContext: response.get("requestContext"),
				setRequestAuth
			});
			server.startHTTP({
				url: new URL(response.req.url),
				httpPath: `${resolvedPrefix}${httpPath}`,
				req,
				res,
				options: Object.keys(options).length > 0 ? options : void 0
			}).catch((e) => {
				this.mastra.getLogger()?.error("[MCP HTTP] Error in background startHTTP:", { error: e instanceof Error ? {
					message: e.message,
					stack: e.stack
				} : e });
				try {
					if (!res.headersSent) {
						res.writeHead(500, { "Content-Type": "application/json" });
						res.end(JSON.stringify({
							jsonrpc: "2.0",
							error: {
								code: -32603,
								message: "Internal server error"
							},
							id: null
						}));
					}
				} catch {}
			});
			propagateRequestAbort(response.req.raw.signal, res);
			return propagateClientDisconnect(await toFetchResponse(res), res);
		} else if (route.responseType === "mcp-sse") {
			const { server, ssePath, messagePath } = result;
			try {
				const { req } = toReqRes(response.req.raw);
				await applyMcpRequestAuth({
					req,
					requestContext: response.get("requestContext"),
					setRequestAuth: this.resolveMcpOptions()?.setRequestAuth
				});
				return await server.startHonoSSE({
					url: new URL(response.req.url),
					ssePath: `${resolvedPrefix}${ssePath}`,
					messagePath: `${resolvedPrefix}${messagePath}`,
					context: response,
					authInfo: req.auth
				});
			} catch {
				return response.json({ error: "Error handling MCP SSE request" }, 500);
			}
		} else return response.status(500);
	}
	async registerRoute(app, route, { prefix: prefixParam } = {}) {
		const prefix = prefixParam ?? this.prefix ?? "";
		const maxSize = route.maxBodySize ?? this.bodyLimitOptions?.maxSize;
		const isBodyMethod = [
			"POST",
			"PUT",
			"PATCH",
			"DELETE"
		].includes(route.method.toUpperCase());
		const middlewares = [];
		if (isBodyMethod && maxSize !== void 0) middlewares.push(bodyLimit({
			maxSize,
			onError: (c) => {
				let errorResponse = { error: "Request body too large" };
				if (route.maxBodySize === void 0 && this.bodyLimitOptions) try {
					errorResponse = this.bodyLimitOptions.onError(errorResponse);
				} catch {}
				return c.json(errorResponse, 413);
			}
		}));
		app[route.method.toLowerCase()](`${prefix}${route.path}`, ...middlewares, async (c) => {
			const authResult = await this.checkRouteAuth(route, {
				path: c.req.path,
				method: c.req.method,
				getHeader: (name) => c.req.header(name),
				getQuery: (name) => c.req.query(name),
				requestContext: c.get("requestContext"),
				request: c.req.raw,
				buildAuthorizeContext: () => c
			});
			if (authResult) {
				if (authResult.headers) for (const [key, value] of Object.entries(authResult.headers)) c.header(key, value);
				if (authResult.error) return c.json({ error: authResult.error }, authResult.status);
			}
			const params = await this.getParams(route, c.req);
			if (params.bodyParseError) return c.json({
				error: "Invalid request body",
				issues: [{
					field: "body",
					message: params.bodyParseError.message
				}]
			}, 400);
			if (params.queryParams) try {
				params.queryParams = await this.parseQueryParams(route, params.queryParams);
			} catch (error) {
				this.mastra.getLogger()?.error("Error parsing query params", { error: error instanceof Error ? {
					message: error.message,
					stack: error.stack
				} : error });
				if (isZodError(error)) {
					const { status, body } = this.resolveValidationError(route, error, "query");
					return c.json(body, status);
				}
				return c.json({
					error: "Invalid query parameters",
					issues: [{
						field: "unknown",
						message: error instanceof Error ? error.message : "Unknown error"
					}]
				}, 400);
			}
			if (params.body !== void 0 || route.bodySchema) try {
				params.body = await this.parseBody(route, params.body);
			} catch (error) {
				this.mastra.getLogger()?.error("Error parsing body", { error: error instanceof Error ? {
					message: error.message,
					stack: error.stack
				} : error });
				if (isZodError(error)) {
					const { status, body } = this.resolveValidationError(route, error, "body");
					return c.json(body, status);
				}
				return c.json({
					error: "Invalid request body",
					issues: [{
						field: "unknown",
						message: error instanceof Error ? error.message : "Unknown error"
					}]
				}, 400);
			}
			if (params.urlParams) try {
				params.urlParams = await this.parsePathParams(route, params.urlParams);
			} catch (error) {
				this.mastra.getLogger()?.error("Error parsing path params", { error: error instanceof Error ? {
					message: error.message,
					stack: error.stack
				} : error });
				if (isZodError(error)) {
					const { status, body } = this.resolveValidationError(route, error, "path");
					return c.json(body, status);
				}
				return c.json({
					error: "Invalid path parameters",
					issues: [{
						field: "unknown",
						message: error instanceof Error ? error.message : "Unknown error"
					}]
				}, 400);
			}
			const handlerParams = {
				...params.urlParams,
				...params.queryParams,
				...typeof params.body === "object" ? params.body : {},
				requestContext: c.get("requestContext"),
				mastra: this.mastra,
				registeredTools: c.get("registeredTools"),
				taskStore: c.get("taskStore"),
				abortSignal: c.get("abortSignal"),
				routePrefix: prefix,
				request: c.req.raw
			};
			const authzError = await this.authorizeRoute(route, {
				...params.urlParams,
				...params.queryParams,
				...typeof params.body === "object" ? params.body : {}
			}, c.get("requestContext"));
			if (authzError) return c.json({
				error: authzError.error,
				message: authzError.message
			}, authzError.status);
			try {
				const result = await route.handler(handlerParams);
				return this.sendResponse(route, c, result, prefix);
			} catch (error) {
				const httpStatus = error && typeof error === "object" ? error.status ?? error.details?.status : void 0;
				if (!(typeof httpStatus === "number" && httpStatus >= 400 && httpStatus < 500)) {
					const logLevel = httpStatus === 501 ? "warn" : "error";
					this.mastra.getLogger()?.[logLevel]("Error calling handler", {
						error: error instanceof Error ? {
							message: error.message,
							stack: error.stack
						} : error,
						path: route.path,
						method: route.method
					});
				}
				const customResponse = getCustomHTTPExceptionResponse(error);
				if (customResponse) return customResponse;
				const { status, body } = getHTTPErrorResponse(error);
				return c.json(body, status);
			}
		});
	}
	async registerCustomApiRoutes() {
		const routes = await this.registerSchemaApiRoutes();
		if (!await this.buildCustomRouteHandler(routes)) return;
		for (const route of routes) {
			const routeHandler = async (c) => {
				const { match, serverRoute, customRouteAuthConfig } = this.resolveCustomRouteAuth(c.req.url, c.req.method, c.req.path, route);
				const authError = await this.checkRouteAuth(serverRoute, {
					path: c.req.path,
					method: c.req.method,
					getHeader: (name) => c.req.header(name),
					getQuery: (name) => c.req.query(name),
					requestContext: c.get("requestContext"),
					request: c.req.raw,
					buildAuthorizeContext: () => c,
					customRouteAuthConfig
				});
				if (authError) {
					if (authError.headers) for (const [key, value] of Object.entries(authError.headers)) c.header(key, value);
					if (authError.error) return c.json({ error: authError.error }, authError.status);
				}
				const permissionError = this.checkRouteRBAC(serverRoute, c.get("requestContext"));
				if (permissionError) return c.json({
					error: permissionError.error,
					message: permissionError.message
				}, permissionError.status);
				const pristineRequest = c.get(MASTRA_PRISTINE_REQUEST_KEY) ?? c.req.raw;
				let bodyParams = {};
				if (getFGAProvider(this.mastra, c.get("requestContext"))) {
					const contentType = c.req.header("content-type");
					if (contentType?.includes("application/json")) try {
						const body = await pristineRequest.clone().json();
						if (body && typeof body === "object" && !Array.isArray(body)) bodyParams = body;
					} catch {
						bodyParams = {};
					}
					else if (contentType?.includes("application/x-www-form-urlencoded") || contentType?.includes("multipart/form-data")) try {
						bodyParams = Object.fromEntries(await pristineRequest.clone().formData());
					} catch {
						bodyParams = {};
					}
				}
				const fgaError = await checkRouteFGA(this.mastra, serverRoute, c.get("requestContext"), {
					...Object.fromEntries(new URL(c.req.url).searchParams.entries()),
					...bodyParams,
					...match ? match.params : c.req.param()
				});
				if (fgaError) return c.json({
					error: fgaError.error,
					message: fgaError.message
				}, fgaError.status);
				const reqHeaders = {};
				c.req.raw.headers.forEach((v, k) => {
					reqHeaders[k] = v;
				});
				let executionCtx;
				try {
					executionCtx = c.executionCtx;
				} catch {
					executionCtx = void 0;
				}
				const response = await this.handleCustomRouteRequest(c.req.url, c.req.method, reqHeaders, pristineRequest.body, c.get("requestContext"), c.req.raw.signal, executionCtx);
				if (!response) return c.json({ error: "Not Found" }, 404);
				return response;
			};
			const method = route.method.toLowerCase();
			this.app[method](route.path, routeHandler);
		}
	}
	registerContextMiddleware() {
		const isFrameworkPublic = this.getFrameworkPublicMatcher();
		this.app.use("*", this.createContextMiddleware());
		this.app.use("*", async (c, next) => {
			c.set(MASTRA_FRAMEWORK_PUBLIC_KEY, isFrameworkPublic(c.req.path, c.req.method));
			return next();
		});
		this.app.use("*", async (c, next) => {
			await next();
			this.warnIfUnregisteredChannelWebhook(c.req.path, c.req.method, c.res.status);
		});
	}
	registerAuthMiddleware() {}
	registerUserMiddleware() {
		for (const m of this.mastra.getServerMiddleware?.() ?? []) this.app.use(m.path, skipIfFrameworkPublic(m.handler));
		const configMiddleware = this.mastra.getServer()?.middleware;
		if (!configMiddleware) return;
		const normalizedMiddlewares = Array.isArray(configMiddleware) ? configMiddleware : [configMiddleware];
		for (const middleware of normalizedMiddlewares) {
			const { path, handler } = typeof middleware === "function" ? {
				path: "*",
				handler: middleware
			} : middleware;
			this.app.use(path, skipIfFrameworkPublic(handler));
		}
	}
	registerHttpLoggingMiddleware() {
		if (!this.httpLoggingConfig?.enabled) return;
		this.app.use("*", async (c, next) => {
			if (!this.shouldLogRequest(c.req.path)) return next();
			const start = Date.now();
			const method = c.req.method;
			const path = c.req.path;
			await next();
			const duration = Date.now() - start;
			const status = c.res.status;
			const level = this.httpLoggingConfig?.level || "info";
			const logData = {
				method,
				path,
				status,
				duration: `${duration}ms`
			};
			if (this.httpLoggingConfig?.includeQueryParams) logData.query = c.req.query();
			if (this.httpLoggingConfig?.includeHeaders) {
				const headers = Object.fromEntries(c.req.raw.headers.entries());
				(this.httpLoggingConfig.redactHeaders || []).forEach((h) => {
					const key = h.toLowerCase();
					if (headers[key] !== void 0) headers[key] = "[REDACTED]";
				});
				logData.headers = headers;
			}
			this.logger[level](`${method} ${path} ${status} ${duration}ms`, logData);
		});
	}
};
// ../../../../../setup-pnpm/node_modules/.bin/store/v11/links/@/hono-openapi/1.5.0/6ca93514d06afdfd0d7befe948e629b04e66fbf3f0241f2ac71dd8ec9b8121b7/node_modules/hono-openapi/dist/index.js
const uniqueSymbol = Symbol.for("hono-openapi");
function describeRoute(spec) {
	const middleware = async (_c, next) => {
		await next();
	};
	Object.defineProperty(middleware, "name", {
		value: "describeRoute",
		configurable: true
	});
	return Object.assign(middleware, { [uniqueSymbol]: { spec } });
}
// src/server/handlers/agent-learning.ts
const DEFAULT_AGENT_LEARNING_ENDPOINT = "https://output.signals.mastra.ai";
const AGENT_LEARNING_TIMEOUT_MS = 8e3;
const LOOPBACK_HOSTS = /* @__PURE__ */ new Set([
	"localhost",
	"127.0.0.1",
	"[::1]"
]);
async function agentLearningProxyHandler(c) {
	const requestUrl = new URL(c.req.url);
	if (!LOOPBACK_HOSTS.has(requestUrl.hostname)) return c.json({ error: "Agent Learning development proxy is only available on loopback hosts" }, 403);
	const origin = c.req.header("Origin");
	if (origin && origin !== requestUrl.origin) return c.json({ error: "Cross-origin Agent Learning requests are not allowed" }, 403);
	const accessToken = process$1.env.MASTRA_PLATFORM_ACCESS_TOKEN;
	const projectId = process$1.env.MASTRA_PROJECT_ID;
	if (!accessToken || !projectId) return c.json({ error: "MASTRA_PLATFORM_ACCESS_TOKEN and MASTRA_PROJECT_ID are required for Agent Learning" }, 503);
	const endpoint = process$1.env.MASTRA_PLATFORM_AGENT_LEARNING_ENDPOINT || DEFAULT_AGENT_LEARNING_ENDPOINT;
	let upstreamUrl;
	try {
		upstreamUrl = new URL(`${requestUrl.pathname}${requestUrl.search}`, `${endpoint.replace(/\/+$/, "")}/`);
	} catch {
		return c.json({ error: "MASTRA_PLATFORM_AGENT_LEARNING_ENDPOINT must be a valid URL" }, 503);
	}
	try {
		const upstream = await fetch(upstreamUrl, {
			method: "GET",
			headers: {
				Accept: c.req.header("Accept") || "application/json",
				Authorization: `Bearer ${accessToken}`,
				"X-Mastra-Project-Id": projectId
			},
			signal: AbortSignal.timeout(AGENT_LEARNING_TIMEOUT_MS)
		});
		const headers = new Headers();
		const contentType = upstream.headers.get("content-type");
		const cacheControl = upstream.headers.get("cache-control");
		if (contentType) headers.set("content-type", contentType);
		if (cacheControl) headers.set("cache-control", cacheControl);
		return new Response(upstream.body, {
			status: upstream.status,
			statusText: upstream.statusText,
			headers
		});
	} catch {
		return c.json({ error: "Agent Learning upstream unavailable" }, 502);
	}
}
// src/server/handlers/client.ts
const clients = /* @__PURE__ */ new Set();
let hotReloadDisabled = false;
function handleClientsRefreshRequest(abortSignal, devServerInstanceId) {
	const stream = new ReadableStream({ start(controller) {
		clients.add(controller);
		controller.enqueue(`${devServerInstanceId ? `id: ${devServerInstanceId}\n` : ""}data: connected\n\n`);
		abortSignal.addEventListener("abort", () => {
			clients.delete(controller);
		});
	} });
	return new Response(stream, { headers: {
		"Content-Type": "text/event-stream",
		"Cache-Control": "no-cache",
		Connection: "keep-alive"
	} });
}
/**
* End every open refresh SSE stream. Studio keeps one of these connections
* open for its whole lifetime, so without this the graceful-shutdown drain
* would wait on them until the drain deadline (stalling `mastra dev` hot
* reloads while Studio is open).
*/
function closeRefreshStreams() {
	clients.forEach((controller) => {
		try {
			controller.close();
		} catch {}
	});
	clients.clear();
}
function getTriggerClientsRefreshPayload() {
	clients.forEach((controller) => {
		try {
			controller.enqueue("data: refresh\n\n");
		} catch {
			clients.delete(controller);
		}
	});
	return {
		success: true,
		clients: clients.size
	};
}
function isHotReloadDisabled() {
	return hotReloadDisabled;
}
// src/server/handlers/error.ts
function handleError(error, defaultMessage) {
	const apiError = error;
	throw new HTTPException(apiError.status || 500, {
		message: apiError.message || defaultMessage,
		cause: apiError.cause
	});
}
function errorHandler(err, c, isDev) {
	if (err instanceof HTTPException) {
		if (isDev) return c.json({
			error: err.message,
			cause: err.cause,
			stack: err.stack
		}, err.status);
		return c.json({ error: err.message }, err.status);
	}
	c.get("mastra").getLogger().error(err);
	return c.json({ error: "Internal Server Error" }, 500);
}
// src/server/handlers/health.ts
async function healthHandler(c) {
	return c.json({ success: true }, 200);
}
// src/server/handlers/restart-active-runs.ts
async function restartAllActiveWorkflowRunsHandler(c) {
	try {
		const mastra = c.get("mastra");
		if (mastra.recoveryConfig?.workflows !== "off") mastra.restartAllActiveWorkflowRuns().catch((error) => {
			mastra.getLogger().error("Failed to restart active workflow runs during server startup", { error });
		});
		if (mastra.recoveryConfig?.durableAgents === "auto") mastra.recoverAllDurableAgents().catch((error) => {
			mastra.getLogger().error("Failed to recover durable agent runs during server startup", { error });
		});
		return c.json({ message: "Restarting all active workflow runs..." });
	} catch (error) {
		return handleError(error, "Error restarting active workflow runs");
	}
}
// src/server/handlers/root.ts
async function rootHandler(c) {
	const baseUrl = new URL(c.req.url).origin;
	return c.html(`
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Mastra API</title>
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/inter-ui/3.19.3/inter.min.css" />
        <style>
          body {
            margin: 0;
            padding: 0;
            background-color: #0d0d0d;
            color: #ffffff;
            font-family:
              'Inter',
              -apple-system,
              BlinkMacSystemFont,
              system-ui,
              sans-serif;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
          }

          main {
            flex: 1;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 2rem;
            text-align: center;
          }

          h1 {
            font-size: 4rem;
            font-weight: 600;
            margin: 0 0 1rem 0;
            background: linear-gradient(to right, #fff, #ccc);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            line-height: 1.2;
          }

          .subtitle {
            color: #9ca3af;
            font-size: 1.25rem;
            max-width: 600px;
            margin: 0 auto 3rem auto;
            line-height: 1.6;
          }

          .link {
            color: #ffffff;
          }

          .link:hover {
            text-decoration: none;
          }

          .docs-link {
            background-color: #1a1a1a;
            padding: 1rem 2rem;
            border-radius: 0.5rem;
            display: flex;
            align-items: center;
            gap: 1rem;
            font-family: monospace;
            font-size: 1rem;
            color: #ffffff;
            text-decoration: none;
            transition: background-color 0.2s;
          }

          .docs-link:hover {
            background-color: #252525;
          }

          .arrow-icon {
            transition: transform 0.2s;
          }

          .docs-link:hover .arrow-icon {
            transform: translateX(4px);
          }
        </style>
      </head>
      <body>
        <main>
          <h1>Welcome to the Mastra API</h1>
          <p class="subtitle">
            Discover all available endpoints through Swagger UI. You can also define your own <a href="https://mastra.ai/docs/server-db/custom-api-routes" target="_blank" class="link">API routes</a>.
          </p>
          <a href="${baseUrl}/swagger-ui" target="_blank" class="docs-link">
            Browse Swagger UI
            <svg
              class="arrow-icon"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </a>
        </main>
      </body>
    </html>
    `);
}
// src/server/welcome.ts
/**
* Trim leading and trailing slashes. Index scan instead of regex to avoid
* backtracking (CodeQL js/polynomial-redos).
*/
function trimSlashes(value) {
	let start = 0;
	let end = value.length;
	while (start < end && value[start] === "/") start++;
	while (end > start && value[end - 1] === "/") end--;
	return value.slice(start, end);
}
function welcomeHtml(apiPrefix = "/api") {
	const prefix = "/" + trimSlashes(apiPrefix);
	const prefixNoSlash = prefix.slice(1);
	return `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Mastra Server</title>
    <style>
      * { box-sizing: border-box; }

      body {
        margin: 0;
        padding: 0;
        background-color: #0a0a0a;
        color: #e4e4e7;
        font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
        min-height: 100vh;
        line-height: 1.6;
      }

      .page {
        max-width: 720px;
        margin: 0 auto;
        padding: 3rem 1.5rem 4rem;
      }

      header {
        margin-bottom: 2.5rem;
      }

      header h1 {
        font-size: 1.75rem;
        font-weight: 600;
        margin: 0 0 0.25rem;
        color: #fff;
      }

      header p {
        color: #71717a;
        font-size: 0.9rem;
        margin: 0;
      }

      .status-bar {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        margin-top: 1rem;
        font-size: 0.8rem;
        color: #a1a1aa;
      }

      .status-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #22c55e;
        flex-shrink: 0;
      }

      section {
        margin-bottom: 2rem;
      }

      section h2 {
        font-size: 0.75rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: #71717a;
        margin: 0 0 0.75rem;
      }

      .card {
        background: #18181b;
        border: 1px solid #27272a;
        border-radius: 8px;
        overflow: hidden;
      }

      .card + .card {
        margin-top: 0.75rem;
      }

      .card-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0.75rem 1rem;
        gap: 0.75rem;
      }

      .card-row + .card-row {
        border-top: 1px solid #27272a;
      }

      .card-row-left {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        min-width: 0;
      }

      .method {
        font-family: 'SF Mono', SFMono-Regular, ui-monospace, Menlo, monospace;
        font-size: 0.7rem;
        font-weight: 600;
        padding: 2px 6px;
        border-radius: 4px;
        flex-shrink: 0;
      }

      .method-get { background: #052e16; color: #4ade80; }
      .method-post { background: #172554; color: #60a5fa; }

      .endpoint-path {
        font-family: 'SF Mono', SFMono-Regular, ui-monospace, Menlo, monospace;
        font-size: 0.8rem;
        color: #d4d4d8;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .endpoint-desc {
        font-size: 0.75rem;
        color: #71717a;
        flex-shrink: 0;
      }

      .curl-block {
        position: relative;
        background: #111113;
        border: 1px solid #27272a;
        border-radius: 8px;
        overflow: hidden;
      }

      .curl-block + .curl-block {
        margin-top: 0.75rem;
      }

      .curl-label {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0.5rem 1rem;
        border-bottom: 1px solid #27272a;
        font-size: 0.75rem;
        color: #a1a1aa;
      }

      .copy-btn {
        background: none;
        border: 1px solid #3f3f46;
        border-radius: 4px;
        color: #a1a1aa;
        font-size: 0.7rem;
        padding: 2px 8px;
        cursor: pointer;
        font-family: inherit;
        transition: all 0.15s;
      }

      .copy-btn:hover {
        background: #27272a;
        color: #e4e4e7;
      }

      .curl-code {
        padding: 0.75rem 1rem;
        font-family: 'SF Mono', SFMono-Regular, ui-monospace, Menlo, monospace;
        font-size: 0.8rem;
        line-height: 1.5;
        color: #d4d4d8;
        overflow-x: auto;
        white-space: pre;
        margin: 0;
      }

      .curl-code .c-cmd { color: #a78bfa; }
      .curl-code .c-flag { color: #60a5fa; }
      .curl-code .c-url { color: #fbbf24; }
      .curl-code .c-str { color: #4ade80; }

      .links-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 0.75rem;
      }

      .link-card {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.875rem 1rem;
        background: #18181b;
        border: 1px solid #27272a;
        border-radius: 8px;
        color: #d4d4d8;
        text-decoration: none;
        font-size: 0.85rem;
        transition: all 0.15s;
      }

      .link-card:hover {
        background: #1f1f23;
        border-color: #3f3f46;
        color: #fff;
      }

      .link-icon {
        flex-shrink: 0;
        width: 18px;
        height: 18px;
        color: #71717a;
      }

      .link-card:hover .link-icon { color: #a1a1aa; }

      footer {
        margin-top: 3rem;
        padding-top: 1.5rem;
        border-top: 1px solid #1c1c1f;
        font-size: 0.75rem;
        color: #52525b;
      }

      @media (max-width: 480px) {
        .page { padding: 2rem 1rem 3rem; }
        header h1 { font-size: 1.5rem; }
        .links-grid { grid-template-columns: 1fr; }
        .endpoint-desc { display: none; }
      }
    </style>
  </head>
  <body>
    <div class="page">
      <header>
        <h1>Mastra Server</h1>
        <p>Your server is running. Use the endpoints below to get started.</p>
        <div class="status-bar">
          <span class="status-dot"></span>
          <span id="base-url"></span>
        </div>
      </header>

      <section>
        <h2>Quick Start</h2>

        <div class="curl-block">
          <div class="curl-label">
            <span>Check server health</span>
            <button class="copy-btn" onclick="copyCode(this)">Copy</button>
          </div>
          <pre class="curl-code" data-tpl="curl <base>/health"><span class="c-cmd">curl</span> <span class="c-url" data-url="health"></span></pre>
        </div>

        <div class="curl-block">
          <div class="curl-label">
            <span>List your agents</span>
            <button class="copy-btn" onclick="copyCode(this)">Copy</button>
          </div>
          <pre class="curl-code" data-tpl="curl <base>${prefix}/agents"><span class="c-cmd">curl</span> <span class="c-url" data-url="${prefixNoSlash}/agents"></span></pre>
        </div>

        <div class="curl-block">
          <div class="curl-label">
            <span>Chat with an agent</span>
            <button class="copy-btn" onclick="copyCode(this)">Copy</button>
          </div>
          <pre class="curl-code" data-tpl="curl -X POST <base>${prefix}/agents/:agent-id/generate -H 'Content-Type: application/json' -d '{&quot;messages&quot;:[{&quot;role&quot;:&quot;user&quot;,&quot;content&quot;:&quot;Hello&quot;}]}'"><span class="c-cmd">curl</span> <span class="c-flag">-X POST</span> <span class="c-url" data-url="${prefixNoSlash}/agents/:agent-id/generate"></span> \\
  <span class="c-flag">-H</span> <span class="c-str">'Content-Type: application/json'</span> \\
  <span class="c-flag">-d</span> <span class="c-str">'{"messages":[{"role":"user","content":"Hello"}]}'</span></pre>
        </div>

        <div class="curl-block">
          <div class="curl-label">
            <span>Stream an agent response</span>
            <button class="copy-btn" onclick="copyCode(this)">Copy</button>
          </div>
          <pre class="curl-code" data-tpl="curl -N -X POST <base>${prefix}/agents/:agent-id/stream -H 'Content-Type: application/json' -d '{&quot;messages&quot;:[{&quot;role&quot;:&quot;user&quot;,&quot;content&quot;:&quot;Hello&quot;}]}'"><span class="c-cmd">curl</span> <span class="c-flag">-N -X POST</span> <span class="c-url" data-url="${prefixNoSlash}/agents/:agent-id/stream"></span> \\
  <span class="c-flag">-H</span> <span class="c-str">'Content-Type: application/json'</span> \\
  <span class="c-flag">-d</span> <span class="c-str">'{"messages":[{"role":"user","content":"Hello"}]}'</span></pre>
        </div>
      </section>

      <section>
        <h2>API Endpoints</h2>
        <div class="card">
          <div class="card-row">
            <div class="card-row-left">
              <span class="method method-get">GET</span>
              <span class="endpoint-path">${prefix}/agents</span>
            </div>
            <span class="endpoint-desc">List all agents</span>
          </div>
          <div class="card-row">
            <div class="card-row-left">
              <span class="method method-post">POST</span>
              <span class="endpoint-path">${prefix}/agents/:id/generate</span>
            </div>
            <span class="endpoint-desc">Generate a response</span>
          </div>
          <div class="card-row">
            <div class="card-row-left">
              <span class="method method-post">POST</span>
              <span class="endpoint-path">${prefix}/agents/:id/stream</span>
            </div>
            <span class="endpoint-desc">Stream a response</span>
          </div>
          <div class="card-row">
            <div class="card-row-left">
              <span class="method method-get">GET</span>
              <span class="endpoint-path">${prefix}/workflows</span>
            </div>
            <span class="endpoint-desc">List all workflows</span>
          </div>
          <div class="card-row">
            <div class="card-row-left">
              <span class="method method-post">POST</span>
              <span class="endpoint-path">${prefix}/workflows/:id/start</span>
            </div>
            <span class="endpoint-desc">Run a workflow</span>
          </div>
          <div class="card-row">
            <div class="card-row-left">
              <span class="method method-get">GET</span>
              <span class="endpoint-path">${prefix}/tools</span>
            </div>
            <span class="endpoint-desc">List all tools</span>
          </div>
          <div class="card-row">
            <div class="card-row-left">
              <span class="method method-post">POST</span>
              <span class="endpoint-path">${prefix}/tools/:id/execute</span>
            </div>
            <span class="endpoint-desc">Execute a tool</span>
          </div>
          <div class="card-row">
            <div class="card-row-left">
              <span class="method method-get">GET</span>
              <span class="endpoint-path">${prefix}/memory/threads</span>
            </div>
            <span class="endpoint-desc">List memory threads</span>
          </div>
        </div>
      </section>

      <section>
        <h2>Resources</h2>
        <div class="links-grid">
          <a href="https://mastra.ai/docs" target="_blank" rel="noopener noreferrer" class="link-card">
            <svg class="link-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
            Documentation
          </a>
          <a href="https://mastra.ai/docs/server-db/custom-api-routes" target="_blank" rel="noopener noreferrer" class="link-card">
            <svg class="link-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 18l6-6-6-6"/><path d="M8 6l-6 6 6 6"/></svg>
            Custom API Routes
          </a>
          <a href="https://mastra.ai/docs/agents/overview" target="_blank" rel="noopener noreferrer" class="link-card">
            <svg class="link-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v4m0 14v4m-7.8-15.4 2.8 2.8m9.6 9.6 2.8 2.8M1 12h4m14 0h4M4.2 19.8l2.8-2.8m9.6-9.6 2.8-2.8"/></svg>
            Agents Guide
          </a>
          <a href="https://mastra.ai/docs/workflows/overview" target="_blank" rel="noopener noreferrer" class="link-card">
            <svg class="link-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>
            Workflows Guide
          </a>
        </div>
      </section>

      <footer>
        Powered by <a href="https://mastra.ai" target="_blank" rel="noopener noreferrer" style="color:#71717a;">Mastra</a>
      </footer>
    </div>

    <script>
      (function() {
        var base = location.origin;
        document.getElementById('base-url').textContent = base;

        var els = document.querySelectorAll('[data-url]');
        for (var i = 0; i < els.length; i++) {
          els[i].textContent = base + '/' + els[i].getAttribute('data-url');
        }

        var tpls = document.querySelectorAll('[data-tpl]');
        for (var i = 0; i < tpls.length; i++) {
          tpls[i].setAttribute('data-tpl', tpls[i].getAttribute('data-tpl').replace(/<base>/g, base));
        }
      })();

      function copyCode(btn) {
        var pre = btn.closest('.curl-block').querySelector('.curl-code');
        var text = pre.getAttribute('data-tpl');
        if (!navigator.clipboard || !navigator.clipboard.writeText) {
          btn.textContent = 'Unavailable';
          setTimeout(function() { btn.textContent = 'Copy'; }, 1500);
          return;
        }
        navigator.clipboard.writeText(text).then(function() {
          btn.textContent = 'Copied!';
          setTimeout(function() { btn.textContent = 'Copy'; }, 1500);
        }).catch(function() {
          btn.textContent = 'Failed';
          setTimeout(function() { btn.textContent = 'Copy'; }, 1500);
        });
      }
    <\/script>
  </body>
</html>
`;
}
// src/server/index.ts
const getStudioPath = () => {
	if (process.env.MASTRA_STUDIO_PATH) return process.env.MASTRA_STUDIO_PATH;
	let __dirname = ".";
	if (import.meta.url) {
		const __filename = fileURLToPath(import.meta.url);
		__dirname = dirname(__filename);
	}
	return process.env.MASTRA_STUDIO_PATH || join(__dirname, "studio");
};
function isSchemaApiRoute(route) {
	return "_mastraSchemaRoute" in route && route._mastraSchemaRoute === true;
}
const DEFAULT_CORS_ALLOW_METHODS = [
	"GET",
	"POST",
	"PUT",
	"PATCH",
	"DELETE",
	"OPTIONS"
];
const DEFAULT_CORS_ALLOW_HEADERS = [
	"Content-Type",
	"Authorization",
	"A2A-Version",
	"x-mastra-client-type",
	"x-mastra-dev-playground"
];
const DEFAULT_CORS_EXPOSE_HEADERS = ["Content-Length", "X-Requested-With"];
function getCorsConfig(serverCors, credentialsDefault) {
	const userCors = serverCors && typeof serverCors === "object" ? serverCors : void 0;
	const hasExplicitOrigin = !!(userCors && "origin" in userCors && userCors.origin);
	const origin = hasExplicitOrigin ? userCors.origin : credentialsDefault ? (requestOrigin) => requestOrigin || void 0 : "*";
	const credentials = userCors && "credentials" in userCors ? userCors.credentials : credentialsDefault && hasExplicitOrigin;
	return {
		origin,
		allowMethods: DEFAULT_CORS_ALLOW_METHODS,
		credentials,
		maxAge: 3600,
		...userCors,
		allowHeaders: [...DEFAULT_CORS_ALLOW_HEADERS, ...userCors?.allowHeaders ?? []],
		exposeHeaders: [...DEFAULT_CORS_EXPOSE_HEADERS, ...userCors?.exposeHeaders ?? []]
	};
}
function getRouteCorsConfig(apiRoutes, pathname, method) {
	const route = findMatchingCustomRoute(pathname, method, apiRoutes)?.route;
	return route && !isSchemaApiRoute(route) ? route.cors : void 0;
}
function getToolExports(tools) {
	try {
		return tools.reduce((acc, toolModule) => {
			Object.entries(toolModule).forEach(([key, tool]) => {
				if (tool instanceof Tool) acc[key] = tool;
			});
			return acc;
		}, {});
	} catch (err) {
		console.error(`Failed to import tools
reason: ${err.message}
${err.stack.split("\n").slice(1).join("\n")}
    `, err);
	}
}
async function createHonoServer(mastra, options = { tools: {} }) {
	if (options.tools) for (const [key, tool] of Object.entries(options.tools)) try {
		mastra.addTool(tool, key);
	} catch {}
	const app = new Hono();
	const server = mastra.getServer();
	const apiPrefix = server?.apiPrefix ?? "/api";
	const a2aTaskStore = new InMemoryTaskStore();
	const processedRoutes = (server?.apiRoutes)?.map((route) => {
		if (isSchemaApiRoute(route)) return route;
		if (route.openapi) {
			const existingMiddleware = route.middleware ? Array.isArray(route.middleware) ? route.middleware : [route.middleware] : [];
			return {
				...route,
				middleware: [describeRoute(route.openapi), ...existingMiddleware]
			};
		}
		return route;
	});
	const customRouteAuthConfig = /* @__PURE__ */ new Map();
	if (processedRoutes) for (const route of processedRoutes) {
		const requiresAuth = route.requiresAuth !== false;
		const routeKey = `${route.method}:${route.path}`;
		customRouteAuthConfig.set(routeKey, requiresAuth);
	}
	const customOnError = server?.onError;
	app.onError((err, c) => {
		if (customOnError) return customOnError(err, c);
		return errorHandler(err, c, options.isDev);
	});
	const bodyLimitOptions = {
		maxSize: server?.bodySizeLimit ?? 4718592,
		onError: () => ({ error: "Request body too large" })
	};
	const honoServerAdapter = new MastraServer$2({
		app,
		mastra,
		tools: options.tools,
		taskStore: a2aTaskStore,
		bodyLimitOptions,
		openapiPath: options?.isDev || server?.build?.openAPIDocs ? "/openapi.json" : void 0,
		customRouteAuthConfig,
		customApiRoutes: processedRoutes,
		prefix: apiPrefix,
		mcpOptions: server?.mcpOptions
	});
	honoServerAdapter.registerContextMiddleware();
	const serverMiddleware = mastra.getServerMiddleware?.();
	if (serverMiddleware && serverMiddleware.length > 0) for (const m of serverMiddleware) app.use(m.path, skipIfFrameworkPublic(m.handler));
	const browserStreamOrigins = server?.cors && typeof server.cors === "object" && "origin" in server.cors ? server.cors.origin : void 0;
	const browserStreamSetup = options.browserStream === false ? null : await setupBrowserStream(app, {
		mastra,
		allowedOrigins: browserStreamOrigins,
		getToolset: async (agentId) => {
			const resolveBrowser = async (agent) => {
				if (!agent) return void 0;
				if (agent.browser) return agent.browser;
				try {
					return (await agent.getWorkspace())?.browser;
				} catch {
					return;
				}
			};
			try {
				const runtimeAgent = mastra.getAgentById(agentId);
				if (runtimeAgent) return await resolveBrowser(runtimeAgent);
			} catch {}
			try {
				return await resolveBrowser(await mastra.getEditor?.()?.agent.getById(agentId));
			} catch {
				return;
			}
		},
		apiPrefix
	});
	if (!browserStreamSetup) app.get(`${apiPrefix}/agents/:agentId/browser/session`, (c) => c.json({
		hasSession: false,
		screencastAvailable: false
	}));
	if (server?.cors === false) app.use("*", timeout(server?.timeout ?? 18e4));
	else {
		const hasAuth = !!server?.auth;
		app.use("*", timeout(server?.timeout ?? 18e4), async (c, next) => {
			const pathname = new URL(c.req.url).pathname;
			const method = c.req.method === "OPTIONS" ? c.req.header("Access-Control-Request-Method") ?? c.req.method : c.req.method;
			const routeCors = getRouteCorsConfig(processedRoutes, pathname, method);
			const corsOptions = routeCors ? getCorsConfig(routeCors, false) : getCorsConfig(server?.cors, hasAuth);
			return cors(corsOptions)(c, next);
		});
	}
	app.get("/health", describeRoute({
		description: "Health check endpoint",
		tags: ["system"],
		responses: { 200: { description: "Service is healthy" } }
	}), healthHandler);
	if (options?.isDev && options.studio) app.get("/api/learning/*", agentLearningProxyHandler);
	if (options?.isDev || server?.build?.swaggerUI) app.get(apiPrefix, describeRoute({
		description: "API Welcome Page",
		tags: ["system"],
		responses: { 200: { description: "Success" } }
	}), rootHandler);
	await honoServerAdapter.validateEELicense();
	honoServerAdapter.registerAuthMiddleware();
	if (server?.middleware) {
		const middlewares = (Array.isArray(server.middleware) ? server.middleware : [server.middleware]).map((middleware) => {
			if (typeof middleware === "function") return {
				path: "*",
				handler: middleware
			};
			return middleware;
		});
		for (const middleware of middlewares) app.use(middleware.path, skipIfFrameworkPublic(middleware.handler));
	}
	await honoServerAdapter.registerCustomApiRoutes();
	if (server?.build?.apiReqLogs) app.use(logger());
	await honoServerAdapter.registerRoutes();
	if (options?.isDev || server?.build?.swaggerUI) {
		if (!options?.isDev && server?.build?.swaggerUI && !server?.build?.openAPIDocs) mastra.getLogger().warn("Swagger UI is enabled but OpenAPI documentation is disabled. The Swagger UI will not function properly without the OpenAPI endpoint. Please enable openAPIDocs in your server.build configuration:\n  server: { build: { swaggerUI: true, openAPIDocs: true } }");
		app.get("/swagger-ui", describeRoute({ hide: true }), middleware({ url: `${apiPrefix}/openapi.json` }));
	}
	if (options?.isDev) app.post("/__restart-active-workflow-runs", describeRoute({ hide: true }), restartAllActiveWorkflowRunsHandler);
	const serverOptions = mastra.getServer();
	const studioBasePath = normalizeStudioBase(serverOptions?.studioBase ?? "/");
	const devServerInstanceId = options?.isDev ? globalThis.crypto.randomUUID() : void 0;
	if (options?.studio) {
		const studioControlRoutes = [
			{
				method: "GET",
				path: "/refresh-events",
				responseType: "datastream-response",
				handler: async ({ abortSignal }) => handleClientsRefreshRequest(abortSignal, devServerInstanceId)
			},
			{
				method: "POST",
				path: "/__refresh",
				responseType: "json",
				handler: async () => getTriggerClientsRefreshPayload()
			},
			{
				method: "GET",
				path: "/__hot-reload-status",
				responseType: "json",
				handler: async () => ({
					disabled: isHotReloadDisabled(),
					timestamp: (/* @__PURE__ */ new Date()).toISOString()
				})
			}
		];
		for (const route of studioControlRoutes) {
			customRouteAuthConfig.set(`${route.method}:${studioBasePath}${route.path}`, !options.isDev);
			await honoServerAdapter.registerRoute(app, route, { prefix: studioBasePath });
		}
		app.use(`${studioBasePath}/assets/*`, compress());
		const studioPath = getStudioPath();
		app.use(`${studioBasePath}/assets/*`, serveStatic({
			root: join(studioPath, "assets"),
			rewriteRequestPath: (path) => {
				let rewritten = path;
				if (studioBasePath && rewritten.startsWith(studioBasePath)) rewritten = rewritten.slice(studioBasePath.length);
				if (rewritten.startsWith("/assets")) rewritten = rewritten.slice(7);
				return rewritten;
			}
		}));
	}
	app.get("*", async (c, next) => {
		const requestPath = c.req.path;
		if (requestPath === apiPrefix || requestPath.startsWith(`${apiPrefix}/`) || requestPath.startsWith("/swagger-ui") || requestPath.startsWith("/openapi.json")) return await next();
		if (requestPath.includes(".") && !requestPath.endsWith(".html")) return await next();
		const isStudioRoute = studioBasePath === "" || requestPath === studioBasePath || requestPath.startsWith(`${studioBasePath}/`);
		if (options?.studio && isStudioRoute) {
			const studioPath = getStudioPath();
			let indexHtml = await readFile$1(join(studioPath, "index.html"), "utf-8");
			const port = serverOptions?.port ?? (Number(process.env.PORT) || 4111);
			const hideCloudCta = process.env.MASTRA_HIDE_CLOUD_CTA === "true";
			const host = serverOptions?.host ?? process.env.MASTRA_HOST ?? "localhost";
			const key = serverOptions?.https?.key ?? (process.env.MASTRA_HTTPS_KEY ? Buffer.from(process.env.MASTRA_HTTPS_KEY, "base64") : void 0);
			const cert = serverOptions?.https?.cert ?? (process.env.MASTRA_HTTPS_CERT ? Buffer.from(process.env.MASTRA_HTTPS_CERT, "base64") : void 0);
			const protocol = key && cert ? "https" : "http";
			const studioHost = serverOptions?.studioHost ?? host;
			const studioProtocol = serverOptions?.studioProtocol ?? protocol;
			const studioPort = serverOptions?.studioPort ?? port;
			const cloudApiEndpoint = process.env.MASTRA_CLOUD_API_ENDPOINT || "";
			const experimentalFeatures = process.env.EXPERIMENTAL_FEATURES === "true" ? "true" : "false";
			const experimentalUI = process.env.MASTRA_EXPERIMENTAL_UI === "true" ? "true" : "false";
			const templatesEnabled = process.env.MASTRA_TEMPLATES === "true" ? "true" : "false";
			const agentSignals = process.env.MASTRA_AGENT_SIGNALS === "false" ? "false" : "true";
			const signalsUI = process.env.MASTRA_SIGNALS_UI === "true" ? "true" : "false";
			const organizationId = process.env.MASTRA_ORGANIZATION_ID || "";
			const platformProjectId = process.env.MASTRA_PLATFORM_PROJECT_ID || "";
			const platformObservabilityEndpoint = process.env.MASTRA_PLATFORM_OBSERVABILITY_ENDPOINT || "";
			const requestContextPresets = process.env.MASTRA_REQUEST_CONTEXT_PRESETS || "";
			const autoDetectUrl = process.env.MASTRA_AUTO_DETECT_URL === "true";
			indexHtml = injectStudioHtmlConfig(indexHtml, {
				host: `'${studioHost}'`,
				port: `'${studioPort}'`,
				protocol: `'${studioProtocol}'`,
				apiPrefix: `'${serverOptions?.apiPrefix ?? "/api"}'`,
				basePath: studioBasePath,
				hideCloudCta: `'${hideCloudCta}'`,
				cloudApiEndpoint: `'${escapeStudioHtmlValue(cloudApiEndpoint)}'`,
				experimentalFeatures: `'${experimentalFeatures}'`,
				templates: `'${templatesEnabled}'`,
				telemetryDisabled: `'${escapeStudioHtmlValue(process.env.MASTRA_TELEMETRY_DISABLED ?? "")}'`,
				requestContextPresets: `'${escapeStudioHtmlValue(requestContextPresets)}'`,
				experimentalUI: `'${experimentalUI}'`,
				agentSignals: `'${agentSignals}'`,
				signalsUI: `'${signalsUI}'`,
				organizationId: `'${escapeStudioHtmlValue(organizationId)}'`,
				platformProjectId: `'${escapeStudioHtmlValue(platformProjectId)}'`,
				platformObservabilityEndpoint: `'${escapeStudioHtmlValue(platformObservabilityEndpoint)}'`,
				autoDetectUrl: `'${autoDetectUrl}'`,
				devServerInstanceId: JSON.stringify(devServerInstanceId ?? "")
			});
			return c.newResponse(indexHtml, 200, { "Content-Type": "text/html" });
		}
		return c.newResponse(welcomeHtml(apiPrefix), 200, { "Content-Type": "text/html" });
	});
	if (options?.studio) {
		const studioRootPath = getStudioPath();
		const studioPath = studioBasePath ? `${studioBasePath}/*` : "*";
		app.use(studioPath, serveStatic({
			root: studioRootPath,
			rewriteRequestPath: (path) => {
				if (studioBasePath && path.startsWith(studioBasePath)) return path.slice(studioBasePath.length);
				return path;
			}
		}));
	}
	app.injectWebSocket = browserStreamSetup?.injectWebSocket;
	return app;
}
async function createNodeServer(mastra, options = { tools: {} }) {
	const app = await createHonoServer(mastra, options);
	const injectWebSocket = app.injectWebSocket;
	const serverOptions = mastra.getServer();
	const apiPrefix = serverOptions?.apiPrefix ?? "/api";
	const drainTimeoutMs = serverOptions?.drainTimeout ?? 5e3;
	if (serverOptions?.handleShutdownSignals !== false && (!Number.isFinite(drainTimeoutMs) || drainTimeoutMs < 0 || drainTimeoutMs > 2147483647)) throw new RangeError("server.drainTimeout must be a finite number between 0 and 2147483647 milliseconds");
	const key = serverOptions?.https?.key ?? (process.env.MASTRA_HTTPS_KEY ? Buffer.from(process.env.MASTRA_HTTPS_KEY, "base64") : void 0);
	const cert = serverOptions?.https?.cert ?? (process.env.MASTRA_HTTPS_CERT ? Buffer.from(process.env.MASTRA_HTTPS_CERT, "base64") : void 0);
	const isHttpsEnabled = Boolean(key && cert);
	const bindHost = serverOptions?.host ?? process.env.MASTRA_HOST;
	const host = bindHost ?? "localhost";
	const port = serverOptions?.port ?? (Number(process.env.PORT) || 4111);
	const protocol = isHttpsEnabled ? "https" : "http";
	const studioHost = serverOptions?.studioHost ?? host;
	const studioProtocol = serverOptions?.studioProtocol ?? protocol;
	const studioPort = serverOptions?.studioPort ?? port;
	await import('@mastra/core/telemetry').then(({ startModelUsageTelemetry }) => startModelUsageTelemetry?.(mastra)).catch(() => {});
	const server = serve({
		fetch: app.fetch,
		port,
		hostname: bindHost,
		...isHttpsEnabled ? {
			createServer: https.createServer,
			serverOptions: {
				key,
				cert
			}
		} : {}
	}, () => {
		const logger = mastra.getLogger();
		logger.info("Mastra API running", { url: `${protocol}://${host}:${port}${apiPrefix}` });
		if (options?.studio) {
			const studioBasePath = normalizeStudioBase(serverOptions?.studioBase ?? "/");
			const studioUrl = `${studioProtocol}://${studioHost}:${studioPort}${studioBasePath}`;
			logger.info("Studio available", { url: studioUrl });
		}
		if (process.send) process.send({
			type: "server-ready",
			port,
			host
		});
	});
	injectWebSocket?.(server);
	const workerLifecycle = mastra;
	if (typeof workerLifecycle.startWorkers === "function") await workerLifecycle.startWorkers();
	else await workerLifecycle.startEventEngine();
	import('@mastra/core/telemetry').then(({ syncUsageTelemetry }) => syncUsageTelemetry(mastra)).catch(() => {});
	import('@mastra/core/telemetry').then(({ syncFeatureUsageTelemetry }) => syncFeatureUsageTelemetry(mastra)).catch(() => {});
	if (serverOptions?.handleShutdownSignals !== false) {
		const CORE_SHUTDOWN_TIMEOUT_MS = 6500;
		const timedOut = Symbol("shutdown-timeout");
		const race = async (work, ms) => {
			let timeout;
			const timeoutPromise = new Promise((resolve) => {
				timeout = setTimeout(() => resolve(timedOut), ms);
			});
			try {
				return await Promise.race([work, timeoutPromise]);
			} finally {
				clearTimeout(timeout);
			}
		};
		const DUPLICATE_SIGNAL_WINDOW_MS = 250;
		let shutdownStartedAt;
		const shutdown = async (signal) => {
			if (shutdownStartedAt !== void 0) {
				if (Date.now() - shutdownStartedAt >= DUPLICATE_SIGNAL_WINDOW_MS) process.exit(1);
				return;
			}
			shutdownStartedAt = Date.now();
			const logger = mastra.getLogger();
			logger.info("Shutting down Mastra server", { signal });
			try {
				const drained = new Promise((resolve) => {
					server.close(() => resolve());
				});
				closeRefreshStreams();
				const closeIdleConnections = () => server.closeIdleConnections?.();
				closeIdleConnections();
				const idleSweep = setInterval(closeIdleConnections, 100);
				idleSweep.unref?.();
				try {
					if (await race(drained, drainTimeoutMs) === timedOut) {
						logger.warn("Mastra server drain timed out; closing remaining HTTP connections", { timeoutMs: drainTimeoutMs });
						server.closeAllConnections?.();
					}
				} finally {
					clearInterval(idleSweep);
				}
			} catch (error) {
				logger.error("Error while draining Mastra server", { error });
			}
			try {
				const lifecycle = mastra;
				if (typeof lifecycle.shutdown === "function") {
					const coreTimeoutMs = drainTimeoutMs + CORE_SHUTDOWN_TIMEOUT_MS;
					if (await race(lifecycle.shutdown({ drainTimeout: drainTimeoutMs }), coreTimeoutMs) === timedOut) logger.warn("Mastra shutdown timed out; forcing exit", { timeoutMs: coreTimeoutMs });
				}
			} catch (error) {
				logger.error("Error during Mastra shutdown", { error });
			}
			process.exit(0);
		};
		process.on("SIGINT", () => void shutdown("SIGINT"));
		process.on("SIGTERM", () => void shutdown("SIGTERM"));
	}
	return server;
}

// @ts-ignore
// @ts-ignore
await createNodeServer(mastra, {
  studio: true,
  isDev: true,
  tools: getToolExports(tools),
});

if (mastra.getStorage()) {
  mastra.__registerInternalWorkflow(scoreTracesWorkflow);
}
