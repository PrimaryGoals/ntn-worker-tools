import type { Worker } from "@ntn-worker-tools/shared";
import { runNtnJson } from "./ntn.js";
import { getConfig, updateConfig } from "./state.js";
import {
	findDeletedWorkerIds,
	recordedWorkerIds,
	type WorkspaceListing,
	withoutWorkers,
} from "./worker-records.js";

// Records are keyed by workerId and kept forever, so a worker deleted on the
// server — `ntn workers delete`, or the Notion UI — leaves its deploy and push
// history behind in the config. Nothing reads it again, but it accumulates.
//
// Pruning needs proof a worker is gone, and one workspace's list is not proof:
// `ntn workers list` covers only the workspace it targets, and a record does
// not say which workspace its worker lives in. So every workspace this app
// knows is listed, and a record is dropped only when its worker appears in
// none of them. Any listing that fails, or answers for a different workspace
// than the one asked, cancels the whole prune.
//
// Getting it wrong is mild: a lost record makes the app over-flag that worker
// as needing a redeploy or push until its next one — the failure direction the
// staleness check already prefers.

// Runs once at startup, in the background. Best-effort throughout: it never
// throws, and anything it cannot verify is left exactly as it was.
export async function pruneDeletedWorkerRecords(): Promise<void> {
	try {
		const snapshot = getConfig();
		const names = snapshot.workspaceNames ?? {};
		const workspaceIds = Object.keys(names);
		// Only ids recorded before listing began are candidates: a worker deployed
		// while the lists are fetched must not be pruned for missing from them.
		const candidates = recordedWorkerIds(snapshot);
		if (workspaceIds.length === 0 || candidates.size === 0) return;

		const listings: WorkspaceListing[] = [];
		for (const workspaceId of workspaceIds) {
			try {
				// Read-only: NOTION_WORKSPACE_ID targets a workspace without switching
				// the login (see identity-names.ts).
				const workers = await runNtnJson<Worker[]>(["workers", "list"], {
					env: { NOTION_WORKSPACE_ID: workspaceId },
				});
				if (!Array.isArray(workers)) throw new Error("not a list");
				listings.push({ workspaceId, workers });
			} catch (err) {
				console.warn(
					`[prune] Skipped: could not list workers in ${names[workspaceId] ?? workspaceId}, ` +
						`so deleted workers cannot be told apart from ones in that workspace ` +
						`(${err instanceof Error ? err.message : String(err)}).`,
				);
				return;
			}
		}

		const deleted = findDeletedWorkerIds(candidates, workspaceIds, listings);
		if (deleted === null) {
			console.warn("[prune] Skipped: a workspace listing did not match the workspace it was asked for.");
			return;
		}
		if (deleted.length === 0) return;

		await updateConfig(withoutWorkers(getConfig(), deleted));
		console.log(`[prune] Forgot ${deleted.length} deleted worker(s): ${deleted.join(", ")}`);
	} catch (err) {
		console.warn(`[prune] Skipped: ${err instanceof Error ? err.message : String(err)}`);
	}
}
