import { useState } from "react";
import type { KnownWorkspace, RepoStatus } from "../repoStatus";

// Where a repository stands against the connected workspace, stated outright.
// Before this, a branch belonging to another workspace showed only as an empty
// Branch segment and workers that quietly failed to pair, leaving the cause to
// be inferred.
export function RepoBanner({
	status,
	workspaces,
	saving,
	placement = "top",
	onLink,
	onDismiss,
}: {
	status: RepoStatus;
	// Everything the app can honestly name: the connected workspace, plus any
	// whose name it has learned.
	workspaces: KnownWorkspace[];
	saving: boolean;
	// Where this sits relative to the worker list, which decides which edge
	// carries the rule. An unanswerable mismatch belongs below the list.
	placement?: "top" | "bottom";
	onLink: (workspaceId: string) => void;
	// Closes the prompt for now without recording anything, for when the right
	// answer is a workspace this app has never connected to.
	onDismiss: () => void;
}) {
	const connected = workspaces.find((workspace) => workspace.connected) ?? null;
	const branch = status.repo.branch;
	// What the folders here claim is the best available guess, so it opens as the
	// answer. It is still only a guess — a client branch cut from main carries
	// the old workspace in every folder until each one is deployed — so nothing
	// is recorded without Save.
	const suggested = status.claims[0] ?? null;
	const [choice, setChoice] = useState(suggested?.workspaceId ?? connected?.id ?? "");

	const nameFor = (id: string | null) =>
		(id ? (workspaces.find((workspace) => workspace.id === id)?.name ?? id) : null) ?? id;

	const tone =
		status.kind === "unlinked"
			? "border-blue-300 bg-blue-50 dark:border-blue-900/50 dark:bg-blue-950/30"
			: "border-amber-300 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/30";

	const repoLine = (
		<>
			Repo <span className="font-mono font-medium">{status.label}</span>
			{branch ? (
				<>
					{" @ "}
					<span className="font-mono font-medium">{branch}</span>
				</>
			) : null}
		</>
	);

	return (
		<div className={`${placement === "bottom" ? "border-t" : "border-b"} px-3 py-2 text-xs ${tone}`}>
			{status.kind === "unlinked" ? (
				<>
					<div>Link {repoLine} to a workspace.</div>
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
							onClick={() => onLink(choice)}
							className="rounded bg-neutral-900 px-2 py-1 text-xs text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
						>
							{saving ? "Saving…" : "Save"}
						</button>
						<button
							type="button"
							onClick={onDismiss}
							title="Nothing is recorded. Connect to that workspace and the question returns."
							className="rounded border border-neutral-300 px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-900"
						>
							Not one of these
						</button>
					</div>
					{suggested ? (
						<div className="mt-1 text-[11px] text-neutral-500">
							{suggested.count} of {status.claimTotal} worker
							{status.claimTotal === 1 ? "" : "s"} here name{" "}
							<span className="font-medium">{nameFor(suggested.workspaceId)}</span>. Recorded
							here only — this never switches branches or touches the repository.
						</div>
					) : (
						<div className="mt-1 text-[11px] text-neutral-500">
							Recorded here only — this never switches branches or touches the repository.
						</div>
					)}
				</>
			) : status.kind === "detached" ? (
				<div>
					{repoLine} has no branch checked out, so it cannot be linked to a workspace. Check one
					out and refresh.
				</div>
			) : (
				<>
					<div className="font-medium">Workspace and branch do not match.</div>
					<div className="mt-0.5">
						{repoLine} is linked to{" "}
						<span className="font-medium">
							{nameFor(status.linkedWorkspaceId)}
						</span>
						. You are connected to <span className="font-medium">{connected?.name}</span>.
					</div>
					<div className="mt-1 text-[11px]">
						{status.kind === "wrong-branch" ? (
							<>
								Change the connected workspace, or switch this repo to{" "}
								<span className="font-mono font-medium">{status.connectedBranch}</span>, which
								is linked to {connected?.name}.
							</>
						) : (
							<>
								Change the connected workspace, or switch to a branch linked to{" "}
								{connected?.name} — no branch here is.
							</>
						)}
					</div>
				</>
			)}
		</div>
	);
}
