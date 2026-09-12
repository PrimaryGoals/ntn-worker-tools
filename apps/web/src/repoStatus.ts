import { gitRemoteShortLabel, normalizePathKey } from "@ntn-worker-tools/shared";
import type { AppConfig, ScanRepo, ScanWorker } from "@ntn-worker-tools/shared";

// Where a repository stands relative to the workspace you are connected to.
// Checked per repo, before anything per-worker: if the checked-out branch
// belongs to another workspace then every folder in it targets that workspace,
// and per-worker states would all repeat the same fact less usefully.
export type RepoStatusKind =
	| "aligned" // this branch is linked to the connected workspace
	| "unlinked" // no workspace recorded for this branch yet
	| "wrong-branch" // branch belongs elsewhere, and a branch here belongs to the connected workspace
	| "no-branch-here" // branch belongs elsewhere, and no branch here belongs to the connected workspace
	| "detached"; // no branch name to link at all

// What the folders in a repo say about themselves, which is the best available
// guess at the answer — but only a guess. On a client branch cut from main,
// every folder still names the old workspace until it is deployed, so this
// preselects an answer rather than recording one.
export interface RepoClaim {
	workspaceId: string;
	count: number;
}

export interface RepoStatus {
	repo: ScanRepo;
	kind: RepoStatusKind;
	// owner/name from the origin remote, falling back to the folder name.
	label: string;
	// The workspace this branch is linked to, when there is one.
	linkedWorkspaceId: string | null;
	linkedWorkspaceName: string | null;
	// For "wrong-branch": the branch here that does belong to the connected
	// workspace, which is what makes the remedy a branch switch.
	connectedBranch: string | null;
	// Most-claimed first.
	claims: RepoClaim[];
	// How many folders in this repo name any workspace at all.
	claimTotal: number;
}

export interface KnownWorkspace {
	id: string;
	name: string;
	connected: boolean;
}

// Workspaces that can be offered as an answer: the one you are connected to,
// plus any whose name has been learned. `ntn` cannot list workspaces, so this is
// everything the app can honestly name.
export function knownWorkspaces(
	config: AppConfig | undefined,
	connectedWorkspaceId: string | null,
	connectedWorkspaceName: string | null,
): KnownWorkspace[] {
	const byId = new Map<string, KnownWorkspace>();
	for (const [id, name] of Object.entries(config?.workspaceNames ?? {})) {
		byId.set(id, { id, name, connected: id === connectedWorkspaceId });
	}
	if (connectedWorkspaceId) {
		byId.set(connectedWorkspaceId, {
			id: connectedWorkspaceId,
			name: connectedWorkspaceName ?? connectedWorkspaceId,
			connected: true,
		});
	}
	// Connected first, then by name: the answer is often the one in front of you.
	return [...byId.values()].sort((a, b) =>
		a.connected === b.connected
			? a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
			: a.connected
				? -1
				: 1,
	);
}

export function branchLinks(
	config: AppConfig | undefined,
	repoRoot: string,
): Record<string, string> {
	return config?.branchWorkspaces?.[normalizePathKey(repoRoot)] ?? {};
}

function repoLabel(repo: ScanRepo): string {
	return (
		gitRemoteShortLabel(repo.remoteUrl) ??
		repo.root.split(/[\\/]/).filter(Boolean).pop() ??
		repo.root
	);
}

function claimsFor(repoRoot: string, workers: ScanWorker[]): { claims: RepoClaim[]; total: number } {
	const counts = new Map<string, number>();
	let total = 0;
	for (const worker of workers) {
		if (!worker.repoRoot || !worker.workspaceId) continue;
		if (normalizePathKey(worker.repoRoot) !== normalizePathKey(repoRoot)) continue;
		counts.set(worker.workspaceId, (counts.get(worker.workspaceId) ?? 0) + 1);
		total++;
	}
	const claims = [...counts.entries()]
		.map(([workspaceId, count]) => ({ workspaceId, count }))
		.sort((a, b) => b.count - a.count);
	return { claims, total };
}

export function buildRepoStatuses(
	repos: ScanRepo[],
	workers: ScanWorker[],
	config: AppConfig | undefined,
	connectedWorkspaceId: string | null,
	workspaceName: (id: string) => string | null,
): RepoStatus[] {
	return repos.map((repo) => {
		const links = branchLinks(config, repo.root);
		const { claims, total } = claimsFor(repo.root, workers);
		const base = {
			repo,
			label: repoLabel(repo),
			linkedWorkspaceId: null as string | null,
			linkedWorkspaceName: null as string | null,
			connectedBranch: null as string | null,
			claims,
			claimTotal: total,
		};

		// A detached HEAD names no branch, so there is nothing to link.
		if (!repo.branch) return { ...base, kind: "detached" as const };

		const linked = links[repo.branch] ?? null;
		const withLink = {
			...base,
			linkedWorkspaceId: linked,
			linkedWorkspaceName: linked ? workspaceName(linked) : null,
		};

		if (!linked) return { ...withLink, kind: "unlinked" as const };
		if (linked === connectedWorkspaceId) return { ...withLink, kind: "aligned" as const };

		// Linked elsewhere. Whether a branch here belongs to the connected
		// workspace decides the remedy: switch branches, or switch workspace.
		const connectedBranch =
			Object.entries(links).find(([, id]) => id === connectedWorkspaceId)?.[0] ?? null;
		return {
			...withLink,
			connectedBranch,
			kind: connectedBranch ? ("wrong-branch" as const) : ("no-branch-here" as const),
		};
	});
}

// Repos worth a banner. An aligned repo needs no announcement.
export function bannerStatuses(statuses: RepoStatus[]): RepoStatus[] {
	return statuses.filter((status) => status.kind !== "aligned");
}
