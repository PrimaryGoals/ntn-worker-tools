import { useState } from "react";
import { gitRemoteShortLabel, gitRemoteWebUrl } from "@ntn-worker-tools/shared";
import { PRIMARY_GOALS_URL } from "../constants";
import type { WorkerMenuGroup } from "../workerMenu";
import { MenuItem } from "./ui/MenuItem";
import { MenuItemSubmenu } from "./ui/MenuItemSubmenu";

export function MenuBar({
	leftMenu,
	loading,
	error,
	spaceName,
	workerName,
	localPath,
	scanRoot,
	branch,
	repoRoot,
	repoRemoteUrl,
	onRevealRepo,
	groups,
}: {
	// When supplied, replaces the Worker dropdown in the header's left slot.
	// The Agents tab passes its own menu here; the rest of the header (title,
	// workspace name, auth status) is context-independent and stays put.
	leftMenu?: React.ReactNode;
	loading: boolean;
	error: Error | null;
	// The workspace `ntn whoami` reports; null until that call resolves.
	spaceName: string | null;
	workerName: string | null;
	localPath: string | null;
	// The one folder the scan walks, shown as Source so the directory being
	// read is visible without opening a menu.
	scanRoot: string | null;
	// Checked-out branch of the selected worker's repo, when there is one.
	// Absent outside git.
	branch?: string | null;
	// That repo's root. A worker can live in a repository of its own, unrelated
	// to the source folder, so a bare branch name like "main" says almost
	// nothing on its own - the repo is what makes it specific.
	repoRoot?: string | null;
	// That repo's origin, verbatim. Preferred over the local path for display:
	// it identifies the repository rather than this clone of it.
	repoRemoteUrl?: string | null;
	// Used only when there is no remote to link to.
	onRevealRepo?: (path: string) => void;
	// Already narrowed by dropdownGroups() — unavailable items are still here,
	// greyed with their reason, because the dropdown is where you find out why
	// an action isn't open to you yet.
	groups: WorkerMenuGroup[];
}) {
	const [open, setOpen] = useState(false);
	// Source reports the folder that was chosen, and nothing else. Folders
	// retained from outside it are still scanned, but appending them here made
	// the bar disagree with the choice it is meant to report.
	const sourceLabel = scanRoot ?? "none set";
	// Repository first, then branch: a worker in its own repo would otherwise
	// read as the same "main" as everything else. The remote names the
	// repository; the local path is only where this clone sits, so it is the
	// fallback for a repo with no origin.
	const repoWebUrl = gitRemoteWebUrl(repoRemoteUrl);
	// owner/name rather than the whole URL: the line already carries a
	// workspace and a full local path. The link still goes to the repository,
	// and the title carries the URL in full.
	const repoLabel = gitRemoteShortLabel(repoRemoteUrl) ?? repoWebUrl ?? repoRemoteUrl ?? repoRoot;
	const branchLabel = repoLabel ? `${repoLabel} @ ${branch}` : branch;
	return (
		<header className="flex items-center justify-between border-b border-neutral-200 bg-white px-4 py-2 dark:border-neutral-800 dark:bg-neutral-950">
			{leftMenu ?? (
				<div className="relative">
					<button
						type="button"
						onClick={() => setOpen((v) => !v)}
						className="rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900"
					>
						Worker{workerName ? `: ${workerName}` : ""} ▾
					</button>
					{open ? (
						<div
							className="absolute left-0 top-full z-10 mt-1 w-64 rounded border border-neutral-200 bg-white shadow-lg dark:border-neutral-800 dark:bg-neutral-950"
							onMouseLeave={() => setOpen(false)}
						>
							{groups.map((group) => {
								const items = group.items.map((item) => (
									<MenuItem
										key={item.id}
										label={item.label}
										disabled={item.disabled}
										disabledReason={item.disabledReason}
										onClick={() => {
											setOpen(false);
											item.onSelect();
										}}
									/>
								));
								return (
									<div key={group.id}>
										{group.separatorBefore ? (
											<div className="border-t border-neutral-200 dark:border-neutral-800" />
										) : null}
										{group.label ? (
											<MenuItemSubmenu
												label={group.label}
												disabled={group.disabled}
												disabledReason={group.disabledReason}
											>
												{/* The registered folder reads as part of the group
												    whose actions operate on it, rather than as a
												    detached footer at the bottom of the menu. */}
												{group.id === "localFolder" && localPath ? (
													<div
														className="border-b border-neutral-200 px-3 py-1 font-mono text-[10px] text-neutral-500 dark:border-neutral-800"
														title={localPath}
													>
														{localPath}
													</div>
												) : null}
												{items}
											</MenuItemSubmenu>
										) : (
											items
										)}
									</div>
								);
							})}
						</div>
					) : null}
				</div>
			)}
			<div className="flex min-w-0 flex-1 items-center gap-4 px-4 text-xs text-neutral-500">
				<span className="whitespace-nowrap">
					Workspace:{" "}
					<span className="font-medium text-neutral-700 dark:text-neutral-300">
						{spaceName ?? "…"}
					</span>
				</span>
				<span className="min-w-0 truncate" title={sourceLabel}>
					Source:{" "}
					<span className="font-mono font-medium text-neutral-700 dark:text-neutral-300">
						{sourceLabel}
					</span>
				</span>
				{branch ? (
					<span className="min-w-0 truncate">
						Branch:{" "}
						{repoWebUrl ? (
							<a
								href={repoWebUrl}
								target="_blank"
								rel="noopener noreferrer"
								title={`Open ${repoWebUrl}`}
								className="font-mono font-medium text-blue-600 underline-offset-2 hover:underline dark:text-blue-400"
							>
								{branchLabel}
							</a>
						) : repoRoot && onRevealRepo ? (
							<button
								type="button"
								onClick={() => onRevealRepo(repoRoot)}
								title={`No origin remote — open ${repoRoot} in your file browser`}
								className="font-mono font-medium text-blue-600 underline-offset-2 hover:underline dark:text-blue-400"
							>
								{branchLabel}
							</button>
						) : (
							<span className="font-mono font-medium text-neutral-700 dark:text-neutral-300">
								{branchLabel}
							</span>
						)}
					</span>
				) : null}
			</div>
			<div className="flex items-center gap-3">
				<h1 className="whitespace-nowrap text-sm font-semibold">NTN Worker Tools</h1>
				<span className={"text-xs " + (error ? "text-red-600 dark:text-red-400" : "text-neutral-500")}>
					{loading ? (
						"checking auth…"
					) : error ? (
						"not signed in — run `ntn login` in a terminal"
					) : (
						<a
							href={PRIMARY_GOALS_URL}
							target="_blank"
							rel="noopener noreferrer"
							className="text-blue-600 underline hover:no-underline dark:text-blue-400"
						>
							PrimaryGoals.com
						</a>
					)}
				</span>
			</div>
		</header>
	);
}
