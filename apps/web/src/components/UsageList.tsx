import type { WorkerUsage } from "@ntn-worker-tools/shared";
import { useMemo, useState } from "react";
import { formatBytes, formatMs } from "../format";
import { Empty } from "./ui/Panel";

type SortColumn =
	| "name"
	| "credits"
	| "executions"
	| "creditsPerExecution"
	| "cpu"
	| "wallDuration"
	| "ingress"
	| "egress";

type SortDirection = "asc" | "desc";

const columns: Array<{ id: SortColumn; label: string; getValue: (u: WorkerUsage) => number | string }> = [
	{ id: "name", label: "Name", getValue: (u) => u.worker.name.toLowerCase() },
	{ id: "credits", label: "Credits", getValue: (u) => u.usage.credits },
	{ id: "executions", label: "Executions", getValue: (u) => u.usage.sandboxCount },
	{
		id: "creditsPerExecution",
		label: "C/E",
		getValue: (u) => (u.usage.sandboxCount === 0 ? 0 : u.usage.credits / u.usage.sandboxCount),
	},
	{ id: "cpu", label: "CPU", getValue: (u) => u.usage.activeCpuDurationMs },
	{ id: "wallDuration", label: "Wall duration", getValue: (u) => u.usage.durationMs },
	{ id: "ingress", label: "Ingress", getValue: (u) => u.usage.networkIngressBytes },
	{ id: "egress", label: "Egress", getValue: (u) => u.usage.networkEgressBytes },
];

export function UsageList({
	loading,
	error,
	usages,
}: {
	loading: boolean;
	error: Error | null;
	usages: WorkerUsage[];
}) {
	const [sortColumn, setSortColumn] = useState<SortColumn>("name");
	const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

	const sorted = useMemo(() => {
		const column = columns.find((c) => c.id === sortColumn)!;
		const dir = sortDirection === "asc" ? 1 : -1;
		return [...usages].sort((a, b) => {
			const va = column.getValue(a);
			const vb = column.getValue(b);
			if (typeof va === "string" || typeof vb === "string") {
				return dir * String(va).localeCompare(String(vb), undefined, { sensitivity: "base" });
			}
			return dir * (va - vb);
		});
	}, [usages, sortColumn, sortDirection]);

	if (loading) return <Empty>Loading usage…</Empty>;
	if (error) return <div className="p-3 text-sm text-red-600">{error.message}</div>;
	if (usages.length === 0) return <Empty>No workers found.</Empty>;

	function handleHeaderClick(column: SortColumn) {
		if (column === sortColumn) {
			setSortDirection((d) => (d === "desc" ? "asc" : "desc"));
		} else {
			setSortColumn(column);
			setSortDirection("desc");
		}
	}

	return (
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
				{sorted.map((u) => (
					<tr
						key={u.worker.workerId}
						className="border-t border-neutral-100 dark:border-neutral-900"
					>
						<td className="px-3 py-1.5 font-medium">{u.worker.name}</td>
						<td className="px-3 py-1.5 font-mono text-xs">{u.usage.credits.toFixed(2)}</td>
						<td className="px-3 py-1.5 font-mono text-xs">
							{u.usage.sandboxCount.toLocaleString()}
						</td>
						<td className="px-3 py-1.5 font-mono text-xs">
							{u.usage.sandboxCount === 0
								? "—"
								: (u.usage.credits / u.usage.sandboxCount).toFixed(2)}
						</td>
						<td className="px-3 py-1.5 font-mono text-xs">
							{formatMs(u.usage.activeCpuDurationMs, { compact: true })}
						</td>
						<td className="px-3 py-1.5 font-mono text-xs">
							{formatMs(u.usage.durationMs, { compact: true })}
						</td>
						<td className="px-3 py-1.5 font-mono text-xs">
							{formatBytes(u.usage.networkIngressBytes, { compact: true })}
						</td>
						<td className="px-3 py-1.5 font-mono text-xs">
							{formatBytes(u.usage.networkEgressBytes, { compact: true })}
						</td>
					</tr>
				))}
			</tbody>
		</table>
	);
}
