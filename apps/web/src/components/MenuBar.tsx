import { useState } from "react";
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
	groups,
	setLocalPathError,
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
	// Already narrowed by dropdownGroups() — unavailable items are still here,
	// greyed with their reason, because the dropdown is where you find out why
	// an action isn't open to you yet.
	groups: WorkerMenuGroup[];
	setLocalPathError: Error | null;
}) {
	const [open, setOpen] = useState(false);
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
							{setLocalPathError ? (
								<div className="border-t border-red-200 px-3 py-1 text-[11px] text-red-600 dark:border-red-900/40 dark:text-red-400">
									{setLocalPathError.message}
								</div>
							) : null}
						</div>
					) : null}
				</div>
			)}
			<div className="flex items-center gap-3">
				<h1 className="text-sm font-semibold">
					{spaceName ? (
						<>
							NTN Worker Tools <span className="font-normal text-neutral-500">({spaceName})</span>
						</>
					) : (
						"NTN Worker Tools"
					)}
				</h1>
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
