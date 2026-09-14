import type { RepoStatus } from "../repoStatus";

// A repository that has a branch for the connected workspace, checked out on a
// different one. Stated outright: otherwise its workers just fail to pair and
// its folders vanish from the list, leaving the cause to be inferred.
//
// Only "wrong-branch" gets this. A repo with no branch for the connected
// workspace is not mismatched - it is not used here - and is summed up by
// UnmappedReposLine instead.
export function RepoBanner({
	status,
	connectedName,
	workspaceName,
	suppressedCount = 0,
}: {
	status: RepoStatus;
	connectedName: string | null;
	workspaceName: (id: string) => string;
	// Folders in this repo left out of the list while it is on the wrong
	// branch. Stated here so they do not just vanish.
	suppressedCount?: number;
}) {
	const branch = status.repo.branch;
	const targets = status.connectedBranches;

	return (
		<div className="border-b border-amber-300 bg-amber-50 px-3 py-2 text-xs dark:border-amber-900/50 dark:bg-amber-950/30">
			<div className="font-medium">Workspace and branch do not match.</div>
			<div className="mt-0.5">
				You are connected to workspace <span className="font-medium">{connectedName}</span>.
			</div>
			<div>
				Your repo is <span className="font-mono font-medium">{status.label}</span>
				{" @ "}
				<span className="font-mono font-medium">{branch ?? "(no branch checked out)"}</span>
			</div>
			<div>
				{status.linkedWorkspaceId ? (
					<>
						Which is linked to workspace:{" "}
						<span className="font-medium">{workspaceName(status.linkedWorkspaceId)}</span>.
					</>
				) : (
					<>Which is not linked to any workspace.</>
				)}
			</div>
			<div className="mt-1.5">
				Change the connected workspace (<span className="font-mono">ntn login</span>),
			</div>
			<div>
				or switch this repo (
				<span className="font-mono">git switch {targets[0]}</span>)
				{targets.length > 1 ? (
					<>
						{" "}
						— also linked to {connectedName}:{" "}
						<span className="font-mono">{targets.slice(1).join(", ")}</span>
					</>
				) : null}
			</div>
			{/* Neither remedy is something the app can see happen: both run in a
			    terminal, and nothing here polls for them. */}
			<div className="mt-1 font-medium text-red-600 dark:text-red-400">
				Then refresh this browser tab
			</div>
			{suppressedCount > 0 ? (
				<div className="mt-1 text-[11px] text-neutral-500">
					{suppressedCount} folder{suppressedCount === 1 ? " is" : "s are"} not listed while
					this repo is on another branch.
				</div>
			) : null}
		</div>
	);
}

// One quiet line for every repo with no branch linked to the connected
// workspace. Their undeployed folders are left out of the list - code for
// another workspace, or not yet placed anywhere - and this says how many, and
// where to change that.
export function UnmappedReposLine({
	statuses,
	suppressedCount,
	connectedName,
	onMap,
}: {
	statuses: RepoStatus[];
	// Folders withheld across those repos. Workers already on the server are
	// never withheld, so this counts only first deployments.
	suppressedCount: number;
	connectedName: string | null;
	onMap: () => void;
}) {
	if (suppressedCount === 0) return null;
	const repoCount = statuses.length;
	return (
		<div
			className="flex items-center gap-2 border-b border-neutral-200 px-3 py-1.5 text-[11px] text-neutral-500 dark:border-neutral-800"
			title={statuses.map((status) => status.label).join("\n")}
		>
			<span className="min-w-0 flex-1">
				{suppressedCount} folder{suppressedCount === 1 ? "" : "s"} in {repoCount} repo
				{repoCount === 1 ? "" : "s"} not mapped to {connectedName ?? "this workspace"}.
			</span>
			<button
				type="button"
				onClick={onMap}
				className="shrink-0 rounded border border-neutral-300 px-2 py-0.5 text-[11px] text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-900"
			>
				Map…
			</button>
		</div>
	);
}
