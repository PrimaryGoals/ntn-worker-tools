import type { AgentSummary, RunHealth } from "@ntn-worker-tools/shared";
import { formatDateTime } from "../format";
import { Empty } from "./ui/Panel";
import { WorkerStatusDot } from "./ui/WorkerStatusDot";

export function AgentsList({
	loading,
	error,
	agents,
	selectedId,
	health,
	onSelect,
}: {
	loading: boolean;
	error: Error | null;
	agents: AgentSummary[];
	selectedId: string | null;
	// agentId -> health, scored from recent sessions by the same rules as
	// worker runs. Empty until the tab's first visit triggers the fetch.
	health: Record<string, RunHealth>;
	onSelect: (id: string) => void;
}) {
	if (loading) return <Empty>Loading agents…</Empty>;
	if (error) return <div className="p-3 text-sm text-red-600">{error.message}</div>;
	if (agents.length === 0) {
		return (
			<Empty>
				No agents visible to this credential. `ntn` sees only agents shared with it — check
				`ntn whoami` is the workspace you expect.
			</Empty>
		);
	}
	return (
		<ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
			{agents.map((a) => {
				const isSelected = selectedId === a.id;
				// An active agent with every trigger off can never fire on its
				// own. Worth calling out, since `status` alone reads as healthy.
				const dormant = a.status === "active" && a.triggerCount > 0 && a.enabledTriggerCount === 0;
				return (
					<li key={a.id} className={isSelected ? "bg-neutral-100 dark:bg-neutral-900" : ""}>
						<button
							type="button"
							onClick={() => onSelect(a.id)}
							className="block w-full px-3 py-2 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-900"
						>
							<div>
								<WorkerStatusDot health={health[a.id]} />
								<span className="font-medium">{a.name}</span>
								{a.status !== "active" ? (
									<span className="font-medium text-neutral-500"> - {a.status}</span>
								) : null}
								{dormant ? (
									<span
										className="font-medium text-amber-600 dark:text-amber-400"
										title="Every trigger on this agent is disabled, so it can only run when started manually."
									>
										{" "}
										- no triggers enabled
									</span>
								) : null}
							</div>
							<div className="font-mono text-xs text-neutral-500">
								{a.id}
								{a.creditLimit !== null ? (
									<span
										className="text-neutral-600 dark:text-neutral-400"
										title="Per-agent credit limit"
									>
										{" "}
										(limit={a.creditLimit})
									</span>
								) : null}
							</div>
							<div className="text-xs text-neutral-500">
								v{a.versionNumber} · {a.model} · {a.enabledTriggerCount}/{a.triggerCount} triggers
								{" · last run "}
								{a.lastRunAt ? formatDateTime(a.lastRunAt) : "never"}
							</div>
						</button>
					</li>
				);
			})}
		</ul>
	);
}
