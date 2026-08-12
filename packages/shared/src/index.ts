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
	// workerId -> whether the local folder is a git repo (cached; only positive
	// results are stored — a `git init` after the fact is picked up next check).
	workerIsGitRepo?: Record<string, boolean>;
	// workerId -> absolute path of the git repo top-level (may be an ancestor of
	// the worker's local path). All git commands run from this directory so
	// porcelain-relative paths resolve correctly.
	workerGitRoot?: Record<string, string>;
	// ISO 8601 timestamp of the last "Mark current time" click. Global (not
	// per-worker) — shown in the runs panel for every worker to split runs
	// into before/after the marker.
	timeMarker?: string;
}

export interface EnvInfo {
	// Whether the machine running the server has git on PATH.
	gitAvailable: boolean;
	gitVersion: string | null;
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
	isGitRepo: boolean;
}

export interface GitStatusEntry {
	// Two-char porcelain code, e.g. " M", "M ", "??", "AM".
	statusCode: string;
	path: string;
}

export interface LocalMtimes {
	// workerId -> ISO 8601 timestamp of the most recently modified file under
	// that worker's local path (recursive scan, skipping node_modules/build
	// output/hidden dirs), or null when the folder is empty or unreadable.
	// Works regardless of VCS (or no VCS at all). Only includes workers with a
	// registered local path.
	[workerId: string]: string | null;
}

export interface GitStatus {
	isGitRepo: boolean;
	files: GitStatusEntry[];
	// Combined diff of staged + unstaged changes vs HEAD.
	// Empty string when there are no committed refs to diff against.
	diff: string;
	// Absolute path of the git repo top-level. Same as the worker's registered
	// path for a standalone worker; an ancestor for a worker inside a monorepo.
	gitRoot: string;
	// Worker's registered path relative to gitRoot, forward-slashed. "" when
	// the worker sits at the repo root (standalone case).
	workerPathRelToRoot: string;
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

export interface ApiError {
	error: string;
	detail?: string;
	// Present on the "worker mismatch" 400 from POST /api/workers/:id/local-path.
	folderWorkerId?: string;
	folderWorkerName?: string;
	selectedWorkerId?: string;
}
