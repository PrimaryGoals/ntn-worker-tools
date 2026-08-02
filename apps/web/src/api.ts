import type {
	AppConfig,
	LogsPayload,
	RunsPayload,
	WebhookFireResult,
	WebhooksPayload,
	Whoami,
	Worker,
	WorkerEnvPayload,
	WorkerUsage,
} from "@ntn-ui/shared";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
	const res = await fetch(path, {
		...init,
		headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
	});
	if (!res.ok) {
		let msg = "";
		try {
			const body = (await res.json()) as { error?: string; detail?: string };
			msg = body.detail ? `${body.error}: ${body.detail}` : (body.error ?? "");
		} catch {
			msg = await res.text();
		}
		throw new Error(msg || `${res.status} ${res.statusText}`);
	}
	return (await res.json()) as T;
}

export const api = {
	getConfig: () => request<AppConfig>("/api/config"),
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
	fireWebhook: (url: string) =>
		request<WebhookFireResult>("/api/webhook/fire", {
			method: "POST",
			body: JSON.stringify({ url }),
		}),
};
