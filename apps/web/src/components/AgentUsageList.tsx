import type { AgentUsage } from "@ntn-worker-tools/shared";
import { useMemo, useState } from "react";
import { Empty } from "./ui/Panel";

type SortColumn = "name" | "runs" | "credits" | "creditsPerRun" | "creditLimit" | "status";
type SortDirection = "asc" | "desc";

function creditsPerRun(u: AgentUsage): number {
	return u.runsCompleted === 0 ? 0 : u.totalCreditsUsed / u.runsCompleted;
}

// "hidden" sorts as -1 so the rows the token can't read group together rather
// than scattering among the real limits.
function limitValue(u: AgentUsage): number {
	if (u.creditLimit === null) return -2;
	if (u.creditLimit === "hidden") return -1;
	return u.creditLimit;
}

const columns: Array<{
	id: SortColumn;
	label: string;
	getValue: (u: AgentUsage) => number | string;
}> = [
	{ id: "name", label: "Name", getValue: (u) => u.agentName.toLowerCase() },
	{ id: "runs", label: "Runs", getValue: (u) => u.runsCompleted },
	{ id: "credits", label: "Credits", getValue: (u) => u.totalCreditsUsed },
	{ id: "creditsPerRun", label: "C/R", getValue: creditsPerRun },
	{ id: "creditLimit", label: "Limit", getValue: limitValue },
	{ id: "status", label: "Status", getValue: (u) => u.status },
];

export function AgentUsageList({
	loading,
	error,
	usages,
	windowStart,
	windowEnd,
}: {
	loading: boolean;
	error: Error | null;
	usages: AgentUsage[];
	windowStart: string | null;
	windowEnd: string | null;
}) {
	const [sortColumn, setSortColumn] = useState<SortColumn>("credits");
	const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

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

	if (loading) return <Empty>Loading agent usage…</Empty>;
	if (error) return <div className="p-3 text-sm text-red-600">{error.message}</div>;
	if (usages.length === 0) return <Empty>No agents found.</Empty>;

	function handleHeaderClick(column: SortColumn) {
		if (column === sortColumn) {
			setSortDirection((d) => (d === "desc" ? "asc" : "desc"));
		} else {
			setSortColumn(column);
			setSortDirection("desc");
		}
	}

	return (
		<>
			<div className="border-b border-neutral-200 px-3 py-1.5 text-xs text-neutral-500 dark:border-neutral-800">
				{windowStart && windowEnd
					? `Window: ${windowStart.slice(0, 10)} to ${windowEnd.slice(0, 10)}`
					: "Window: current billing period (the API default)"}
			</div>
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
						<th className="px-3 py-2 text-left">Paused because</th>
					</tr>
				</thead>
				<tbody>
					{sorted.map((u) => (
						<tr key={u.agentId} className="border-t border-neutral-100 dark:border-neutral-900">
							<td className="px-3 py-1.5 font-medium">{u.agentName}</td>
							<td className="px-3 py-1.5 font-mono text-xs">
								{u.runsCompleted.toLocaleString()}
							</td>
							<td className="px-3 py-1.5 font-mono text-xs">
								{u.totalCreditsUsed.toLocaleString()}
							</td>
							<td className="px-3 py-1.5 font-mono text-xs">
								{u.runsCompleted === 0 ? "—" : creditsPerRun(u).toFixed(2)}
							</td>
							<td className="px-3 py-1.5 font-mono text-xs">
								{u.creditLimit === null
									? "—"
									: u.creditLimit === "hidden"
										? "hidden"
										: u.creditLimit.toLocaleString()}
							</td>
							<td className="px-3 py-1.5">
								{u.status === "active" ? (
									u.status
								) : (
									<span className="font-medium text-amber-600 dark:text-amber-400">
										{u.status}
									</span>
								)}
							</td>
							<td className="px-3 py-1.5 font-mono text-xs">
								{u.pauseReason ? (
									<span className="text-amber-600 dark:text-amber-400">{u.pauseReason}</span>
								) : (
									"—"
								)}
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</>
	);
}
