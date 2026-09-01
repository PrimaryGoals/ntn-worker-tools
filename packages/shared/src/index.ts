export interface Whoami {
	userId: string;
	userName: string;
	userType: string;
	userEmail?: string;
	spaceId: string;
	spaceName: string;
	ownerId?: string;
	ownerName?: string;
	ownerType?: string;
	// populated only when the request set ?verbose=1
	_trace?: string;
}

export interface Worker {
	workerId: string;
	name: string;
	spaceId: string;
	createdAt: string;
	updatedAt: string;
	updatedByName?: string;
	// populated only when the request set ?verbose=1
	_trace?: string;
}

export interface Run {
	workerId: string;
	spaceId: string;
	runId: string;
	name: string;
	actorName: string;
	exitCode: number | null;
	startedAt: string;
	endedAt: string | null;
	// Populated by the cross-worker runs endpoint, which already knows the
	// worker's name while iterating — the single-worker endpoint leaves this
	// unset and callers fall back to a client-side workerId -> name lookup.
	workerName?: string;
}

export interface RunsPayload {
	runs: Run[];
	nextCursor?: string;
}

// A worker's recent-run health, shown as a colored dot in the workers list.
// "none" = the worker has never run; "unknown" = its run history couldn't be
// read. See computeRunHealth below for how the colors are derived.
export type RunHealth = "green" | "yellow" | "orange" | "red" | "none" | "unknown";

export interface RunHealthPayload {
	// workerId -> health. Every worker in the workspace gets an entry.
	health: Record<string, RunHealth>;
}

// How many recent runs a health score looks at, and the cutoff between the
// "recent" window and the older half. Position 1 is red on its own, so
// RECENT_WINDOW = 3 means orange covers positions 2-3 and yellow the rest.
export const RUN_HEALTH_WINDOW = 5;
const RECENT_WINDOW = 3;

// Scores a worker's runs into a single traffic-light value. Lives here rather
// than in either app because both score the same runs: the server sweeps every
// worker for the sidebar, and the client re-derives one worker's dot from run
// lists it already fetched (selecting a worker, firing its webhook).
//
// `runs` must be newest-first, as every `ntn workers runs list` payload is. Only
// the first RUN_HEALTH_WINDOW are considered, and in-flight runs (null exit
// code) are dropped from those, so the positions below count completed runs:
//   red    - the most recent completed run failed
//   orange - the newest failure sits in positions 2-3
//   yellow - the newest failure sits in positions 4-5
//   green  - nothing failed in the window
//   none   - no completed runs in the window
// Any non-zero exit code counts as a failure, not just 1.
export function computeRunHealth(runs: Run[]): RunHealth {
	// Any non-zero exit code is a failure; a null exit code means still running.
	return scoreHealth(
		runs.map((run) => (run.exitCode == null ? "pending" : run.exitCode === 0 ? "ok" : "failed")),
	);
}

// One execution's outcome, reduced to what scoring cares about. "pending" is
// dropped from the window rather than counted either way.
export type HealthOutcome = "ok" | "failed" | "pending";

// The scoring itself, shared by workers and agents so the two can never drift
// apart when these thresholds change. Takes outcomes newest-first.
export function scoreHealth(outcomes: HealthOutcome[]): RunHealth {
	const completed = outcomes.slice(0, RUN_HEALTH_WINDOW).filter((o) => o !== "pending");
	if (completed.length === 0) return "none";
	const newestFailure = completed.indexOf("failed");
	if (newestFailure === -1) return "green";
	if (newestFailure === 0) return "red";
	return newestFailure < RECENT_WINDOW ? "orange" : "yellow";
}

export interface CrossWorkerRunsPayload extends RunsPayload {
	// Recent-run health for every worker, scored from the first (unfiltered)
	// page of each worker's runs — the same page this endpoint already fetches
	// to find runs since the marker, so it costs no additional CLI calls.
	health: Record<string, RunHealth>;
}

export interface LogsPayload {
	logs: string;
	// populated only when the request set ?verbose=1
	_trace?: string;
}

export interface WorkerUsage {
	worker: Worker;
	days: number;
	usage: {
		sandboxCount: number;
		credits: number;
		activeCpuDurationMs: number;
		durationMs: number;
		networkIngressBytes: number;
		networkEgressBytes: number;
	};
	dailyUsage: Array<{
		day: string;
		sandboxCount: number;
		creditsMicro: number;
		activeCpuDurationMs: number;
		durationMs: number;
		networkIngressBytes: number;
		networkEgressBytes: number;
	}>;
	// populated only when the request set ?verbose=1
	_trace?: string;
}

export interface CrossWorkerUsagePayload {
	usages: WorkerUsage[];
}

export interface WebhookEntry {
	key: string;
	url: string;
	worker_id: string;
	worker_name: string;
	workspace_id: string;
}

export interface WebhooksPayload {
	webhooks: WebhookEntry[];
	// populated only when the request set ?verbose=1
	_trace?: string;
}

export interface SyncStatusCheck {
	slug: string;
	status: string;
	description: string;
	error: string | null;
}

export interface SyncStatus {
	_tag: string;
	capabilityKey: string;
	status: string;
	executing: boolean;
	checks: SyncStatusCheck[];
	disabled: boolean;
	schedule: { intervalMs: number; type: string };
	stats: {
		lastSucceededAt: number | null;
		lastCompletedAt: number | null;
		lastFailedAt: number | null;
		recentRunDurationsMs: number[];
		totalUpsertsProcessed: number;
		totalDeletesProcessed: number;
		cycleUpsertsProcessed: number;
		cycleDeletesProcessed: number;
	};
	nextRunAt: number | null;
	collectionId: string;
}

export interface WorkerEnvPayload {
	// raw .env-style KEY=VALUE lines from `ntn workers env pull --no-file --yes`
	text: string;
	// populated only when the request set ?verbose=1
	_trace?: string;
}

export interface WebhookFireResult {
	command: string;
	url: string;
	status: number;
	statusText: string;
	body: string;
	durationMs: number;
	// Names of any custom request headers the server added (values elided so
	// the transcript doesn't leak secrets). E.g. ["X-Webhook-Secret"] when a
	// WEBHOOK_SECRET was found in the worker's env.
	sentHeaders?: string[];
	// Raw response headers from curl -i. Only requested (and only present)
	// when the request set ?verbose=1 — otherwise curl runs without -i.
	_trace?: string;
}

export interface AppConfig {
	ui: {
		theme: "system" | "light" | "dark";
		panelSizes?: Record<string, number>;
	};
	// workerId -> absolute path of the local source directory
	workerLocalPaths?: Record<string, string>;
	// workerId -> ISO timestamp of the last successful code deploy THIS APP
	// initiated (ntn workers deploy / pnpm run deploy / deploy-updated /
	// deploy-new). Deliberately not re-derived from the worker's live
	// `updatedAt` on every check: that field bumps on ANY mutation, including
	// env pushes, so comparing local mtime against it live can mask an
	// undeployed code change behind an unrelated env push (this happened in
	// practice — a security-check code change sat undeployed on 8 workers
	// while an unrelated secrets sync made all 8 look up to date). Seeded once
	// from that live `updatedAt` the first time a worker's mtime is checked
	// with no prior record, so pre-existing setups don't all show stale on
	// rollout; after that, only actions this app runs update it. Tradeoff: an
	// external deploy (another machine, a teammate, a raw terminal) won't be
	// reflected here until this app deploys or pushes again — accepted as the
	// lesser failure mode (over-flagging something already fine) versus the
	// old one (silently hiding something that wasn't).
	workerLastCodeDeployAt?: Record<string, string>;
	// Same idea, for env pushes (env/push and env/set).
	workerLastEnvPushAt?: Record<string, string>;
	// ISO 8601 timestamp of the last "Mark current time" click. Global (not
	// per-worker) — shown in the runs panel for every worker to split runs
	// into before/after the marker.
	timeMarker?: string;
}

export interface LocalPathPayload {
	workerId: string;
	path: string | null;
}

export interface FsEntry {
	name: string;
	isDirectory: boolean;
	// True if this entry (when a directory) itself contains a workers.json.
	isWorkerProject: boolean;
}

export interface FsListing {
	path: string;
	// Parent directory, or null if this is a filesystem root (or a Windows drive root).
	parent: string | null;
	// True if `path` itself contains a workers.json (i.e. selecting it would succeed).
	isWorkerProject: boolean;
	entries: FsEntry[];
}

export interface LocalInfo {
	path: string;
	hasPackageJson: boolean;
	hasDeployScript: boolean;
	deployScript: string | null;
	hasEnvFile: boolean;
}

export interface LocalMtimeInfo {
	// ISO timestamp of the most recently modified file under the worker's
	// local path, excluding .env (recursive scan, skipping node_modules/build
	// output/hidden dirs), or null when there's nothing to compare. Compared
	// against workerLastCodeDeployAt.
	code: string | null;
	// ISO timestamp of .env's own mtime, or null if there's no .env file.
	// Compared against workerLastEnvPushAt.
	env: string | null;
}

export interface LocalMtimes {
	// workerId -> {code, env} mtimes. Works regardless of VCS (or no VCS at
	// all). Only includes workers with a registered local path.
	[workerId: string]: LocalMtimeInfo;
}

export interface DeployResult {
	command: string;
	cwd: string;
	exitCode: number;
	stdout: string;
	stderr: string;
	durationMs: number;
	// Present only when the command emitted a parseable JSON summary
	// (i.e. `ntn workers deploy --json` on success). Absent for pnpm run deploy.
	summary?: {
		worker_id: string;
		is_update: boolean;
		capabilities: Array<{ _tag: string; key: string; state?: unknown }>;
		webhook_urls: Array<{ key: string; url: string }>;
		database_links: unknown[];
	};
	// Present when the endpoint chains a second command after the primary one
	// succeeds — e.g. env push followed by env pull to display the current state.
	followup?: {
		command: string;
		exitCode: number;
		stdout: string;
		stderr: string;
		durationMs: number;
	};
}

export interface DeployNewInspection {
	path: string;
	folderName: string;
	hasWorkersJson: boolean;
	// Present only when workers.json exists and parses with the fields we need.
	workersJson?: { workspaceId: string; workerId: string; environment: string };
	hasEnvFile: boolean;
	// True when package.json declares scripts.deploy — usually a sign this
	// worker lives in a monorepo and needs a custom local-bundle step, not a
	// plain `ntn workers deploy`.
	hasDeployScript: boolean;
	deployScript: string | null;
	// package.json's own "name" field with any npm scope stripped (e.g.
	// "@pmfn/pm-echo" -> "pm-echo"). Used to detect/rename a stale worker name
	// left over from copying another worker's folder.
	packageName: string | null;
	// True when any dependency uses the pnpm/yarn `workspace:` protocol.
	// The remote build sandbox runs plain `npm install`, which errors on it
	// (EUNSUPPORTEDPROTOCOL) — a plain `ntn workers deploy` will fail here.
	hasWorkspaceProtocolDeps: boolean;
}

export interface ApiError {
	error: string;
	detail?: string;
	// Present on the "worker mismatch" 400 from POST /api/workers/:id/local-path.
	folderWorkerId?: string;
	folderWorkerName?: string;
	selectedWorkerId?: string;
}

export interface AgentSummary {
	id: string;
	name: string;
	description: string | null;
	agentType: string;
	// "active" | "disabled" | "deleted"
	status: string;
	// The pinned model id, or "auto" when the agent picks per run.
	model: string;
	versionNumber: number;
	lastRunAt: string | null;
	createdTime: string;
	// Both come back on the query response, so the list shows them without a
	// second call. creditLimit is a number, null when unset, or the literal
	// "hidden" when the token lacks full access to the agent.
	creditLimit: number | "hidden" | null;
	pauseReason: string | null;
	// An agent can be `status: "active"` with every trigger disabled, which
	// means it can never fire on its own. Both counts are kept so the list
	// can say so.
	triggerCount: number;
	enabledTriggerCount: number;
}

// One execution of an agent — the closest analogue to a worker Run.
export interface AgentSession {
	id: string;
	agentId: string;
	// "queued" | "in_progress" | "requires_action" | "completed" | "failed"
	// | "canceled" | "terminated"
	status: string;
	triggerType: string;
	title: string;
	createdAt: string;
	updatedAt: string;
	messageCount: number;
	toolCallCount: number;
	creditsUsed: number;
	// Null on some failed sessions — the run never completed enough to count.
	runsCompleted: number | null;
	typeLabels: string[];
	toolTypes: string[];
	// Present only when status is "failed" — an infrastructure-level failure
	// (rate limit, inference error) that the platform itself recorded.
	error?: { code: string; message: string; retryable: boolean };
	// True when the agent called markSessionFailed. This is the *other*
	// failure mode: the session still reports status "completed", so this is
	// the only signal that the agent's own work didn't land.
	agentReportedFailure: boolean;
}

// The only two values PATCH /v1/agents/{id}/status accepts. "deleted" appears
// in an agent's status field but cannot be set through this endpoint.
export const AGENT_STATUS_VALUES = ["active", "disabled"] as const;
export type AgentStatus = (typeof AGENT_STATUS_VALUES)[number];

// Scores an agent's sessions with the exact same rules as worker runs, via
// scoreHealth. Sessions must be newest-first, as the API returns them.
//
// Mapping sessions onto outcomes takes two judgement calls, both deliberate:
//   - A session the agent itself abandoned (markSessionFailed) counts as a
//     failure even though its status stays "completed" — otherwise the most
//     common agent failure would score green.
//   - "canceled" counts as ok, not a failure: it means somebody stopped the
//     session on purpose. "terminated" counts as a failure.
export function computeAgentHealth(sessions: AgentSession[]): RunHealth {
	return scoreHealth(
		sessions.map((s) => {
			if (s.status === "queued" || s.status === "in_progress" || s.status === "requires_action") {
				return "pending";
			}
			if (s.status === "failed" || s.status === "terminated" || s.agentReportedFailure) {
				return "failed";
			}
			return "ok";
		}),
	);
}

export interface AgentHealthPayload {
	// agentId -> health. Every visible agent gets an entry.
	health: Record<string, RunHealth>;
}

export interface AgentSessionsPayload {
	sessions: AgentSession[];
	// The API caps a page at 100 and we don't auto-page; true means there are
	// older sessions this list isn't showing.
	hasMore: boolean;
}

// One entry in a session transcript.
export interface SessionEvent {
	sequence: number;
	// "user.message" | "agent.message" | "agent.thinking" | "agent.tool_use"
	// | "agent.tool_result" | "session.status"
	type: string;
	createdAt: string;
	toolName?: string;
	// Set on tool_result events. Note the API exposes no error text alongside
	// it — a failed tool call is detectable but not diagnosable.
	isError?: boolean;
	status?: string;
	// Flattened message text. Only message events carry content; tool_use and
	// tool_result events expose neither arguments nor results.
	text?: string;
	// Per-message model, which can differ from the session's reported model.
	model?: string;
}

export interface SessionEventsPayload {
	events: SessionEvent[];
	hasMore: boolean;
}

// Per-agent usage, from GET /v1/agents/{id}/insights. Deliberately NOT merged
// with WorkerUsage: the only metric the two share is credits — agents have no
// sandbox count, CPU, wall duration, or network bytes, and workers have no
// credit limit or pause reason.
export interface AgentUsage {
	agentId: string;
	agentName: string;
	// Both figures cover the requested window only.
	runsCompleted: number;
	totalCreditsUsed: number;
	// A number, null when no limit is set, or the literal "hidden" when the
	// calling token lacks full access to the agent.
	creditLimit: number | "hidden" | null;
	status: string;
	// Why the agent is paused, when it is. Several values are quota-driven
	// (run_limit, credit_limit, runaway_credit_usage, workspace_credit_limit,
	// failure_limit, mark_session_failed_autopause), which is why this belongs
	// in the usage view rather than only on the agent record.
	pauseReason: string | null;
}

export interface AgentUsagePayload {
	usages: AgentUsage[];
	// Echoes the window the figures cover. Null bounds mean no explicit window
	// was requested, so the API used the current billing period.
	windowStart: string | null;
	windowEnd: string | null;
}
