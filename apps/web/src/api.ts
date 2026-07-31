import type { AppConfig, LogsPayload, RunsPayload, Whoami, Worker } from "@ntn-ui/shared";

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
	getWhoami: () => request<Whoami>("/api/whoami"),
	getWorkers: () => request<Worker[]>("/api/workers"),
	getRuns: (workerId: string) => request<RunsPayload>(`/api/workers/${workerId}/runs`),
	getLogs: (workerId: string, runId: string, verbose = false) =>
		request<LogsPayload>(
			`/api/workers/${workerId}/runs/${runId}/logs${verbose ? "?verbose=1" : ""}`,
		),
};
