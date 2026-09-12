import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface WorkerIdentity {
	workspaceId: string | null;
	workerId: string | null;
}

// The ids a folder claims, or null when it has no readable workers.json. Used
// where the question is which workspace a folder belongs to rather than whether
// it matches a particular worker.
export async function readWorkerIdentity(dir: string): Promise<WorkerIdentity | null> {
	try {
		const parsed = JSON.parse(await readFile(join(dir, "workers.json"), "utf8")) as {
			workspaceId?: unknown;
			workerId?: unknown;
		};
		return {
			workspaceId: typeof parsed.workspaceId === "string" ? parsed.workspaceId : null,
			workerId: typeof parsed.workerId === "string" ? parsed.workerId : null,
		};
	} catch {
		return null;
	}
}

export interface FolderIdentityMismatch {
	error: string;
	detail: string;
	folderWorkerId?: string;
	folderWorkspaceId?: string;
}

// Checks that a folder still belongs to the worker it is about to act as.
//
// This has to be re-read immediately before every deploy or push, never taken
// from a cached scan. `ntn` decides which worker it is updating by reading
// workers.json from its working directory, and that file changes underneath a
// registered folder whenever a branch is switched — tracked copies are swapped
// by the checkout, ignored ones simply stay behind from whichever branch
// deployed last. The registration check runs once, when a folder is first
// registered, and can see none of that.
//
// Returns null when the folder is safe to act on, or the reason it is not.
export async function folderIdentityMismatch(
	dir: string,
	workerId: string,
): Promise<FolderIdentityMismatch | null> {
	const file = join(dir, "workers.json");
	let raw: string;
	try {
		raw = await readFile(file, "utf8");
	} catch {
		return {
			error: "workers.json missing",
			detail:
				`${file} does not exist, so this folder names no worker. Deploying from here ` +
				`would create a new worker rather than update this one. If the file was lost ` +
				`with a branch switch, check out the branch this worker was deployed from.`,
		};
	}

	let parsed: { workspaceId?: unknown; workerId?: unknown };
	try {
		parsed = JSON.parse(raw) as { workspaceId?: unknown; workerId?: unknown };
	} catch (err) {
		return {
			error: "workers.json is not valid JSON",
			detail: `${file}: ${err instanceof Error ? err.message : String(err)}`,
		};
	}

	const folderWorkerId = typeof parsed.workerId === "string" ? parsed.workerId : null;
	const folderWorkspaceId = typeof parsed.workspaceId === "string" ? parsed.workspaceId : null;
	if (!folderWorkerId) {
		return {
			error: "workers.json names no worker",
			detail: `${file} has no workerId, so there is nothing to match against.`,
		};
	}
	if (folderWorkerId === workerId) return null;

	return {
		error: "folder belongs to a different worker",
		detail:
			`${file} points at workerId=${folderWorkerId}` +
			(folderWorkspaceId ? ` in workspace ${folderWorkspaceId}` : "") +
			`, but this action targets workerId=${workerId}. Acting here would deploy to the ` +
			`wrong worker. This usually means the checked-out branch belongs to another ` +
			`workspace — switch branches in your terminal, or pick the worker this folder holds.`,
		folderWorkerId,
		...(folderWorkspaceId ? { folderWorkspaceId } : {}),
	};
}
