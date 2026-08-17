import type { Run } from "@ntn-worker-tools/shared";
import { formatDateTime, formatDuration } from "../format";
import { Empty } from "./ui/Panel";
import { ExitCodeBadge } from "./ui/ExitCodeBadge";

// Runs arrive newest-first. The marker row is inserted at the point where a
// run's startedAt drops below markerTime — i.e. runs after the marker stay
// above it, runs before it end up below.
function buildRows(runs: Run[], markerTime: string | null): Array<{ run: Run } | { marker: true }> {
	if (!markerTime) return runs.map((run) => ({ run }));
	const markerMs = new Date(markerTime).getTime();
	const rows: Array<{ run: Run } | { marker: true }> = [];
	let inserted = false;
	for (const run of runs) {
		if (!inserted && new Date(run.startedAt).getTime() < markerMs) {
			rows.push({ marker: true });
			inserted = true;
		}
		rows.push({ run });
	}
	if (!inserted) rows.push({ marker: true });
	return rows;
}

export function RunsList({
	loading,
	error,
	runs,
	selectedId,
	markerTime,
	workerNames,
	showWorkerColumn,
	onSelect,
}: {
	loading: boolean;
	error: Error | null;
	runs: Run[];
	selectedId: string | null;
	markerTime?: string | null;
	workerNames?: Record<string, string>;
	showWorkerColumn?: boolean;
	onSelect: (id: string) => void;
}) {
	if (loading) return <Empty>Loading runs…</Empty>;
	if (error) return <div className="p-3 text-sm text-red-600">{error.message}</div>;
	if (runs.length === 0 && !markerTime) {
		return (
			<Empty>
				{showWorkerColumn
					? "Set a time marker to see cross-worker runs."
					: "No runs for this worker yet."}
			</Empty>
		);
	}
	const rows = buildRows(runs, markerTime ?? null);
	return (
		<table className="w-full text-sm">
			<thead className="sticky top-0 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500 dark:bg-neutral-900">
				<tr>
					{showWorkerColumn ? <th className="px-3 py-2 text-left">Worker</th> : null}
					<th className="px-3 py-2 text-left">Name</th>
					<th className="px-3 py-2 text-left">Actor</th>
					<th className="px-3 py-2 text-left">Exit</th>
					<th className="px-3 py-2 text-left">Duration</th>
					<th className="px-3 py-2 text-left">Started</th>
				</tr>
			</thead>
			<tbody>
				{rows.map((row) =>
					"marker" in row ? (
						<tr
							key="time-marker"
							className="border-t border-dashed border-blue-400 bg-blue-50/70 dark:border-blue-700 dark:bg-blue-950/30"
						>
							{showWorkerColumn ? (
								<td className="px-3 py-1.5 text-neutral-400">----</td>
							) : null}
							<td className="px-3 py-1.5 font-medium text-neutral-400">----</td>
							<td className="px-3 py-1.5 text-neutral-400">----</td>
							<td className="px-3 py-1.5 text-neutral-400">----</td>
							<td className="px-3 py-1.5 font-mono text-xs text-neutral-400">----</td>
							<td className="px-3 py-1.5 text-xs text-neutral-500">
								{formatDateTime(markerTime as string)}
							</td>
						</tr>
					) : (
						<tr
							key={row.run.runId}
							onClick={() => onSelect(row.run.runId)}
							className={
								"cursor-pointer border-t border-neutral-100 hover:bg-neutral-50 dark:border-neutral-900 dark:hover:bg-neutral-900 " +
								(selectedId === row.run.runId ? "bg-neutral-100 dark:bg-neutral-900" : "")
							}
						>
							{showWorkerColumn ? (
								<td className="px-3 py-1.5 text-neutral-600 dark:text-neutral-400">
									{row.run.workerName ?? workerNames?.[row.run.workerId] ?? row.run.workerId}
								</td>
							) : null}
							<td className="px-3 py-1.5 font-medium">{row.run.name}</td>
							<td className="px-3 py-1.5">{row.run.actorName}</td>
							<td className="px-3 py-1.5">
								<ExitCodeBadge code={row.run.exitCode} />
							</td>
							<td className="px-3 py-1.5 font-mono text-xs">
								{formatDuration(row.run.startedAt, row.run.endedAt)}
							</td>
							<td className="px-3 py-1.5 text-xs text-neutral-500">
								{formatDateTime(row.run.startedAt)}
							</td>
						</tr>
					),
				)}
			</tbody>
		</table>
	);
}
