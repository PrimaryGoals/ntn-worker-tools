import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
	SyncScheduleEntry,
	SyncScheduleUpdateResult,
	SyncStatus,
} from "@ntn-worker-tools/shared";
import {
	DEFAULT_SYNC_SCHEDULE,
	SYNC_SCHEDULE_PRESETS,
	creditsForIntervalMinutes,
	formatCredits,
	formatScheduleWithCredits,
	syncScheduleCredits,
	syncScheduleError,
	syncScheduleMinutes,
} from "@ntn-worker-tools/shared";
import { api } from "../../api";
import { formatInterval } from "../../format";

// A text field with a preset dropdown. A native <datalist> can't serve here:
// it filters its options against whatever the field already holds, so a field
// pre-filled with the current interval ("15m", say) matches none of the
// presets and opens an empty popup. This always offers the full list while
// leaving the field freely typeable.
function IntervalCombo({
	value,
	onChange,
	disabled,
	label,
	creditsPerExecution,
}: {
	value: string;
	onChange: (v: string) => void;
	disabled: boolean;
	label: string;
	creditsPerExecution: number | null;
}) {
	const [open, setOpen] = useState(false);
	const wrapRef = useRef<HTMLDivElement>(null);
	const listRef = useRef<HTMLUListElement>(null);

	useEffect(() => {
		if (!open) return;
		function onDown(ev: MouseEvent) {
			if (!wrapRef.current?.contains(ev.target as Node)) setOpen(false);
		}
		window.addEventListener("mousedown", onDown);
		return () => window.removeEventListener("mousedown", onDown);
	}, [open]);

	// Rows live in a scrolling container, which would clip a popup opened on the
	// last one — scroll it into view rather than letting it hide.
	useEffect(() => {
		if (open) listRef.current?.scrollIntoView({ block: "nearest" });
	}, [open]);

	return (
		<div ref={wrapRef} className="relative w-32 shrink-0">
			<input
				type="text"
				value={value}
				onChange={(ev) => onChange(ev.target.value)}
				onKeyDown={(ev) => {
					if (ev.key === "Escape" && open) {
						// Dismiss the popup, not the whole dialog.
						ev.stopPropagation();
						setOpen(false);
					}
				}}
				disabled={disabled}
				autoComplete="off"
				spellCheck={false}
				aria-label={label}
				className="w-full rounded border border-neutral-300 bg-white py-1 pl-2 pr-7 font-mono text-xs disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900"
			/>
			<button
				type="button"
				tabIndex={-1}
				disabled={disabled}
				onClick={() => setOpen((v) => !v)}
				aria-label={`${label} — preset intervals`}
				className="absolute inset-y-0 right-0 flex w-6 items-center justify-center text-xs text-neutral-500 disabled:opacity-50"
			>
				▾
			</button>
			{open ? (
				<ul
					ref={listRef}
					className="absolute right-0 top-full z-20 mt-1 w-max min-w-full overflow-hidden rounded border border-neutral-200 bg-white shadow-lg dark:border-neutral-800 dark:bg-neutral-950"
				>
					{SYNC_SCHEDULE_PRESETS.map((p) => (
						<li key={p}>
							<button
								type="button"
								onClick={() => {
									onChange(p);
									setOpen(false);
								}}
								className={
									"block w-full whitespace-nowrap px-2 py-1 text-left font-mono text-xs hover:bg-neutral-100 dark:hover:bg-neutral-900 " +
									(p === value ? "font-semibold" : "")
								}
							>
								{formatScheduleWithCredits(p, creditsPerExecution)}
							</button>
						</li>
					))}
				</ul>
			) : null}
		</div>
	);
}

// Identity of a row across the entries list — a worker can declare the same
// sync key in only one place, but keying on the file too keeps rows stable if
// a project ever does something unusual.
function rowId(e: SyncScheduleEntry): string {
	return `${e.file}::${e.key}`;
}

// What the live sync is actually doing, as opposed to what source says. The
// two diverge whenever source has been edited but not yet deployed — exactly
// the state this dialog leaves you in — so the row reports them separately
// rather than labelling one interval and costing the other.
function deployedInfo(
	status: SyncStatus | undefined,
): { label: string; minutes: number | null; disabled: boolean } | null {
	if (!status?.schedule) return null;
	const { intervalMs, type } = status.schedule;
	const hasInterval = typeof intervalMs === "number" && intervalMs > 0;
	return {
		label: hasInterval ? formatInterval(intervalMs) : type ? `every ${type}` : "unknown",
		minutes: hasInterval ? intervalMs / 60_000 : null,
		disabled: !!status.disabled,
	};
}

/**
 * Edits the `schedule:` polling interval of every `worker.sync()` in the
 * worker's registered local folder. The interval only exists in source, so
 * this reads and rewrites TypeScript rather than calling `ntn` — and a save
 * has no effect on the running worker until it's deployed, hence the deploy
 * prompt on the success screen.
 */
export function SyncScheduleModal({
	workerId,
	workerName,
	syncStatuses,
	creditsPerExecution,
	hasDeployScript,
	deploying,
	onClose,
	onSaved,
	onDeploy,
}: {
	workerId: string;
	workerName: string;
	syncStatuses: SyncStatus[];
	// Observed credits per run (total credits / sandboxes over the usage
	// window), or null when the worker has no runs yet to average. Drives the
	// cost estimates beside each interval.
	creditsPerExecution: number | null;
	hasDeployScript: boolean;
	deploying: boolean;
	onClose: () => void;
	onSaved: (result: SyncScheduleUpdateResult) => void;
	onDeploy: () => void;
}) {
	// Edited values by rowId; a row absent here is untouched.
	const [drafts, setDrafts] = useState<Record<string, string>>({});
	const [saved, setSaved] = useState<SyncScheduleUpdateResult | null>(null);

	const schedulesQ = useQuery({
		queryKey: ["syncSchedules", workerId],
		queryFn: () => api.getSyncSchedules(workerId),
	});

	const save = useMutation({
		mutationFn: (updates: Array<{ key: string; file: string; schedule: string }>) =>
			api.updateSyncSchedules(workerId, updates),
		onSuccess: (result) => {
			onSaved(result);
			setSaved(result);
		},
	});

	useEffect(() => {
		const h = (e: KeyboardEvent) => {
			if (e.key === "Escape" && !save.isPending) onClose();
		};
		window.addEventListener("keydown", h);
		return () => window.removeEventListener("keydown", h);
	}, [onClose, save.isPending]);

	const entries = schedulesQ.data?.entries ?? [];
	const statusByKey = useMemo(
		() => new Map(syncStatuses.map((s) => [s.capabilityKey, s])),
		[syncStatuses],
	);

	// Rows sharing a `via` constant in the same file are one declaration, so an
	// edit to either has to move both — otherwise the save would send two
	// conflicting rewrites of a single span.
	function setDraft(entry: SyncScheduleEntry, next: string): void {
		setDrafts((d) => {
			const updated = { ...d, [rowId(entry)]: next };
			if (entry.via) {
				for (const other of entries) {
					if (other.file === entry.file && other.via === entry.via) {
						updated[rowId(other)] = next;
					}
				}
			}
			return updated;
		});
	}

	// The value shown in a row's input: the draft if edited, otherwise the
	// source value, otherwise the implicit default.
	function valueOf(e: SyncScheduleEntry): string {
		return drafts[rowId(e)] ?? e.schedule ?? DEFAULT_SYNC_SCHEDULE;
	}

	// Rows whose value differs from what's in source. A row with no
	// `schedule:` counts as changed only if it moved off the default — nobody
	// wants an inserted `schedule: "30m"` that changes nothing.
	const changed = entries.filter((e) => {
		if (e.expression) return false; // read-only row
		const draft = drafts[rowId(e)];
		if (draft === undefined) return false;
		return draft.trim() !== (e.schedule ?? DEFAULT_SYNC_SCHEDULE);
	});
	const hasErrors = changed.some((e) => syncScheduleError(valueOf(e)) !== null);
	const canSave = changed.length > 0 && !hasErrors && !save.isPending;

	function submit(): void {
		if (!canSave) return;
		save.mutate(
			changed.map((e) => ({ key: e.key, file: e.file, schedule: valueOf(e).trim() })),
		);
	}

	// --- Success screen: the edit is on disk but not yet live. ---------------
	if (saved) {
		return (
			<div
				className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
				role="presentation"
			>
				<div
					className="flex w-full max-w-xl flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-2xl dark:border-neutral-800 dark:bg-neutral-950"
					role="dialog"
					aria-modal="true"
					aria-label="Polling interval updated"
				>
					<div className="border-b border-neutral-200 px-4 py-2 dark:border-neutral-800">
						<h2 className="text-sm font-semibold">Polling Interval Updated</h2>
					</div>
					<div className="flex flex-col gap-3 p-4">
						<ul className="flex flex-col gap-1">
							{saved.updates.map((u) => (
								<li key={`${u.file}::${u.key}`} className="font-mono text-xs">
									<span className="font-medium">{u.key}</span>{" "}
									<span className="text-neutral-500">
										{u.from ?? `${DEFAULT_SYNC_SCHEDULE} (default)`} →
									</span>{" "}
									{u.to}
								</li>
							))}
						</ul>
						{saved.stderr ? (
							<div className="whitespace-pre-wrap text-xs text-red-600 dark:text-red-400">
								{saved.stderr}
							</div>
						) : null}
						<p className="text-xs text-neutral-600 dark:text-neutral-400">
							The source file has been updated. The worker keeps running on its old
							interval until it's deployed. Deploy now?
						</p>
						<p className="text-xs text-neutral-600 dark:text-neutral-400">
							The deploy includes <span className="font-mono">--yes</span> to confirm this
							worker's managed database — that prompt can't be answered from here, and
							without it the deploy would just fail. A schedule change migrates nothing.
						</p>
						<div className="flex justify-end gap-2">
							<button
								type="button"
								onClick={onClose}
								className="rounded border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900"
							>
								Not now
							</button>
							<button
								type="button"
								onClick={() => {
									onClose();
									onDeploy();
								}}
								disabled={deploying}
								className="rounded bg-neutral-900 px-3 py-1 text-sm text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
							>
								{deploying
									? "Deploying…"
									: hasDeployScript
										? "Deploy (pnpm run deploy)"
										: "Deploy (ntn workers deploy)"}
							</button>
						</div>
					</div>
				</div>
			</div>
		);
	}

	// --- Edit screen --------------------------------------------------------
	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
			onClick={save.isPending ? undefined : onClose}
			role="presentation"
		>
			<div
				className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-2xl dark:border-neutral-800 dark:bg-neutral-950"
				onClick={(e) => e.stopPropagation()}
				role="dialog"
				aria-modal="true"
				aria-label="Update polling interval"
			>
				<div className="flex items-center justify-between border-b border-neutral-200 px-4 py-2 dark:border-neutral-800">
					<h2 className="text-sm font-semibold">
						Update Polling Interval{" "}
						<span className="font-normal text-neutral-500">({workerName})</span>
					</h2>
					<button
						type="button"
						onClick={onClose}
						disabled={save.isPending}
						className="rounded px-2 py-1 text-sm text-neutral-500 hover:bg-neutral-100 disabled:opacity-50 dark:hover:bg-neutral-900"
					>
						✕
					</button>
				</div>

				<form
					className="flex min-h-0 flex-1 flex-col"
					onSubmit={(e) => {
						e.preventDefault();
						submit();
					}}
				>
					{/* Tall enough that a dropdown opened on the first row is fully
					    visible rather than clipped by this scroll container. */}
					<div className="min-h-[22rem] flex-1 overflow-auto p-4">
						{schedulesQ.isLoading ? (
							<div className="text-sm text-neutral-500">Reading local source…</div>
						) : schedulesQ.error ? (
							<div className="text-sm text-red-600 dark:text-red-400">
								{(schedulesQ.error as Error).message}
							</div>
						) : entries.length === 0 ? (
							<div className="text-sm text-neutral-500">
								No <span className="font-mono">worker.sync()</span> declarations found in{" "}
								<span className="font-mono">{schedulesQ.data?.path}</span>.
							</div>
						) : (
							<div className="flex flex-col gap-3">
								<p className="text-xs text-neutral-600 dark:text-neutral-400">
									Pick a preset or type any interval — a number followed by{" "}
									<span className="font-mono">m</span>, <span className="font-mono">h</span>{" "}
									or <span className="font-mono">d</span> (min{" "}
									<span className="font-mono">1m</span>, max{" "}
									<span className="font-mono">7d</span>) — or{" "}
									<span className="font-mono">continuous</span> /{" "}
									<span className="font-mono">manual</span>.
								</p>
								{entries.map((e) => {
									const id = rowId(e);
									const value = valueOf(e);
									const readOnly = !!e.expression;
									const error =
										!readOnly && drafts[id] !== undefined ? syncScheduleError(value) : null;
									const live = deployedInfo(statusByKey.get(e.key));
									// Two independent figures: what the running schedule costs, and what the
									// one in the field would. Kept as separate blocks — pairing one interval's
									// label with the other's cost is what made this unreadable.
									const liveEst = creditsForIntervalMinutes(live?.minutes ?? null, creditsPerExecution);
									const projectedEst = readOnly ? null : syncScheduleCredits(value, creditsPerExecution);
									const pending =
										live?.minutes != null &&
										syncScheduleMinutes(value) != null &&
										live.minutes !== syncScheduleMinutes(value);
									// Only worth projecting when it differs from what's running, or when
									// nothing is running to compare against.
									const showProjected = !!projectedEst && (pending || !live);
									// Per-run cost is the same at any interval, so it belongs to whichever
									// block comes first rather than being repeated in both.
									const perRun =
										creditsPerExecution !== null
											? `~${formatCredits(creditsPerExecution)} credits/execution`
											: null;
									return (
										<div
											key={id}
											className="flex flex-col gap-1 rounded border border-neutral-200 p-3 dark:border-neutral-800"
										>
											<div className="flex items-center justify-between gap-3">
												<div className="min-w-0">
													<div className="truncate font-mono text-sm font-medium">{e.key}</div>
													<div className="truncate font-mono text-[10px] text-neutral-500">
														{e.file}:{e.line}
														{readOnly
															? ` · ${e.expression} (edit in source)`
															: e.via
																? ` · via ${e.via}`
																: e.schedule === null
																	? ` · no schedule set (default ${DEFAULT_SYNC_SCHEDULE})`
																	: ""}
													</div>
												</div>
												{readOnly ? (
													<input
														type="text"
														value={e.expression!}
														disabled
														readOnly
														title="Set from an expression, not a literal — edit it in the source file."
														aria-label={`Polling interval for ${e.key}`}
														className="w-40 shrink-0 rounded border border-neutral-300 bg-white px-2 py-1 font-mono text-xs opacity-50 dark:border-neutral-700 dark:bg-neutral-900"
													/>
												) : (
													<IntervalCombo
														value={value}
														onChange={(v) => setDraft(e, v)}
														disabled={save.isPending}
														label={`Polling interval for ${e.key}`}
														creditsPerExecution={creditsPerExecution}
													/>
												)}
											</div>
											<div className="flex flex-col gap-0.5 text-[11px] text-neutral-500">
												{live ? (
													<>
														<span className="font-medium text-neutral-600 dark:text-neutral-400">
															Deployed
															{live.disabled ? (
																<span className="text-amber-700 dark:text-amber-500"> (disabled)</span>
															) : null}
															:
														</span>
														<span>execute {live.label}</span>
														{perRun ? <span>{perRun}</span> : null}
														{liveEst ? (
															<>
																<span>~{formatCredits(liveEst.perDay)} credits/day</span>
																<span>~{formatCredits(liveEst.perMonth)} credits/month</span>
															</>
														) : null}
													</>
												) : null}
												{showProjected ? (
													<>
														<span className="pt-2 font-medium text-neutral-600 dark:text-neutral-400">
															projected at {value}
															{live ? " (not yet deployed)" : ""}:
														</span>
														{!live && perRun ? <span>{perRun}</span> : null}
														<span>~{formatCredits(projectedEst!.perDay)} credits/day</span>
														<span>~{formatCredits(projectedEst!.perMonth)} credits/month</span>
													</>
												) : null}
											</div>
											{error ? (
												<div className="text-[11px] text-red-600 dark:text-red-400">{error}</div>
											) : null}
										</div>
									);
								})}
								{schedulesQ.data?.unparsed.length ? (
									<div className="text-[11px] text-amber-700 dark:text-amber-500">
										Couldn't read sync declarations in:{" "}
										{schedulesQ.data.unparsed.join(", ")}. Edit those by hand.
									</div>
								) : null}
							</div>
						)}
					</div>

					<div className="flex items-center justify-between gap-3 border-t border-neutral-200 px-4 py-3 dark:border-neutral-800">
						<div className="min-w-0 text-xs text-red-600 dark:text-red-400">
							{save.error ? (save.error as Error).message : null}
						</div>
						<div className="flex shrink-0 gap-2">
							<button
								type="button"
								onClick={onClose}
								disabled={save.isPending}
								className="rounded border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
							>
								Cancel
							</button>
							<button
								type="submit"
								disabled={!canSave}
								className="rounded bg-neutral-900 px-3 py-1 text-sm text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
							>
								{save.isPending
									? "Saving…"
									: changed.length > 1
										? `Save ${changed.length} changes`
										: "Save"}
							</button>
						</div>
					</div>
				</form>
			</div>
		</div>
	);
}
