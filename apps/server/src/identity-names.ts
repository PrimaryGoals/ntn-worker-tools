import type { Worker } from "@ntn-worker-tools/shared";
import { runNtnJson, runNtnPlain } from "./ntn.js";
import { getConfig, updateConfig } from "./state.js";

// Ids identify; names are what a person recognises. A mismatch message built
// from ids alone asks the reader to decode two UUIDs before they can see what
// went wrong, so this resolves the names behind them.
//
// Every lookup here is best-effort. A failure falls back to the bare id: the
// guard exists to stop a wrong deploy, and it must never fail to report one
// because a name could not be fetched.

// workspaceId -> (workerId -> name). Per process: a workspace's worker names do
// not change often, and this is only consulted on the rare mismatch path.
const workerNamesByWorkspace = new Map<string, Map<string, string>>();

// A null workspace means the one that is logged in. The action a guard blocks
// always targets a worker there, so that is the list its name comes from.
const CONNECTED = "(connected)";

async function workerNames(workspaceId: string | null): Promise<Map<string, string>> {
	const key = workspaceId ?? CONNECTED;
	const cached = workerNamesByWorkspace.get(key);
	if (cached) return cached;
	const names = new Map<string, string>();
	try {
		// NOTION_WORKSPACE_ID targets a workspace other than the logged-in one.
		// Read-only: this lists workers, it does not switch the login.
		const workers = await runNtnJson<Worker[]>(
			["workers", "list"],
			workspaceId ? { env: { NOTION_WORKSPACE_ID: workspaceId } } : {},
		);
		for (const worker of workers) names.set(worker.workerId, worker.name);
	} catch {
		/* unreachable, or no access to that workspace — ids only */
	}
	workerNamesByWorkspace.set(key, names);
	return names;
}

export async function resolveWorkerName(
	workspaceId: string | null,
	workerId: string,
): Promise<string | null> {
	return (await workerNames(workspaceId)).get(workerId) ?? null;
}

// Workspace names are cached in the app config rather than per process: they
// are stable, and a name learned once should survive a restart so the message
// reads the same every time.
export async function resolveWorkspaceName(workspaceId: string | null): Promise<string | null> {
	if (!workspaceId) return null;
	const known = getConfig().workspaceNames?.[workspaceId];
	if (known) return known;
	let name: string | null = null;
	try {
		// `ntn whoami --plain` is tab separated; column 6 is the workspace name.
		const out = await runNtnPlain(["whoami"], { env: { NOTION_WORKSPACE_ID: workspaceId } });
		const columns = out.trim().split("\t");
		name = columns[5]?.trim() || null;
	} catch {
		/* leave null — the id still identifies it */
	}
	if (!name) return null;
	try {
		await updateConfig({
			workspaceNames: { ...(getConfig().workspaceNames ?? {}), [workspaceId]: name },
		});
	} catch {
		/* caching is a convenience; failing to write it changes nothing here */
	}
	return name;
}

function label(name: string | null, id: string): string {
	return name ? `${name} - ${id}` : id;
}

// The body of the "folder belongs to a different worker" message. Written as
// lines rather than a paragraph: it carries two worker ids and a workspace id,
// and as a single run of text the reader has to find the boundaries themselves.
export async function describeIdentityMismatch(args: {
	file: string;
	folderWorkerId: string;
	folderWorkspaceId: string | null;
	targetWorkerId: string;
	targetWorkspaceId: string | null;
}): Promise<string> {
	const [folderWorkerName, folderWorkspaceName, targetWorkerName] = await Promise.all([
		resolveWorkerName(args.folderWorkspaceId, args.folderWorkerId),
		resolveWorkspaceName(args.folderWorkspaceId),
		resolveWorkerName(args.targetWorkspaceId, args.targetWorkerId),
	]);

	const lines = [
		args.file,
		`points at workerId: ${label(folderWorkerName, args.folderWorkerId)}`,
	];
	if (args.folderWorkspaceId) {
		lines.push(`in workspace: ${label(folderWorkspaceName, args.folderWorkspaceId)},`);
	}
	lines.push(
		`but this action targets workerId ${label(targetWorkerName, args.targetWorkerId)}.`,
		"Acting here would deploy to the wrong worker.",
		"",
		"This usually means the checked-out branch belongs to another workspace.",
		"Switch branches in your terminal and refresh this page.",
	);
	return lines.join("\n");
}
