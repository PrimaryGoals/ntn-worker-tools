import type {
	AppConfig,
	DeployResult,
	EnvInfo,
	FsListing,
	GitStatus,
	LocalInfo,
	LogsPayload,
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
		try {
			const body = JSON.parse(text) as { error?: string; detail?: string };
			msg = body.detail ? `${body.error}: ${body.detail}` : (body.error ?? text);
		} catch {
			/* keep raw text */
		}
		throw new Error(msg || `${res.status} ${res.statusText}`);
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
	getEnvInfo: () => request<EnvInfo>("/api/env-info"),
	getFsHome: () => request<{ path: string }>("/api/fs/home"),
	getFsListing: (path: string) =>
		request<FsListing>(`/api/fs/list?path=${encodeURIComponent(path)}`),
	getWhoami: (verbose = false) =>
		request<Whoami>(`/api/whoami${verbose ? "?verbose=1" : ""}`),
	getWorkers: () => request<Worker[]>("/api/workers"),
	getRuns: (workerId: string) => request<RunsPayload>(`/api/workers/${workerId}/runs`),
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
	revealWorker: (workerId: string) =>
		request<{ ok: true; path: string }>(`/api/workers/${workerId}/reveal`, { method: "POST" }),
	deployWorker: (workerId: string, verbose = false) =>
		request<DeployResult>(
			`/api/workers/${workerId}/deploy${verbose ? "?verbose=1" : ""}`,
			{ method: "POST" },
		),
	pnpmDeployWorker: (workerId: string) =>
		request<DeployResult>(`/api/workers/${workerId}/pnpm-deploy`, { method: "POST" }),
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
	getGitStatus: (workerId: string) =>
		request<GitStatus>(`/api/workers/${workerId}/git-status`),
	gitCommit: (workerId: string, files: string[], message: string) =>
		request<DeployResult>(`/api/workers/${workerId}/git-commit`, {
			method: "POST",
			body: JSON.stringify({ files, message }),
		}),
};
