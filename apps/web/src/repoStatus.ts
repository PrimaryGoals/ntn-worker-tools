import { normalizePathKey } from "@ntn-worker-tools/shared";
import type { AppConfig, ScanRepo } from "@ntn-worker-tools/shared";

// Where a repository stands relative to the workspace you are connected to.
// Checked per repo, before anything per-worker: if the checked-out branch
// belongs to another workspace then every folder in it targets that workspace,
// and per-worker states would all say the same thing in a less useful way.
export type RepoStatusKind =
	| "aligned" // this branch is assigned to the connected workspace
	| "unassigned" // no workspace recorded for this branch yet
	| "wrong-branch" // branch belongs elsewhere, and a branch here belongs to the connected workspace
	| "no-branch-here" // branch belongs elsewhere, and no branch here belongs to the connected workspace
	| "not-used" // this repo is marked as never deployed to the connected workspace
	| "detached"; // no branch name to assign at all

export interface RepoStatus {
	repo: ScanRepo;
	kind: RepoStatusKind;
	// The workspace this branch is assigned to, when there is one.
	assignedWorkspaceId: string | null;
	assignedWorkspaceName: string | null;
	// For "wrong-branch": the branch in this repo that does belong to the
	// connected workspace, which is what makes the fix a branch switch.
	connectedBranch: string | null;
}

export interface KnownWorkspace {
	id: string;
	name: string;
	connected: boolean;
}

// Workspaces that can be offered as an answer: the one you are connected to,
// plus any whose name has been learned before. `ntn` cannot list workspaces, so
// this is everything the app can honestly name.
export function knownWorkspaces(
	config: AppConfig | undefined,
	connectedWorkspaceId: string | null,
	connectedWorkspaceName: string | null,
): KnownWorkspace[] {
	const names = config?.workspaceNames ?? {};
	const byId = new Map<string, KnownWorkspace>();
	for (const [id, name] of Object.entries(names)) {
		byId.set(id, { id, name, connected: id === connectedWorkspaceId });
	}
	if (connectedWorkspaceId) {
		byId.set(connectedWorkspaceId, {
			id: connectedWorkspaceId,
			name: connectedWorkspaceName ?? connectedWorkspaceId,
			connected: true,
		});
	}
	// Connected first, then by name: the answer is usually the one in front of
	// you, and scanning a list for it is needless work.
	return [...byId.values()].sort((a, b) =>
		a.connected === b.connected
			? a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
			: a.connected
				? -1
				: 1,
	);
}

export function branchAssignments(
	config: AppConfig | undefined,
	repoRoot: string,
): Record<string, string> {
	return config?.branchWorkspaces?.[normalizePathKey(repoRoot)] ?? {};
}

export function buildRepoStatuses(
	repos: ScanRepo[],
	config: AppConfig | undefined,
	connectedWorkspaceId: string | null,
	workspaceName: (id: string) => string | null,
): RepoStatus[] {
	return repos.map((repo) => {
		const assignments = branchAssignments(config, repo.root);
		const notUsed = config?.repoWorkspacesNotUsed?.[normalizePathKey(repo.root)] ?? [];

		const base = {
			repo,
			assignedWorkspaceId: null as string | null,
			assignedWorkspaceName: null as string | null,
			connectedBranch: null as string | null,
		};

		if (connectedWorkspaceId && notUsed.includes(connectedWorkspaceId)) {
			return { ...base, kind: "not-used" as const };
		}
		// A detached HEAD names no branch, so there is nothing to assign. Deploys
		// from it are still someone's deliberate act, so this only reports.
		if (!repo.branch) return { ...base, kind: "detached" as const };

		const assigned = assignments[repo.branch] ?? null;
		const withAssignment = {
			...base,
			assignedWorkspaceId: assigned,
			assignedWorkspaceName: assigned ? workspaceName(assigned) : null,
		};

		if (!assigned) return { ...withAssignment, kind: "unassigned" as const };
		if (assigned === connectedWorkspaceId) return { ...withAssignment, kind: "aligned" as const };

		// Assigned elsewhere. Whether a branch here belongs to the connected
		// workspace decides the advice: switch branches, or create one.
		const connectedBranch =
			Object.entries(assignments).find(([, id]) => id === connectedWorkspaceId)?.[0] ?? null;
		return {
			...withAssignment,
			connectedBranch,
			kind: connectedBranch ? ("wrong-branch" as const) : ("no-branch-here" as const),
		};
	});
}

// Repos worth showing a banner for. An aligned repo needs no announcement, and
// one marked unused in this workspace was explicitly dismissed.
export function bannerStatuses(statuses: RepoStatus[]): RepoStatus[] {
	return statuses.filter((status) => status.kind !== "aligned" && status.kind !== "not-used");
}
