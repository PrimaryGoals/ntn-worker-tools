import type { AppConfig, Worker } from "@ntn-worker-tools/shared";

// Pure helpers for pruning deploy/push records of deleted workers. Kept free of
// state.ts, which loads and saves the real config on import, so they can be
// exercised without touching it. See prune-workers.ts for why and when.

export const RECORD_FIELDS = [
	"workerDeploys",
	"workerEnvPushes",
	"workerLastCodeDeployAt",
	"workerLastEnvPushAt",
] as const;

type RecordField = (typeof RECORD_FIELDS)[number];

export interface WorkspaceListing {
	workspaceId: string;
	workers: Worker[];
}

export function recordedWorkerIds(config: AppConfig): Set<string> {
	const ids = new Set<string>();
	for (const field of RECORD_FIELDS) {
		for (const id of Object.keys(config[field] ?? {})) ids.add(id);
	}
	return ids;
}

// Ids recorded in `candidates` that no listing contains, or null when the
// listings cannot be trusted to be complete.
export function findDeletedWorkerIds(
	candidates: Set<string>,
	knownWorkspaceIds: string[],
	listings: WorkspaceListing[],
): string[] | null {
	if (knownWorkspaceIds.length === 0) return null;
	const listed = new Set(listings.map((l) => l.workspaceId));
	if (knownWorkspaceIds.some((id) => !listed.has(id))) return null;
	const live = new Set<string>();
	for (const { workspaceId, workers } of listings) {
		// A worker from another workspace means NOTION_WORKSPACE_ID was not
		// honoured, and this is some other workspace's list under the wrong name.
		if (workers.some((w) => w.spaceId !== workspaceId)) return null;
		for (const w of workers) live.add(w.workerId);
	}
	return [...candidates].filter((id) => !live.has(id));
}

export function withoutWorkers(config: AppConfig, ids: string[]): Partial<AppConfig> {
	const drop = new Set(ids);
	const patch: Partial<AppConfig> = {};
	for (const field of RECORD_FIELDS) {
		const records = config[field];
		if (!records) continue;
		const kept = Object.fromEntries(Object.entries(records).filter(([id]) => !drop.has(id)));
		(patch as Record<RecordField, unknown>)[field] = kept;
	}
	return patch;
}
