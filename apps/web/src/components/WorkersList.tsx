import type { RunHealth, Worker } from "@ntn-worker-tools/shared";
import { Empty } from "./ui/Panel";
import { WorkerStatusDot } from "./ui/WorkerStatusDot";

export function WorkersList({
	loading,
	error,
	workers,
	selectedId,
	runHealth,
	localPaths,
	syncSchedules,
	codeOutOfDateWorkerIds,
	envOutOfDateWorkerIds,
	onSelect,
	onRevealPath,
	filtered,
}: {
	loading: boolean;
	error: Error | null;
	workers: Worker[];
	selectedId: string | null;
	// workerId -> recent-run health, from the run-health query. A worker with
	// no entry (still loading, or added since the last refresh) gets a hollow dot.
	runHealth: Record<string, RunHealth>;
	localPaths: Record<string, string>;
	// workerId -> the distinct polling intervals of that worker's syncs,
	// read from its local source. Absent for workers with no registered
	// folder (nothing to read) and empty for folders declaring no syncs —
	// either way, no badge.
	syncSchedules: Record<string, string[]>;
	codeOutOfDateWorkerIds: Set<string>;
	envOutOfDateWorkerIds: Set<string>;
	onSelect: (id: string) => void;
	onRevealPath: (id: string) => void;
	// True when `workers` has already been narrowed by a search filter —
	// changes the empty-state message so "no matches" isn't confused with
	// "no workers at all".
	filtered?: boolean;
}) {
	if (loading) return <Empty>Loading workers…</Empty>;
	if (error) return <div className="p-3 text-sm text-red-600">{error.message}</div>;
	if (workers.length === 0) {
		return <Empty>{filtered ? "No workers match your filter." : "No workers in this workspace."}</Empty>;
	}
	return (
		<ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
			{workers.map((w) => {
				const localPath = localPaths[w.workerId];
				const isSelected = selectedId === w.workerId;
				return (
					<li
						key={w.workerId}
						className={isSelected ? "bg-neutral-100 dark:bg-neutral-900" : ""}
					>
						<button
							type="button"
							onClick={() => onSelect(w.workerId)}
							className="block w-full px-3 pt-2 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-900"
						>
							<div>
								<WorkerStatusDot health={runHealth[w.workerId]} />
								<span className="font-medium">{w.name}</span>
				{syncSchedules[w.workerId]?.length ? (
					<span
						className="font-mono text-xs text-neutral-500"
						title={`Sync polling interval${
							syncSchedules[w.workerId]!.length > 1 ? "s" : ""
							}, from this worker’s source`}
					>
						{" "}({syncSchedules[w.workerId]!.join(" / ")})
					</span>
				) : null}
								<span className="font-mono text-xs text-neutral-500"> - {w.workerId}</span>
								{codeOutOfDateWorkerIds.has(w.workerId) && (
									<span className="font-medium text-red-600 dark:text-red-400"> - redeploy</span>
								)}
								{envOutOfDateWorkerIds.has(w.workerId) && (
									<span className="font-medium text-amber-600 dark:text-amber-400"> - push secrets</span>
								)}
							</div>
						</button>
						{localPath ? (
							<button
								type="button"
								onClick={() => onRevealPath(w.workerId)}
								title={`Reveal ${localPath} in file explorer`}
								className="block w-full px-3 pb-2 text-left font-mono text-xs font-medium text-neutral-500 hover:text-blue-600 hover:underline dark:hover:text-blue-400"
							>
								{localPath}
							</button>
						) : (
							<div className="pb-2" />
						)}
					</li>
				);
			})}
		</ul>
	);
}
