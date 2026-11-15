import { ad as normalizeRoutePath, ae as findMatchingCustomRoute, af as isReservedRequestContextKey, ag as isStudioClientTypeHeader, ah as MASTRA_IS_STUDIO_KEY, ai as MASTRA_AUTH_MODE_KEY, aj as coreAuthMiddleware, ak as MASTRA_USER_KEY, al as MASTRA_USER_PERMISSIONS_KEY, am as SERVER_ROUTES, an as pathMatchesPattern, ao as isCustomRoutePublic, ap as Hono, aq as CustomRouteMatcher, ar as isProtectedCustomRoute, as as generateOpenAPIDocument, at as convertCustomRoutesToOpenAPIPaths, au as resolveServerRoute, av as HTTPException, aw as OPT_IN_ROUTES, ax as MASTRA_CLIENT_TYPE_HEADER, F as getEffectivePermission, ay as resolveBuiltinMCPPath, az as createRoute, aA as formatZodError, aB as MASTRA_AUTH_TOKEN_KEY, aC as RESERVED_REQUEST_CONTEXT_KEYS, aD as isBuiltinMCPEnabled, aE as MASTRA_RESOURCE_ID_KEY, aF as canAccessPublicly, aG as authorizeAuthenticatedUser, aH as isZodError } from './routes-CmkPohqd.mjs';
import { z } from 'zod/v4';
import { Readable } from 'stream';
import { hasPermission } from '@mastra/core/auth/ee';
import { RequestContext } from '@mastra/core/request-context';
import { MastraServerBase } from '@mastra/core/server';
import { safeStringify } from '@mastra/core/utils';
import { pipeline } from 'stream/promises';

// src/server/mcp/oauth.ts
/** RFC 9728 well-known path for OAuth protected-resource metadata. */
const OAUTH_PROTECTED_RESOURCE_PATH = "/.well-known/oauth-protected-resource";
const warnedAudience = /* @__PURE__ */ new WeakSet();
const resourceValidity = /* @__PURE__ */ new WeakMap();
const LOOPBACK_HOSTS = /* @__PURE__ */ new Set([
	"localhost",
	"127.0.0.1",
	"[::1]"
]);
/** `server.auth` when it is a provider instance (only providers carry the OAuth hooks). */
function getAuthProvider(mastra) {
	const auth = mastra.getServer()?.auth;
	return auth && typeof auth.authenticateToken === "function" ? auth : void 0;
}
function getOAuthConfig(mastra) {
	return mastra.getServer()?.mcp?.oauth ?? {};
}
/** RFC 9728 resource identifier: absolute https URL (http only for loopback hosts) without a fragment. */
function isValidResourceUrl(resource) {
	let url;
	try {
		url = new URL(resource);
	} catch {
		return false;
	}
	if (resource.includes("#")) return false;
	return url.protocol === "https:" || url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
}
/** Whether `server.mcp.oauth.resource` is unset or valid. Logs one error per instance when it isn't. */
function hasValidResource(mastra) {
	const { resource } = getOAuthConfig(mastra);
	if (resource === void 0) return true;
	let valid = resourceValidity.get(mastra);
	if (valid === void 0) {
		valid = isValidResourceUrl(resource);
		resourceValidity.set(mastra, valid);
		if (!valid) mastra.getLogger()?.error(`server.mcp.oauth.resource "${resource}" is not an absolute https URL without a fragment (http is only allowed for localhost). OAuth discovery for the built-in MCP server is disabled. Token audience checks still use this value, so MCP requests are rejected unless the token audience matches it exactly.`);
	}
	return valid;
}
function isBuiltinMCPAuthenticated(mastra) {
	return Boolean(mastra.getServer()?.auth) && isBuiltinMCPEnabled(mastra);
}
/**
* Whether OAuth discovery applies: the built-in MCP endpoint is on, requires auth, and any configured
* `server.mcp.oauth.resource` is valid. Gates the well-known routes and the `resource_metadata` challenge.
*/
function isMCPOAuthDiscoveryEnabled(mastra) {
	return isBuiltinMCPAuthenticated(mastra) && hasValidResource(mastra);
}
/**
* Whether the built-in MCP endpoint checks token audience: `server.mcp.oauth.resource` is set. An invalid value
* only turns discovery off; the audience is still checked against it, so a config typo fails closed.
*/
function isMCPAudienceEnforced(mastra) {
	return isBuiltinMCPAuthenticated(mastra) && getOAuthConfig(mastra).resource !== void 0;
}
/** Canonical URL of the MCP endpoint: `server.mcp.oauth.resource`, else derived from the request. */
function resolveMCPResource(mastra, prefix, requestUrl) {
	return getOAuthConfig(mastra).resource ?? `${new URL(requestUrl).origin}${prefix}${resolveBuiltinMCPPath(mastra)}`;
}
/** Absolute URL of the path-suffixed metadata document advertised in `WWW-Authenticate`. */
function mcpResourceMetadataUrl(mastra, prefix, requestUrl) {
	return `${new URL(getOAuthConfig(mastra).resource ?? requestUrl).origin}${OAUTH_PROTECTED_RESOURCE_PATH}${prefix}${resolveBuiltinMCPPath(mastra)}`;
}
/** RFC 9728 metadata for the built-in MCP endpoint. Unset optional fields are omitted. */
function resolveMCPResourceMetadata(mastra, prefix, requestUrl) {
	const config = getOAuthConfig(mastra);
	const hints = getAuthProvider(mastra)?.getOAuthMetadata?.();
	const authorizationServers = config.authorizationServers ?? hints?.authorizationServers;
	const scopesSupported = config.scopesSupported ?? hints?.scopesSupported;
	return {
		resource: resolveMCPResource(mastra, prefix, requestUrl),
		...authorizationServers?.length ? { authorization_servers: authorizationServers } : {},
		...scopesSupported?.length ? { scopes_supported: scopesSupported } : {},
		bearer_methods_supported: ["header"]
	};
}
/**
* `WWW-Authenticate` value for a 401 from the built-in MCP endpoint (RFC 6750 §3 auth-params, quoted and escaped).
* `resource_metadata` is only included while discovery is enabled.
*/
function mcpWWWAuthenticate(mastra, prefix, requestUrl, error) {
	const params = {
		...isMCPOAuthDiscoveryEnabled(mastra) ? { resource_metadata: mcpResourceMetadataUrl(mastra, prefix, requestUrl) } : {},
		...error
	};
	return `Bearer ${Object.entries(params).filter(([, value]) => value !== void 0).map(([key, value]) => `${key}="${value.replace(/[\\"]/g, "\\$&")}"`).join(", ")}`;
}
/** The innermost provider that authenticated `user`, looking through `CompositeAuth`. Undefined when unknown. */
function authenticatingLeaf(provider, user) {
	const composite = provider;
	if (typeof composite.getAuthenticatedProvider !== "function") return provider;
	const inner = composite.getAuthenticatedProvider(user);
	return inner && authenticatingLeaf(inner, user);
}
/**
* When `server.mcp.oauth.resource` is set, the token's audience must include it. A provider that can't check the
* audience is accepted, unless `requireAudience` is on: then the request is rejected.
*/
async function checkMCPAudience(mastra, user) {
	const { resource, requireAudience } = getOAuthConfig(mastra);
	if (resource === void 0) return true;
	const provider = getAuthProvider(mastra);
	if (requireAudience) {
		if (typeof (provider && authenticatingLeaf(provider, user))?.verifyAudience !== "function") return false;
	}
	if (typeof provider?.verifyAudience !== "function") return true;
	return provider.verifyAudience(user, resource);
}
function leafProviders(provider) {
	const inner = provider.getProviders?.();
	return inner ? inner.flatMap(leafProviders) : [provider];
}
/** Warns once when `server.mcp.oauth.resource` is set but some provider cannot check token audience. */
function warnOnUnenforcedMCPAudience(mastra) {
	if (warnedAudience.has(mastra) || getOAuthConfig(mastra).resource === void 0) return;
	warnedAudience.add(mastra);
	if (!mastra.getServer()?.auth) return;
	const provider = getAuthProvider(mastra);
	const unenforced = provider ? leafProviders(provider).filter((p) => typeof p.verifyAudience !== "function").map((p) => p.name || "server.auth") : ["server.auth"];
	if (!unenforced.length) return;
	const consequence = getOAuthConfig(mastra).requireAudience ? "requireAudience is on, so MCP requests authenticated by them are rejected." : "MCP requests authenticated by them are accepted for any audience. Set server.mcp.oauth.requireAudience to reject them.";
	mastra.getLogger()?.warn(`server.mcp.oauth.resource is set, but ${unenforced.join(", ")} cannot check the token audience: ${consequence}`);
}
/**
* Public routes serving the metadata at `/.well-known/oauth-protected-resource` and its path-suffixed
* form for the MCP endpoint. Mounted at the server root (outside the API prefix), not in SERVER_ROUTES.
*/
function createMCPOAuthMetadataRoutes(mastra, prefix) {
	return [OAUTH_PROTECTED_RESOURCE_PATH, `${OAUTH_PROTECTED_RESOURCE_PATH}${prefix}${resolveBuiltinMCPPath(mastra)}`].map((path) => createRoute({
		method: "GET",
		path,
		responseType: "datastream-response",
		summary: "OAuth protected-resource metadata",
		description: "RFC 9728 metadata for the built-in MCP endpoint",
		tags: ["MCP"],
		requiresAuth: false,
		handler: async ({ mastra, request }) => Response.json(resolveMCPResourceMetadata(mastra, prefix, request?.url ?? `http://localhost${path}`), { headers: { "Cache-Control": "no-store" } })
	}));
}
// src/server/server-adapter/routes/fga-manifest.ts
function isProtectedFGARoute$1(route) {
	return route.requiresAuth !== false;
}
function getToolRoutePermission(path) {
	return path.includes("/execute") ? "tools:execute" : "tools:read";
}
function getAgentToolResourceId(agentId, toolId) {
	return `${agentId}:${toolId}`;
}
function getMCPToolResourceId(serverId, toolId) {
	return JSON.stringify([serverId, toolId]);
}
const STORED_ROUTE_FGA = {
	agents: {
		resourceType: "stored-agents",
		idParams: ["storedAgentId", "agentId"]
	},
	"mcp-clients": {
		resourceType: "stored-mcp-clients",
		idParams: ["storedMCPClientId", "mcpClientId"]
	},
	"prompt-blocks": {
		resourceType: "stored-prompt-blocks",
		idParams: ["storedPromptBlockId", "promptBlockId"]
	},
	scorers: {
		resourceType: "stored-scorers",
		idParams: ["storedScorerId", "scorerId"]
	},
	skills: {
		resourceType: "stored-skills",
		idParams: ["storedSkillId"]
	},
	workspaces: {
		resourceType: "stored-workspaces",
		idParams: ["storedWorkspaceId"]
	}
};
function getStoredResourceRouteFGAConfig(path, permission) {
	const match = path.match(/^\/stored\/([^/]+)/);
	if (!match?.[1]) return null;
	const config = STORED_ROUTE_FGA[match[1]];
	if (!config) return null;
	return {
		resourceType: config.resourceType,
		resourceId: (params, { requestContext }) => {
			for (const idParam of config.idParams) {
				const id = params[idParam];
				if (typeof id === "string" && id) return id;
			}
			const scopedResourceId = requestContext?.get(MASTRA_RESOURCE_ID_KEY);
			return typeof scopedResourceId === "string" && scopedResourceId ? scopedResourceId : config.resourceType;
		},
		permission
	};
}
function getBuiltInRouteFGAConfig(route) {
	if (!isProtectedFGARoute$1(route) || !route.path || !route.method) return null;
	const permission = getEffectivePermission(route);
	if (!permission) return null;
	const path = route.path;
	const storedRouteConfig = getStoredResourceRouteFGAConfig(path, permission);
	if (storedRouteConfig) return storedRouteConfig;
	if (path.startsWith("/agents/:agentId/tools/:toolId")) return {
		resourceType: "tool",
		resourceId: ({ agentId, toolId }) => getAgentToolResourceId(String(agentId), String(toolId)),
		permission: getToolRoutePermission(path)
	};
	if (path.startsWith("/agents/:agentId")) return {
		resourceType: "agent",
		resourceIdParam: "agentId",
		permission
	};
	if (path.startsWith("/workflows/:workflowId")) return {
		resourceType: "workflow",
		resourceIdParam: "workflowId",
		permission
	};
	if (path.startsWith("/tools/:toolId")) return {
		resourceType: "tool",
		resourceIdParam: "toolId",
		permission
	};
	if (path.startsWith("/mcp/:serverId/tools/:toolId")) return {
		resourceType: "tool",
		resourceId: ({ serverId, toolId }) => getMCPToolResourceId(String(serverId), String(toolId)),
		permission: getToolRoutePermission(path)
	};
	if (path.startsWith("/mcp/:serverId")) return {
		resourceType: "mcp",
		resourceIdParam: "serverId",
		permission
	};
	if (path.startsWith("/knowledge/:knowledgeKey")) return {
		resourceType: "knowledge",
		resourceIdParam: "knowledgeKey",
		permission
	};
	if (path.startsWith("/memory/threads/:threadId") || path.startsWith("/memory/network/threads/:threadId")) return {
		resourceType: "thread",
		resourceIdParam: "threadId",
		permission
	};
	if (path === "/memory/threads" || path === "/memory/network/threads") return {
		resourceType: "thread",
		resourceId: ({ threadId, resourceId }) => {
			if (typeof threadId === "string") return threadId;
			return typeof resourceId === "string" ? resourceId : void 0;
		},
		permission
	};
	if (path === "/memory/save-messages" || path === "/memory/network/save-messages") return {
		resourceType: "thread",
		resourceId: ({ messages }) => {
			if (!Array.isArray(messages)) return void 0;
			const threadId = messages.find((message) => message && typeof message === "object" && "threadId" in message)?.threadId;
			return typeof threadId === "string" ? threadId : void 0;
		},
		permission
	};
	if (path === "/v1/responses") return {
		resourceType: "agent",
		resourceIdParam: "agent_id",
		permission
	};
	if (path.startsWith("/v1/responses/:responseId")) return {
		resourceType: "response",
		resourceIdParam: "responseId",
		permission
	};
	if (path === "/v1/conversations") return {
		resourceType: "agent",
		resourceIdParam: "agent_id",
		permission
	};
	if (path.startsWith("/v1/conversations/:conversationId")) return {
		resourceType: "conversation",
		resourceIdParam: "conversationId",
		permission
	};
	return null;
}
// src/server/server-adapter/mcp-auth.ts
/**
* Key under which `applyMcpRequestAuth` attaches the trusted request context to
* `req.auth`. `@mastra/mcp` reads the same registered symbol and copies the
* values into the request context its tools receive. A symbol cannot come out
* of a token or JSON payload, so only server code can supply it.
*/
const MCP_TRUSTED_REQUEST_CONTEXT = Symbol.for("mastra.mcp.trustedRequestContext");
function normalizeScopes(value) {
	if (Array.isArray(value)) return value.filter((s) => typeof s === "string");
	if (typeof value === "string") return value.split(/[\s,]+/).filter(Boolean);
	return [];
}
function resolveClientId(user) {
	for (const key of [
		"id",
		"sub",
		"userId",
		"email"
	]) {
		const value = user[key];
		if (typeof value === "string" && value) return value;
	}
	return "";
}
/**
* Build the default `AuthInfo` from the Mastra request context.
*
* Returns `undefined` when the request carries no identity at all, so servers
* without auth keep behaving exactly as before.
*/
function buildMcpAuthInfoFromRequestContext(requestContext) {
	const user = requestContext.get(MASTRA_USER_KEY);
	const token = requestContext.get(MASTRA_AUTH_TOKEN_KEY);
	const hasUser = !!user && typeof user === "object";
	const hasToken = typeof token === "string" && token.length > 0;
	if (!hasUser && !hasToken) return void 0;
	const userRecord = hasUser ? user : {};
	return {
		token: hasToken ? token : "",
		clientId: resolveClientId(userRecord),
		scopes: normalizeScopes(userRecord.scopes ?? userRecord.scope ?? userRecord.permissions),
		...hasUser ? { extra: { user: userRecord } } : {}
	};
}
/**
* Populate `req.auth` on the Node request that is about to be handed to an MCP
* transport.
*
* Resolution order:
* 1. An already-set `req.auth` keeps its identity.
* 2. A configured `setRequestAuth` hook runs and fully owns the result.
* 3. Otherwise the principal resolved by Mastra server auth is bridged from the
*    request context using the default mapping.
*
* Whichever way `req.auth` is set, the trusted request context is attached to
* it so MCP tools see the same principal as Mastra routes.
*/
async function applyMcpRequestAuth({ req, requestContext, setRequestAuth }) {
	const request = req;
	if (!requestContext) return;
	if (!request.auth) {
		if (setRequestAuth) await setRequestAuth(req, requestContext);
		else {
			const authInfo = buildMcpAuthInfoFromRequestContext(requestContext);
			if (authInfo) request.auth = authInfo;
		}
	}
	if (request.auth && typeof request.auth === "object") attachTrustedRequestContext(request.auth, requestContext);
}
/**
* Hands MCP tools the values Mastra server auth resolved for this request
* (user, permissions, roles, resource id, tenant, auth mode), so a tool called
* over MCP is authorized the same way as the matching HTTP route. The token is
* left out; it is already on `authInfo`.
*/
function attachTrustedRequestContext(auth, requestContext) {
	const trusted = {};
	for (const key of RESERVED_REQUEST_CONTEXT_KEYS) {
		if (key === "mastra__authToken" || !requestContext.has(key)) continue;
		trusted[key] = requestContext.get(key);
	}
	Object.defineProperty(auth, MCP_TRUSTED_REQUEST_CONTEXT, {
		value: trusted,
		configurable: true
	});
}
// src/server/server-adapter/mcp-disconnect.ts
/**
* Forwards a fetch `Request` abort to the simulated Node response used by fetch-based
* adapters (Hono, Elysia, Next) to drive the MCP Node transport.
*
* `fetch-to-node`'s `toReqRes` ignores `Request.signal`, and the MCP Node transport only
* aborts an in-flight request when `res` emits `close`. Without this, a client that
* disconnects before any response bytes are sent leaves the tool call running to completion.
*
* Call it after `startHTTP` has been invoked so the transport's `close` listener is attached.
*/
function propagateRequestAbort(signal, res) {
	if (!signal) return;
	const onAbort = () => {
		if (res.writableFinished) return;
		try {
			res.emit("close");
		} catch {}
	};
	if (signal.aborted) {
		onAbort();
		return;
	}
	signal.addEventListener("abort", onAbort, { once: true });
	res.once("finish", () => signal.removeEventListener("abort", onAbort));
}
// src/server/server-adapter/redact.ts
/**
* Redacts request data from a v2 format payload.
* Removes `metadata.request` and `output.steps[].request` from the payload.
*/
function redactV2Payload(payload) {
	const redactedPayload = { ...payload };
	if (redactedPayload.metadata && typeof redactedPayload.metadata === "object") {
		const { request, ...metadataRest } = redactedPayload.metadata;
		redactedPayload.metadata = metadataRest;
	}
	if (redactedPayload.output && typeof redactedPayload.output === "object") {
		const output = { ...redactedPayload.output };
		if (Array.isArray(output.steps)) output.steps = output.steps.map((step) => {
			if (step && typeof step === "object") {
				const { request, ...stepRest } = step;
				return stepRest;
			}
			return step;
		});
		redactedPayload.output = output;
	}
	return redactedPayload;
}
/**
* Redacts sensitive data from stream chunks before they are sent to clients.
*
* This function strips out request bodies that may contain sensitive information
* such as system prompts, tool definitions, API keys, and other configuration data.
*
* Handles both v1 (legacy) and v2 stream formats:
*
* v1 format (fields at root level):
* - `step-start.request` - Contains the full LLM request body
* - `step-finish.request` - Contains the request body
* - `finish.request` - Contains the request body (if present)
*
* v2 format (fields nested in payload):
* - `step-start.payload.request` - Contains the full LLM request body
* - `step-finish.payload.metadata.request` - Contains the request metadata
* - `step-finish.payload.output.steps[].request` - Contains request data for each step
* - `finish.payload.metadata.request` - Contains the request metadata
* - `finish.payload.output.steps[].request` - Contains request data for each step
*
* @param chunk - The stream chunk to redact
* @returns A new chunk with sensitive data removed, or the original chunk if no redaction needed
*/
function redactStreamChunk(chunk) {
	if (!chunk || typeof chunk !== "object") return chunk;
	const typedChunk = chunk;
	switch (chunk.type) {
		case "step-start":
			if ("payload" in typedChunk && typedChunk.payload && typeof typedChunk.payload === "object") {
				const { payload, ...rest } = typedChunk;
				const { request, ...payloadRest } = payload;
				return {
					...rest,
					type: "step-start",
					payload: {
						...payloadRest,
						request: {}
					}
				};
			} else if ("request" in typedChunk) {
				const { request, ...rest } = typedChunk;
				return {
					...rest,
					type: "step-start",
					request: {}
				};
			}
			return chunk;
		case "step-finish":
			if ("payload" in typedChunk && typedChunk.payload && typeof typedChunk.payload === "object") {
				const { payload, ...rest } = typedChunk;
				return {
					...rest,
					type: "step-finish",
					payload: redactV2Payload(payload)
				};
			} else if ("request" in typedChunk) {
				const { request, ...rest } = typedChunk;
				return {
					...rest,
					type: "step-finish"
				};
			}
			return chunk;
		case "finish":
			if ("payload" in typedChunk && typedChunk.payload && typeof typedChunk.payload === "object") {
				const { payload, ...rest } = typedChunk;
				return {
					...rest,
					type: "finish",
					payload: redactV2Payload(payload)
				};
			} else if ("request" in typedChunk) {
				const { request, ...rest } = typedChunk;
				return {
					...rest,
					type: "finish"
				};
			}
			return chunk;
		default: return chunk;
	}
}
// src/server/server-adapter/serialize.ts
/**
* Serializes a stream chunk to JSON for wire transport.
*
* Stream chunks can contain values that plain `JSON.stringify` throws on
* (e.g. BigInt produced by zod coercions/transforms in structuredOutput
* schemas, or circular references) — `safeStringify` handles those. A single
* bad chunk must never kill the whole stream — Studio relies on later chunks
* (`workflow-step-result`, `workflow-finish`) to render run state.
*
* Returns `{ ok: false, error }` if the chunk cannot be serialized at all
* (e.g. a throwing getter/toJSON) — callers should log the error, skip the
* chunk, and keep streaming.
*/
function serializeStreamChunk(chunk) {
	try {
		return {
			ok: true,
			json: safeStringify(withPlainPayloadError(chunk))
		};
	} catch (error) {
		return {
			ok: false,
			error: error instanceof Error ? error : new Error(String(error))
		};
	}
}
/**
* `JSON.stringify(new Error('x'))` keeps only own enumerable fields, so an Error subclass that sets `name`
* arrives as `{ name }` and clients show `[object Object]`. Send the message too; never the stack. An
* error whose class curates its JSON (`toJSON`, e.g. MastraError) keeps that shape, so fields it leaves
* out stay out.
*/
function withPlainPayloadError(chunk) {
	if (!chunk || typeof chunk !== "object" || !("payload" in chunk)) return chunk;
	const { payload } = chunk;
	if (!payload || typeof payload !== "object" || !("error" in payload)) return chunk;
	const { error } = payload;
	if (!(error instanceof Error)) return withoutStack(chunk, payload, error);
	const plain = {
		...curatedJson(error) ?? error,
		message: error.message
	};
	delete plain.stack;
	if (!plain.name && error.name !== "Error") plain.name = error.name;
	return {
		...chunk,
		payload: {
			...payload,
			error: plain
		}
	};
}
/** An error that is already a plain object (a replayed one) is kept as is, minus its stack. */
function withoutStack(chunk, payload, error) {
	if (!error || typeof error !== "object" || Array.isArray(error) || !("stack" in error)) return chunk;
	const { stack: _stack, ...rest } = error;
	return {
		...chunk,
		payload: {
			...payload,
			error: rest
		}
	};
}
function curatedJson(error) {
	const toJSON = error.toJSON;
	if (typeof toJSON !== "function") return void 0;
	try {
		const json = toJSON.call(error);
		return json && typeof json === "object" ? json : void 0;
	} catch {
		return;
	}
}
// src/server/server-adapter/index.ts
function getCustomHTTPExceptionResponse(error) {
	if (!(error instanceof HTTPException) || !error.res) return;
	return error.getResponse();
}
/**
* Response for an HTTPException thrown from a `registerApiRoute` handler, or undefined for
* any other error (which callers keep behind a generic 500). Duck-typed so an HTTPException
* from `hono/http-exception`, possibly a separate Hono install, is recognised too.
*/
function getCustomRouteHTTPExceptionResponse(error) {
	if (!(error instanceof Error)) return void 0;
	const httpError = error;
	const status = httpError.status;
	if (typeof httpError.getResponse !== "function" || typeof status !== "number" || !Number.isInteger(status) || status < 400 || status > 599) return;
	if (httpError.res) return httpError.getResponse.call(httpError);
	return Response.json({ error: httpError.message }, { status });
}
/**
* Only allowlisted causes are exposed to clients; any other cause stays server-side:
* - `cause.failingItems` (dataset schema-update rejections)
* - `cause.field` + `cause.errors` (schema validation failures), reduced to each error's path and message
*/
function getSafeErrorCause(error) {
	try {
		const raw = error instanceof Error ? error.cause : void 0;
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) return void 0;
		if (Array.isArray(raw.failingItems)) return { failingItems: raw.failingItems };
		const { field, errors } = raw;
		if (typeof field === "string" && Array.isArray(errors)) return {
			field,
			errors: errors.flatMap((e) => e && typeof e.path === "string" && typeof e.message === "string" ? [{
				path: e.path,
				message: e.message
			}] : [])
		};
	} catch {}
}
/**
* Maps a handler error to the status and JSON body every adapter sends:
* `error.status` (HTTPException) first, then `error.details.status` (MastraError), else 500.
*/
function getHTTPErrorResponse(error) {
	const message = error instanceof Error ? error.message : "Unknown error";
	if (error && typeof error === "object") {
		if ("status" in error) {
			const cause = getSafeErrorCause(error);
			return {
				status: error.status,
				body: {
					error: message,
					...cause ? { cause } : {}
				}
			};
		}
		if ("details" in error && error.details && typeof error.details === "object" && "status" in error.details) return {
			status: error.details.status,
			body: { error: message }
		};
	}
	return {
		status: 500,
		body: { error: message }
	};
}
/**
* Hono/adapter context key set by the framework-public middleware.
*
* When true, the current request targets a route the framework has declared
* public (via `createPublicRoute()` / `requiresAuth: false`). Adapter authors
* MUST short-circuit any user-registered middleware for such requests so that
* users cannot accidentally (or intentionally) 401 routes the framework needs
* to keep reachable (e.g. Studio sign-in endpoints).
*/
const MASTRA_FRAMEWORK_PUBLIC_KEY = "__mastraFrameworkPublic";
const AGENT_CHANNEL_WEBHOOK_PATH = /^\/api\/agents\/([^/]+)\/channels\/([^/]+)\/webhook\/?$/;
function isAbortSignalError(error) {
	if (!error || typeof error !== "object") return false;
	const { code, name } = error;
	return name === "AbortError" || code === "ABORT_ERR";
}
function isExpectedResponseCloseError(error) {
	if (!error || typeof error !== "object") return false;
	const { code } = error;
	return code === "ECONNRESET" || code === "EPIPE" || code === "ERR_STREAM_DESTROYED" || code === "ERR_STREAM_WRITE_AFTER_END" || code === "ERR_STREAM_PREMATURE_CLOSE";
}
/**
* Returns `response` with a pass-through body that holds the re-dispatched
* custom route `request` until that body is fully read, errors or is cancelled.
*
* `new Request(url, { signal })` gives the request its own signal and forwards
* the outer abort to it through a listener that only weakly references the
* request's controller (nodejs/undici#4068). Once a custom route returns a
* streaming Response, nothing else holds that inner Request, so a GC can drop
* it and a client disconnect never reaches `c.req.raw.signal` (#29154).
*
* The reference lives on the body because the body is reachable exactly while
* an adapter is still sending the response. Anything reachable from the outer
* signal (a WeakMap keyed by it, or an abort listener on it) would leak instead:
* undici's request finalizer holds the outer signal strongly while the inner
* controller is alive, so signal -> request -> controller -> signal is never
* collected when the signal never aborts, as after a normal Express response.
* An abort ends or cancels the body, which releases the request too.
*/
function retainRequestWhileBodyIsOpen(response, request) {
	const source = response.body;
	if (!source) return response;
	const reader = source.getReader();
	const body = new ReadableStream({
		async pull(controller) {
			try {
				const { done, value } = await reader.read();
				if (done) {
					controller.close();
				} else controller.enqueue(value);
			} catch (error) {
				controller.error(error);
			}
		},
		cancel(reason) {
			return reader.cancel(reason);
		}
	}, { highWaterMark: 0 });
	return new Response(body, {
		status: response.status,
		statusText: response.statusText,
		headers: response.headers
	});
}
function isResponseClosed(response) {
	return Boolean(response.writableEnded || response.destroyed);
}
function isProtectedFGARoute(route) {
	return route.requiresAuth !== false;
}
function formatRoute(route) {
	return `${route.method} ${route.path}`;
}
function isSchemaApiRoute(route) {
	return "_mastraSchemaRoute" in route && route._mastraSchemaRoute === true;
}
function getFGAProvider(mastra, requestContext) {
	if (requestContext) {
		if (requestContext.get("mastra__authMode") === "studio") {
			const studioFga = mastra?.getStudio?.()?.fga;
			if (studioFga) return studioFga;
		}
	}
	return mastra?.getServer?.()?.fga;
}
function getFGARouteInfo(route) {
	return {
		path: route.path,
		method: route.method,
		requiresAuth: route.requiresAuth,
		requiresPermission: route.requiresPermission,
		fga: route.fga
	};
}
function getRoutePermissions(route) {
	return [getEffectivePermission(route), route.fga?.permission].flatMap((value) => Array.isArray(value) ? value : [value]).filter((permission) => Boolean(permission));
}
async function resolveRouteFGAConfig(fgaProvider, route, requestContext, params) {
	if (route.fga) return route.fga;
	const resolvedConfig = await fgaProvider.resolveRouteFGA?.({
		route: getFGARouteInfo(route),
		params,
		requestContext
	});
	if (resolvedConfig) return resolvedConfig;
	return getBuiltInRouteFGAConfig(route);
}
function getSchemaTypeName(schema) {
	const schemaDef = schema?._def ?? schema?.def;
	return schemaDef?.typeName ?? schemaDef?.type;
}
function unwrapOptionalNullable(schema) {
	let inner = schema;
	let typeName = getSchemaTypeName(inner);
	while (typeName === "ZodOptional" || typeName === "ZodNullable" || typeName === "optional" || typeName === "nullable") {
		const innerDef = inner?._def ?? inner?.def;
		if (!innerDef?.innerType) return inner;
		inner = innerDef.innerType;
		typeName = getSchemaTypeName(inner);
	}
	return inner;
}
function parseComplexQueryParams(queryParamSchema, params) {
	if (!(queryParamSchema instanceof z.ZodObject)) return params;
	const parsedParams = { ...params };
	const shape = queryParamSchema.shape;
	for (const [key, fieldSchema] of Object.entries(shape)) {
		const rawValue = parsedParams[key];
		if (typeof rawValue !== "string") continue;
		const typeName = getSchemaTypeName(unwrapOptionalNullable(fieldSchema));
		if (!(typeName === "ZodObject" || typeName === "ZodArray" || typeName === "ZodRecord" || typeName === "object" || typeName === "array" || typeName === "record")) continue;
		try {
			parsedParams[key] = JSON.parse(rawValue);
		} catch {}
	}
	return parsedParams;
}
/**
* Property names that must never be written onto objects built from untrusted
* input: assigning them can mutate the object's prototype chain.
*/
const UNSAFE_OBJECT_KEYS = /* @__PURE__ */ new Set([
	"__proto__",
	"prototype",
	"constructor"
]);
/**
* Returns whether `key` is safe to use as a property name when building an
* object from untrusted input (query strings, form fields, etc.).
*/
function isSafeObjectKey(key) {
	return !UNSAFE_OBJECT_KEYS.has(key);
}
/**
* Normalizes query parameters from various HTTP framework formats to a consistent structure.
* Handles both single string values and arrays (for repeated query params like ?tag=a&tag=b).
* Reconstructs bracket-notation keys (e.g., `orderBy[field]=createdAt`) into JSON strings
* so that z.preprocess JSON.parse can handle them.
* Filters out non-string values that some frameworks may include.
*
* @param rawQuery - Raw query parameters from the HTTP framework (may contain strings, arrays, or nested objects)
* @returns Normalized query parameters as Record<string, string | string[]>
*/
function normalizeQueryParams(rawQuery) {
	const queryParams = {};
	const bracketGroups = {};
	for (const [key, value] of Object.entries(rawQuery)) {
		const bracketMatch = key.match(/^([^[]+)\[([^\]]+)\]$/);
		if (bracketMatch) {
			const parent = bracketMatch[1];
			const child = bracketMatch[2];
			const strValue = Array.isArray(value) ? value.filter((v) => typeof v === "string")[0] : typeof value === "string" ? value : void 0;
			if (strValue !== void 0 && isSafeObjectKey(parent) && isSafeObjectKey(child)) {
				if (!Object.hasOwn(bracketGroups, parent)) bracketGroups[parent] = {};
				bracketGroups[parent][child] = strValue;
			}
		} else if (typeof value === "string") {
			if (isSafeObjectKey(key)) queryParams[key] = value;
		} else if (Array.isArray(value)) {
			if (!isSafeObjectKey(key)) continue;
			const stringValues = value.filter((v) => typeof v === "string");
			queryParams[key] = stringValues.length === 1 ? stringValues[0] : stringValues;
		}
	}
	for (const [parent, children] of Object.entries(bracketGroups)) if (!Object.hasOwn(queryParams, parent)) queryParams[parent] = JSON.stringify(children);
	return queryParams;
}
/**
* Abstract base class for server adapters that handle HTTP requests.
*
* This class extends `MastraServerBase` to inherit app storage functionality
* and provides the framework for registering routes, middleware, and handling requests.
*
* Framework-specific adapters in @mastra/hono and @mastra/express extend this class
* (both named `MastraServer` in their respective packages) and implement the abstract
* methods for their specific framework.
*
* @template TApp - The type of the server app (e.g., Hono, Express Application)
* @template TRequest - The type of the request object
* @template TResponse - The type of the response object
*/
var MastraServer = class extends MastraServerBase {
	/** Request bodies cannot set agent scopes: handlers strip `scopes`, and `mastra__scopes` is a reserved key. */
	reservesAgentScopes = true;
	mastra;
	bodyLimitOptions;
	tools;
	prefix;
	openapiPath;
	taskStore;
	customRouteAuthConfig;
	streamOptions;
	httpLoggingConfig;
	customApiRoutes;
	mcpOptions;
	/** This adapter's `registerDispatchAdapter` handle, recorded on each request it serves. */
	dispatchAdapter;
	customRouteHandler = null;
	/** Mirrors the custom-route app's router so auth can ask which route a request runs. */
	customRouteMatcher = null;
	/**
	* Whether custom (non-schema) API routes were registered. Adapters use this
	* at request time to decide if they need to preserve a pristine copy of the
	* request body for the custom-route bridge.
	*/
	get hasCustomRouteHandler() {
		return this.customRouteHandler !== null;
	}
	constructor({ app, mastra, bodyLimitOptions, tools, prefix = "/api", openapiPath = "", taskStore, customRouteAuthConfig, streamOptions, customApiRoutes, mcpOptions }) {
		super({
			app,
			name: "MastraServer"
		});
		this.mastra = mastra;
		this.bodyLimitOptions = bodyLimitOptions;
		this.tools = tools;
		this.prefix = normalizeRoutePath(prefix);
		this.dispatchAdapter = registerDispatchAdapter(mastra, {
			prefix: this.prefix,
			getCustomRouteAuthConfig: () => this.customRouteAuthConfig,
			getCustomApiRoutes: () => this.customApiRoutes ?? this.mastra.getServer()?.apiRoutes ?? [],
			checkRouteRBAC: (route, requestContext) => this.checkRouteRBAC(route, requestContext)
		});
		this.openapiPath = openapiPath;
		this.taskStore = taskStore;
		this.customRouteAuthConfig = customRouteAuthConfig;
		this.streamOptions = {
			redact: true,
			...streamOptions
		};
		this.customApiRoutes = customApiRoutes;
		this.mcpOptions = mcpOptions;
		const serverConfig = mastra.getServer();
		this.httpLoggingConfig = this.parseLoggingConfig(serverConfig?.build?.apiReqLogs);
		mastra.setMastraServer(this);
	}
	/**
	* Parses the apiReqLogs configuration into a normalized HttpLoggingConfig.
	* @param config - The raw config value from server.build.apiReqLogs
	* @returns Normalized HttpLoggingConfig or undefined if disabled
	*/
	parseLoggingConfig(config) {
		if (config === true) return {
			enabled: true,
			level: "info",
			redactHeaders: ["authorization", "cookie"]
		};
		if (typeof config === "object" && config.enabled) return {
			enabled: true,
			level: config.level || "info",
			excludePaths: config.excludePaths,
			includeHeaders: config.includeHeaders,
			includeQueryParams: config.includeQueryParams,
			redactHeaders: [.../* @__PURE__ */ new Set([...["authorization", "cookie"], ...config.redactHeaders || []])]
		};
	}
	/**
	* Determines if a request to the given path should be logged.
	* @param path - The request path to check
	* @returns true if the request should be logged, false otherwise
	*/
	shouldLogRequest(path) {
		if (!this.httpLoggingConfig?.enabled) return false;
		return !(this.httpLoggingConfig.excludePaths || []).some((excluded) => path === excluded || path.startsWith(excluded + "/"));
	}
	/** Warn when a request looks like an agent channel webhook whose route was never registered. */
	warnIfUnregisteredChannelWebhook(path, method, status) {
		if (status !== 404 || method.toUpperCase() !== "POST") return;
		const match = AGENT_CHANNEL_WEBHOOK_PATH.exec(path);
		if (!match) return;
		const routes = this.customApiRoutes ?? this.mastra.getServer()?.apiRoutes;
		if (findMatchingCustomRoute(path, method.toUpperCase(), routes)) return;
		const agentId = match[1];
		const platform = match[2];
		const platformLabel = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/i.test(platform) ? platform.split(/[-_]/).map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1)).join(" ") : "channel";
		this.mastra.getLogger()?.warn(`Received a ${platformLabel} webhook, but this agent doesn't have a ${platformLabel} adapter. Add one to the agent's channels.adapters configuration and restart the server.`, {
			agentId,
			platform
		});
	}
	mergeRequestContext({ paramsRequestContext, bodyRequestContext }) {
		const requestContext = new RequestContext();
		bindDispatchAdapter(requestContext, this.dispatchAdapter);
		if (bodyRequestContext) for (const [key, value] of Object.entries(bodyRequestContext)) {
			if (isReservedRequestContextKey(key)) continue;
			requestContext.set(key, value);
		}
		if (paramsRequestContext) for (const [key, value] of Object.entries(paramsRequestContext)) {
			if (isReservedRequestContextKey(key)) continue;
			requestContext.set(key, value);
		}
		return requestContext;
	}
	applyRequestMetadataToContext({ requestContext, getHeader }) {
		if (isStudioClientTypeHeader(getHeader("x-mastra-client-type"))) requestContext.set(MASTRA_IS_STUDIO_KEY, true);
	}
	/**
	* Determines which auth configuration to use for the current request.
	*
	* Request routing logic:
	* 1. If `x-mastra-client-type: studio` header is present AND `studio.auth` is configured:
	*    → Use studio auth (for internal team members accessing Studio UI)
	* 2. If studio header is present but `studio.auth` is NOT configured:
	*    → No auth required (Studio development mode)
	* 3. Otherwise:
	*    → Use server auth (for external customers calling API)
	*
	* Security note: The header is only for routing - auth validation happens
	* via session cookies/tokens. If someone spoofs the studio header but doesn't
	* have a valid studio session, they'll get a 401 (not fall back to server auth).
	*/
	getEffectiveAuthConfig(getHeader) {
		return resolveEffectiveAuthConfig(this.mastra, getHeader);
	}
	/**
	* Gets the effective RBAC provider for the current request based on auth mode.
	*
	* @deprecated Never consulted by route permission checks, so overriding it has no effect.
	* Override `checkRoutePermission` to change how a route's permission is decided.
	*/
	getEffectiveRBACProvider(requestContext) {
		return getEffectiveRBACProvider(this.mastra, requestContext);
	}
	/**
	* Gets the effective FGA provider for the current request based on auth mode.
	*/
	getEffectiveFGAProvider(requestContext) {
		if (requestContext.get("mastra__authMode") === "studio") return this.mastra.getStudio?.()?.fga ?? this.mastra.getServer()?.fga;
		return this.mastra.getServer()?.fga;
	}
	/**
	* Check if the current request should be authenticated/authorized.
	* Returns null if auth passes, or an error response if it fails.
	*
	* This is a thin wrapper around coreAuthMiddleware that:
	* 1. Routes to the correct auth provider (studio vs server) based on request headers
	* 2. Handles route-level requiresAuth opt-out (not available in global middleware)
	* 3. Delegates all other auth logic to coreAuthMiddleware
	* 4. Translates the AuthResult into the {status, error} format adapters expect
	*
	* Security: When `x-mastra-client-type: studio` header is present and studio auth
	* is configured, we ONLY use studio auth. If authentication fails, we return 401
	* and redirect to login - we do NOT fall back to server auth. This prevents
	* external users from spoofing the studio header to access Studio UI.
	*/
	async checkRouteAuth(route, context) {
		if (route.authTransport === "bearer") return this.checkBearerRouteAuth(route, context);
		const effectiveAuth = this.getEffectiveAuthConfig(context.getHeader);
		if (!effectiveAuth) return null;
		const { authConfig, authMode } = effectiveAuth;
		context.requestContext.set(MASTRA_AUTH_MODE_KEY, authMode);
		if (route.requiresAuth === false) return null;
		const authHeader = context.getHeader("authorization");
		let token = authHeader ? authHeader.replace("Bearer ", "") : null;
		if (!token) token = context.getQuery("apiKey") || null;
		const fallbackHeaders = new Headers();
		for (const headerName of ["authorization", "cookie"]) {
			const headerValue = context.getHeader(headerName);
			if (headerValue) fallbackHeaders.set(headerName, headerValue);
		}
		const result = await coreAuthMiddleware({
			path: context.path,
			method: context.method,
			getHeader: context.getHeader,
			mastra: this.mastra,
			authConfig,
			customRouteAuthConfig: context.customRouteAuthConfig ?? this.customRouteAuthConfig,
			requestContext: context.requestContext,
			rawRequest: context.request ?? new Request(`http://localhost${context.path}`, {
				method: context.method,
				headers: fallbackHeaders
			}),
			token,
			buildAuthorizeContext: context.buildAuthorizeContext ?? (() => null),
			requiresAuth: route.requiresAuth
		});
		if (result.action === "next") {
			if (result.headers) return {
				status: 200,
				error: "",
				headers: result.headers
			};
			return null;
		}
		const errorBody = result.body;
		return {
			status: result.status,
			error: errorBody?.error ?? "Access denied",
			headers: result.headers
		};
	}
	/**
	* Auth for routes with `authTransport: 'bearer'` (the built-in MCP server): only the
	* `Authorization` header counts, always against `server.auth`. Studio client-type routing,
	* cookies, and the `apiKey` query parameter are ignored, so a browser session can't be used.
	*
	* 401s carry `WWW-Authenticate` pointing at the OAuth protected-resource metadata, and when
	* `server.mcp.oauth.resource` is set the token audience must include it.
	*/
	async checkBearerRouteAuth(route, context) {
		context.requestContext.set(MASTRA_IS_STUDIO_KEY, false);
		const authorization = context.getHeader("authorization");
		const getHeader = (name) => {
			const lower = name.toLowerCase();
			return lower === "cookie" || lower === "x-mastra-client-type" ? void 0 : context.getHeader(name);
		};
		const result = await this.checkRouteAuth({
			...route,
			authTransport: void 0
		}, {
			...context,
			getHeader,
			getQuery: (name) => name === "apiKey" ? void 0 : context.getQuery(name),
			request: new Request(context.request?.url ?? `http://localhost${context.path}`, {
				method: context.method,
				headers: authorization ? { authorization } : {}
			})
		});
		const discovery = isMCPOAuthDiscoveryEnabled(this.mastra);
		if (!discovery && !isMCPAudienceEnforced(this.mastra)) return result;
		const requestUrl = context.request?.url ?? `http://localhost${context.path}`;
		const prefix = this.prefix ?? "";
		if (result?.status === 401) {
			if (!discovery) return result;
			const error = authorization?.trim() ? { error: "invalid_token" } : void 0;
			const challenge = mcpWWWAuthenticate(this.mastra, prefix, requestUrl, error);
			return {
				...result,
				headers: {
					...result.headers,
					"WWW-Authenticate": challenge
				}
			};
		}
		const user = context.requestContext.get(MASTRA_USER_KEY);
		if (user !== void 0 && !await checkMCPAudience(this.mastra, user)) {
			const challenge = mcpWWWAuthenticate(this.mastra, prefix, requestUrl, {
				error: "invalid_token",
				error_description: "The token audience does not include this MCP server"
			});
			return {
				status: 401,
				error: "Invalid token audience",
				headers: {
					...result?.headers,
					"WWW-Authenticate": challenge
				}
			};
		}
		return result;
	}
	/**
	* Check if the user has the required permission for a route.
	*
	* Uses convention-based permission derivation:
	* 1. If route has explicit `requiresPermission`, use that
	* 2. Otherwise, derive permission from path/method (e.g., GET /agents → agents:read)
	* 3. Routes with `requiresAuth: false` skip permission checks
	*
	* When the route specifies an array of permissions, the user needs ANY ONE
	* of them (logical OR).
	*
	* @param route - The route being accessed
	* @param userPermissions - The user's permissions from the request context
	* @returns Error response if permission denied, null if allowed
	*/
	/**
	* Check if the user has the required permission for a route.
	*
	* Uses convention-based permission derivation:
	* 1. If route has explicit `requiresPermission`, use that
	* 2. Otherwise, derive permission from path/method (e.g., GET /agents → agents:read)
	* 3. Routes with `requiresAuth: false` skip permission checks
	*
	* Permission checks use the RBAC provider that corresponds to the auth mode
	* (studio vs server) that was used for authentication.
	*
	* @param route - The route being accessed
	* @param userPermissions - The user's permissions from the request context
	* @param hasPermissionFn - Function to check if user permissions match required permission
	* @param requestContext - Request context to determine which RBAC provider to use
	* @returns Error response if permission denied, null if allowed
	*/
	checkRoutePermission(route, userPermissions, hasPermissionFn, requestContext) {
		return getRoutePermissionError(this.mastra, route, userPermissions, hasPermissionFn, requestContext);
	}
	/**
	* RBAC check for a route this adapter serves. Skipped when no auth is configured;
	* otherwise decided by `checkRoutePermission`, so a subclass override of it still applies.
	*/
	checkRouteRBAC(route, requestContext) {
		if (!this.mastra.getStudio?.()?.auth && !this.mastra.getServer()?.auth) return null;
		const userPermissions = requestContext.get(MASTRA_USER_PERMISSIONS_KEY);
		return this.checkRoutePermission(route, userPermissions, hasPermission, requestContext);
	}
	/** RBAC (`checkRouteRBAC`) then FGA on the parsed params, after authentication and validation. */
	async authorizeRoute(route, params, requestContext) {
		return this.checkRouteRBAC(route, requestContext) ?? await checkRouteFGA(this.mastra, route, requestContext, params);
	}
	/**
	* Build a matcher that answers "is this (path, method) a framework-public
	* route?" — i.e. registered with `requiresAuth: false`.
	*
	* Adapters call this once at registration time and use the returned function
	* inside their context middleware to stash a boolean on the per-request
	* context under `MASTRA_FRAMEWORK_PUBLIC_KEY`. That boolean is then read by
	* per-user-middleware wrappers to short-circuit user middleware for
	* framework-public routes, guaranteeing that user middleware cannot 401
	* routes the framework declared public (e.g. Studio sign-in endpoints).
	*
	* The matcher considers:
	*   - Built-in `SERVER_ROUTES` entries with `requiresAuth === false`
	*     (paths joined with the adapter's configured `prefix`).
	*   - Custom user API routes registered with `requiresAuth: false` via the
	*     `customRouteAuthConfig` map.
	*/
	getFrameworkPublicMatcher() {
		const prefix = this.prefix ?? "";
		const publicRoutes = SERVER_ROUTES.filter((r) => r.requiresAuth === false).map((r) => ({
			method: r.method.toUpperCase(),
			pattern: `${prefix}${r.path}`
		}));
		if (isMCPOAuthDiscoveryEnabled(this.mastra)) for (const route of createMCPOAuthMetadataRoutes(this.mastra, prefix)) publicRoutes.push({
			method: route.method.toUpperCase(),
			pattern: route.path
		});
		return (path, method) => {
			const upperMethod = method.toUpperCase();
			for (const r of publicRoutes) if ((r.method === upperMethod || r.method === "ALL") && pathMatchesPattern(path, r.pattern)) return true;
			return isCustomRoutePublic(path, upperMethod, this.customRouteAuthConfig);
		};
	}
	async init() {
		this.registerContextMiddleware();
		this.registerAuthMiddleware();
		this.validateAuthResourceScoping();
		this.registerUserMiddleware();
		this.registerHttpLoggingMiddleware();
		await this.validateEELicense();
		await this.validateAgentBuilderLicense();
		await this.validateFGAPolicyCoverage();
		await this.registerCustomApiRoutes();
		await this.registerRoutes();
	}
	/**
	* Validate that EE features have a valid license in production.
	* Throws if RBAC or FGA is configured without a valid license outside dev/test environments.
	*/
	async validateEELicense() {
		const serverConfig = this.mastra.getServer();
		const studioConfig = this.mastra.getStudio?.();
		const configuredFeatures = [serverConfig?.rbac || studioConfig?.rbac ? "RBAC" : null, serverConfig?.fga || studioConfig?.fga ? "FGA" : null].filter((feature) => feature !== null);
		if (configuredFeatures.length === 0) return;
		try {
			const { isEEEnabled } = await import('@mastra/core/auth/ee');
			if (!isEEEnabled()) {
				const featureList = configuredFeatures.join(" and ");
				throw new Error(`[mastra/auth-ee] ${featureList} ${configuredFeatures.length === 1 ? "is" : "are"} configured but no valid EE license was found.\n${featureList} ${configuredFeatures.length === 1 ? "requires" : "require"} a Mastra Enterprise License for production use.\nSet the MASTRA_EE_LICENSE environment variable with your license key.
Learn more: https://github.com/mastra-ai/mastra/blob/main/ee/LICENSE`);
			}
		} catch (err) {
			if (err instanceof Error && err.message.startsWith("[mastra/auth-ee]")) throw err;
			throw new Error(`[mastra/auth-ee] ${configuredFeatures.join(" and ")} ${configuredFeatures.length === 1 ? "is" : "are"} configured but the EE module (@mastra/core/auth/ee) could not be loaded.\nEnsure @mastra/core is updated to a version that includes EE support.`);
		}
	}
	/**
	* Validate that an Agent Builder configuration has a valid EE license.
	* Throws if the editor is configured with builder support but no valid EE license is available.
	*/
	async validateAgentBuilderLicense() {
		if (!this.mastra.getEditor()?.hasEnabledBuilderConfig?.()) return;
		try {
			const { isEEEnabled } = await import('@mastra/core/auth/ee');
			if (!isEEEnabled()) throw new Error("[mastra/auth-ee] Agent Builder is configured but no valid EE license was found.\nAgent Builder requires a Mastra Enterprise License for production use.\nSet the MASTRA_EE_LICENSE environment variable with your license key.\nLearn more: https://github.com/mastra-ai/mastra/blob/main/ee/LICENSE");
		} catch (err) {
			if (err instanceof Error && err.message.startsWith("[mastra/auth-ee]")) throw err;
			throw new Error("[mastra/auth-ee] Agent Builder is configured but the EE module (@mastra/core/auth/ee) could not be loaded.\nEnsure @mastra/core is updated to a version that includes EE support.");
		}
	}
	/**
	* Warn when `server.auth` is configured without `mapUserToResourceId`.
	*
	* Without it, MASTRA_RESOURCE_ID_KEY is never set in the request context, so
	* built-in routes fall back to the client-supplied resource ID (for example
	* `memory.resource`) and ownership checks run against a caller-chosen value.
	*/
	validateAuthResourceScoping() {
		const auth = this.mastra.getServer()?.auth;
		if (!auth || typeof auth.mapUserToResourceId === "function") return;
		this.mastra.getLogger()?.warn("[mastra/auth] server.auth is configured without mapUserToResourceId. Memory, thread and workflow ownership checks will trust the resource ID supplied by the client (e.g. memory.resource in the request body), so an authenticated user can read or write another user's threads. Configure server.auth.mapUserToResourceId to derive the resource ID from the authenticated user.");
	}
	/**
	* Validate route-level FGA policy coverage when an FGA provider opts into
	* startup checks.
	*/
	async validateFGAPolicyCoverage() {
		const serverConfig = this.mastra.getServer();
		const studioConfig = this.mastra.getStudio?.();
		const fgaProvider = serverConfig?.fga ?? studioConfig?.fga;
		if (!fgaProvider) return;
		const customRoutes = (this.customApiRoutes ?? serverConfig?.apiRoutes ?? []).filter((route) => !route._mastraInternal);
		const routes = [...SERVER_ROUTES, ...customRoutes];
		if (fgaProvider.validatePermissions) {
			const permissions = [...new Set(routes.flatMap((route) => getRoutePermissions(route)))];
			await fgaProvider.validatePermissions(permissions);
		}
		const auditMode = fgaProvider.auditProtectedRoutes ?? (fgaProvider.requireForProtectedRoutes ? "warn" : false);
		if (!auditMode || fgaProvider.resolveRouteFGA) return;
		const missingRoutes = routes.filter((route) => isProtectedFGARoute(route) && !route.fga && !getBuiltInRouteFGAConfig(route));
		if (missingRoutes.length === 0) return;
		const routeList = missingRoutes.map((route) => formatRoute(route));
		const message = `[mastra/auth-ee] FGA is configured but ${missingRoutes.length} protected route${missingRoutes.length === 1 ? " is" : "s are"} missing FGA metadata: ${routeList.join(", ")}`;
		if (auditMode === "error") throw new Error(message);
		this.mastra.getLogger()?.warn(message, {
			routes: routeList,
			count: missingRoutes.length
		});
	}
	/**
	* Register user-provided middleware from the Mastra config (`server.middleware`)
	* and from `mastra.setServerMiddleware()`. Called by init() between
	* registerAuthMiddleware() and registerHttpLoggingMiddleware().
	*
	* Mastra middleware handlers use Hono's `(c, next)` signature, so only
	* Hono-based adapters can run them. Those adapters override this method and
	* MUST wrap each handler with `skipIfFrameworkPublic` (exported by
	* `@mastra/hono`) so user middleware cannot block framework-public routes.
	* The default implementation warns when middleware is configured so the
	* config is not silently ignored on adapters that cannot honor it.
	*/
	registerUserMiddleware() {
		const instanceMiddleware = this.mastra.getServerMiddleware?.() ?? [];
		const configMiddleware = this.mastra.getServer()?.middleware;
		const hasConfigMiddleware = Array.isArray(configMiddleware) ? configMiddleware.length > 0 : !!configMiddleware;
		if (instanceMiddleware.length === 0 && !hasConfigMiddleware) return;
		this.mastra.getLogger()?.warn("Mastra server middleware (`server.middleware` or `setServerMiddleware()`) is configured, but this server adapter cannot run Hono middleware handlers. The configured middleware will not run — register middleware through your server framework instead.");
	}
	/**
	* Override in adapters to register custom API routes defined via registerApiRoute().
	* Called by init() between registerAuthMiddleware() and registerRoutes().
	*/
	async registerCustomApiRoutes() {}
	/** Ensures every custom route has an auth entry without overriding supplied values. */
	initializeCustomRouteAuthConfig(routes) {
		this.customRouteAuthConfig ??= /* @__PURE__ */ new Map();
		for (const route of routes) {
			const routeKey = `${route.method}:${route.path}`;
			if (!this.customRouteAuthConfig.has(routeKey)) this.customRouteAuthConfig.set(routeKey, route.requiresAuth !== false);
		}
	}
	/**
	* Registers schema-aware custom routes through the adapter's native route pipeline.
	* Returns the remaining Hono-style routes for the custom-route bridge.
	*/
	async registerSchemaApiRoutes() {
		const routes = this.customApiRoutes ?? this.mastra.getServer()?.apiRoutes ?? [];
		this.validateCustomRoutePaths(routes);
		this.initializeCustomRouteAuthConfig(routes);
		const schemaRoutes = routes.filter(isSchemaApiRoute);
		for (const route of schemaRoutes) {
			const prefix = OPT_IN_ROUTES.includes(route) ? this.prefix : "";
			await this.registerRoute(this.app, route, { prefix });
		}
		return routes.filter((route) => !isSchemaApiRoute(route));
	}
	/**
	* Validates that no custom route path collides with the built-in route prefix.
	* Throws if any route path starts with the server's `apiPrefix`.
	*/
	validateCustomRoutePaths(routes) {
		const prefix = this.prefix ?? "";
		if (!prefix) return;
		for (const route of routes) {
			if (route._mastraInternal) continue;
			if (route.path.startsWith(`${prefix}/`) || route.path === prefix) throw new Error(`Custom API route "${route.path}" must not start with "${prefix}" — that path is reserved for built-in Mastra routes. Choose a different path (e.g. "${route.path.replace(prefix, "/custom")}").`);
		}
	}
	/**
	* Creates an internal Hono sub-app with all custom API routes registered.
	* Stores the handler on this instance for use by handleCustomRouteRequest().
	* Returns true if custom routes were found and registered.
	*/
	async buildCustomRouteHandler(routes) {
		if (routes.length === 0) return false;
		const NOT_FOUND_HEADER = "x-mastra-custom-route-not-found";
		const mastra = this.mastra;
		const app = new Hono();
		app.use("*", async (c, next) => {
			c.set("mastra", mastra);
			c.set("requestContext", c.env?.requestContext ?? new RequestContext());
			await next();
		});
		const serverOnError = this.mastra.getServer()?.onError;
		app.onError((err, c) => {
			if (serverOnError) return serverOnError(err, c);
			const httpExceptionResponse = getCustomRouteHTTPExceptionResponse(err);
			if (httpExceptionResponse) return httpExceptionResponse;
			this.mastra.getLogger()?.error(`Custom route handler failed: ${c.req.method} ${c.req.path}`, {
				method: c.req.method,
				path: c.req.path,
				error: err instanceof Error ? err.stack ?? err.message : String(err)
			});
			return c.json({ error: "Internal Server Error" }, 500);
		});
		const matcherEntries = [];
		for (const route of routes) {
			const handler = "handler" in route && route.handler ? route.handler : "createHandler" in route ? await route.createHandler({ mastra }) : void 0;
			if (!handler) continue;
			const middlewares = [];
			if (route.middleware) middlewares.push(...Array.isArray(route.middleware) ? route.middleware : [route.middleware]);
			const allHandlers = [...middlewares, handler];
			matcherEntries.push({
				method: route.method,
				path: route.path,
				handlerCount: allHandlers.length,
				route
			});
			if (route.method === "ALL") app.all(route.path, allHandlers[0], ...allHandlers.slice(1));
			else app.on(route.method, route.path, allHandlers[0], ...allHandlers.slice(1));
		}
		app.notFound(() => new Response(null, {
			status: 404,
			headers: { [NOT_FOUND_HEADER]: "true" }
		}));
		this.customRouteHandler = async (request, env, executionCtx) => app.fetch(request, env, executionCtx);
		this.customRouteMatcher = new CustomRouteMatcher(matcherEntries);
		return true;
	}
	/**
	* Returns the custom route the custom-route app will run for `url` (the same URL
	* passed to `handleCustomRouteRequest`), with its decoded path params, or
	* undefined if none will.
	*/
	matchCustomRoute(url, method) {
		if (!this.customRouteMatcher) return void 0;
		try {
			const match = this.customRouteMatcher.matchUrl(url, method);
			return match ? {
				route: match.entry.route,
				params: match.params
			} : void 0;
		} catch {
			return;
		}
	}
	/**
	* Works out what auth applies to a request before it's forwarded to the
	* custom-route app. The route that decides is the one the app will dispatch
	* `dispatchUrl` to, not the route the outer framework matched, because the two
	* routers can disagree on precedence, case, trailing slashes and encoding.
	*
	* `requestPath` is the path passed to `checkRouteAuth`. When the dispatched route
	* requires auth, the returned `customRouteAuthConfig` marks that path protected so
	* the auth middleware can't skip auth on it. `fallbackRoute` is used when the app
	* won't dispatch the request (it 404s and nothing runs); pass the framework's own
	* route when there is one so its auth still applies.
	*/
	resolveCustomRouteAuth(dispatchUrl, method, requestPath, fallbackRoute) {
		const match = this.matchCustomRoute(dispatchUrl, method);
		const route = match?.route ?? fallbackRoute;
		const requiresAuth = route ? this.customRouteAuthConfig?.get(`${route.method}:${route.path}`) ?? route.requiresAuth !== false : isProtectedCustomRoute(requestPath, method, this.customRouteAuthConfig);
		const serverRoute = {
			method: route?.method ?? method,
			path: route?.path ?? requestPath,
			responseType: "json",
			handler: async () => {},
			requiresAuth: requiresAuth ? route?.requiresAuth === true ? true : void 0 : false,
			requiresPermission: route?.requiresPermission,
			fga: route?.fga
		};
		let customRouteAuthConfig;
		if (requiresAuth) {
			customRouteAuthConfig = new Map(this.customRouteAuthConfig ?? []);
			customRouteAuthConfig.set(`${method.toUpperCase()}:${requestPath}`, true);
		}
		return {
			match,
			requiresAuth,
			serverRoute,
			customRouteAuthConfig
		};
	}
	/**
	* Forwards a request to the internal custom route handler.
	* Returns the Response if a custom route matched, or null to fall through.
	*/
	async handleCustomRouteRequest(url, method, headers, body, requestContext, signal, executionCtx) {
		if (!this.customRouteHandler) return null;
		const fetchHeaders = new Headers();
		for (const [key, value] of Object.entries(headers)) if (typeof value === "string") fetchHeaders.set(key, value);
		else if (Array.isArray(value)) value.forEach((v) => {
			fetchHeaders.append(key, v);
		});
		const init = {
			method,
			headers: fetchHeaders,
			signal
		};
		if ([
			"POST",
			"PUT",
			"PATCH",
			"DELETE"
		].includes(method) && body !== void 0) {
			if (body instanceof ArrayBuffer || body instanceof Uint8Array || body instanceof ReadableStream) {
				init.body = body;
				if (body instanceof ReadableStream) init.duplex = "half";
			} else if (((typeof headers["content-type"] === "string" ? headers["content-type"] : "") || "").includes("application/json")) init.body = JSON.stringify(body);
			else if (typeof body === "string") init.body = body;
		}
		const request = new globalThis.Request(url, init);
		const response = await this.customRouteHandler(request, { requestContext }, executionCtx);
		if (response.headers.get("x-mastra-custom-route-not-found") === "true") return null;
		return signal ? retainRequestWhileBodyIsOpen(response) : response;
	}
	/**
	* Pipes a custom route Response to a Node.js ServerResponse (http.ServerResponse).
	* Works with Koa (ctx.res), Express (res), and Fastify (reply.raw).
	*/
	async writeCustomRouteResponse(response, nodeRes, signal) {
		const headers = {};
		response.headers.forEach((value, key) => {
			if (key.toLowerCase() !== "set-cookie") headers[key] = value;
		});
		const setCookies = response.headers.getSetCookie?.();
		if (setCookies && setCookies.length > 0) headers["set-cookie"] = setCookies;
		if (isResponseClosed(nodeRes)) {
			await response.body?.cancel();
			return;
		}
		nodeRes.writeHead(response.status, headers);
		if (response.body) {
			let responseBodyError;
			let responseBodyErrorAfterResponseClosed = false;
			try {
				const responseStream = Readable.fromWeb(response.body);
				responseStream.once("error", (error) => {
					responseBodyError = error;
					responseBodyErrorAfterResponseClosed = isResponseClosed(nodeRes);
				});
				if (signal) await pipeline(responseStream, nodeRes, { signal });
				else await pipeline(responseStream, nodeRes);
			} catch (error) {
				const expectedSignalAbort = signal?.aborted && isAbortSignalError(error) && (!responseBodyError || responseBodyErrorAfterResponseClosed);
				const expectedResponseClose = (!responseBodyError || responseBodyErrorAfterResponseClosed) && isResponseClosed(nodeRes) && isExpectedResponseCloseError(error);
				if (!expectedSignalAbort && !expectedResponseClose) throw error;
			}
		} else {
			const text = await response.text();
			if (!isResponseClosed(nodeRes)) nodeRes.end(text);
		}
	}
	/**
	* Builds the OpenAPI spec object with servers field and custom route paths.
	*/
	buildOpenAPISpec(config, prefix) {
		const openApiSpec = generateOpenAPIDocument(SERVER_ROUTES, config);
		if (prefix) openApiSpec.servers = [{ url: prefix }];
		const allCustomRoutes = this.customApiRoutes ?? this.mastra.getServer()?.apiRoutes;
		if (allCustomRoutes && allCustomRoutes.length > 0) {
			const componentSchemas = openApiSpec.components?.schemas ?? Object.create(null);
			const isPrefixed = (route) => OPT_IN_ROUTES.includes(route);
			const customPaths = convertCustomRoutesToOpenAPIPaths(allCustomRoutes.filter((route) => !isPrefixed(route)), componentSchemas);
			const prefixedPaths = convertCustomRoutesToOpenAPIPaths(allCustomRoutes.filter(isPrefixed), componentSchemas);
			if (Object.keys(componentSchemas).length > 0) openApiSpec.components = {
				...openApiSpec.components,
				schemas: componentSchemas
			};
			if (prefix) {
				for (const pathKey of Object.keys(customPaths)) if (!customPaths[pathKey].servers) customPaths[pathKey].servers = [{ url: "/" }];
			}
			Object.assign(customPaths, prefixedPaths);
			openApiSpec.paths = {
				...openApiSpec.paths,
				...customPaths
			};
		}
		return openApiSpec;
	}
	async registerOpenAPIRoute(app, config = {}, { prefix }) {
		const { title = "Mastra API", version = "1.0.0", description = "Mastra Server API", path = "/openapi.json" } = config;
		const openApiSpec = this.buildOpenAPISpec({
			title,
			version,
			description
		}, prefix);
		const openApiRoute = {
			method: "GET",
			path,
			responseType: "json",
			handler: async () => openApiSpec
		};
		await this.registerRoute(app, openApiRoute, { prefix });
	}
	async registerRoutes() {
		for (const route of SERVER_ROUTES) await this.registerRoute(this.app, resolveServerRoute(route, this.mastra, SERVER_ROUTES), { prefix: this.prefix });
		if (isMCPAudienceEnforced(this.mastra)) warnOnUnenforcedMCPAudience(this.mastra);
		if (isMCPOAuthDiscoveryEnabled(this.mastra)) for (const route of createMCPOAuthMetadataRoutes(this.mastra, this.prefix ?? "")) await this.registerRoute(this.app, route, { prefix: "" });
		if (this.openapiPath) await this.registerOpenAPIRoute(this.app, {
			title: "Mastra API",
			version: "1.0.0",
			description: "Mastra Server API",
			path: this.openapiPath
		}, { prefix: this.prefix });
	}
	async parsePathParams(route, params) {
		return parseRoutePathParams(route, params);
	}
	async parseQueryParams(route, params) {
		return parseRouteQueryParams(route, params);
	}
	async parseBody(route, body) {
		return parseRouteBody(route, body);
	}
	resolveValidationError(route, error, context) {
		return resolveRouteValidationError(this.mastra, route, error, context);
	}
};
/**
* The RBAC provider for the auth mode the request was authenticated with
* (studio vs server).
*/
function getEffectiveRBACProvider(mastra, requestContext) {
	if (requestContext.get("mastra__authMode") === "studio") return mastra.getStudio?.()?.rbac ?? mastra.getServer()?.rbac;
	return mastra.getServer()?.rbac;
}
/**
* Check if the user has the required permission for a route.
*
* Uses convention-based permission derivation:
* 1. If route has explicit `requiresPermission`, use that
* 2. Otherwise, derive permission from path/method (e.g., GET /agents → agents:read)
* 3. Routes with `requiresAuth: false` skip permission checks
*
* When the route specifies an array of permissions, the user needs ANY ONE
* of them (logical OR). Without an RBAC provider, authenticated users get full access.
*
* @returns Error response if permission denied, null if allowed
*/
function getRoutePermissionError(mastra, route, userPermissions, hasPermissionFn, requestContext) {
	if (!getEffectiveRBACProvider(mastra, requestContext)) return null;
	const requiredPermission = getEffectivePermission(route);
	if (!requiredPermission) return null;
	const permissions = Array.isArray(requiredPermission) ? requiredPermission : [requiredPermission];
	if (!(userPermissions && permissions.some((perm) => hasPermissionFn(userPermissions, perm)))) return {
		status: 403,
		error: "Forbidden",
		message: `Missing required permission: ${permissions.join(" or ")}`
	};
	return null;
}
async function parseRoutePathParams(route, params) {
	const pathParamSchema = route.pathParamSchema;
	if (!pathParamSchema) return params;
	return pathParamSchema.parseAsync(params);
}
async function parseRouteQueryParams(route, params) {
	const queryParamSchema = route.queryParamSchema;
	if (!queryParamSchema) return params;
	const normalizedParams = parseComplexQueryParams(queryParamSchema, params);
	return queryParamSchema.parseAsync(normalizedParams);
}
async function parseRouteBody(route, body) {
	const bodySchema = route.bodySchema;
	if (!bodySchema) return body;
	if (body === void 0) {
		const omitted = await bodySchema.safeParseAsync(void 0);
		if (omitted.success) return omitted.data;
		const schemaType = getSchemaTypeName(unwrapOptionalNullable(bodySchema));
		if (schemaType === "object" || schemaType === "ZodObject") {
			const emptyObject = await bodySchema.safeParseAsync({});
			if (emptyObject.success) return emptyObject.data;
		}
		throw omitted.error;
	}
	return bodySchema.parseAsync(body);
}
const VALIDATION_CONTEXT_LABELS = {
	query: "query parameters",
	body: "request body",
	path: "path parameters"
};
function resolveRouteValidationError(mastra, route, error, context) {
	const hook = route.onValidationError ?? mastra.getServer()?.onValidationError;
	if (hook) try {
		const result = hook(error, context);
		if (result) return result;
	} catch (hookError) {
		mastra.getLogger()?.error("Error in custom onValidationError hook", { error: hookError instanceof Error ? {
			message: hookError.message,
			stack: hookError.stack
		} : hookError });
	}
	return {
		status: 400,
		body: formatZodError(error, VALIDATION_CONTEXT_LABELS[context])
	};
}
/**
* Check the route's RBAC permission (explicit `requiresPermission` or derived from
* path/method) against the permissions `checkRouteAuth` stored in the request context.
* Skipped when no auth or no RBAC provider is configured, matching what adapters enforce.
* Uses the studio RBAC provider for studio-authenticated requests.
* Returns null if allowed, or a 403 error object if denied.
*/
function checkRouteRBAC(mastra, route, requestContext) {
	if (!mastra.getStudio?.()?.auth && !mastra.getServer()?.auth) return null;
	return getRoutePermissionError(mastra, route, requestContext.get(MASTRA_USER_PERMISSIONS_KEY), hasPermission, requestContext);
}
/**
* Run the route authorization adapters enforce after authentication and schema
* validation: RBAC (`checkRouteRBAC`) then FGA (`checkRouteFGA`) on the parsed params.
* Returns null if allowed, or a 403 error object if denied.
*/
async function authorizeRoute(mastra, route, params, requestContext) {
	return checkRouteRBAC(mastra, route, requestContext) ?? await checkRouteFGA(mastra, route, requestContext, params);
}
const dispatchAdapters = /* @__PURE__ */ new WeakMap();
const servingAdapters = /* @__PURE__ */ new WeakMap();
/**
* Record that `handle`'s adapter is serving the request `requestContext` belongs to. Adapters
* built on `MastraServer` do this for every request; other adapters must call it.
*/
function bindDispatchAdapter(requestContext, handle) {
	servingAdapters.set(requestContext, handle);
}
/**
* Tell `dispatchRoute` where an adapter serves a Mastra instance's routes. Adapters built on
* `MastraServer` register themselves; adapters that are not must call this, and bind the returned
* handle to each request context they create with `bindDispatchAdapter`.
*/
function registerDispatchAdapter(mastra, info) {
	const adapters = dispatchAdapters.get(mastra) ?? /* @__PURE__ */ new Map();
	const handle = Object.freeze({});
	adapters.set(handle, info);
	dispatchAdapters.set(mastra, adapters);
	return handle;
}
/**
* The adapter whose HTTP paths and checks a dispatched route gets. Among the adapters serving
* `routePrefix` (all of them when it is not given), that is the one serving the current request
* (`bindDispatchAdapter`), else the only one. `prefix` is undefined when it cannot be
* told: several candidates and none serving this request, a `routePrefix` no registered adapter
* serves (a custom route's own `routePrefix` is empty, for one), or nothing to go on. Guessing
* between adapters could skip one's stricter checks, so it is never done.
*/
function resolveDispatchAdapter(mastra, routePrefix, requestContext) {
	const adapters = [...dispatchAdapters.get(mastra) ?? /* @__PURE__ */ new Map()];
	if (routePrefix !== void 0 && adapters.length === 0) return { prefix: normalizeRoutePath(routePrefix) };
	const candidates = routePrefix === void 0 ? adapters : adapters.filter(([, adapter]) => normalizeRoutePath(adapter.prefix ?? "") === normalizeRoutePath(routePrefix));
	const serving = servingAdapters.get(requestContext);
	const match = candidates.find(([handle]) => handle === serving) ?? (candidates.length === 1 ? candidates[0] : void 0);
	if (!match) return { prefix: void 0 };
	const [, adapter] = match;
	return {
		prefix: normalizeRoutePath(adapter.prefix ?? ""),
		adapter
	};
}
/** Studio auth for Studio requests when `studio.auth` is configured, otherwise `server.auth`. */
function resolveEffectiveAuthConfig(mastra, getHeader) {
	const isStudioRequest = isStudioClientTypeHeader(getHeader(MASTRA_CLIENT_TYPE_HEADER));
	const studioAuth = mastra.getStudio?.()?.auth;
	const serverAuth = mastra.getServer()?.auth;
	if (isStudioRequest && studioAuth) return {
		authConfig: studioAuth,
		authMode: "studio"
	};
	if (serverAuth) return {
		authConfig: serverAuth,
		authMode: "server"
	};
	return null;
}
const ROUTE_PATH_PARAM = /\/:([A-Za-z0-9_]+)(\?)?/g;
/**
* A URL can only carry a path param as a non-empty segment, and `.` / `..` segments are
* resolved away before routing. Anything else names a path no HTTP request to this route
* has, so it is rejected instead of being authorized as some other path.
*/
function findInvalidPathParams(path, pathParams) {
	const issues = [];
	for (const [, name, optional] of path.matchAll(ROUTE_PATH_PARAM)) {
		const value = pathParams[name];
		if (value === void 0 && optional) continue;
		if (typeof value !== "string" || value === "") issues.push({
			field: name,
			message: "Path parameter must be a non-empty string"
		});
		else if (value === "." || value === "..") issues.push({
			field: name,
			message: "Path parameter cannot be \".\" or \"..\""
		});
	}
	return issues;
}
/** Fill `:param` / `:param?` segments of a route path the way a client would put them in a URL. */
function fillRoutePath(path, pathParams) {
	return path.replace(ROUTE_PATH_PARAM, (_segment, name) => {
		const value = pathParams[name];
		return value === void 0 ? "" : `/${encodeURIComponent(String(value))}`;
	});
}
const DISPATCH_ROUTE_POLICY = {
	authPath: "adapter",
	customErrorResponses: true};
/**
* The path-scoped half of `checkRouteAuth` for a route run in-process: `requiresAuth: false`,
* protected/public path handling, then `authorizeUser` / `authorize` / `rules` / the RBAC
* default rules, all evaluated against the route's own request path and method.
* Uses the user Mastra server auth already put in the request context; never re-authenticates.
*/
async function checkDispatchedRouteAuth(route, pathParams, context, policy) {
	if (route.requiresAuth === false) return null;
	const { mastra, requestContext } = context;
	const outerHeaders = context.request?.headers;
	const getHeader = (name) => outerHeaders?.get(name) ?? void 0;
	const studioAuth = mastra.getStudio?.()?.auth;
	const serverAuth = mastra.getServer()?.auth;
	const user = requestContext.get(MASTRA_USER_KEY);
	const authMode = requestContext.get(MASTRA_AUTH_MODE_KEY);
	const authConfig = (authMode === "studio" ? studioAuth : authMode === "server" ? serverAuth : void 0) ?? resolveEffectiveAuthConfig(mastra, getHeader)?.authConfig;
	if (!authConfig) return null;
	const method = route.method;
	let path;
	let customRouteAuthConfig;
	{
		const { prefix, adapter } = resolveDispatchAdapter(mastra, context.routePrefix, requestContext);
		customRouteAuthConfig = adapter?.getCustomRouteAuthConfig?.();
		const isUnprefixed = (adapter?.getCustomApiRoutes?.() ?? mastra.getServer()?.apiRoutes ?? []).includes(route) && !OPT_IN_ROUTES.includes(route);
		if (isUnprefixed || prefix !== void 0) path = `${isUnprefixed ? "" : prefix}${fillRoutePath(route.path, pathParams)}` || "/";
	}
	if (path !== void 0) {
		const isDevPlayground = typeof authConfig.authenticateToken !== "function" && process.env.MASTRA_DEV === "true" && getHeader("x-mastra-dev-playground") === "true";
		const isPublic = !route.requiresAuth && (canAccessPublicly(path, method, authConfig) || isCustomRoutePublic(path, method, customRouteAuthConfig));
		if (isDevPlayground || isPublic) return null;
	}
	if (!user) return {
		status: 401,
		body: { error: "Invalid or expired token" }
	};
	if (path === void 0) throw new Error(`dispatchRoute cannot tell which path ${method} ${route.path} is served under, so it cannot apply server auth to it. Set \`routePrefix\` in the context to the prefix the server adapter serves its built-in routes under (such as "/api").`);
	const token = requestContext.get(MASTRA_AUTH_TOKEN_KEY);
	const headers = outerHeaders ?? (typeof token === "string" && token ? { authorization: `Bearer ${token}` } : void 0);
	return authorizeAuthenticatedUser({
		path,
		method,
		user,
		mastra,
		authConfig,
		customRouteAuthConfig,
		requestContext,
		rawRequest: new Request(`http://localhost${path}`, {
			method,
			headers
		}),
		buildAuthorizeContext: () => null
	});
}
/** The one in-process pipeline behind `dispatchRoute` and `invokeRoute`: path-scoped auth → validate → RBAC → FGA → handler. */
async function runRoutePipeline(route, input, context, policy) {
	const { mastra, requestContext } = context;
	{
		const issues = findInvalidPathParams(route.path, input.pathParams ?? {});
		if (issues.length > 0) return {
			ok: false,
			status: 400,
			body: {
				error: "Invalid path parameters",
				issues
			}
		};
	}
	const pathAuthError = await checkDispatchedRouteAuth(route, input.pathParams ?? {}, context);
	if (pathAuthError) return {
		ok: false,
		...pathAuthError
	};
	const validate = async (kind, label, parse) => {
		try {
			return { value: await parse() };
		} catch (error) {
			if (isZodError(error)) {
				const { status, body } = resolveRouteValidationError(mastra, route, error, kind);
				return { error: {
					ok: false,
					status,
					body
				} };
			}
			return { error: {
				ok: false,
				status: 400,
				body: {
					error: `Invalid ${label}`,
					issues: [{
						field: "unknown",
						message: error instanceof Error ? error.message : "Unknown error"
					}]
				}
			} };
		}
	};
	const parsed = { body: input.body };
	const steps = {
		query: async () => {
			const result = await validate("query", "query parameters", () => parseRouteQueryParams(route, input.query ?? {}));
			if ("error" in result) return result.error;
			parsed.query = result.value;
		},
		body: async () => {
			if (input.body === void 0 && !route.bodySchema) return;
			const result = await validate("body", "request body", () => parseRouteBody(route, input.body));
			if ("error" in result) return result.error;
			parsed.body = result.value;
		},
		path: async () => {
			const result = await validate("path", "path parameters", () => parseRoutePathParams(route, input.pathParams ?? {}));
			if ("error" in result) return result.error;
			parsed.path = result.value;
		}
	};
	const order = [
		steps.query,
		steps.body,
		steps.path
	];
	for (const step of order) {
		const validationError = await step();
		if (validationError) return validationError;
	}
	const { body } = parsed;
	const params = {
		...{} ,
		...parsed.query,
		...typeof body === "object" ? body : {},
		...parsed.path 
	};
	const adapter = policy.authPath === "adapter" ? resolveDispatchAdapter(mastra, context.routePrefix, requestContext).adapter : void 0;
	const authError = adapter?.checkRouteRBAC ? adapter.checkRouteRBAC(route, requestContext) ?? await checkRouteFGA(mastra, route, requestContext, params) : await authorizeRoute(mastra, route, params, requestContext);
	if (authError) return {
		ok: false,
		status: authError.status,
		body: {
			error: authError.error,
			message: authError.message
		}
	};
	try {
		const serverContext = {
			registeredTools: void 0,
			taskStore: void 0,
			routePrefix: void 0,
			request: void 0,
			...context
		} ;
		return {
			ok: true,
			result: await route.handler({
				...params,
				...serverContext
			})
		};
	} catch (error) {
		const customResponse = policy.customErrorResponses ? getCustomHTTPExceptionResponse(error) : void 0;
		if (customResponse) {
			const text = await customResponse.text();
			let responseBody = text;
			try {
				responseBody = JSON.parse(text);
			} catch {}
			return {
				ok: false,
				status: customResponse.status,
				body: responseBody
			};
		}
		const { status, body: errorBody } = getHTTPErrorResponse(error);
		return {
			ok: false,
			status,
			body: errorBody
		};
	}
}
/**
* Invoke a route in-process, enforcing what an adapter enforces for an HTTP request to it,
* and never allowing more than that request would:
*
* 1. Path params must be what a URL can carry: a non-empty string for every `:param` (optional
*    `:param?` may be left out), and never `.` or `..`. Anything else is a 400.
* 2. Path-scoped authorization from `checkRouteAuth`, evaluated against the route's own
*    path (the serving adapter's prefix + filled path params) and method: `requiresAuth: false`,
*    public paths, and `authorizeUser` / `authorize` / `rules` / the RBAC default rules.
*    Authentication is not repeated: the user (`MASTRA_USER_KEY`), permissions, and auth mode
*    must already be in `context.requestContext` from the caller's authenticated request, and
*    the auth config used is the one recorded there (`studio.auth` or `server.auth`), falling
*    back to the request's client-type header only when none was recorded. `authorizeUser`
*    receives the same `{ raw, headers, header() }` shape as over HTTP, wrapping a synthetic
*    `Request` for the route's path/method with the caller's headers (no body).
* 3. Schema validation: query, then body, then path params.
* 4. RBAC (the serving adapter's `checkRoutePermission`), then FGA (`checkRouteFGA`) on the
*    parsed params.
* 5. `route.handler` with the parsed params and `context`.
*
* The adapter's paths and checks apply: the adapter serving the request `requestContext` came
* from, else the only adapter serving the Mastra instance (or `context.routePrefix`, when set).
* With none registered, `routePrefix` is required. When the adapter cannot be told (several
* serve the prefix and none served this request), or `routePrefix` is one no registered adapter
* serves, a caller without a user gets 401 and the call otherwise throws rather than guess.
*
* It is stricter than HTTP in three ways. With auth configured, a route needs a user unless
* its path is declared public; a path merely outside the `protected` patterns is not let
* through. Path params win over same-named query or body fields, so authorization and the
* handler act on the resource named in the path. And request fields never stand in for
* server context (`request`, `routePrefix`, `registeredTools`, `taskStore`) left out of `context`.
*
* Failures resolve to the status and JSON body an adapter would send; successful calls
* return the raw handler result (streams are not converted).
*
* `invokeRoute` runs the same pipeline for JSON routes with a stricter contract: it never
* skips auth for public paths and answers with `{ status, body }`.
*/
async function dispatchRoute(route, input, context) {
	return runRoutePipeline(route, input, context, DISPATCH_ROUTE_POLICY);
}
/**
* Check FGA authorization for an HTTP route.
* Returns null if authorized or FGA not configured, or an error object if denied.
*/
async function checkRouteFGA(mastra, route, requestContext, params) {
	const fgaProvider = getFGAProvider(mastra, requestContext);
	if (!fgaProvider) return null;
	const fgaConfig = await resolveRouteFGAConfig(fgaProvider, route, requestContext, params);
	if (!fgaConfig) {
		if (fgaProvider.requireForProtectedRoutes && isProtectedFGARoute(route)) return {
			status: 403,
			error: "Forbidden",
			message: "FGA authorization denied: route FGA metadata is required"
		};
		return null;
	}
	const user = requestContext?.get("user");
	if (!user) return {
		status: 403,
		error: "Forbidden",
		message: "FGA authorization denied: authenticated user is required"
	};
	const resourceId = typeof fgaConfig.resourceId === "function" ? fgaConfig.resourceId(params, { requestContext }) : fgaConfig.resourceId || (fgaConfig.resourceIdParam ? params[fgaConfig.resourceIdParam] : void 0);
	if (!fgaConfig.resourceType || !resourceId) return {
		status: 403,
		error: "Forbidden",
		message: "FGA authorization denied: route FGA metadata is incomplete"
	};
	const effectivePermission = route.path ? getEffectivePermission(route) : null;
	const permission = fgaConfig.permission || effectivePermission || `${getFGAResourcePermissionSlug(fgaConfig.resourceType)}:${deriveFGAAction(route.method)}`;
	if (!await fgaProvider.check(user, {
		resource: {
			type: fgaConfig.resourceType,
			id: resourceId
		},
		permission,
		context: {
			resourceId,
			requestContext
		}
	})) return {
		status: 403,
		error: "Forbidden",
		message: `FGA authorization denied: cannot ${permission} on ${fgaConfig.resourceType}:${resourceId}`
	};
	return null;
}
function deriveFGAAction(method) {
	switch (method.toUpperCase()) {
		case "GET": return "read";
		case "DELETE": return "delete";
		case "POST":
		case "PUT":
		case "PATCH": return "write";
		default: return "read";
	}
}
function getFGAResourcePermissionSlug(resourceType) {
	return {
		agent: "agents",
		workflow: "workflows",
		tool: "tools",
		thread: "memory"
	}[resourceType] ?? resourceType;
}

export { MastraServer as M, authorizeRoute as a, applyMcpRequestAuth as b, checkRouteRBAC as c, dispatchRoute as d, getHTTPErrorResponse as e, MASTRA_FRAMEWORK_PUBLIC_KEY as f, getCustomHTTPExceptionResponse as g, getFGAProvider as h, isSafeObjectKey as i, checkRouteFGA as j, normalizeQueryParams as n, propagateRequestAbort as p, redactStreamChunk as r, serializeStreamChunk as s };
