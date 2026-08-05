import type { Run } from "@ntn-worker-tools/shared";
import { formatDateTime, formatDuration } from "../format";
import { Empty } from "./ui/Panel";
import { ExitCodeBadge } from "./ui/ExitCodeBadge";

export function RunsList({
	loading,
	error,
	runs,
	selectedId,
	onSelect,
}: {
	loading: boolean;
	error: Error | null;
	runs: Run[];
	selectedId: string | null;
	onSelect: (id: string) => void;
}) {
	if (loading) return <Empty>Loading runs…</Empty>;
	if (error) return <div className="p-3 text-sm text-red-600">{error.message}</div>;
	if (runs.length === 0) return <Empty>No runs for this worker yet.</Empty>;
	return (
		<table className="w-full text-sm">
			<thead className="sticky top-0 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500 dark:bg-neutral-900">
				<tr>
					<th className="px-3 py-2 text-left">Name</th>
					<th className="px-3 py-2 text-left">Actor</th>
					<th className="px-3 py-2 text-left">Exit</th>
					<th className="px-3 py-2 text-left">Duration</th>
					<th className="px-3 py-2 text-left">Started</th>
				</tr>
			</thead>
			<tbody>
				{runs.map((r) => (
					<tr
						key={r.runId}
						onClick={() => onSelect(r.runId)}
						className={
							"cursor-pointer border-t border-neutral-100 hover:bg-neutral-50 dark:border-neutral-900 dark:hover:bg-neutral-900 " +
							(selectedId === r.runId ? "bg-neutral-100 dark:bg-neutral-900" : "")
						}
					>
						<td className="px-3 py-1.5 font-medium">{r.name}</td>
						<td className="px-3 py-1.5">{r.actorName}</td>
						<td className="px-3 py-1.5">
							<ExitCodeBadge code={r.exitCode} />
						</td>
						<td className="px-3 py-1.5 font-mono text-xs">
							{formatDuration(r.startedAt, r.endedAt)}
						</td>
						<td className="px-3 py-1.5 text-xs text-neutral-500">{formatDateTime(r.startedAt)}</td>
					</tr>
				))}
			</tbody>
		</table>
	);
}
