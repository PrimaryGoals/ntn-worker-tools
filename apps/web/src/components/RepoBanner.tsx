import { useState } from "react";
import type { KnownWorkspace, RepoStatus } from "../repoStatus";

function repoName(root: string): string {
	return root.split(/[\\/]/).filter(Boolean).pop() ?? root;
}

// States a repo can be in relative to the connected workspace, stated rather
// than implied. Before this, a branch belonging to another workspace showed up
// only as an empty Branch segment and workers that quietly failed to pair —
// the reader was left to infer the cause.
export function RepoBanner({
	status,
	workspaces,
	saving,
	onAssign,
	onDismiss,
}: {
	status: RepoStatus;
	// Everything the app can honestly name: the connected workspace, plus any
	// whose name it has learned before.
	workspaces: KnownWorkspace[];
	saving: boolean;
	onAssign: (workspaceId: string) => void;
	// Closes the prompt for now, without recording an answer. Used when the
	// right answer is a workspace this app has never connected to.
	onDismiss: () => void;
}) {
	const connected = workspaces.find((workspace) => workspace.connected) ?? null;
	const [choice, setChoice] = useState(connected?.id ?? "");
	const name = repoName(status.repo.root);
	const branch = status.repo.branch;

	const tone =
		status.kind === "unassigned"
			? "border-blue-300 bg-blue-50 dark:border-blue-900/50 dark:bg-blue-950/30"
			: "border-amber-300 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/30";

	return (
		<div className={`border-b px-3 py-2 text-xs ${tone}`}>
			{status.kind === "unassigned" ? (
				<>
					<div>
						<span className="font-medium">{name}</span> is on{" "}
						<span className="font-mono font-medium">{branch}</span>. Which workspace does this
						branch belong to?
					</div>
					<div className="mt-1.5 flex flex-wrap items-center gap-2">
						<select
							value={choice}
							onChange={(e) => setChoice(e.target.value)}
							className="rounded border border-neutral-300 bg-white px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900"
						>
							{workspaces.map((workspace) => (
								<option key={workspace.id} value={workspace.id}>
									{workspace.name}
									{workspace.connected ? " (connected)" : ""}
								</option>
							))}
						</select>
						<button
							type="button"
							disabled={!choice || saving}
							onClick={() => onAssign(choice)}
							className="rounded bg-neutral-900 px-2 py-1 text-xs text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
						>
							{saving ? "Saving…" : "Save"}
						</button>
						<button
							type="button"
							onClick={onDismiss}
							title="Nothing is recorded. Connect to that workspace and the question comes back."
							className="rounded border border-neutral-300 px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-900"
						>
							Not one of these
						</button>
					</div>
					<div className="mt-1 text-[11px] text-neutral-500">
						Recorded here only — this never switches branches or touches the repository.
					</div>
				</>
			) : status.kind === "wrong-branch" ? (
				<div>
					<span className="font-medium">{name}</span> is on{" "}
					<span className="font-mono font-medium">{branch}</span>, which belongs to{" "}
					<span className="font-medium">
						{status.assignedWorkspaceName ?? status.assignedWorkspaceId}
					</span>
					. You are connected to <span className="font-medium">{connected?.name}</span>, whose
					branch here is <span className="font-mono font-medium">{status.connectedBranch}</span>.
					<div className="mt-1 text-[11px]">
						Switch branches in your terminal and refresh, or log in to{" "}
						{status.assignedWorkspaceName ?? "that workspace"}.
					</div>
				</div>
			) : status.kind === "no-branch-here" ? (
				<div>
					<span className="font-medium">{name}</span> is on{" "}
					<span className="font-mono font-medium">{branch}</span>, which belongs to{" "}
					<span className="font-medium">
						{status.assignedWorkspaceName ?? status.assignedWorkspaceId}
					</span>
					. No branch here is assigned to{" "}
					<span className="font-medium">{connected?.name}</span>.
					<div className="mt-1 text-[11px]">
						Create a branch for it in your terminal and refresh, or log back in to{" "}
						{status.assignedWorkspaceName ?? "that workspace"}.
					</div>
				</div>
			) : (
				<div>
					<span className="font-medium">{name}</span> has no branch checked out, so it cannot be
					matched to a workspace.
					<div className="mt-1 text-[11px]">
						A detached HEAD names no branch. Check one out and refresh.
					</div>
				</div>
			)}
		</div>
	);
}
