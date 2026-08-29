import type {
	ApiError,
	AppConfig,
	CrossWorkerRunsPayload,
	CrossWorkerUsagePayload,
	DeployNewInspection,
	DeployResult,
	FsListing,
	LocalInfo,
	LocalMtimes,
	LogsPayload,
	RunHealthPayload,
	RunsPayload,
	SyncStatus,
	WebhookFireResult,
	WebhooksPayload,
	Whoami,
	Worker,
	WorkerEnvPayload,
	WorkerUsage,
} from "@ntn-worker-tools/shared";

const SERVER_UNREACHABLE_MESSAGE =
	"Confirm that your local server is running, or restart it with: pnpm dev";

// The server's JSON error body (ApiError) gets Object.assign'd onto the thrown
// Error below, so any extra fields it sends (e.g. folderWorkerName) are
// available on caught errors without a runtime cast.
export type ApiRequestError = Error & Partial<ApiError>;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
	// Only advertise JSON when we're actually sending a body — Fastify rejects
	// content-type: application/json with an empty body.
	const hasBody = init?.body != null;
	let res: Response;
	try {
		res = await fetch(path, {
			// Send the session cookie on every API call; the guard rejects 401 without it.
			credentials: "same-origin",
			...init,
			headers: {
				...(hasBody ? { "content-type": "application/json" } : {}),
				...(init?.headers ?? {}),
			},
		});
	} catch {
		// fetch() itself only throws for network-level failures (can't reach
		// the server at all) — HTTP error responses resolve normally below
		// and are handled by the !res.ok branch instead.
		throw new Error(SERVER_UNREACHABLE_MESSAGE);
	}
	if (!res.ok) {
		// Read the body once, then try to parse — otherwise the second read fails
		// with "body stream already read" and hides the real error.
		const text = await res.text();
		// Our own server sends a JSON body on every error path (see
		// setErrorHandler and every reply.code(...).send(...) call). An empty
		// body means this response never reached our app code at all — Vite's
		// dev proxy sends exactly this (empty body, 500) when it can't reach
		// the API server, e.g. because it isn't running.
		if (!text.trim()) {
			throw new Error(SERVER_UNREACHABLE_MESSAGE);
		}
		let msg = text;
		let body: Record<string, unknown> = {};
		try {
			body = JSON.parse(text) as Record<string, unknown>;
			msg = body.detail ? `${body.error}: ${body.detail}` : ((body.error as string) ?? text);
		} catch {
			/* keep raw text */
		}
		const err: ApiRequestError = new Error(msg || `${res.status} ${res.statusText}`);
		Object.assign(err, body);
		throw err;
	}
	return (await res.json()) as T;
}

export const api = {
	getSessionStatus: () => request<{ authenticated: boolean }>("/api/session/status"),
	sessionLogin: (token: string) =>
		request<{ ok: true }>("/api/session/login", {
			method: "POST",
			body: JSON.stringify({ token }),
		}),
	sessionLogout: () =>
		request<{ ok: true }>("/api/session/logout", { method: "POST" }),
	getConfig: () => request<AppConfig>("/api/config"),
	updateUiConfig: (patch: Partial<AppConfig["ui"]>) =>
		request<AppConfig>("/api/config/ui", {
			method: "PATCH",
			body: JSON.stringify(patch),
		}),
	getFsHome: () => request<{ path: string }>("/api/fs/home"),
	getFsListing: (path: string) =>
		request<FsListing>(`/api/fs/list?path=${encodeURIComponent(path)}`),
	getWhoami: (verbose = false) =>
		request<Whoami>(`/api/whoami${verbose ? "?verbose=1" : ""}`),
	getWorkers: () => request<Worker[]>("/api/workers"),
	getRuns: (workerId: string) => request<RunsPayload>(`/api/workers/${workerId}/runs`),
	getRunHealth: () => request<RunHealthPayload>("/api/workers/run-health"),
	getCrossWorkerRuns: (since: string) =>
		request<CrossWorkerRunsPayload>(`/api/runs/cross-worker?since=${encodeURIComponent(since)}`),
	getCrossWorkerUsage: () => request<CrossWorkerUsagePayload>("/api/usage/cross-worker"),
	markTime: (time?: string) =>
		request<AppConfig>("/api/config/mark-time", {
			method: "POST",
			...(time ? { body: JSON.stringify({ time }) } : {}),
		}),
	clearTimeMarker: () =>
		request<AppConfig>("/api/config/clear-time-marker", { method: "POST" }),
	getLogs: (workerId: string, runId: string, verbose = false) =>
		request<LogsPayload>(
			`/api/workers/${workerId}/runs/${runId}/logs${verbose ? "?verbose=1" : ""}`,
		),
	getWorker: (workerId: string, verbose = false) =>
		request<Worker>(`/api/workers/${workerId}${verbose ? "?verbose=1" : ""}`),
	getWorkerUsage: (workerId: string, verbose = false) =>
		request<WorkerUsage>(`/api/workers/${workerId}/usage${verbose ? "?verbose=1" : ""}`),
	getWorkerWebhooks: (workerId: string, verbose = false) =>
		request<WebhooksPayload>(
			`/api/workers/${workerId}/webhooks${verbose ? "?verbose=1" : ""}`,
		),
	getWorkerCapabilities: (workerId: string, verbose = false) =>
		request<{ capabilities: unknown; _trace?: string }>(
			`/api/workers/${workerId}/capabilities${verbose ? "?verbose=1" : ""}`,
		),
	getWorkerEnv: (workerId: string, verbose = false) =>
		request<WorkerEnvPayload>(
			`/api/workers/${workerId}/env${verbose ? "?verbose=1" : ""}`,
		),
	getSyncStatus: (workerId: string, verbose = false) =>
		request<{ statuses: SyncStatus[]; _trace?: string }>(
			`/api/workers/${workerId}/sync/status${verbose ? "?verbose=1" : ""}`,
		),
	syncTrigger: (workerId: string, syncKey: string, verbose = false) =>
		request<DeployResult>(
			`/api/workers/${workerId}/sync/trigger${verbose ? "?verbose=1" : ""}`,
			{ method: "POST", body: JSON.stringify({ syncKey }) },
		),
	syncPause: (workerId: string, syncKey: string, verbose = false) =>
		request<DeployResult>(
			`/api/workers/${workerId}/sync/pause${verbose ? "?verbose=1" : ""}`,
			{ method: "POST", body: JSON.stringify({ syncKey }) },
		),
	syncResume: (workerId: string, syncKey: string, verbose = false) =>
		request<DeployResult>(
			`/api/workers/${workerId}/sync/resume${verbose ? "?verbose=1" : ""}`,
			{ method: "POST", body: JSON.stringify({ syncKey }) },
		),
	syncStateReset: (workerId: string, syncKey: string, verbose = false) =>
		request<DeployResult>(
			`/api/workers/${workerId}/sync/state-reset${verbose ? "?verbose=1" : ""}`,
			{ method: "POST", body: JSON.stringify({ syncKey }) },
		),
	fireWebhook: (url: string, webhookSecret?: string, verbose = false) =>
		request<WebhookFireResult>(`/api/webhook/fire${verbose ? "?verbose=1" : ""}`, {
			method: "POST",
			body: JSON.stringify({ url, webhookSecret }),
		}),
	setWorkerLocalPath: (workerId: string, path: string) =>
		request<AppConfig>(`/api/workers/${workerId}/local-path`, {
			method: "POST",
			body: JSON.stringify({ path }),
		}),
	clearWorkerLocalPath: (workerId: string) =>
		request<AppConfig>(`/api/workers/${workerId}/local-path`, { method: "DELETE" }),
	getWorkerLocalInfo: (workerId: string) =>
		request<LocalInfo>(`/api/workers/${workerId}/local-info`),
	getLocalMtimes: () => request<LocalMtimes>("/api/workers/local-mtimes"),
	revealWorker: (workerId: string) =>
		request<{ ok: true; path: string }>(`/api/workers/${workerId}/reveal`, { method: "POST" }),
	deployWorker: (workerId: string, verbose = false) =>
		request<DeployResult>(
			`/api/workers/${workerId}/deploy${verbose ? "?verbose=1" : ""}`,
			{ method: "POST" },
		),
	pnpmDeployWorker: (workerId: string) =>
		request<DeployResult>(`/api/workers/${workerId}/pnpm-deploy`, { method: "POST" }),
	renameWorker: (workerId: string, newName: string) =>
		request<DeployResult>(`/api/workers/${workerId}/rename`, {
			method: "POST",
			body: JSON.stringify({ newName }),
		}),
	pushWorkerSecrets: (workerId: string, verbose = false) =>
		request<DeployResult>(
			`/api/workers/${workerId}/env/push${verbose ? "?verbose=1" : ""}`,
			{ method: "POST" },
		),
	setWorkerEnvVar: (workerId: string, key: string, value: string, verbose = false) =>
		request<DeployResult>(
			`/api/workers/${workerId}/env/set${verbose ? "?verbose=1" : ""}`,
			{ method: "POST", body: JSON.stringify({ key, value }) },
		),
	// Note: /api/workers/batch-actions streams NDJSON and is called directly
	// via fetch() from DeployUpdatedWorkersModal, not through this helper —
	// request<T>() only supports one-shot JSON responses.
	inspectDeployNewPath: (path: string) =>
		request<DeployNewInspection>(`/api/deploy-new/inspect?path=${encodeURIComponent(path)}`),
	cleanDeployNewFiles: (path: string, files: Array<"workers.json" | ".env">) =>
		request<{ ok: true }>("/api/deploy-new/clean", {
			method: "POST",
			body: JSON.stringify({ path, files }),
		}),
	deployNewWorker: (path: string, name: string) =>
		request<DeployResult>("/api/deploy-new/deploy", {
			method: "POST",
			body: JSON.stringify({ path, name }),
		}),
	pnpmDeployNewWorker: (path: string, newName?: string) =>
		request<DeployResult>("/api/deploy-new/pnpm-deploy", {
			method: "POST",
			body: JSON.stringify({ path, ...(newName ? { newName } : {}) }),
		}),
	oauthShowRedirectUrl: (verbose = false) =>
		request<DeployResult>(`/api/oauth/show-redirect-url${verbose ? "?verbose=1" : ""}`, {
			method: "POST",
		}),
	oauthStart: (workerId: string, key: string, verbose = false) =>
		request<DeployResult>(`/api/workers/${workerId}/oauth/start${verbose ? "?verbose=1" : ""}`, {
			method: "POST",
			body: JSON.stringify({ key }),
		}),
	oauthToken: (workerId: string, key: string, verbose = false) =>
		request<DeployResult>(`/api/workers/${workerId}/oauth/token${verbose ? "?verbose=1" : ""}`, {
			method: "POST",
			body: JSON.stringify({ key }),
		}),
};
