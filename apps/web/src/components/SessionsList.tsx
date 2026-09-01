import type { AgentSession } from "@ntn-worker-tools/shared";
import { formatDateTime, formatDuration } from "../format";
import { Empty } from "./ui/Panel";

// Sessions have two independent failure modes and the status field only
// covers one of them, so the badge merges both:
//   - status "failed"        → the platform recorded an infrastructure error
//   - markSessionFailed call → the agent itself gave up; status stays
//                              "completed", which would otherwise read green
function StatusBadge({ session }: { session: AgentSession }) {
	if (session.status === "failed") {
		return (
			<span
				className="font-medium text-red-600 dark:text-red-400"
				title={session.error ? `${session.error.code}: ${session.error.message}` : undefined}
			>
				failed
			</span>
		);
	}
	if (session.agentReportedFailure) {
		return (
			<span
				className="font-medium text-amber-600 dark:text-amber-400"
				title="The session completed, but the agent called markSessionFailed — its work did not land."
			>
				agent failed
			</span>
		);
	}
	if (session.status === "completed") {
		return <span className="text-neutral-600 dark:text-neutral-400">completed</span>;
	}
	return <span className="font-medium text-blue-600 dark:text-blue-400">{session.status}</span>;
}

export function SessionsList({
	loading,
	error,
	sessions,
	hasMore,
	selectedId,
	agentNames,
	onSelect,
}: {
	loading: boolean;
	error: Error | null;
	sessions: AgentSession[];
	hasMore: boolean;
	selectedId: string | null;
	// Supplied only by the cross-agent view, which adds an Agent column;
	// omitted when the list is already scoped to one agent.
	agentNames?: Record<string, string>;
	onSelect: (id: string) => void;
}) {
	if (loading) return <Empty>Loading sessions…</Empty>;
	if (error) return <div className="p-3 text-sm text-red-600">{error.message}</div>;
	if (sessions.length === 0) {
		return (
			<Empty>
				{agentNames ? "No agent sessions since the time marker." : "No sessions for this agent yet."}
			</Empty>
		);
	}
	const showAgentColumn = !!agentNames;
	// The API returns newest-first; keep that, matching the runs list.
	return (
		<>
			<table className="w-full text-sm">
				<thead className="sticky top-0 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500 dark:bg-neutral-900">
					<tr>
						{showAgentColumn ? <th className="px-3 py-2 text-left">Agent</th> : null}
						<th className="px-3 py-2 text-left">Status</th>
						<th className="px-3 py-2 text-left">Trigger</th>
						<th className="px-3 py-2 text-left">Tools</th>
						<th className="px-3 py-2 text-left">Credits</th>
						<th className="px-3 py-2 text-left">Duration</th>
						<th className="px-3 py-2 text-left">Started</th>
					</tr>
				</thead>
				<tbody>
					{sessions.map((s) => (
						<tr
							key={s.id}
							onClick={() => onSelect(s.id)}
							className={
								"cursor-pointer border-t border-neutral-100 hover:bg-neutral-50 dark:border-neutral-900 dark:hover:bg-neutral-900 " +
								(selectedId === s.id ? "bg-neutral-100 dark:bg-neutral-900" : "")
							}
						>
							{showAgentColumn ? (
								<td className="px-3 py-1.5 text-neutral-600 dark:text-neutral-400">
									{agentNames?.[s.agentId] ?? s.agentId}
								</td>
							) : null}
							<td className="px-3 py-1.5">
								<StatusBadge session={s} />
							</td>
							<td className="px-3 py-1.5 font-mono text-xs">{s.triggerType}</td>
							<td className="px-3 py-1.5">{s.toolCallCount}</td>
							<td className="px-3 py-1.5">{s.creditsUsed}</td>
							<td className="px-3 py-1.5 font-mono text-xs">
								{formatDuration(s.createdAt, s.updatedAt)}
							</td>
							<td className="px-3 py-1.5 text-xs text-neutral-500">
								{formatDateTime(s.createdAt)}
							</td>
						</tr>
					))}
				</tbody>
			</table>
			{hasMore ? (
				<div className="px-3 py-2 text-xs text-neutral-500">
					Showing the 100 most recent sessions — there are more.
				</div>
			) : null}
		</>
	);
}
