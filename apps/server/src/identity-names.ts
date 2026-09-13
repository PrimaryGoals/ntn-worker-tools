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
	const name = await lookupWorkspaceName(workspaceId);
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

// Asks `ntn` for a workspace's name by id, without switching the login. Null
// when the login has no token for it (ntn exits non-zero), or when the answer
// is for a different workspace than the one asked: a name stored under the
// wrong id would mislabel every row that shows it.
export async function lookupWorkspaceName(workspaceId: string): Promise<string | null> {
	try {
		// `ntn whoami --plain` is tab separated; column 5 is the workspace id and
		// column 6 its name.
		const out = await runNtnPlain(["whoami"], { env: { NOTION_WORKSPACE_ID: workspaceId } });
		const columns = out.trim().split("\t");
		if (columns[4]?.trim().toLowerCase() !== workspaceId.toLowerCase()) return null;
		return columns[5]?.trim() || null;
	} catch {
		return null;
	}
}

// Records the name behind a workspace id. `ntn` cannot list workspaces, so the
// only names this app can ever offer are ones it has seen - every whoami is a
// chance to learn one, and the branch map is where they are spent.
export async function rememberWorkspaceName(workspaceId: string, name: string): Promise<void> {
	if (!workspaceId || !name) return;
	if (getConfig().workspaceNames?.[workspaceId] === name) return;
	try {
		await updateConfig({
			workspaceNames: { ...(getConfig().workspaceNames ?? {}), [workspaceId]: name },
		});
	} catch {
		/* a convenience; a failed write changes nothing the caller depends on */
	}
}

// Learns the names behind whatever workspace ids the scan saw, so a prompt can
// offer them by name rather than by UUID. Each unknown id costs one read-only
// whoami, once ever - after that the config answers.
export async function ensureWorkspaceNames(ids: (string | null)[]): Promise<void> {
	const known = getConfig().workspaceNames ?? {};
	const unknown = new Set<string>();
	for (const id of ids) if (id && !known[id]) unknown.add(id);
	for (const id of unknown) await resolveWorkspaceName(id);
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
