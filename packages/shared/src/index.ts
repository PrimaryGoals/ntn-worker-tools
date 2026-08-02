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

export interface WorkerEnvPayload {
	// raw .env-style KEY=VALUE lines from `ntn workers env pull --no-file --yes`
	text: string;
	// populated only when the request set ?verbose=1
	_trace?: string;
}

export interface WebhookFireResult {
	url: string;
	status: number;
	statusText: string;
	body: string;
	durationMs: number;
}

export interface AppConfig {
	ui: {
		theme: "system" | "light" | "dark";
		panelSizes?: Record<string, number>;
	};
}

export interface ApiError {
	error: string;
	detail?: string;
}
