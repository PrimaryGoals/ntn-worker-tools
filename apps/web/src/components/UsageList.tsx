import type { WorkerUsage } from "@ntn-worker-tools/shared";
import { formatBytes, formatMs } from "../format";
import { Empty } from "./ui/Panel";

export function UsageList({
	loading,
	error,
	usages,
}: {
	loading: boolean;
	error: Error | null;
	usages: WorkerUsage[];
}) {
	if (loading) return <Empty>Loading usage…</Empty>;
	if (error) return <div className="p-3 text-sm text-red-600">{error.message}</div>;
	if (usages.length === 0) return <Empty>No workers found.</Empty>;
	const sorted = [...usages].sort((a, b) =>
		a.worker.name.localeCompare(b.worker.name, undefined, { sensitivity: "base" }),
	);
	return (
		<table className="w-full text-sm">
			<thead className="sticky top-0 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500 dark:bg-neutral-900">
				<tr>
					<th className="px-3 py-2 text-left">Name</th>
					<th className="px-3 py-2 text-left">Credits</th>
					<th className="px-3 py-2 text-left">Executions</th>
					<th className="px-3 py-2 text-left">CPU</th>
					<th className="px-3 py-2 text-left">Wall duration</th>
					<th className="px-3 py-2 text-left">Ingress</th>
					<th className="px-3 py-2 text-left">Egress</th>
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
