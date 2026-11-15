import { s as standardSchemaToJSONSchema, t as toStandardSchema } from './rolldown-runtime-CQI-hT2b.mjs';
import { g as getBuiltinMCPCapabilities, G as GENERATE_AGENT_ROUTE, S as START_ASYNC_WORKFLOW_ROUTE, L as LIST_WORKFLOWS_ROUTE, a as LIST_TOOLS_ROUTE, A as AWAIT_BUFFER_STATUS_ROUTE, b as GET_OBSERVATIONAL_MEMORY_ROUTE, c as LIST_THREADS_ROUTE, d as GET_THREAD_BY_ID_ROUTE, e as LIST_MESSAGES_ROUTE, f as SEARCH_MEMORY_ROUTE, h as GET_MEMORY_STATUS_ROUTE, i as GET_MEMORY_CONFIG_ROUTE, C as CREATE_THREAD_ROUTE, U as UPDATE_THREAD_ROUTE, j as CLONE_THREAD_ROUTE, s as saveMessagesBodySchema, k as SAVE_MESSAGES_ROUTE, l as GET_TRACE_LIGHT_ROUTE, m as GET_TRACE_ROUTE, n as GET_SPAN_ROUTE, o as GET_TRACE_TRAJECTORY_ROUTE, p as LIST_TRACES_ROUTE, q as LIST_LOGS, r as LIST_SCORES, t as LIST_FEEDBACK, u as GET_METRIC_NAMES, v as GET_METRIC_LABEL_KEYS, w as GET_METRIC_LABEL_VALUES, x as GET_EDITOR_BUILDER_AVAILABLE_MODELS_ROUTE, y as LIST_STORED_AGENTS_ROUTE, z as GET_STORED_AGENT_ROUTE, B as CREATE_STORED_AGENT_ROUTE, D as UPDATE_STORED_AGENT_ROUTE, E as updateStoredAgentBodySchema, F as getEffectivePermission, Q as QUERY_TRACES, H as AGGREGATE_TRACES, I as QUERY_SPANS, J as AGGREGATE_SPANS, K as QUERY_THREADS, M as GET_TRACE_QUERY_FIELDS, N as GET_TRACE_QUERY_VALUES, O as GET_METRIC_PERCENTILES, P as GET_METRIC_TIME_SERIES, R as GET_METRIC_BREAKDOWN, T as GET_METRIC_AGGREGATE, V as GET_SCORE_PERCENTILES, W as GET_SCORE_TIME_SERIES, X as GET_SCORE_BREAKDOWN, Y as GET_SCORE_AGGREGATE, Z as GET_FEEDBACK_PERCENTILES, _ as GET_FEEDBACK_TIME_SERIES, $ as GET_FEEDBACK_BREAKDOWN, a0 as GET_FEEDBACK_AGGREGATE, a1 as createStoredAgentBodySchema, a2 as LIST_AGENTS_ROUTE, a3 as GET_AGENT_BY_ID_ROUTE, a4 as GET_WORKFLOW_BY_ID_ROUTE, a5 as GET_WORKFLOW_RUN_BY_ID_ROUTE, a6 as RESUME_ASYNC_WORKFLOW_ROUTE, a7 as CANCEL_WORKFLOW_RUN_ROUTE, a8 as EXECUTE_TOOL_ROUTE, a9 as GET_TOOL_BY_ID_ROUTE, aa as getAgentFromSystem, ab as listWorkflowsFromSystem, ac as findTool } from './routes-CmkPohqd.mjs';
import { c as checkRouteRBAC, a as authorizeRoute, d as dispatchRoute } from './server-adapter-BywLWVKp.mjs';
import { MastraError, ErrorCategory, ErrorDomain } from '@mastra/core/error';
import { createTool } from '@mastra/core/tools';
import * as coreStorage from '@mastra/core/storage';
import 'zod/v4';
import 'zod/v3';
import 'module';
import '@mastra/core/schema';
import '@mastra/core/utils/zod-to-json';
import 'zod';
import '@mastra/core/auth/ee';
import '@mastra/core/memory';
import 'stream';
import '@mastra/core/stream';
import '@mastra/core/agent';
import '@mastra/core/agent/durable';
import '@mastra/core/di';
import '@mastra/core/llm';
import '@mastra/core/server';
import 'util';
import '@mastra/core/a2a';
import '@mastra/core/a2a/v1';
import 'dns/promises';
import 'http';
import 'https';
import 'net';
import '@mastra/core/request-context';
import '@mastra/core/features';
import '@mastra/core/knowledge';
import '@mastra/core/utils';
import '@mastra/core/evals';
import '@mastra/core/evals/scoreTraces';
import '@mastra/core/observability';
import '@mastra/core/processors';
import '@mastra/core/workspace';
import 'fs';
import 'stream/promises';

// src/server/mcp/schema.ts
const object = (properties, required = []) => ({
	type: "object",
	properties,
	required,
	additionalProperties: false
});
const str = (description) => ({
	type: "string",
	description
});
/** MCP tool schemas default to JSON Schema 2020-12 (e.g. tuples are `prefixItems`, not array-valued `items`). */
function toJSONSchema(schema) {
	if (!schema) return void 0;
	try {
		const { $schema: _dialect, ...json } = standardSchemaToJSONSchema(toStandardSchema(schema), {
			io: "input",
			target: "draft-2020-12"
		});
		return json;
	} catch {
		return;
	}
}
/**
* Shrinks a tool schema without changing what it accepts, and keeps it portable:
* - drops regex `pattern`s that only restate `format: date-time` (most of a time-range schema's size);
* - spells a closed tuple (`prefixItems` + `items: false`) as `maxItems`, since some clients reject bare `false`.
*/
function compact(node) {
	if (Array.isArray(node)) return node.map(compact);
	if (!node || typeof node !== "object") return node;
	const { pattern, ...rest } = node;
	const kept = rest.format === "date-time" || pattern === void 0 ? rest : {
		...rest,
		pattern
	};
	if (kept.items === false && Array.isArray(kept.prefixItems)) {
		delete kept.items;
		kept.maxItems ??= kept.prefixItems.length;
	}
	return Object.fromEntries(Object.entries(kept).map(([key, value]) => [key, compact(value)]));
}
/**
* Moves sub-schemas repeated within one tool schema (e.g. predicate operands) into `$defs`. The schema
* accepts exactly the same input; it is just shorter. Schemas here already use `$defs`/`$ref`.
*/
const MAPS = /* @__PURE__ */ new Set([
	"properties",
	"patternProperties",
	"$defs",
	"definitions"
]);
const SCHEMA_KEYS = /* @__PURE__ */ new Set([
	"items",
	"additionalProperties",
	"anyOf",
	"oneOf",
	"allOf",
	"not",
	"prefixItems",
	"contains"
]);
function hoistRepeated(schema) {
	const root = schema;
	const defs = { ...root.$defs };
	let body = {
		...root,
		$defs: void 0
	};
	for (let n = 0;; n++) {
		const counts = /* @__PURE__ */ new Map();
		const visit = (node, isSchema) => {
			if (!node || typeof node !== "object") return;
			const json = JSON.stringify(node);
			if (isSchema && !Array.isArray(node) && json.length > 150) counts.set(json, (counts.get(json) ?? 0) + 1);
			for (const [key, child] of Object.entries(node)) if (MAPS.has(key) && !Array.isArray(node)) for (const value of Object.values(child ?? {})) visit(value, true);
			else visit(child, Array.isArray(node) || SCHEMA_KEYS.has(key));
		};
		for (const [key, value] of Object.entries(body)) if (MAPS.has(key)) for (const child of Object.values(value ?? {})) visit(child, true);
		else visit(value, SCHEMA_KEYS.has(key));
		for (const value of Object.values(defs)) visit(value, false);
		const [repeated] = [...counts].filter(([, count]) => count > 1).sort(([a], [b]) => b.length - a.length);
		if (!repeated) break;
		const name = `mcp${n}`;
		const target = repeated[0];
		defs[name] = JSON.parse(target);
		const replace = (node, isSchema = true) => {
			if (!node || typeof node !== "object") return node;
			if (isSchema && !Array.isArray(node) && JSON.stringify(node) === target) return { $ref: `#/$defs/${name}` };
			if (Array.isArray(node)) return node.map((item) => replace(item));
			return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, MAPS.has(key) ? Object.fromEntries(Object.entries(value ?? {}).map(([k, v]) => [k, replace(v)])) : replace(value, SCHEMA_KEYS.has(key))]));
		};
		body = replace(body, false);
		for (const key of Object.keys(defs)) if (key !== name) defs[key] = replace(defs[key], false);
	}
	const { $defs: _unused, ...rest } = body;
	return Object.keys(defs).length ? {
		...rest,
		$defs: defs
	} : rest;
}
// src/server/mcp/result-size.ts
/**
* Most MCP clients cap a tool result at roughly 25k tokens (Claude Code drops larger results). Tools that
* return lists keep their serialized result under this many characters.
*/
const MAX_RESULT_CHARS = 4e4;
/** String lengths tried, longest first, when clipping a value that doesn't fit. */
const CLIP_LENGTHS = [
	1e4,
	2e3,
	500,
	100
];
/** Ids stay whole so the caller can still look the full item up (`id`, `spanId`, `trace_id`, ...). */
const isIdKey = (key) => key === "id" || /(Id|_id)$/.test(key);
const isObject$1 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const isPlainObject = (value) => isObject$1(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const fits = (value) => JSON.stringify(value).length <= MAX_RESULT_CHARS;
/** Cuts every string longer than `max` to `max` characters plus a marker; keys, ids and other values stay. */
function clipStrings(value, max, detail) {
	if (typeof value === "string") {
		if (value.length <= max) return value;
		const how = detail ? `, use ${detail} for the full value` : "";
		return `${value.slice(0, max)}[truncated ${value.length - max} chars${how}]`;
	}
	if (Array.isArray(value)) return value.map((item) => clipStrings(item, max, detail));
	if (isPlainObject(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, isIdKey(key) ? item : clipStrings(item, max, detail)]));
	return value;
}
/** `build` with its long strings clipped as little as it takes to fit (or down to 100 characters). */
function clipToFit(build, detail) {
	let clipped;
	for (const max of CLIP_LENGTHS) {
		clipped = build((value) => clipStrings(value, max, detail));
		if (fits(clipped)) break;
	}
	return clipped;
}
/**
* Keeps a single-record result under {@link MAX_RESULT_CHARS} by clipping its long strings. `detail` names the
* tool that returns full values, if there is one. Results that already fit pass through unchanged.
*/
function fitValue(result, detail) {
	return fits(result) ? result : clipToFit((clip) => clip(result), detail);
}
/**
* Keeps a list result under {@link MAX_RESULT_CHARS} by dropping trailing rows of `key` and says how to page.
* It always keeps at least one row: when the first row alone is too big, its long strings are clipped. Results
* that already fit, or aren't a list, pass through unchanged.
*/
function fitRows(result, key, hint, { cursors = [], views = [], detail } = {}) {
	if (!isObject$1(result) || !Array.isArray(result[key]) || fits(result)) return result;
	const rows = result[key];
	const without = (fields) => Object.fromEntries(Object.entries(result).filter(([field]) => field !== key && !fields.includes(field)));
	const allRows = {
		...without(views),
		[key]: rows
	};
	if (views.length > 0 && fits(allRows)) return allRows;
	const rest = without([...cursors, ...views]);
	const build = (count) => ({
		...rest,
		[key]: rows.slice(0, count),
		truncated: `Only the first ${count} of ${rows.length} ${key} fit in one result. ${hint}`
	});
	let low = 0;
	let high = rows.length - 1;
	while (low < high) {
		const mid = Math.ceil((low + high) / 2);
		if (fits(build(mid))) low = mid;
		else high = mid - 1;
	}
	if (low > 0 || rows.length === 0) return build(low);
	const kept = rows.length > 1 ? rest : without(views);
	return clipToFit((clip) => ({
		...kept,
		[key]: [clip(rows[0])],
		truncated: rows.length > 1 ? `Only the first of ${rows.length} ${key} fits in one result, with its long values cut. ${hint}` : `Long values in the ${key} were cut to fit in one result.`
	}), detail);
}
// src/server/mcp/toolsets/memory.ts
const PER_PAGE_HINT$1 = "Call again with a smaller perPage to page through every item.";
const PAGINATION = ["hasMore"];
const int = (description) => ({
	type: "integer",
	minimum: 0,
	description
});
const metadata = {
	type: "object",
	description: "Arbitrary metadata."
};
/** Drops undefined values so optional arguments are not sent as empty query params. */
const defined = (values) => Object.fromEntries(Object.entries(values).filter(([, value]) => value !== void 0));
/**
* Memory: Observational Memory, threads, and messages. Every route enforces thread/resource ownership itself.
* A tool given an `agentId` left out by include/exclude returns "not found", as in the agents toolset; threads
* read by `threadId` or listed without an `agentId` aren't filtered by agent, as on the HTTP routes.
*/
async function addMemoryTools(kit) {
	const { addOperation, addCombined, requestContext } = kit;
	const call = async (route, input, signal) => {
		const agentId = input.query?.agentId ?? input.body?.agentId;
		if (typeof agentId === "string") await kit.requireSelected("agents", agentId, "Agent");
		return kit.call(route, input, signal);
	};
	const agentIds = await kit.visibleAgentIds();
	const agentId = kit.idParam("Agent", agentIds, "list_agents");
	const resourceId = str("Owner of the memory, for example a user id. Defaults to you when the server maps users to resources.");
	const threadId = str("Thread id.");
	const contextResource = (args) => args.resourceId ?? requestContext.get("mastra__resourceId");
	const omScope = {
		agentId,
		threadId: str("Thread id. Omit for resource-scoped Observational Memory."),
		resourceId
	};
	const canWait = kit.permitted(AWAIT_BUFFER_STATUS_ROUTE);
	const waitForPending = {
		type: "boolean",
		description: "Set true right after call_agent to wait (up to 30s) for Observational Memory to finish processing recent messages before reading. Returns an error if the agent has no Observational Memory."
	};
	addOperation(GET_OBSERVATIONAL_MEMORY_ROUTE, object(canWait ? {
		...omScope,
		waitForPending
	} : omScope, ["agentId"]), async (args, signal) => {
		const scope = defined({
			agentId: args.agentId,
			threadId: args.threadId,
			resourceId: args.resourceId
		});
		if (canWait && args.waitForPending === true) return fitValue(await call(AWAIT_BUFFER_STATUS_ROUTE, { body: scope }, signal));
		return fitValue({ record: (await call(GET_OBSERVATIONAL_MEMORY_ROUTE, { query: {
			...scope,
			limit: 1
		} }, signal))?.record ?? null });
	});
	const page = {
		page: int("Page number, from 0."),
		perPage: int("Items per page.")
	};
	addOperation(LIST_THREADS_ROUTE, object({
		agentId: {
			...agentId,
			description: "Agent whose memory to list. Optional."
		},
		resourceId,
		...page
	}), async (args, signal) => fitRows(await call(LIST_THREADS_ROUTE, { query: defined(args) }, signal), "threads", PER_PAGE_HINT$1, { cursors: PAGINATION }));
	addOperation(GET_THREAD_BY_ID_ROUTE, object({
		threadId,
		agentId: {
			...agentId,
			description: "Agent whose memory holds the thread. Optional."
		}
	}, ["threadId"]), (args, signal) => call(GET_THREAD_BY_ID_ROUTE, {
		pathParams: { threadId: args.threadId },
		query: defined({ agentId: args.agentId })
	}, signal));
	addOperation(LIST_MESSAGES_ROUTE, object({
		threadId,
		agentId: {
			...agentId,
			description: "Agent whose memory holds the thread. Optional."
		},
		...page
	}, ["threadId"]), async (args, signal) => {
		const { threadId: id, ...query } = args;
		return fitRows(await call(LIST_MESSAGES_ROUTE, {
			pathParams: { threadId: id },
			query: defined(query)
		}, signal), "messages", PER_PAGE_HINT$1, {
			cursors: PAGINATION,
			views: ["uiMessages"]
		});
	});
	addOperation(SEARCH_MEMORY_ROUTE, object({
		agentId,
		searchQuery: str("What to search for."),
		resourceId,
		threadId: str("Only search this thread."),
		limit: int("Maximum results. Defaults to 20.")
	}, ["agentId", "searchQuery"]), (args, signal) => call(SEARCH_MEMORY_ROUTE, { query: defined({
		...args,
		resourceId: contextResource(args)
	}) }, signal));
	addCombined([GET_MEMORY_STATUS_ROUTE, GET_MEMORY_CONFIG_ROUTE], object({
		agentId,
		resourceId,
		threadId
	}, ["agentId"]), async (args, signal) => {
		const status = await call(GET_MEMORY_STATUS_ROUTE, { query: defined(args) }, signal);
		const config = await call(GET_MEMORY_CONFIG_ROUTE, { query: { agentId: args.agentId } }, signal);
		return {
			status,
			config: config?.config ?? config
		};
	});
	addOperation(CREATE_THREAD_ROUTE, object({
		agentId,
		resourceId,
		title: str("Thread title."),
		metadata,
		threadId: str("Id for the new thread. Generated if omitted.")
	}, ["agentId"]), (args, signal) => {
		const { agentId: id, ...body } = args;
		return call(CREATE_THREAD_ROUTE, {
			query: { agentId: id },
			body: defined({
				...body,
				resourceId: contextResource(args)
			})
		}, signal);
	});
	addOperation(UPDATE_THREAD_ROUTE, object({
		threadId,
		agentId,
		title: str("New title."),
		metadata
	}, ["threadId", "agentId"]), (args, signal) => call(UPDATE_THREAD_ROUTE, {
		pathParams: { threadId: args.threadId },
		query: { agentId: args.agentId },
		body: defined({
			title: args.title,
			metadata: args.metadata
		})
	}, signal));
	addOperation(CLONE_THREAD_ROUTE, object({
		threadId: str("Thread to copy."),
		agentId,
		newThreadId: str("Id for the copy. Generated if omitted."),
		title: str("Title for the copy."),
		metadata,
		messageLimit: int("Only copy the most recent N messages.")
	}, ["threadId", "agentId"]), (args, signal) => call(CLONE_THREAD_ROUTE, {
		pathParams: { threadId: args.threadId },
		query: { agentId: args.agentId },
		body: defined({
			newThreadId: args.newThreadId,
			title: args.title,
			metadata: args.metadata,
			options: args.messageLimit === void 0 ? void 0 : { messageLimit: args.messageLimit }
		})
	}, signal));
	const messages = toJSONSchema(saveMessagesBodySchema)?.properties?.messages;
	addOperation(SAVE_MESSAGES_ROUTE, object({
		agentId,
		messages: typeof messages === "object" ? messages : {
			type: "array",
			items: { type: "object" }
		}
	}, ["agentId", "messages"]), (args, signal) => call(SAVE_MESSAGES_ROUTE, {
		query: { agentId: args.agentId },
		body: { messages: args.messages }
	}, signal));
}
// src/server/mcp/toolsets/observability.ts
const COMBINATORS = [
	"anyOf",
	"oneOf",
	"allOf",
	"not"
];
const DELTA_POLLING = [
	"mode",
	"after",
	"limit"
];
/**
* Every way an observability list says where to continue: keyset `page`, offset `pagination`, and delta polling's
* `delta` / `deltaCursor` (the tool schemas don't offer delta polling, but the routes still accept it). All of them
* would skip rows that were cut, so a cut page drops whichever it has.
*/
const CURSORS = [
	"page",
	"pagination",
	"delta",
	"deltaCursor"
];
const PAGE_LIMIT_HINT = "Call again with a smaller page.limit and follow page.next to see every row.";
const PER_PAGE_HINT = "Call again with a smaller perPage to page through every row.";
const LIGHT_SPAN_FIELDS = Object.keys(coreStorage.getTraceLightResponseSchema.shape.spans.element.shape);
/** Light span record with its status (stores may omit it; the UI derives it the same way). */
function lightSpan(span) {
	return {
		...Object.fromEntries(LIGHT_SPAN_FIELDS.filter((key) => key in span).map((key) => [key, span[key]])),
		status: span.status ?? coreStorage.computeTraceStatus(span)
	};
}
/**
* MCP clients (and the Anthropic API) need a plain `type: object` input schema without top-level combinators.
* The route still validates the full body; the tool schema leaves out delta polling, which needs a client loop.
*/
function asObjectSchema(schema) {
	if (!schema || schema.type !== "object" || COMBINATORS.some((key) => key in schema)) return {
		type: "object",
		additionalProperties: true
	};
	const properties = { ...schema.properties };
	if (properties.mode) for (const key of DELTA_POLLING) delete properties[key];
	if (properties.page && properties.pagination) delete properties.pagination;
	return compact({
		...schema,
		properties
	});
}
/**
* List routes take filters as flat query params, where complex values may also arrive as JSON strings.
* The tool schema keeps the structured branch and drops delta polling, which an MCP client cannot use.
*/
function listQuerySchema(route) {
	const json = toJSONSchema(route.queryParamSchema);
	const properties = {};
	for (const [key, value] of Object.entries(json?.properties ?? {})) {
		if (DELTA_POLLING.includes(key)) continue;
		const branches = value.anyOf ?? [];
		const structured = branches.filter((branch) => branch.type !== "string" || branch.enum || branch.format);
		properties[key] = branches.length > 1 && structured.length === 1 ? structured[0] : value;
	}
	return compact({
		type: "object",
		properties
	});
}
const OPS = [
	"aggregate",
	"breakdown",
	"timeseries",
	"percentiles"
];
/**
* One `analyze_<source>` tool per family (D15). The per-op body fields are merged into one flat object
* (each field says which ops use it); the call goes to that op's own route, which validates the body
* and authorizes the call.
*/
function analyzeSchema(routes) {
	const variants = /* @__PURE__ */ new Map();
	const usedBy = /* @__PURE__ */ new Map();
	const required = /* @__PURE__ */ new Map();
	const defs = {};
	for (const op of OPS) {
		const json = JSON.parse(JSON.stringify(asObjectSchema(toJSONSchema(routes[op].bodySchema))).replaceAll("#/$defs/", `#/$defs/${op}_`));
		for (const [name, def] of Object.entries(json.$defs ?? {})) defs[`${op}_${name}`] = def;
		for (const [key, value] of Object.entries(json.properties ?? {})) {
			const { description: _description, ...shape } = value;
			if (!variants.has(key)) variants.set(key, /* @__PURE__ */ new Map());
			if (!variants.get(key).has(JSON.stringify(shape))) variants.get(key).set(JSON.stringify(shape), value);
			usedBy.set(key, [...usedBy.get(key) ?? [], op]);
		}
		for (const key of json.required ?? []) required.set(key, (required.get(key) ?? 0) + 1);
	}
	const properties = {};
	for (const [key, shapes] of variants) {
		const all = [...shapes.values()];
		properties[key] = all.length === 1 ? all[0] : {
			anyOf: all.map(({ description: _description, ...shape }) => shape),
			description: all[0].description
		};
	}
	for (const [key, ops] of usedBy) {
		const scope = ops.length === OPS.length ? "" : ` Used by op: ${ops.join(", ")}.`;
		const needed = ops.length !== OPS.length && required.get(key) ? ` Required for ${ops.join(", ")}.` : "";
		if (scope || needed) {
			const prop = properties[key];
			properties[key] = {
				...prop,
				description: `${prop.description ?? ""}${scope}${needed}`.trim()
			};
		}
	}
	const alwaysRequired = [...required].filter(([, count]) => count === OPS.length).map(([key]) => key);
	return {
		...Object.keys(defs).length ? { $defs: defs } : {},
		type: "object",
		properties: {
			op: {
				type: "string",
				enum: [...OPS],
				description: "aggregate: one value; breakdown: grouped by labels; timeseries: bucketed over time; percentiles: distribution."
			},
			...properties
		},
		required: ["op", ...alwaysRequired]
	};
}
/** Observability (traces, spans, logs) and observability analytics (metrics, scores, feedback). */
function addObservabilityTools(kit) {
	const { call, addOperation, addCombined, config } = kit;
	if (config.toolsets.has("observability")) {
		const bodyTool = (route, rows, schema = route.bodySchema) => addOperation(route, hoistRepeated(asObjectSchema(toJSONSchema(schema))), async (args, signal) => {
			const result = await call(route, { body: args }, signal);
			return rows ? fitRows(result, rows, PAGE_LIMIT_HINT, {
				cursors: CURSORS,
				detail: rows === "traces" || rows === "spans" ? "get_span" : void 0
			}) : result;
		});
		bodyTool(QUERY_TRACES, "traces");
		bodyTool(AGGREGATE_TRACES);
		bodyTool(QUERY_SPANS, "spans");
		bodyTool(AGGREGATE_SPANS);
		bodyTool(QUERY_THREADS, "threads", coreStorage.threadQueryRequestSchema);
		bodyTool(GET_TRACE_QUERY_FIELDS);
		bodyTool(GET_TRACE_QUERY_VALUES);
		const traceId = str("Trace id.");
		const { traceStructure } = kit.capabilities;
		addOperation(GET_TRACE_LIGHT_ROUTE, object({
			traceId,
			offset: {
				type: "integer",
				minimum: 0,
				description: "Spans to skip: the nextOffset of a truncated result."
			}
		}, ["traceId"]), async (args, signal) => {
			const trace = await call(traceStructure ? GET_TRACE_LIGHT_ROUTE : GET_TRACE_ROUTE, { pathParams: { traceId: args.traceId } }, signal);
			const spans = Array.isArray(trace?.spans) ? trace.spans : [];
			const offset = typeof args.offset === "number" ? args.offset : 0;
			const page = spans.slice(offset).map(lightSpan);
			const result = fitRows({
				traceId: trace?.traceId ?? args.traceId,
				spanCount: spans.length,
				...offset ? { offset } : {},
				spans: page
			}, "spans", "Call get_trace again with offset: nextOffset for the rest.", { detail: "get_span" });
			const kept = result.spans.length;
			return kept < page.length ? {
				...result,
				nextOffset: offset + kept
			} : result;
		});
		addOperation(GET_SPAN_ROUTE, object({
			traceId,
			spanId: str("Span id.")
		}, ["traceId", "spanId"]), (args, signal) => call(GET_SPAN_ROUTE, { pathParams: {
			traceId: args.traceId,
			spanId: args.spanId
		} }, signal));
		addOperation(GET_TRACE_TRAJECTORY_ROUTE, object({ traceId }, ["traceId"]), (args, signal) => call(GET_TRACE_TRAJECTORY_ROUTE, { pathParams: { traceId: args.traceId } }, signal));
		addOperation(LIST_TRACES_ROUTE, hoistRepeated(listQuerySchema(LIST_TRACES_ROUTE)), async (args, signal) => fitRows(await call(LIST_TRACES_ROUTE, { query: args }, signal), "spans", PER_PAGE_HINT, {
			cursors: CURSORS,
			detail: "get_span"
		}));
		addOperation(LIST_LOGS, hoistRepeated(listQuerySchema(LIST_LOGS)), async (args, signal) => fitRows(await call(LIST_LOGS, { query: args }, signal), "logs", PER_PAGE_HINT, { cursors: CURSORS }));
	}
	if (config.toolsets.has("observability_analytics")) {
		for (const [route, key] of [[LIST_SCORES, "scores"], [LIST_FEEDBACK, "feedback"]]) addOperation(route, hoistRepeated(listQuerySchema(route)), async (args, signal) => fitRows(await call(route, { query: args }, signal), key, PER_PAGE_HINT, { cursors: CURSORS }));
		const analyze = (routes) => addCombined(Object.values(routes), hoistRepeated(analyzeSchema(routes)), (args, signal) => {
			const { op, ...body } = args;
			const route = typeof op === "string" && Object.hasOwn(routes, op) ? routes[op] : void 0;
			if (!route) throw toolError(400, `Unknown op "${String(op)}". Use one of: ${OPS.join(", ")}.`);
			return call(route, { body }, signal);
		});
		analyze({
			aggregate: GET_METRIC_AGGREGATE,
			breakdown: GET_METRIC_BREAKDOWN,
			timeseries: GET_METRIC_TIME_SERIES,
			percentiles: GET_METRIC_PERCENTILES
		});
		analyze({
			aggregate: GET_SCORE_AGGREGATE,
			breakdown: GET_SCORE_BREAKDOWN,
			timeseries: GET_SCORE_TIME_SERIES,
			percentiles: GET_SCORE_PERCENTILES
		});
		analyze({
			aggregate: GET_FEEDBACK_AGGREGATE,
			breakdown: GET_FEEDBACK_BREAKDOWN,
			timeseries: GET_FEEDBACK_TIME_SERIES,
			percentiles: GET_FEEDBACK_PERCENTILES
		});
		addCombined([
			GET_METRIC_NAMES,
			GET_METRIC_LABEL_KEYS,
			GET_METRIC_LABEL_VALUES
		], object({
			metricName: str("List the label keys of this metric (or, with labelKey, one label’s values)."),
			labelKey: str("With metricName, list the values of this label."),
			prefix: str("Only names or values starting with this."),
			limit: {
				type: "integer",
				minimum: 1,
				description: "Maximum results."
			}
		}), (args, signal) => {
			const { metricName, labelKey, prefix, limit } = args;
			if (labelKey && !metricName) throw toolError(400, "labelKey needs metricName.");
			if (metricName && labelKey) return call(GET_METRIC_LABEL_VALUES, { query: {
				metricName,
				labelKey,
				prefix,
				limit
			} }, signal);
			if (metricName) return call(GET_METRIC_LABEL_KEYS, { query: { metricName } }, signal);
			return call(GET_METRIC_NAMES, { query: {
				prefix,
				limit
			} }, signal);
		});
	}
}
// src/server/mcp/toolsets/stored-agents.ts
const PUBLISH_DESCRIPTION = "Publish the change so call_agent uses it right away. Defaults to true.";
function bodySchema(schema, omit) {
	const json = toJSONSchema(schema) ?? { type: "object" };
	const properties = { ...json.properties };
	for (const key of omit) delete properties[key];
	properties.autoPublish = {
		type: "boolean",
		description: PUBLISH_DESCRIPTION
	};
	return hoistRepeated(compact({
		...json,
		properties,
		required: (json.required ?? []).filter((key) => !omit.includes(key))
	}));
}
const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
/** The keys of a stored model the editor reads: what it runs (`provider/name`) and its model settings. */
const MODEL_CONFIG_KEYS = /* @__PURE__ */ new Set([
	"provider",
	"name",
	"temperature",
	"topP",
	"frequencyPenalty",
	"presencePenalty",
	"maxCompletionTokens"
]);
/**
* The agent's own model, per variant when conditional. The editor runs `${provider}/${name}`, so that is what's
* checked. Any other key is rejected: the policy would read `id`/`providerId`/`modelId` before `name`, and the
* editor ignores them, so they could make the policy check a model the agent doesn't run.
*/
function agentModelUses(model) {
	if (model === void 0 || model === null) return [];
	return (Array.isArray(model) ? model.map((variant, index) => [isObject(variant) ? variant.value : void 0, `model[${index}].value`]) : [[model, "model"]]).map(([value, field]) => {
		if (!isObject(value)) return {
			field,
			implicit: "is not a provider and name"
		};
		const unknown = Object.keys(value).filter((key) => !MODEL_CONFIG_KEYS.has(key));
		if (unknown.length > 0) return {
			field,
			implicit: `has keys a stored model doesn't take (${unknown.join(", ")})`
		};
		const { provider, name } = value;
		return typeof provider === "string" && provider && typeof name === "string" && name ? {
			field,
			model: {
				provider,
				name
			}
		} : {
			field,
			implicit: "is not a provider and name"
		};
	});
}
/** Keys that name a model wherever they appear in free-form config; `modelSettings` and the like don't. */
const MODEL_KEY = /^(model|models|modelList)$/;
/**
* Every model named in free-form config (default options, which pass unknown keys through to the agent), at any
* depth: a string `model` is checked, anything else under a model key is rejected.
*/
function namedModelUses(value, path) {
	if (Array.isArray(value)) return value.flatMap((item, index) => namedModelUses(item, `${path}[${index}]`));
	if (!isObject(value)) return [];
	return Object.entries(value).flatMap(([key, child]) => {
		const field = `${path}.${key}`;
		if (!MODEL_KEY.test(key)) return namedModelUses(child, field);
		if (child === void 0) return [];
		return key === "model" && typeof child === "string" ? [{
			field,
			model: child
		}] : [{
			field,
			implicit: "is not a model id"
		}];
	});
}
/** Models named in default options, per variant when conditional (the editor merges matching variants shallowly). */
function defaultOptionsUses(defaultOptions) {
	if (Array.isArray(defaultOptions)) return defaultOptions.flatMap((variant, index) => namedModelUses(isObject(variant) ? variant.value : void 0, `defaultOptions[${index}].value`));
	return namedModelUses(defaultOptions, "defaultOptions");
}
/** OM model values that defer to a default the caller can't see: `'auto'` picks per main model and environment. */
const IMPLICIT_OM_MODELS = /* @__PURE__ */ new Set(["auto", "default"]);
/**
* Models Observational Memory runs. Observer and reflector each fall back to the other step's model and then to
* an implicit one: `true` runs on the editor's builder default OM model, and a config without a model (or with
* `'auto'`/`'default'`) on Observational Memory's own pick, which depends on the main model and environment.
*/
function observationalMemoryUses(om, field) {
	if (om === true) return [{
		field,
		implicit: "true runs on the default Observational Memory model"
	}];
	if (!isObject(om)) return [];
	const observation = isObject(om.observation) ? om.observation.model : void 0;
	const reflection = isObject(om.reflection) ? om.reflection.model : void 0;
	const uses = [
		[`${field}.model`, om.model],
		[`${field}.observation.model`, observation],
		[`${field}.reflection.model`, reflection]
	].filter((entry) => typeof entry[1] === "string" && !IMPLICIT_OM_MODELS.has(entry[1])).map(([path, model]) => ({
		field: path,
		model
	}));
	const observer = om.model ?? observation ?? reflection;
	const reflector = om.model ?? reflection ?? observation;
	const isImplicit = (model) => typeof model !== "string" || IMPLICIT_OM_MODELS.has(model);
	if (isImplicit(observer) || isImplicit(reflector)) uses.push({
		field,
		implicit: "sets no explicit model, so it runs on an automatically picked default model"
	});
	return uses;
}
/**
* Models inside a stored agent's memory field (static or conditional; inline or bare config): Observational
* Memory's observer/reflector and the title model (without one, titles use the agent's model). Registered
* memory refs carry none.
*/
function memoryUses(memory, field = "memory") {
	return (Array.isArray(memory) ? memory.map((variant, index) => [isObject(variant) ? variant.value : void 0, `${field}[${index}].value`]) : [[memory, field]]).flatMap(([variant, path]) => {
		if (!isObject(variant)) return [];
		const inline = variant.type === "inline";
		const config = inline ? variant.config : variant;
		if (!isObject(config)) return [];
		const configPath = inline ? `${path}.config` : path;
		const title = isObject(config.options) ? config.options.generateTitle : void 0;
		return [...observationalMemoryUses(config.observationalMemory, `${configPath}.observationalMemory`), ...isObject(title) && title.model !== void 0 ? [typeof title.model === "string" ? {
			field: `${configPath}.options.generateTitle.model`,
			model: title.model
		} : {
			field: `${configPath}.options.generateTitle.model`,
			implicit: "is not a model id"
		}] : []];
	});
}
/**
* Models in a stored agent's fallback list, which replaces the models of a code agent that hands its model list
* to the editor. A disabled entry never runs, so it isn't checked; an entry the policy can't read is implicit.
*/
function modelListUses(modelList) {
	if (!Array.isArray(modelList)) return [];
	return modelList.flatMap((entry, index) => {
		if (!isObject(entry) || entry.enabled === false) return [];
		const field = `modelList[${index}]`;
		return typeof entry.provider === "string" && typeof entry.modelId === "string" ? [{
			field,
			model: `${entry.provider}/${entry.modelId}`
		}] : [{
			field,
			implicit: "is not a provider and model id"
		}];
	});
}
/**
* Models inside a stored agent's input or output processor graph (static or conditional), at every nesting depth:
* every model named in each step's config (`config.model` for the built-in providers). A provider whose config
* schema needs a model, given none, is implicit; a `model` that isn't a string is too, since the policy can't check it.
*/
function processorUses(processors, field, editor) {
	const stepUses = (step, path) => {
		if (!isObject(step)) return [];
		const config = isObject(step.config) ? step.config : {};
		const modelField = `${path}.config.model`;
		const named = namedModelUses(config, `${path}.config`);
		if (config.model !== void 0) return named;
		return (typeof step.providerId === "string" ? editor?.getProcessorProvider?.(step.providerId) : void 0)?.configSchema.safeParse({}).error?.issues.some((issue) => issue.path[0] === "model") ? [...named, {
			field: modelField,
			implicit: "is not set, so the processor runs on a default model"
		}] : named;
	};
	const entryUses = (entry, path) => {
		if (!isObject(entry)) return [];
		const list = (entries, at) => Array.isArray(entries) ? entries.flatMap((child, index) => entryUses(child, `${at}[${index}]`)) : [];
		if (entry.type === "step") return stepUses(entry.step, `${path}.step`);
		if (entry.type === "parallel" && Array.isArray(entry.branches)) return entry.branches.flatMap((branch, index) => list(branch, `${path}.branches[${index}]`));
		if (entry.type === "conditional" && Array.isArray(entry.conditions)) return entry.conditions.flatMap((condition, index) => isObject(condition) ? list(condition.steps, `${path}.conditions[${index}].steps`) : []);
		return [];
	};
	return (Array.isArray(processors) ? processors.map((variant, index) => [isObject(variant) ? variant.value : void 0, `${field}[${index}].value`]) : [[processors, field]]).flatMap(([graph, path]) => isObject(graph) && Array.isArray(graph.steps) ? graph.steps.flatMap((entry, index) => entryUses(entry, `${path}.steps[${index}]`)) : []);
}
/**
* The builder model policy and the builder it came from. Unlike the shared helper, which treats a builder that
* fails to resolve as "no policy" so agent runs don't fail, the write tools fail closed: no check, no write.
*/
async function resolvePolicy(editor) {
	if (typeof editor?.resolveBuilder !== "function") return void 0;
	if (typeof editor.hasEnabledBuilderConfig === "function" && !editor.hasEnabledBuilderConfig()) return void 0;
	try {
		const builder = await editor.resolveBuilder();
		const { builderToModelPolicy } = await import('@mastra/core/agent-builder/ee');
		return {
			builder,
			policy: builderToModelPolicy(builder)
		};
	} catch {
		throw toolError(503, { message: "The builder model policy could not be resolved, so the agent was not saved. Try again later." });
	}
}
const describeAllowed = (allowed) => allowed.map((entry) => `${entry.provider}/${entry.modelId ?? "*"}`).join(", ");
/**
* Stored agents (agent builder). The routes enforce `stored-agents:*` permissions, author/visibility
* ownership and builder defaults; the MCP tools also enforce the builder model policy on every model the
* agent will run, which the HTTP routes leave to the Studio model picker.
*/
function addStoredAgentTools(kit) {
	const { mastra, call, addOperation } = kit;
	/**
	* Enforces the builder model policy on every model the agent will run: its model (each conditional variant),
	* models named in its default options, its enabled fallback models, its memory models and its processor models.
	* Models the policy can't check (implicit defaults, unknown shapes) are rejected. On create, omitted memory gets the builder default: the admin's pinned memory, else Observational
	* Memory on its default model (the editor's `BUILDER_BASELINE_DEFAULTS`).
	*/
	const assertModelsAllowed = async (body, isCreate) => {
		const editor = mastra.getEditor();
		const resolved = await resolvePolicy(editor);
		if (!resolved?.policy.active || !resolved.policy.allowed?.length) return;
		const allowed = resolved.policy.allowed;
		let uses;
		if (isCreate && body.memory === void 0) {
			const pinned = resolved.builder?.getConfiguration()?.agent?.memory;
			uses = pinned === void 0 ? [{
				field: "memory",
				implicit: "is omitted, so the builder default turns on Observational Memory with its default model"
			}] : memoryUses(pinned).map((use) => ({
				...use,
				field: `${use.field} (builder default)`
			}));
		} else uses = memoryUses(body.memory);
		uses.unshift(...agentModelUses(body.model));
		uses.push(...defaultOptionsUses(body.defaultOptions), ...modelListUses(body.modelList), ...processorUses(body.inputProcessors, "inputProcessors", editor), ...processorUses(body.outputProcessors, "outputProcessors", editor));
		const { assertModelAllowed: assertAllowed, toModelCandidates } = await import('@mastra/core/agent-builder/ee');
		const problems = [];
		for (const use of uses) {
			if ("implicit" in use) {
				problems.push(`${use.field}: ${use.implicit}, which the builder model policy cannot check; set an allowed model`);
				continue;
			}
			const { model } = use;
			if (toModelCandidates(model).length === 0) {
				problems.push(`${use.field}: ${JSON.stringify(use.model)} is not a provider/model id the policy can check`);
				continue;
			}
			try {
				assertAllowed(allowed, model);
			} catch (error) {
				problems.push(`${use.field}: ${(error instanceof Error ? error.message : "Model not allowed").replace(/\.$/, "")}`);
			}
		}
		if (problems.length > 0) throw toolError(422, { message: `${problems.join("; ")}. Allowed models: ${describeAllowed(allowed)}. Call list_available_models for the models you can use.` });
	};
	const withPublish = (args) => ({
		...args,
		autoPublish: args.autoPublish ?? true
	});
	addOperation(GET_EDITOR_BUILDER_AVAILABLE_MODELS_ROUTE, object({}), (_args, signal) => call(GET_EDITOR_BUILDER_AVAILABLE_MODELS_ROUTE, {}, signal));
	addOperation(LIST_STORED_AGENTS_ROUTE, object({
		status: {
			type: "string",
			enum: [
				"draft",
				"published",
				"archived"
			],
			description: "Defaults to published."
		},
		page: {
			type: "integer",
			minimum: 0,
			description: "Page number, from 0."
		},
		perPage: {
			type: "integer",
			minimum: 1,
			description: "Agents per page. Defaults to 100."
		}
	}), (args, signal) => call(LIST_STORED_AGENTS_ROUTE, { query: args }, signal));
	const storedAgentId = str("Stored agent id. Call list_stored_agents to find ids.");
	addOperation(GET_STORED_AGENT_ROUTE, object({ storedAgentId }, ["storedAgentId"]), (args, signal) => call(GET_STORED_AGENT_ROUTE, { pathParams: { storedAgentId: args.storedAgentId } }, signal));
	addOperation(CREATE_STORED_AGENT_ROUTE, bodySchema(createStoredAgentBodySchema, ["authorId"]), async (args, signal) => {
		await assertModelsAllowed(args, true);
		return call(CREATE_STORED_AGENT_ROUTE, { body: withPublish(args) }, signal);
	});
	addOperation(UPDATE_STORED_AGENT_ROUTE, (() => {
		const schema = bodySchema(updateStoredAgentBodySchema, ["authorId"]);
		return {
			...schema,
			properties: {
				storedAgentId,
				...schema.properties
			},
			required: ["storedAgentId"]
		};
	})(), async (args, signal) => {
		const { storedAgentId: id, ...body } = args;
		await assertModelsAllowed(body, false);
		return call(UPDATE_STORED_AGENT_ROUTE, {
			pathParams: { storedAgentId: id },
			body: withPublish(body)
		}, signal);
	});
}
// src/server/mcp/catalogue.ts
const MAX_TOOL_NAME_LENGTH = 64;
/** A backing route's permission is a read when every permission it accepts has the `read` action. */
function isReadRoute(route) {
	const permission = getEffectivePermission(route);
	if (!permission) return false;
	return (Array.isArray(permission) ? permission : [permission]).every((p) => p.split(":")[1] === "read");
}
function shortHash(value) {
	let hash = 2166136261;
	for (let i = 0; i < value.length; i++) {
		hash ^= value.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0).toString(16).padStart(8, "0").slice(0, 6);
}
/**
* Names entity tools `<prefix>_<id>`, sanitized to `[A-Za-z0-9_-]` and at most 64 characters.
* Ids that are already valid are named first, so they keep the plain name when a sanitized id collides with them.
*/
function nameEntityTools(prefix, ids, used) {
	const names = /* @__PURE__ */ new Map();
	const sanitize = (id) => id.replace(/[^A-Za-z0-9_-]/g, "_");
	const ordered = [...ids].sort((a, b) => {
		const aClean = sanitize(a) === a;
		return aClean === (sanitize(b) === b) ? a.localeCompare(b) : aClean ? -1 : 1;
	});
	for (const id of ordered) {
		let name = `${prefix}_${sanitize(id)}`;
		if (name.length > MAX_TOOL_NAME_LENGTH || used.has(name)) name = `${name.slice(0, 57)}_${shortHash(id)}`;
		used.add(name);
		names.set(id, name);
	}
	return names;
}
/**
* Maps every name of a registered primitive (its `.id` and registration key) to all of its names.
* A name that is some primitive's `.id` resolves to that primitive, as in the handlers' id-first lookups.
*/
function registryNames(...registries) {
	const byId = /* @__PURE__ */ new Map();
	for (const registry of registries) for (const [key, value] of Object.entries(registry ?? {})) {
		const id = typeof value?.id === "string" ? value.id : key;
		const names = byId.get(id) ?? /* @__PURE__ */ new Set([id]);
		names.add(key);
		byId.set(id, names);
	}
	const byName = /* @__PURE__ */ new Map();
	for (const names of byId.values()) for (const name of names) byName.set(name, [...names]);
	for (const [id, names] of byId) byName.set(id, [...names]);
	return byName;
}
function toolError(status, body) {
	const details = body && typeof body === "object" ? body : {};
	const message = details.message ?? details.error ?? (typeof body === "string" ? body : "Request failed");
	const issues = Array.isArray(details.issues) ? ` ${JSON.stringify(details.issues)}` : "";
	return new MastraError({
		id: "MASTRA_MCP_TOOL_CALL_FAILED",
		domain: ErrorDomain.MCP,
		category: status >= 500 ? ErrorCategory.SYSTEM : ErrorCategory.USER,
		text: `${status} ${String(message)}${issues}`,
		details: { status }
	});
}
const missingDescriptionWarnings = /* @__PURE__ */ new WeakMap();
function describeAgent(mastra, id, agent) {
	if (agent?.description) return agent.description;
	let warned = missingDescriptionWarnings.get(mastra);
	if (!warned) missingDescriptionWarnings.set(mastra, warned = /* @__PURE__ */ new Set());
	if (!warned.has(id)) {
		warned.add(id);
		mastra.getLogger()?.warn(`Agent "${id}" has no description; MCP clients get a generic one. Add a description to the agent.`);
	}
	return `Call the ${agent?.name ?? id} agent.`;
}
/**
* Builds the tools one caller sees on the built-in MCP server.
*
* Each tool is backed by a server route and runs it with `dispatchRoute` and the caller's own
* RequestContext, so RBAC, FGA, and the handler's ownership checks are exactly those of the HTTP route.
* Tools the caller would be refused are left out; every call is authorized again.
*/
async function buildBuiltinMCPTools(ctx, config) {
	const { mastra, requestContext } = ctx;
	const capabilities = await getBuiltinMCPCapabilities(mastra);
	const routeContext = {
		mastra,
		requestContext,
		registeredTools: ctx.registeredTools,
		taskStore: ctx.taskStore,
		routePrefix: ctx.routePrefix,
		abortSignal: ctx.abortSignal,
		request: ctx.request
	};
	const mcpExecuteRoute = {
		...ctx.mcpRoute,
		requiresPermission: "mcp:execute"
	};
	const canExecute = checkRouteRBAC(mastra, mcpExecuteRoute, requestContext) === null;
	/** Whether the caller may run this route from a tool: route-level RBAC and read-only mode. */
	const permitted = (route) => canExecute && (!config.readOnly || isReadRoute(route)) && checkRouteRBAC(mastra, route, requestContext) === null;
	/** Whether the route's own tool is offered: permitted, in the configured toolsets, and supported by the server. */
	const offered = (route) => Boolean(route.mcp) && config.toolsets.has(route.mcp.toolset) && (route.mcp.requires?.(capabilities) ?? true) && permitted(route);
	const call = async (route, input, signal) => {
		const denied = checkRouteRBAC(mastra, mcpExecuteRoute, requestContext);
		if (denied) throw toolError(denied.status, denied);
		const abortSignal = signal ? AbortSignal.any([signal, ctx.abortSignal]) : ctx.abortSignal;
		const result = await dispatchRoute(route, input, {
			...routeContext,
			abortSignal
		});
		if (!result.ok) throw toolError(result.status, result.body);
		return result.result;
	};
	const registries = {
		agents: () => registryNames(mastra.listAgents()),
		workflows: () => registryNames(mastra.listWorkflows()),
		tools: () => registryNames(ctx.registeredTools, mastra.listTools())
	};
	const registryCache = /* @__PURE__ */ new Map();
	/** Every name of the registered primitive called `name` (just `name` when it isn't registered). */
	const namesOf = (kind, name) => {
		let names = registryCache.get(kind);
		if (!names) registryCache.set(kind, names = registries[kind]());
		return names.get(name) ?? [name];
	};
	/** Resolves a caller-supplied id with the backing handler's own resolver, then returns every name it has. */
	const resolveNames = async (kind, id) => {
		let resolved;
		try {
			if (kind === "agents") resolved = (await getAgentFromSystem({
				mastra,
				agentId: id,
				requestContext
			})).id;
			else if (kind === "workflows") resolved = (await listWorkflowsFromSystem({
				mastra,
				workflowId: id
			})).workflow.id;
			else resolved = (await findTool({
				mastra,
				registeredTools: ctx.registeredTools,
				toolId: id,
				requestContext
			}))?.id;
		} catch {}
		return [.../* @__PURE__ */ new Set([id, ...resolved ? namesOf(kind, resolved) : []])];
	};
	const requireSelected = async (kind, id, label) => {
		if (!config.isSelected(kind, await resolveNames(kind, id))) throw toolError(404, `${label} not found`);
	};
	/** Keys of listed entities that a configured id list (e.g. `featured`) names by `.id` or registration key. */
	const named = (kind, listed, ids) => [...listed.keys()].filter((key) => namesOf(kind, key).some((name) => ids.includes(name)));
	/** Lists visible entities through the backing list route, so FGA filtering and stored agents are inherited. */
	const listVisible = async (route, kind, query) => {
		if (checkRouteRBAC(mastra, route, requestContext)) return void 0;
		const result = await dispatchRoute(route, { query }, routeContext);
		if (!result.ok) return void 0;
		const entries = Object.entries(result.result ?? {});
		return new Map(entries.filter(([key]) => config.isSelected(kind, namesOf(kind, key))));
	};
	const idParam = (label, ids, listTool) => ids && ids.length > 0 && ids.length <= config.enumLimit ? {
		type: "string",
		enum: ids,
		description: `${label} id. Call ${listTool} for descriptions.`
	} : str(`${label} id. Call ${listTool} to find ids.`);
	const annotationsFor = (route, extra = {}) => isReadRoute(route) ? {
		readOnlyHint: true,
		...extra
	} : {
		readOnlyHint: false,
		destructiveHint: false,
		...extra
	};
	const tools = {};
	const used = /* @__PURE__ */ new Set();
	const add = (name, route, description, inputSchema, execute, options = {}) => {
		used.add(name);
		tools[name] = createTool({
			id: name,
			description,
			inputSchema,
			outputSchema: options.outputSchema,
			mcp: { annotations: options.annotations ?? annotationsFor(route) },
			execute: async (args, context) => execute(args ?? {}, context?.abortSignal)
		});
	};
	const addOperation = (route, inputSchema, execute, options) => {
		if (offered(route)) add(route.mcp.name, route, route.mcp.description, inputSchema, execute, options);
	};
	const matches = (query, ...values) => typeof query !== "string" || values.some((value) => typeof value === "string" && value.toLowerCase().includes(query.toLowerCase()));
	const listInput = (label) => object({ query: str(`Only return ${label} whose id or name contains this text.`) });
	let visibleAgents;
	const listVisibleAgents = () => visibleAgents ??= listVisible(LIST_AGENTS_ROUTE, "agents", { partial: "true" });
	if (config.toolsets.has("agents")) {
		const agents = await listVisibleAgents();
		const agentIds = agents ? [...agents.keys()].sort() : void 0;
		const callAgentOutput = object({
			text: { type: "string" },
			threadId: { type: "string" },
			runId: { type: "string" },
			usage: { type: "object" }
		});
		const callAgent = async (agentId, args, signal) => {
			await requireSelected("agents", agentId, "Agent");
			const { message } = args;
			const resourceId = args.resourceId ?? requestContext.get("mastra__resourceId");
			const threadId = args.threadId ?? (resourceId ? crypto.randomUUID() : void 0);
			const body = { messages: [{
				role: "user",
				content: message
			}] };
			if (threadId || resourceId) body.memory = {
				thread: threadId,
				resource: resourceId
			};
			const result = await call(GENERATE_AGENT_ROUTE, {
				pathParams: { agentId },
				body
			}, signal);
			return {
				text: result?.text ?? "",
				...threadId ? { threadId } : {},
				...result?.runId ? { runId: result.runId } : {},
				...result?.totalUsage || result?.usage ? { usage: result.totalUsage ?? result.usage } : {}
			};
		};
		const messageInput = {
			message: str("The message to send."),
			threadId: str("Conversation thread id. Reuse the threadId from an earlier reply to continue it."),
			resourceId: str("Owner of the conversation memory (for example a user id).")
		};
		const agentAnnotations = {
			readOnlyHint: false,
			destructiveHint: false,
			openWorldHint: true
		};
		addOperation(LIST_AGENTS_ROUTE, listInput("agents"), async (args, signal) => {
			const listed = await call(LIST_AGENTS_ROUTE, { query: { partial: "true" } }, signal);
			return { agents: Object.entries(listed ?? {}).filter(([id, agent]) => config.isSelected("agents", namesOf("agents", id)) && matches(args.query, id, agent?.name)).map(([id, agent]) => ({
				id,
				name: agent?.name,
				description: describeAgent(mastra, id, agent)
			})) };
		});
		addOperation(GET_AGENT_BY_ID_ROUTE, object({ agentId: idParam("Agent", agentIds, "list_agents") }, ["agentId"]), async (args, signal) => {
			await requireSelected("agents", args.agentId, "Agent");
			return call(GET_AGENT_BY_ID_ROUTE, { pathParams: { agentId: args.agentId } }, signal);
		});
		addOperation(GENERATE_AGENT_ROUTE, object({
			agentId: idParam("Agent", agentIds, "list_agents"),
			...messageInput
		}, ["agentId", "message"]), (args, signal) => callAgent(args.agentId, args, signal), {
			annotations: agentAnnotations,
			outputSchema: callAgentOutput
		});
		if (agents && offered(GENERATE_AGENT_ROUTE)) {
			const featured = [];
			for (const id of named("agents", agents, config.featured.agents)) if (!await authorizeRoute(mastra, GENERATE_AGENT_ROUTE, { agentId: id }, requestContext)) featured.push(id);
			for (const [id, name] of nameEntityTools("agent", featured, used)) add(name, GENERATE_AGENT_ROUTE, describeAgent(mastra, id, agents.get(id)), object(messageInput, ["message"]), (args, signal) => callAgent(id, args, signal), {
				annotations: agentAnnotations,
				outputSchema: callAgentOutput
			});
		}
	}
	if (config.toolsets.has("workflows")) {
		const workflows = await listVisible(LIST_WORKFLOWS_ROUTE, "workflows", { partial: "true" });
		const workflowIds = workflows ? [...workflows.keys()].sort() : void 0;
		const workflowId = () => idParam("Workflow", workflowIds, "list_workflows");
		const runId = str("Workflow run id.");
		/** Suspended runs return what a client needs to resume them with resume_workflow_run. */
		const toRunResult = (id, result) => result?.status === "suspended" ? {
			status: "suspended",
			runId: id,
			suspendPayload: result.suspendPayload,
			suspendedSteps: result.suspended
		} : {
			runId: id,
			...result
		};
		const startWorkflow = async (id, args, signal) => {
			await requireSelected("workflows", id, "Workflow");
			const run = args.runId ?? crypto.randomUUID();
			const result = await call(START_ASYNC_WORKFLOW_ROUTE, {
				pathParams: { workflowId: id },
				query: { runId: run },
				body: { inputData: args.inputData }
			}, signal);
			return toRunResult(run, result);
		};
		addOperation(LIST_WORKFLOWS_ROUTE, listInput("workflows"), async (args, signal) => {
			const listed = await call(LIST_WORKFLOWS_ROUTE, { query: { partial: "true" } }, signal);
			return { workflows: Object.entries(listed ?? {}).filter(([id, workflow]) => config.isSelected("workflows", namesOf("workflows", id)) && matches(args.query, id, workflow?.name)).map(([id, workflow]) => ({
				id,
				name: workflow?.name,
				description: workflow?.description
			})) };
		});
		addOperation(GET_WORKFLOW_BY_ID_ROUTE, object({ workflowId: workflowId() }, ["workflowId"]), async (args, signal) => {
			await requireSelected("workflows", args.workflowId, "Workflow");
			return call(GET_WORKFLOW_BY_ID_ROUTE, { pathParams: { workflowId: args.workflowId } }, signal);
		});
		addOperation(START_ASYNC_WORKFLOW_ROUTE, object({
			workflowId: workflowId(),
			inputData: { description: "Input matching the workflow input schema (see get_workflow)." },
			runId: str("Optional id for the new run.")
		}, ["workflowId"]), (args, signal) => startWorkflow(args.workflowId, args, signal));
		addOperation(GET_WORKFLOW_RUN_BY_ID_ROUTE, object({
			workflowId: workflowId(),
			runId,
			fields: str("Comma-separated fields to return: result, error, payload, steps, activeStepsPath.")
		}, ["workflowId", "runId"]), async (args, signal) => {
			await requireSelected("workflows", args.workflowId, "Workflow");
			return call(GET_WORKFLOW_RUN_BY_ID_ROUTE, {
				pathParams: {
					workflowId: args.workflowId,
					runId: args.runId
				},
				query: args.fields ? { fields: args.fields } : {}
			}, signal);
		});
		addOperation(RESUME_ASYNC_WORKFLOW_ROUTE, object({
			workflowId: workflowId(),
			runId,
			step: str("Suspended step to resume. Defaults to the suspended step."),
			resumeData: { description: "Data the suspended step asked for." }
		}, ["workflowId", "runId"]), async (args, signal) => {
			await requireSelected("workflows", args.workflowId, "Workflow");
			const result = await call(RESUME_ASYNC_WORKFLOW_ROUTE, {
				pathParams: { workflowId: args.workflowId },
				query: { runId: args.runId },
				body: {
					step: args.step,
					resumeData: args.resumeData
				}
			}, signal);
			return toRunResult(args.runId, result);
		});
		addOperation(CANCEL_WORKFLOW_RUN_ROUTE, object({
			workflowId: workflowId(),
			runId
		}, ["workflowId", "runId"]), async (args, signal) => {
			await requireSelected("workflows", args.workflowId, "Workflow");
			return call(CANCEL_WORKFLOW_RUN_ROUTE, { pathParams: {
				workflowId: args.workflowId,
				runId: args.runId
			} }, signal);
		}, { annotations: {
			readOnlyHint: false,
			destructiveHint: true
		} });
		if (workflows && offered(START_ASYNC_WORKFLOW_ROUTE)) {
			const registered = mastra.listWorkflows();
			const featured = /* @__PURE__ */ new Map();
			for (const key of named("workflows", workflows, config.featured.workflows)) {
				const id = registered[key]?.id ?? key;
				if (!await authorizeRoute(mastra, START_ASYNC_WORKFLOW_ROUTE, { workflowId: id }, requestContext)) featured.set(id, key);
			}
			for (const [id, name] of nameEntityTools("workflow", [...featured.keys()], used)) {
				const key = featured.get(id);
				const inputSchema = toJSONSchema(registered[key]?.inputSchema);
				const isObject = inputSchema?.type === "object";
				add(name, START_ASYNC_WORKFLOW_ROUTE, workflows.get(key)?.description ?? registered[key]?.description ?? `Run the ${id} workflow.`, isObject ? inputSchema : object({ inputData: inputSchema ?? {} }), (args, signal) => startWorkflow(id, { inputData: isObject ? args : args.inputData }, signal));
			}
		}
	}
	if (config.toolsets.has("tools")) {
		const listed = await listVisible(LIST_TOOLS_ROUTE, "tools");
		const visible = listed ? [...listed.keys()].map((key) => {
			const tool = ctx.registeredTools?.[key] ?? mastra.listTools()?.[key];
			return {
				key,
				id: tool?.id ?? key,
				tool
			};
		}) : [];
		if (listed !== void 0 && visible.length <= config.enumLimit && offered(EXECUTE_TOOL_ROUTE)) {
			const allowed = [];
			for (const entry of visible) if (!await authorizeRoute(mastra, EXECUTE_TOOL_ROUTE, { toolId: entry.id }, requestContext)) allowed.push(entry);
			const byId = new Map(allowed.map((entry) => [entry.id, entry]));
			for (const [id, name] of nameEntityTools("tool", [...byId.keys()], used)) {
				const { tool } = byId.get(id);
				const inputSchema = toJSONSchema(tool?.inputSchema);
				const isObject = inputSchema?.type === "object";
				add(name, EXECUTE_TOOL_ROUTE, tool?.description ?? `Call the ${id} tool.`, isObject ? inputSchema : object({ data: inputSchema ?? {} }), async (args, signal) => {
					await requireSelected("tools", id, "Tool");
					return call(EXECUTE_TOOL_ROUTE, {
						pathParams: { toolId: id },
						body: { data: isObject ? args : args.data }
					}, signal);
				}, { annotations: {
					readOnlyHint: false,
					destructiveHint: false,
					...tool?.mcp?.annotations
				} });
			}
		} else {
			const toolIds = listed ? visible.map((entry) => entry.id).sort() : void 0;
			const toolId = () => idParam("Tool", toolIds, "list_tools");
			addOperation(LIST_TOOLS_ROUTE, listInput("tools"), async (args, signal) => {
				const tools = await call(LIST_TOOLS_ROUTE, {}, signal);
				return { tools: Object.entries(tools ?? {}).map(([key, tool]) => ({
					key,
					id: tool?.id ?? key,
					description: tool?.description
				})).filter((tool) => config.isSelected("tools", [...namesOf("tools", tool.key), tool.id]) && matches(args.query, tool.id)).map(({ id, description }) => ({
					id,
					description
				})) };
			});
			addOperation(GET_TOOL_BY_ID_ROUTE, object({ toolId: toolId() }, ["toolId"]), async (args, signal) => {
				await requireSelected("tools", args.toolId, "Tool");
				return call(GET_TOOL_BY_ID_ROUTE, { pathParams: { toolId: args.toolId } }, signal);
			});
			addOperation(EXECUTE_TOOL_ROUTE, object({
				toolId: toolId(),
				data: { description: "Input matching the tool input schema (see get_tool)." }
			}, ["toolId"]), async (args, signal) => {
				await requireSelected("tools", args.toolId, "Tool");
				return call(EXECUTE_TOOL_ROUTE, {
					pathParams: { toolId: args.toolId },
					body: { data: args.data }
				}, signal);
			});
		}
	}
	const kit = {
		mastra,
		requestContext,
		config,
		capabilities,
		offered,
		permitted,
		call,
		add,
		addOperation,
		addCombined: (routes, inputSchema, execute) => {
			if (routes.every(offered)) add(routes[0].mcp.name, routes[0], routes[0].mcp.description, inputSchema, execute);
		},
		visibleAgentIds: async () => {
			const agents = await listVisibleAgents();
			return agents ? [...agents.keys()].sort() : void 0;
		},
		requireSelected,
		idParam
	};
	if (config.toolsets.has("memory")) await addMemoryTools(kit);
	addObservabilityTools(kit);
	if (config.toolsets.has("stored_agents")) addStoredAgentTools(kit);
	return tools;
}

export { buildBuiltinMCPTools };
