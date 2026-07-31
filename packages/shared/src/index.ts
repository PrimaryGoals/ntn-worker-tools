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
}

export interface Worker {
	workerId: string;
	name: string;
	spaceId: string;
	createdAt: string;
	updatedAt: string;
	updatedByName?: string;
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
