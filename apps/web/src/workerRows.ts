import { normalizePathKey } from "@ntn-worker-tools/shared";
import type { ScanWorker, Worker } from "@ntn-worker-tools/shared";

// A scanned folder that the connected workspace has no worker for. These are
// invisible in a list built from `ntn workers list` alone, which is exactly the
// case that matters when connecting to a workspace most of the code has never
// been deployed to.
export type LocalOnlyState = "first-deployment" | "not-on-server" | "unreadable";

export interface LocalOnlyRow {
	path: string;
	name: string;
	state: LocalOnlyState;
	// Why it is here, shown beside the label so the row explains itself.
	detail: string;
	branch: string | null;
}

const LOCAL_ONLY_LABELS: Record<LocalOnlyState, string> = {
	"first-deployment": "first deployment",
	"not-on-server": "not on server",
	unreadable: "workers.json unreadable",
};

export function localOnlyLabel(state: LocalOnlyState): string {
	return LOCAL_ONLY_LABELS[state];
}

export interface LocalOnlyResult {
	rows: LocalOnlyRow[];
	// repo root key -> rows withheld because that repo is not deployable into
	// the connected workspace from its current branch, so what is missing can be
	// accounted for instead of leaving a gap.
	suppressedByRepo: Map<string, number>;
}

// Folders the scan found that no worker in the connected workspace claims.
// Pairing is by workerId only — never by name, since names repeat across
// workspaces while ids do not.
export function buildLocalOnlyRows(
	scanned: ScanWorker[],
	servers: Worker[],
	connectedWorkspaceId: string | null,
	// Repos whose checked-out branch is not linked to the connected workspace.
	// Offering to deploy their folders here would put code meant for another
	// workspace (or for none yet) into this one.
	hiddenRepoRoots: Set<string> = new Set(),
): LocalOnlyResult {
	const serverIds = new Set(servers.map((worker) => worker.workerId));
	const rows: LocalOnlyRow[] = [];
	const suppressedByRepo = new Map<string, number>();

	for (const folder of scanned) {
		// Paired: the server already lists it, so it has a row of its own.
		if (folder.workerId && serverIds.has(folder.workerId)) continue;

		const repoKey = folder.repoRoot ? normalizePathKey(folder.repoRoot) : null;
		if (repoKey && hiddenRepoRoots.has(repoKey)) {
			suppressedByRepo.set(repoKey, (suppressedByRepo.get(repoKey) ?? 0) + 1);
			continue;
		}

		let state: LocalOnlyState;
		let detail: string;
		if (folder.workersJsonInvalid) {
			// Not offered for deployment: a workers.json that names nothing may
			// still be hiding an id, and overwriting it would strand that worker.
			state = "unreadable";
			detail = "workers.json does not name a worker";
		} else if (!folder.workerId) {
			state = "first-deployment";
			detail = "never deployed";
		} else if (connectedWorkspaceId && folder.workspaceId === connectedWorkspaceId) {
			// Names a worker in this very workspace, yet the server does not list
			// it — deleted remotely, or deployed from a clone that is now gone.
			state = "not-on-server";
			detail = `${folder.workerId.slice(0, 8)}… is not in this workspace`;
		} else {
			state = "first-deployment";
			detail = "deployed to another workspace";
		}

		rows.push({ path: folder.path, name: folder.name, state, detail, branch: folder.branch });
	}

	rows.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
	return { rows, suppressedByRepo };
}
