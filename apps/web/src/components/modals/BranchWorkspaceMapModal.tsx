import { useQueries, useQuery } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { gitRemoteShortLabel, normalizePathKey } from "@ntn-worker-tools/shared";
import type { MapRepo, RepoBranch, RepoBranchesResult } from "@ntn-worker-tools/shared";
import { api } from "../../api";
import type { KnownWorkspace } from "../../repoStatus";

// Every repository's branch links on one grid: workspaces down the side,
// repositories across the top, and in each cell the branches of that repo
// that deploy to that workspace. It is the only place links are made, and the
// worker list follows from it: see buildRepoStatuses.
//
// Nothing is written until Save. A branch belongs to one workspace per repo,
// which the draft's shape (repo -> branch -> workspace) enforces by itself.

type Links = Record<string, Record<string, string>>;

interface BranchColumn {
	data?: RepoBranchesResult;
	loading: boolean;
	error: Error | null;
}

interface CellRef {
	repoKey: string;
	workspaceId: string;
	// Where the cell sits on screen, for anchoring the checklist outside the
	// grid's scroll container, which would otherwise clip it.
	rect: DOMRect;
}

function repoLabel(repo: MapRepo): string {
	return (
		gitRemoteShortLabel(repo.remoteUrl) ??
		repo.root.split(/[\\/]/).filter(Boolean).pop() ??
		repo.root
	);
}

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base" });

export function BranchWorkspaceMapModal({
	workspaces,
	savedLinks,
	saving,
	error,
	onClose,
	onSave,
}: {
	workspaces: KnownWorkspace[];
	// config.branchWorkspaces, keyed by normalized repo root.
	savedLinks: Links;
	saving: boolean;
	error: Error | null;
	onClose: () => void;
	onSave: (links: Links) => void;
}) {
	const reposQ = useQuery({
		queryKey: ["mapRepos"],
		queryFn: api.listMapRepos,
		gcTime: 0,
	});
	const repos = useMemo(
		() =>
			[...(reposQ.data ?? [])]
				.map((repo) => ({ repo, key: normalizePathKey(repo.root), label: repoLabel(repo) }))
				.sort((a, b) => byName(a.label, b.label)),
		[reposQ.data],
	);
	// One fetch per column, in parallel, each with its own spinner. Not cached
	// past the dialog: opening it is the request for current branches.
	const branchQs = useQueries({
		queries: repos.map(({ repo, key }) => ({
			queryKey: ["repoBranches", key],
			queryFn: () => api.listRepoBranches(repo.root),
			gcTime: 0,
			retry: false,
		})),
	});
	const branchesByRepo = new Map<string, BranchColumn>(
		repos.map(({ key }, i) => [
			key,
			{
				data: branchQs[i]?.data,
				loading: branchQs[i]?.isPending ?? true,
				error: (branchQs[i]?.error as Error | null) ?? null,
			},
		]),
	);

	const [draft, setDraft] = useState<Links>(() => structuredClone(savedLinks));
	const [openCell, setOpenCell] = useState<CellRef | null>(null);

	// Rows: every workspace the app can name, alphabetically, plus any a saved
	// link points at without a known name — otherwise those links would be
	// invisible here, and their branches greyed for no reason shown.
	const rows = useMemo(() => {
		const known = new Map(workspaces.map((w) => [w.id, w]));
		for (const links of Object.values(draft)) {
			for (const id of Object.values(links)) {
				if (!known.has(id)) known.set(id, { id, name: id, connected: false });
			}
		}
		return [...known.values()].sort((a, b) => byName(a.name, b.name));
	}, [workspaces, draft]);
	const workspaceName = (id: string) => rows.find((w) => w.id === id)?.name ?? id;

	const dirty = useMemo(() => {
		const keys = new Set([...Object.keys(savedLinks), ...Object.keys(draft)]);
		for (const key of keys) {
			const a = savedLinks[key] ?? {};
			const b = draft[key] ?? {};
			const branches = new Set([...Object.keys(a), ...Object.keys(b)]);
			for (const branch of branches) if (a[branch] !== b[branch]) return true;
		}
		return false;
	}, [savedLinks, draft]);

	useEffect(() => {
		const h = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			// Closes the checklist only. Leaving the dialog takes Save or Cancel,
			// so a stray key cannot throw away a grid of edits.
			if (openCell) setOpenCell(null);
		};
		window.addEventListener("keydown", h);
		return () => window.removeEventListener("keydown", h);
	}, [openCell]);

	function toggle(repoKey: string, branch: string, workspaceId: string) {
		setDraft((prev) => {
			const forRepo = { ...(prev[repoKey] ?? {}) };
			if (forRepo[branch] === workspaceId) delete forRepo[branch];
			else forRepo[branch] = workspaceId;
			return { ...prev, [repoKey]: forRepo };
		});
	}

	function save() {
		// Only the columns on screen are sent. A saved link for a repo no longer
		// on disk has no column, and leaving it out of the body leaves it alone.
		const body: Links = {};
		for (const { key } of repos) body[key] = draft[key] ?? {};
		onSave(body);
	}

	const openRepo = openCell ? repos.find((r) => r.key === openCell.repoKey) : undefined;

	return (
		// No click-away: the backdrop does nothing, and there is no close button.
		// Save or Cancel are the only ways out.
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
			role="presentation"
		>
			<div
				className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-2xl dark:border-neutral-800 dark:bg-neutral-950"
				onClick={(e) => {
					e.stopPropagation();
					setOpenCell(null);
				}}
				role="dialog"
				aria-modal="true"
				aria-label="Map repository branches to workspaces"
			>
				<div className="border-b border-neutral-200 px-4 py-2 dark:border-neutral-800">
					<h2 className="text-sm font-semibold">Map Repo+Branch:Workspace</h2>
				</div>

				<div className="flex min-h-0 flex-col gap-3 p-4">
					<p className="text-xs text-neutral-600 dark:text-neutral-400">
						Choose which branches of each repository to associate with each workspace. A branch can
						belong to one workspace per repository.
					</p>

					{reposQ.isPending ? (
						<div className="text-xs text-neutral-500">Finding repositories…</div>
					) : reposQ.error ? (
						<div className="text-xs text-red-600 dark:text-red-400">
							{(reposQ.error as Error).message}
						</div>
					) : repos.length === 0 ? (
						<div className="text-xs text-neutral-500">
							No repositories found. Use Scan folder for workers… to choose where to look.
						</div>
					) : (
						<div
							// The checklist is anchored to where the cell was; once the
							// grid scrolls that is somewhere else, so it closes.
							onScroll={() => setOpenCell(null)}
							className="min-h-0 overflow-auto rounded border border-neutral-200 dark:border-neutral-800"
						>
							<table className="border-separate border-spacing-0 text-xs">
								<thead>
									<tr>
										<th className="sticky left-0 top-0 z-20 min-w-40 whitespace-nowrap border-b border-r border-neutral-200 bg-neutral-50 px-3 py-2 text-left font-semibold text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900">
											↓ Workspace | Repo →
										</th>
										{repos.map(({ repo, key, label }) => {
											const col = branchesByRepo.get(key);
											const warning = col?.error?.message ?? col?.data?.fetchError ?? null;
											return (
												<th
													key={key}
													title={repo.root}
													className="sticky top-0 z-10 w-56 min-w-56 border-b border-r border-neutral-200 bg-neutral-50 px-3 py-2 text-left font-semibold last:border-r-0 dark:border-neutral-800 dark:bg-neutral-900"
												>
													<div className="flex items-center gap-1.5">
														<span className="truncate font-mono">{label}</span>
														{col?.loading ? (
															<span
																className="inline-block h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-600"
																title="Fetching branches…"
															/>
														) : warning ? (
															<span
																className="shrink-0 text-amber-600 dark:text-amber-400"
																title={`Fetch failed — showing branches already known locally.\n${warning}`}
															>
																⚠
															</span>
														) : null}
													</div>
													{!repo.scanned ? (
														<div className="font-normal text-[10px] text-neutral-500">
															outside the scan folder
														</div>
													) : null}
												</th>
											);
										})}
									</tr>
								</thead>
								<tbody>
									{rows.map((workspace) => (
										<tr key={workspace.id}>
											<th
												scope="row"
												className="sticky left-0 z-10 border-b border-r border-neutral-200 bg-white px-3 py-2 text-left align-top font-medium dark:border-neutral-800 dark:bg-neutral-950"
											>
												<div className="truncate" title={workspace.id}>
													{workspace.name}
												</div>
												{workspace.connected ? (
													<div className="text-[10px] font-normal text-emerald-600 dark:text-emerald-400">
														connected
													</div>
												) : null}
											</th>
											{repos.map(({ key }) => {
												const linked = Object.entries(draft[key] ?? {})
													.filter(([, id]) => id === workspace.id)
													.map(([branch]) => branch)
													.sort(byName);
												const known = branchesByRepo.get(key)?.data?.branches;
												const isOpen =
													openCell?.repoKey === key && openCell.workspaceId === workspace.id;
												return (
													<td
														key={key}
														className="border-b border-r border-neutral-200 p-0 align-top last:border-r-0 dark:border-neutral-800"
													>
														<button
															type="button"
															onClick={(e) => {
																e.stopPropagation();
																setOpenCell(
																	isOpen
																		? null
																		: {
																				repoKey: key,
																				workspaceId: workspace.id,
																				rect: e.currentTarget.getBoundingClientRect(),
																			},
																);
															}}
															className={
																"flex min-h-10 w-full flex-wrap content-start items-start gap-1 px-2 py-2 text-left hover:bg-neutral-50 dark:hover:bg-neutral-900 " +
																(isOpen ? "bg-neutral-100 dark:bg-neutral-900" : "")
															}
														>
															{linked.length === 0 ? (
																<span className="text-neutral-400">+ add</span>
															) : (
																linked.map((branch) => {
																	const missing =
																		known !== undefined && !known.some((b) => b.name === branch);
																	return (
																		<span
																			key={branch}
																			title={
																				missing
																					? "This branch no longer exists locally or on origin."
																					: branch
																			}
																			className={
																				"max-w-full truncate rounded border px-1.5 py-0.5 font-mono " +
																				(missing
																					? "border-red-300 bg-red-50 text-red-700 line-through dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400"
																					: "border-neutral-300 bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-800")
																			}
																		>
																			{branch}
																		</span>
																	);
																})
															)}
														</button>
													</td>
												);
											})}
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}

					{error ? <div className="text-xs text-red-600 dark:text-red-400">{error.message}</div> : null}

					<div className="flex justify-end gap-2">
						<button
							type="button"
							onClick={onClose}
							disabled={saving}
							className="rounded border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
						>
							Cancel
						</button>
						<button
							type="button"
							onClick={save}
							disabled={saving || !dirty || repos.length === 0}
							className="rounded bg-neutral-900 px-3 py-1 text-sm text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
						>
							{saving ? "Saving…" : "Save"}
						</button>
					</div>
				</div>

				{openCell && openRepo ? (
					<BranchChecklist
						anchor={openCell.rect}
						workspaceId={openCell.workspaceId}
						links={draft[openCell.repoKey] ?? {}}
						column={branchesByRepo.get(openCell.repoKey)}
						workspaceName={workspaceName}
						onToggle={(branch) => toggle(openCell.repoKey, branch, openCell.workspaceId)}
					/>
				) : null}
			</div>
		</div>
	);
}

function BranchChecklist({
	anchor,
	workspaceId,
	links,
	column,
	workspaceName,
	onToggle,
}: {
	anchor: DOMRect;
	workspaceId: string;
	links: Record<string, string>;
	column: BranchColumn | undefined;
	workspaceName: (id: string) => string;
	onToggle: (branch: string) => void;
}) {
	const ref = useRef<HTMLDivElement>(null);
	const [pos, setPos] = useState({ top: anchor.bottom + 2, left: anchor.left });

	// Kept on screen: flipped above the cell near the bottom edge, and pulled
	// left near the right one.
	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		const { width, height } = el.getBoundingClientRect();
		const top =
			anchor.bottom + 2 + height > window.innerHeight - 8
				? Math.max(8, anchor.top - 2 - height)
				: anchor.bottom + 2;
		const left = Math.min(anchor.left, window.innerWidth - width - 8);
		setPos({ top, left: Math.max(8, left) });
	}, [anchor, column?.loading]);

	// Linked branches git no longer knows still appear, so removing one is a
	// choice rather than something that happens when a branch is deleted.
	const entries: (RepoBranch & { missing: boolean })[] = useMemo(() => {
		const known = column?.data?.branches ?? [];
		const names = new Set(known.map((b) => b.name));
		const missing = column?.data
			? Object.keys(links)
					.filter((name) => !names.has(name))
					.map((name) => ({ name, local: false, remote: false, missing: true }))
			: [];
		return [...known.map((b) => ({ ...b, missing: false })), ...missing].sort((a, b) =>
			byName(a.name, b.name),
		);
	}, [column?.data, links]);

	// While the fetch runs, the linked branches are still shown and editable.
	const pendingLinked = column?.loading
		? Object.entries(links).sort(([a], [b]) => byName(a, b))
		: [];

	return (
		<div
			ref={ref}
			onClick={(e) => e.stopPropagation()}
			style={{ top: pos.top, left: pos.left }}
			className="fixed z-[60] max-h-72 w-64 overflow-auto rounded border border-neutral-200 bg-white py-1 text-xs shadow-lg dark:border-neutral-800 dark:bg-neutral-950"
		>
			{column?.loading ? (
				<>
					<div className="px-3 py-1 text-neutral-500">Fetching branches…</div>
					{pendingLinked.map(([branch, owner]) => (
						<ChecklistRow
							key={branch}
							name={branch}
							checked={owner === workspaceId}
							takenBy={owner !== workspaceId ? workspaceName(owner) : null}
							onToggle={() => onToggle(branch)}
						/>
					))}
				</>
			) : entries.length === 0 ? (
				<div className="px-3 py-1 text-neutral-500">No branches found.</div>
			) : (
				entries.map((entry) => {
					const owner = links[entry.name];
					return (
						<ChecklistRow
							key={entry.name}
							name={entry.name}
							checked={owner === workspaceId}
							takenBy={owner && owner !== workspaceId ? workspaceName(owner) : null}
							note={entry.missing ? "missing" : !entry.local ? "origin" : null}
							onToggle={() => onToggle(entry.name)}
						/>
					);
				})
			)}
		</div>
	);
}

function ChecklistRow({
	name,
	checked,
	takenBy,
	note,
	onToggle,
}: {
	name: string;
	checked: boolean;
	takenBy: string | null;
	note?: string | null;
	onToggle: () => void;
}) {
	const taken = takenBy !== null;
	return (
		<label
			title={taken ? `Linked to ${takenBy}` : name}
			className={
				"flex items-center gap-2 px-3 py-1 " +
				(taken ? "cursor-not-allowed text-neutral-400" : "cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-900")
			}
		>
			<input type="checkbox" checked={checked} disabled={taken} onChange={onToggle} />
			<span className={"min-w-0 flex-1 truncate font-mono " + (note === "missing" ? "line-through" : "")}>
				{name}
			</span>
			{taken ? (
				<span className="shrink-0 truncate text-[10px]">({takenBy})</span>
			) : note ? (
				<span
					className={
						"shrink-0 text-[10px] " +
						(note === "missing" ? "text-red-600 dark:text-red-400" : "text-neutral-500")
					}
				>
					({note})
				</span>
			) : null}
		</label>
	);
}
