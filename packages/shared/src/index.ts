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
