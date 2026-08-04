import type {
	AppConfig,
	DeployResult,
	EnvInfo,
	FsListing,
	GitStatus,
	LocalInfo,
	LogsPayload,
	RunsPayload,
	WebhookFireResult,
	WebhooksPayload,
	Whoami,
	Worker,
	WorkerEnvPayload,
	WorkerUsage,
} from "@ntn-worker-tools/shared";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
	// Only advertise JSON when we're actually sending a body — Fastify rejects
	// content-type: application/json with an empty body.
	const hasBody = init?.body != null;
	const res = await fetch(path, {
		// Send the session cookie on every API call; the guard rejects 401 without it.
		credentials: "same-origin",
		...init,
		headers: {
			...(hasBody ? { "content-type": "application/json" } : {}),
			...(init?.headers ?? {}),
		},
	});
	if (!res.ok) {
		// Read the body once, then try to parse — otherwise the second read fails
		// with "body stream already read" and hides the real error.
		const text = await res.text();
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
	getWorkerEnv: (workerId: string, verbose = false) =>
		request<WorkerEnvPayload>(
			`/api/workers/${workerId}/env${verbose ? "?verbose=1" : ""}`,
		),
	fireWebhook: (url: string, webhookSecret?: string) =>
		request<WebhookFireResult>("/api/webhook/fire", {
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
