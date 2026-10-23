import type {
	DeclaredCapability,
	HistoryRun,
	RunHealth,
	SyncPausedByWorker,
	Worker,
	WorkerRunHistory,
} from "@ntn-worker-tools/shared";
import {
	HEALTH_SORT_RANK,
	runNameMatchesCapability,
	runningSyncSchedules,
	syncOverdueMinutes,
} from "@ntn-worker-tools/shared";
import { Fragment, useMemo, useState } from "react";
import { formatTimeDelta } from "../format";
import { Empty } from "./ui/Panel";
import { RunHistoryStrip } from "./ui/RunHistoryStrip";

type SortColumn = "name" | "history" | "age";
type SortDirection = "asc" | "desc";

// What the columns sort on. A worker row and one of its capability rows answer
// the same three questions, so one comparator orders both — which is what keeps
// a capability sorting inside its worker rather than against every other row.
interface Sortable {
	label: string;
	health: RunHealth;
	failures: number;
	// Time since this row's newest run started, or null if it has never run.
	ageMs: number | null;
}

interface CapabilityRow extends Sortable {
	runs: HistoryRun[];
}

interface HealthRow extends Sortable {
	worker: Worker;
	history: WorkerRunHistory;
	capabilities: CapabilityRow[];
	// Minutes past due for a worker whose RUNNING syncs should have fired by now.
	overdueMinutes: number | null;
	// "paused", or "paused (1 of 3)" when only some syncs are. Null when none is.
	pausedNote: string | null;
}

const columns: Array<{
	id: SortColumn;
	label: string;
	// Where a fresh click on this header starts. Worst-first for history and
	// stalest-first for age are what the view is for; name reads a-z.
	defaultDirection: SortDirection;
	getValue: (row: Sortable) => number | string;
}> = [
	{ id: "name", label: "Worker", defaultDirection: "asc", getValue: (r) => r.label.toLowerCase() },
	{
		// Ascending rank is worst-first: red sorts above orange above green. The
		// failure count only separates rows that score the same.
		id: "history",
		label: "History",
		defaultDirection: "asc",
		getValue: (r) => HEALTH_SORT_RANK[r.health] * 1000 - r.failures,
	},
	{ id: "age", label: "Age", defaultDirection: "desc", getValue: (r) => r.ageMs ?? 0 },
];

function countFailures(runs: Array<{ exitCode: number | null }>): number {
	return runs.filter((r) => r.exitCode != null && r.exitCode !== 0).length;
}

function ageOf(runs: Array<{ startedAt: string }>, now: number): number | null {
	const startedAt = runs[0]?.startedAt;
	if (!startedAt) return null;
	const started = new Date(startedAt).getTime();
	return Number.isFinite(started) ? now - started : null;
}

// Every capability a worker has, whether it has run or not: what it declares,
// paired with the runs that belong to it, plus any bucket left over.
//
// A leftover is a capability the worker no longer declares but has history for
// — one removed from source, or renamed. Its runs are kept rather than dropped,
// since a failure that happened did happen.
function capabilityRows(
	declared: DeclaredCapability[] | undefined,
	buckets: WorkerRunHistory["capabilities"],
	now: number,
): CapabilityRow[] {
	const toRow = (label: string, runs: HistoryRun[], health: RunHealth): CapabilityRow => ({
		label,
		runs,
		health,
		failures: countFailures(runs),
		ageMs: ageOf(runs, now),
	});
	// Without a capabilities list there is nothing to add, so the buckets that
	// ran are the whole truth available.
	if (!declared) return buckets.map((b) => toRow(b.name, b.runs, b.health));
	const matched = new Set<string>();
	const rows = declared.map((cap) => {
		const bucket = buckets.find((b) => runNameMatchesCapability(b.name, cap.key));
		if (bucket) matched.add(bucket.name);
		// Named from the declaration so every capability reads the same way,
		// including ones with no run to take a name from. The exact run names are
		// on the bubbles.
		return toRow(`${cap.tag}:${cap.key}`, bucket?.runs ?? [], bucket?.health ?? "none");
	});
	for (const bucket of buckets) {
		if (!matched.has(bucket.name)) rows.push(toRow(bucket.name, bucket.runs, bucket.health));
	}
	return rows;
}

export function HealthList({
	loading,
	error,
	workers,
	history,
	declared,
	deadAfterSeconds,
	syncPaused,
	onSelectWorker,
	onSelectRun,
}: {
	loading: boolean;
	error: Error | null;
	// Already name-sorted by the caller; this table re-sorts anyway.
	workers: Worker[];
	history: Record<string, WorkerRunHistory>;
	// workerId -> what it declares, so a capability that has never run still gets
	// a row. A worker whose capabilities could not be read is absent, and falls
	// back to the capabilities its runs reveal.
	declared: Record<string, DeclaredCapability[]>;
	deadAfterSeconds?: number;
	// Carries each sync's cadence and which are paused; the running ones are what
	// "overdue" is measured against, since a paused sync is never late.
	syncPaused: SyncPausedByWorker;
	onSelectWorker: (workerId: string) => void;
	onSelectRun: (workerId: string, runId: string) => void;
}) {
	const [sortColumn, setSortColumn] = useState<SortColumn>("name");
	const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
	const [failuresOnly, setFailuresOnly] = useState(false);
	const [expanded, setExpanded] = useState<Set<string>>(new Set());

	const rows = useMemo<HealthRow[]>(() => {
		const now = Date.now();
		return workers.map((worker) => {
			const workerHistory = history[worker.workerId] ?? {
				runs: [],
				health: "unknown" as const,
				capabilities: [],
			};
			// Only the cadences still running are held to a schedule. A paused sync
			// was told to stop, so its silence is the intended outcome rather than a
			// fault, and a fully paused worker has no cadence left to be late for.
			const sync = syncPaused[worker.workerId];
			const paused = sync?.paused.length ?? 0;
			return {
				worker,
				history: workerHistory,
				label: worker.name,
				health: workerHistory.health,
				// Counted across every capability's bucket rather than the worker's
				// newest ten, so a failure in a capability too quiet to reach that
				// window still sorts and filters the worker into view.
				failures: workerHistory.capabilities.reduce((n, c) => n + countFailures(c.runs), 0),
				ageMs: ageOf(workerHistory.runs, now),
				capabilities: capabilityRows(declared[worker.workerId], workerHistory.capabilities, now),
				overdueMinutes: syncOverdueMinutes(
					sync ? runningSyncSchedules(sync) : [],
					workerHistory.runs[0]?.startedAt ?? null,
					now,
				),
				pausedNote:
					paused === 0
						? null
						: paused >= (sync?.total ?? 0)
							? "paused"
							: `paused (${paused} of ${sync!.total})`,
			};
		});
	}, [workers, history, declared, syncPaused]);

	const visible = useMemo(
		() => (failuresOnly ? rows.filter((r) => r.failures > 0 || r.overdueMinutes !== null) : rows),
		[rows, failuresOnly],
	);

	const compare = useMemo(() => {
		const column = columns.find((c) => c.id === sortColumn)!;
		const dir = sortDirection === "asc" ? 1 : -1;
		return (a: Sortable, b: Sortable) => {
			// A row that has never run sorts last whichever way the age column runs.
			// "Never ran" is a different question from "ran, but a long time ago",
			// and this sort exists for the second one.
			if (column.id === "age") {
				if (a.ageMs === null && b.ageMs === null) return 0;
				if (a.ageMs === null) return 1;
				if (b.ageMs === null) return -1;
			}
			const va = column.getValue(a);
			const vb = column.getValue(b);
			if (typeof va === "string" || typeof vb === "string") {
				return dir * String(va).localeCompare(String(vb), undefined, { sensitivity: "base" });
			}
			return dir * (va - vb);
		};
	}, [sortColumn, sortDirection]);

	const sorted = useMemo(() => [...visible].sort(compare), [visible, compare]);

	if (loading) return <Empty>Loading health…</Empty>;
	if (error) return <div className="p-3 text-sm text-red-600">{error.message}</div>;
	if (workers.length === 0) return <Empty>No workers found.</Empty>;

	function handleHeaderClick(column: SortColumn) {
		if (column === sortColumn) {
			setSortDirection((d) => (d === "desc" ? "asc" : "desc"));
		} else {
			setSortColumn(column);
			setSortDirection(columns.find((c) => c.id === column)!.defaultDirection);
		}
	}

	function toggle(workerId: string) {
		setExpanded((prev) => {
			const next = new Set(prev);
			if (!next.delete(workerId)) next.add(workerId);
			return next;
		});
	}

	return (
		<div>
			<label className="flex cursor-pointer items-center gap-1.5 px-3 py-1.5 text-[11px] text-neutral-600 dark:text-neutral-400">
				<input
					type="checkbox"
					checked={failuresOnly}
					onChange={(e) => setFailuresOnly(e.target.checked)}
				/>
				Only workers with failures or an overdue sync
			</label>
			<table className="w-full text-sm">
				<thead className="sticky top-0 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500 dark:bg-neutral-900">
					<tr>
						{columns.map((column) => (
							<th
								key={column.id}
								className="cursor-pointer select-none px-3 py-2 text-left hover:text-neutral-700 dark:hover:text-neutral-300"
								onClick={() => handleHeaderClick(column.id)}
							>
								{column.label}
								{sortColumn === column.id ? (sortDirection === "asc" ? " ▲" : " ▼") : null}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{sorted.length === 0 ? (
						<tr>
							<td colSpan={columns.length}>
								<Empty>Nothing failing, and no sync overdue.</Empty>
							</td>
						</tr>
					) : (
						sorted.map((row) => {
							// Only worth breaking out when there is more than one: a single
							// capability's rows would just repeat the worker's own.
							const splittable = row.capabilities.length > 1;
							const isOpen = splittable && expanded.has(row.worker.workerId);
							return (
								<Fragment key={row.worker.workerId}>
									<tr
										onClick={() => onSelectWorker(row.worker.workerId)}
										className="cursor-pointer border-t border-neutral-100 hover:bg-neutral-50 dark:border-neutral-900 dark:hover:bg-neutral-900"
									>
										<td className="px-3 py-1.5 font-medium">
											{splittable ? (
												<button
													type="button"
													aria-expanded={isOpen}
													title={`${isOpen ? "Hide" : "Show"} this worker's ${row.capabilities.length} capabilities`}
													onClick={(e) => {
														e.stopPropagation();
														toggle(row.worker.workerId);
													}}
													className="mr-1 w-3 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
												>
													{isOpen ? "▾" : "▸"}
												</button>
											) : (
												<span className="mr-1 inline-block w-3" />
											)}
											{row.worker.name}
										</td>
										<td className="px-3 py-1.5">
											<RunHistoryStrip
												runs={row.history.runs}
												deadAfterSeconds={deadAfterSeconds}
												onSelectRun={(runId) => onSelectRun(row.worker.workerId, runId)}
											/>
										</td>
										<td className="whitespace-nowrap px-3 py-1.5 font-mono text-xs">
											{row.ageMs === null ? (
												<span className="text-neutral-400">never</span>
											) : row.overdueMinutes !== null ? (
												<span
													className="text-amber-600 dark:text-amber-500"
													title={`A running sync is ${formatTimeDelta(row.overdueMinutes * 60000)} past due`}
												>
													{formatTimeDelta(row.ageMs)} ⚠
												</span>
											) : (
												formatTimeDelta(row.ageMs)
											)}
											{row.pausedNote ? (
												<span
													className="ml-1.5 text-neutral-400 dark:text-neutral-500"
													title="A paused sync is not expected to run, so it is never counted overdue"
												>
													{row.pausedNote}
												</span>
											) : null}
										</td>
									</tr>
									{isOpen
										? [...row.capabilities].sort(compare).map((cap) => (
												<tr
													key={cap.label}
													onClick={() => onSelectWorker(row.worker.workerId)}
													className="cursor-pointer border-t border-neutral-100 bg-neutral-50/60 hover:bg-neutral-100 dark:border-neutral-900 dark:bg-neutral-900/40 dark:hover:bg-neutral-900"
												>
													<td className="py-1 pl-10 pr-3 text-xs text-neutral-600 dark:text-neutral-400">
														{cap.label}
													</td>
													<td className="px-3 py-1">
														<RunHistoryStrip
															runs={cap.runs}
															deadAfterSeconds={deadAfterSeconds}
															onSelectRun={(runId) => onSelectRun(row.worker.workerId, runId)}
														/>
													</td>
													<td className="whitespace-nowrap px-3 py-1 font-mono text-xs text-neutral-500">
														{cap.ageMs === null ? "never" : formatTimeDelta(cap.ageMs)}
													</td>
												</tr>
											))
										: null}
								</Fragment>
							);
						})
					)}
				</tbody>
			</table>
		</div>
	);
}
