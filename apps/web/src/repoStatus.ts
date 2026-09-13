import { gitRemoteShortLabel, normalizePathKey } from "@ntn-worker-tools/shared";
import type { AppConfig, ScanRepo } from "@ntn-worker-tools/shared";

// Where a repository stands relative to the workspace you are connected to.
// The branch links are the only source: a repo belongs to a workspace when one
// of its branches is linked to it, and nothing else - not what its folders'
// workers.json files name - puts it there. That is what keeps code meant for
// one workspace from being offered as a first deployment in another.
export type RepoStatusKind =
	| "aligned" // the checked-out branch is linked to the connected workspace
	| "wrong-branch" // a branch here is linked to the connected workspace, but not the one checked out
	| "not-in-workspace"; // no branch here is linked to the connected workspace

export interface RepoStatus {
	repo: ScanRepo;
	kind: RepoStatusKind;
	// owner/name from the origin remote, falling back to the folder name.
	label: string;
	// The workspace the checked-out branch is linked to, when it is linked.
	linkedWorkspaceId: string | null;
	// For "wrong-branch": the branches here linked to the connected workspace,
	// alphabetical, which is what makes the remedy a branch switch.
	connectedBranches: string[];
}

export interface KnownWorkspace {
	id: string;
	name: string;
	connected: boolean;
}

// Every workspace the app can name: the one you are connected to, plus any
// whose name has been learned. `ntn` cannot list workspaces, so this is
// everything the map can offer as a row.
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
	// Connected first, then by name.
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

export function buildRepoStatuses(
	repos: ScanRepo[],
	config: AppConfig | undefined,
	connectedWorkspaceId: string | null,
): RepoStatus[] {
	return repos.map((repo) => {
		const links = branchLinks(config, repo.root);
		const linkedWorkspaceId = repo.branch ? (links[repo.branch] ?? null) : null;
		const connectedBranches = Object.entries(links)
			.filter(([, id]) => id === connectedWorkspaceId)
			.map(([branch]) => branch)
			.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
		const base = { repo, label: repoLabel(repo), linkedWorkspaceId, connectedBranches };

		// Until the connected workspace is known there is nothing to compare
		// against, and hiding every folder while whoami loads would only flicker.
		if (!connectedWorkspaceId) return { ...base, kind: "aligned" as const };
		if (linkedWorkspaceId === connectedWorkspaceId) return { ...base, kind: "aligned" as const };
		// Covers a detached HEAD and an unlinked branch too: neither is linked to
		// the connected workspace, and a branch here is.
		if (connectedBranches.length > 0) return { ...base, kind: "wrong-branch" as const };
		return { ...base, kind: "not-in-workspace" as const };
	});
}
