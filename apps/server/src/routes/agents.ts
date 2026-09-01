import type { FastifyInstance } from "fastify";
import type {
	AgentHealthPayload,
	AgentSession,
	AgentSessionsPayload,
	AgentSummary,
	AgentStatus,
	AgentUsage,
	AgentUsagePayload,
	DeployResult,
	RunHealth,
	SessionEvent,
	SessionEventsPayload,
} from "@ntn-worker-tools/shared";
import { AGENT_STATUS_VALUES, computeAgentHealth, RUN_HEALTH_WINDOW } from "@ntn-worker-tools/shared";
import { formatCommandForDisplay, NtnError, runNtnRawAllowingFailure } from "../ntn.js";
import { isVerbose } from "../route-helpers.js";
import { resolveNotionApiVersion, withSpecFetchHint } from "../notion-version.js";

const AGENTS_QUERY_PATH = "/v1/agents/query";
// The API caps both agent and session pages at 100. Nothing here auto-pages:
// `hasMore` is passed through so the UI can say so rather than silently
// truncating.
const MAX_PAGE_SIZE = 100;
// The insights endpoint rejects any window longer than this.
const MAX_INSIGHTS_WINDOW_DAYS = 90;
// Bound on how far the cross-agent view will page. "All agents since <marker>"
// promises everything after the marker, so unlike the per-agent list it can't
// stop at one page — but an ancient marker shouldn't fetch unboundedly either.
const MAX_SESSION_PAGES = 10;

function apiArgs(path: string, body?: unknown): string[] {
	return body === undefined ? ["api", path] : ["api", path, "-d", JSON.stringify(body)];
}

// Every `ntn api` spawn in this file goes through here, so the resolved
// Notion-Version is applied uniformly and spec-fetch failures get the restart
// guidance attached in one place. A null version means resolution failed, and
// the CLI is spawned unchanged to attempt its own fetch.
async function runNtnApi(args: string[]) {
	const version = await resolveNotionApiVersion();
	const result = await runNtnRawAllowingFailure(args, {
		closeStdin: true,
		...(version ? { env: { NOTION_API_VERSION: version } } : {}),
	});
	return {
		...result,
		stderr: withSpecFetchHint(result.stderr),
		stdout: withSpecFetchHint(result.stdout),
	};
}

// Runs an `ntn api` call and parses its JSON. closeStdin is essential here:
// `ntn api` accepts the request body on stdin, so with an open pipe it waits
// there forever instead of using the -d argument it was given (see ntn.ts).
async function ntnApiJson<T>(path: string, body?: unknown): Promise<T> {
	const args = apiArgs(path, body);
	const label = `ntn api ${path}`;
	const { exitCode, stdout, stderr } = await runNtnApi(args);
	if (exitCode !== 0) {
		throw new NtnError(`${label} failed`, {
			exitCode,
			stderr,
			detail: stderr.trim() || stdout.trim(),
		});
	}
	try {
		return JSON.parse(stdout) as T;
	} catch {
		throw new NtnError(`${label} returned invalid JSON`, { detail: stdout.slice(0, 500) });
	}
}

interface RawAgent {
	id: string;
	name: string;
	description: string | null;
	agent_type: string;
	status: string;
	model: { mode: string; id?: string | null };
	agent_version?: { number?: number };
	last_run_at: string | null;
	created_time: string;
	credit_limit?: number | "hidden" | null;
	pause_reason?: string | null;
	triggers?: Array<{ type: string; enabled: boolean }>;
}

function toAgentSummary(a: RawAgent): AgentSummary {
	const triggers = a.triggers ?? [];
	return {
		id: a.id,
		name: a.name,
		description: a.description,
		agentType: a.agent_type,
		status: a.status,
		// mode "auto" carries no id; mode "pinned" does.
		model: a.model?.id ?? a.model?.mode ?? "unknown",
		versionNumber: a.agent_version?.number ?? 0,
		lastRunAt: a.last_run_at,
		createdTime: a.created_time,
		creditLimit: a.credit_limit ?? null,
		pauseReason: a.pause_reason ?? null,
		triggerCount: triggers.length,
		enabledTriggerCount: triggers.filter((t) => t.enabled).length,
	};
}

interface RawSession {
	id: string;
	agent_id: string;
	status: string;
	trigger_type: string;
	title: string;
	created_at: string;
	updated_at: string;
	message_count: number;
	tool_call_count: number;
	credits_used: number;
	runs_completed: number | null;
	type_labels?: string[];
	tool_types?: string[];
	error?: { code: string; message: string; retryable: boolean };
}

function toAgentSession(s: RawSession): AgentSession {
	const toolTypes = s.tool_types ?? [];
	return {
		id: s.id,
		agentId: s.agent_id,
		status: s.status,
		triggerType: s.trigger_type,
		title: s.title,
		createdAt: s.created_at,
		updatedAt: s.updated_at,
		messageCount: s.message_count,
		toolCallCount: s.tool_call_count,
		creditsUsed: s.credits_used,
		runsCompleted: s.runs_completed,
		typeLabels: s.type_labels ?? [],
		toolTypes,
		...(s.error ? { error: s.error } : {}),
		// An agent that calls markSessionFailed still leaves the session
		// status "completed" — that tool call is the only signal its work
		// didn't land. Surfaced as its own flag so the UI needn't know that.
		agentReportedFailure: toolTypes.includes("markSessionFailed"),
	};
}

interface RawInsights {
	name?: string;
	runs_completed?: number;
	total_credits_used?: number;
	credit_limit?: number | "hidden" | null;
	status?: string;
	pause_reason?: string | null;
}

interface RawEvent {
	sequence: number;
	type: string;
	created_at: string;
	tool_name?: string;
	is_error?: boolean;
	status?: string;
	metadata?: { model?: string };
	content?: unknown;
}

// Event content is an array of {type, text} parts on agent/user messages, and
// absent on every other event type. Flattened to a plain string for display.
function flattenContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((part) =>
			part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string"
				? (part as { text: string }).text
				: "",
		)
		.join("")
		.trim();
}

function toSessionEvent(e: RawEvent): SessionEvent {
	const text = flattenContent(e.content);
	return {
		sequence: e.sequence,
		type: e.type,
		createdAt: e.created_at,
		...(e.tool_name ? { toolName: e.tool_name } : {}),
		...(e.is_error === undefined ? {} : { isError: e.is_error }),
		...(e.status ? { status: e.status } : {}),
		...(text ? { text } : {}),
		...(e.metadata?.model ? { model: e.metadata.model } : {}),
	};
}

export default async function agentsRoutes(app: FastifyInstance) {
	// Not worker-scoped: these are workspace-level public-API calls, so they
	// run from the app's default working directory like `ntn whoami` does.
	//
	// Whose agents come back depends on the credential `ntn` is logged in
	// with: a personal access token returns the agents its user can read,
	// while a connection returns only agents explicitly shared with it. An
	// empty results array is a valid response, not an error.
	// Parsed list for the Agents tab.
	app.get("/api/agents", async (): Promise<AgentSummary[]> => {
		const data = await ntnApiJson<{ results: RawAgent[] }>(AGENTS_QUERY_PATH, {
			page_size: MAX_PAGE_SIZE,
		});
		return (data.results ?? []).map(toAgentSummary);
	});

	// Health dots for the Agents tab, scored by the same rules as worker runs.
	// One small sessions query per agent (page_size = the scoring window) rather
	// than one big unfiltered page, so a chatty agent can't crowd quieter ones
	// out of their own window. Mirrors /api/workers/run-health.
	app.get("/api/agents/health", async (): Promise<AgentHealthPayload> => {
		const data = await ntnApiJson<{ results: RawAgent[] }>(AGENTS_QUERY_PATH, {
			page_size: MAX_PAGE_SIZE,
		});
		const entries = await Promise.all(
			(data.results ?? []).map(async (agent): Promise<[string, RunHealth]> => {
				try {
					const sessions = await ntnApiJson<{ results: RawSession[] }>("/v1/sessions/query", {
						filter: { property: "agent_id", string: { equals: agent.id } },
						page_size: RUN_HEALTH_WINDOW,
					});
					return [agent.id, computeAgentHealth((sessions.results ?? []).map(toAgentSession))];
				} catch {
					// One agent's lookup failing shouldn't blank out the rest.
					return [agent.id, "unknown"];
				}
			}),
		);
		return { health: Object.fromEntries(entries) };
	});

	// The output panel shows this verbatim, so it returns the raw command
	// result rather than a parsed shape.
	app.get<{ Params: { id: string }; Querystring: { verbose?: string } }>(
		"/api/agents/:id/insights",
		async (req): Promise<DeployResult> => {
			const args = [
				...apiArgs(`/v1/agents/${req.params.id}/insights`),
				...(isVerbose(req.query.verbose) ? ["-v"] : []),
			];
			const { exitCode, stdout, stderr, durationMs } = await runNtnApi(args);
			return {
				command: formatCommandForDisplay("ntn", args),
				cwd: "",
				exitCode,
				stdout,
				stderr,
				durationMs,
			};
		},
	);

	// PATCH /v1/agents/{id}/status. The endpoint accepts only "active" and
	// "disabled"; "deleted" is a state an agent can be in but not one you can
	// set. Re-activating only works for agents disabled through this API — an
	// agent the platform paused (see pause_reason) may refuse, and the API's
	// own error is surfaced rather than guessed at here.
	app.patch<{ Params: { id: string }; Body: { status?: string } }>(
		"/api/agents/:id/status",
		async (req, reply): Promise<DeployResult> => {
			const status = req.body?.status;
			if (!status || !AGENT_STATUS_VALUES.includes(status as AgentStatus)) {
				return reply.code(400).send({
					error: `status must be one of: ${AGENT_STATUS_VALUES.join(", ")}`,
				}) as unknown as DeployResult;
			}
			const args = [
				...apiArgs(`/v1/agents/${req.params.id}/status`, { status }),
				"-X",
				"PATCH",
			];
			const { exitCode, stdout, stderr, durationMs } = await runNtnApi(args);
			return {
				command: formatCommandForDisplay("ntn", args),
				cwd: "",
				exitCode,
				stdout,
				stderr,
				durationMs,
			};
		},
	);

	// PATCH /v1/agents/{id}/credit_limit. A non-negative integer sets the
	// limit; null clears it, which is how the UI's empty input is expressed.
	app.patch<{ Params: { id: string }; Body: { creditLimit?: number | null } }>(
		"/api/agents/:id/credit-limit",
		async (req, reply): Promise<DeployResult> => {
			const raw = req.body?.creditLimit;
			const clearing = raw === null || raw === undefined;
			if (!clearing && (!Number.isInteger(raw) || (raw as number) < 0)) {
				return reply.code(400).send({
					error: "creditLimit must be a non-negative integer, or null to clear it",
				}) as unknown as DeployResult;
			}
			const args = [
				...apiArgs(`/v1/agents/${req.params.id}/credit_limit`, {
					credit_limit: clearing ? null : raw,
				}),
				"-X",
				"PATCH",
			];
			const { exitCode, stdout, stderr, durationMs } = await runNtnApi(args);
			return {
				command: formatCommandForDisplay("ntn", args),
				cwd: "",
				exitCode,
				stdout,
				stderr,
				durationMs,
			};
		},
	);

	// There is no /v1/agents/{id}/sessions — sessions are a global collection
	// narrowed by an agent_id filter.
	app.get<{ Params: { id: string } }>(
		"/api/agents/:id/sessions",
		async (req): Promise<AgentSessionsPayload> => {
			const data = await ntnApiJson<{ results: RawSession[]; has_more?: boolean }>(
				"/v1/sessions/query",
				{
					filter: { property: "agent_id", string: { equals: req.params.id } },
					page_size: MAX_PAGE_SIZE,
				},
			);
			return {
				sessions: (data.results ?? []).map(toAgentSession),
				hasMore: Boolean(data.has_more),
			};
		},
	);

	// Sessions across every agent since a timestamp — the agent-side analogue
	// of the cross-worker runs view. Filtering on created_at rather than
	// fetching per agent keeps this to one call regardless of agent count.
	app.get<{ Querystring: { since?: string } }>(
		"/api/sessions/cross-agent",
		async (req): Promise<AgentSessionsPayload> => {
			const since = req.query.since;
			const filter = since
				? { filter: { property: "created_at", timestamp: { after: since } } }
				: {};
			// Page through rather than taking the first 100: the API returns
			// newest-first, so a single page silently cuts the window off at an
			// arbitrary date that looks like a filter bug. Mirrors how the
			// cross-worker runs route walks each worker's pages.
			const collected: AgentSession[] = [];
			let cursor: string | undefined;
			let truncated = false;
			for (let page = 0; page < MAX_SESSION_PAGES; page++) {
				const data = await ntnApiJson<{
					results: RawSession[];
					has_more?: boolean;
					next_cursor?: string | null;
				}>("/v1/sessions/query", {
					...filter,
					page_size: MAX_PAGE_SIZE,
					...(cursor ? { start_cursor: cursor } : {}),
				});
				for (const raw of data.results ?? []) collected.push(toAgentSession(raw));
				if (!data.has_more || !data.next_cursor) break;
				cursor = data.next_cursor;
				// Ran out of page budget with more still upstream.
				if (page === MAX_SESSION_PAGES - 1) truncated = true;
			}
			return { sessions: collected, hasMore: truncated };
		},
	);

	// One insights call per agent, in parallel — same shape as the
	// cross-worker usage route. With no start/end the API reports the current
	// billing period, which is the default this view shows.
	app.get<{ Querystring: { start?: string; end?: string } }>(
		"/api/agents/usage",
		async (req, reply): Promise<AgentUsagePayload> => {
			const { start, end } = req.query;
			// The API requires both bounds or neither.
			if (Boolean(start) !== Boolean(end)) {
				return reply
					.code(400)
					.send({ error: "start and end must be supplied together" }) as unknown as AgentUsagePayload;
			}
			let query = "";
			if (start && end) {
				const startMs = Date.parse(start);
				const endMs = Date.parse(end);
				if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
					return reply
						.code(400)
						.send({ error: "start and end must be ISO timestamps" }) as unknown as AgentUsagePayload;
				}
				const spanDays = (endMs - startMs) / 86_400_000;
				if (spanDays > MAX_INSIGHTS_WINDOW_DAYS) {
					return reply.code(400).send({
						error: `The insights window cannot exceed ${MAX_INSIGHTS_WINDOW_DAYS} days.`,
					}) as unknown as AgentUsagePayload;
				}
				// Epoch seconds, as the endpoint requires.
				query = `?start_time=${Math.floor(startMs / 1000)}&end_time=${Math.floor(endMs / 1000)}`;
			}

			const agents = await ntnApiJson<{ results: RawAgent[] }>(AGENTS_QUERY_PATH, {
				page_size: MAX_PAGE_SIZE,
			});
			const usages = await Promise.all(
				(agents.results ?? []).map(async (agent): Promise<AgentUsage> => {
					const ins = await ntnApiJson<RawInsights>(
						`/v1/agents/${agent.id}/insights${query}`,
					);
					return {
						agentId: agent.id,
						agentName: ins.name ?? agent.name,
						runsCompleted: ins.runs_completed ?? 0,
						totalCreditsUsed: ins.total_credits_used ?? 0,
						creditLimit: ins.credit_limit ?? null,
						status: ins.status ?? agent.status,
						pauseReason: ins.pause_reason ?? null,
					};
				}),
			);
			return { usages, windowStart: start ?? null, windowEnd: end ?? null };
		},
	);

	// Session-scoped rather than agent-scoped, but it exists only to serve the
	// Agents tab's transcript view, so it lives here with the rest.
	app.get<{ Params: { id: string } }>(
		"/api/sessions/:id/events",
		async (req): Promise<SessionEventsPayload> => {
			const data = await ntnApiJson<{ results: RawEvent[]; has_more?: boolean }>(
				`/v1/sessions/${req.params.id}/events/query`,
				{ page_size: MAX_PAGE_SIZE },
			);
			return {
				events: (data.results ?? []).map(toSessionEvent).sort((a, b) => a.sequence - b.sequence),
				hasMore: Boolean(data.has_more),
			};
		},
	);
}
