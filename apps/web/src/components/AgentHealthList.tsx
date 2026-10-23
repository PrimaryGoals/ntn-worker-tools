import type {
	AgentRunHistory,
	AgentSummary,
	HistorySession,
	RunHealth,
} from "@ntn-worker-tools/shared";
import { HEALTH_SORT_RANK } from "@ntn-worker-tools/shared";
import { Fragment, useMemo, useState } from "react";
import { formatTimeDelta } from "../format";
import { Empty } from "./ui/Panel";
import { RunHistoryStrip, sessionBubbles } from "./ui/RunHistoryStrip";

// The Agents tab's counterpart to HealthList. A sibling rather than a shared
// generic table, for the same reason the two view-mode switches are siblings:
// what each has to say beside the age doesn't merge. A worker is late for a
// sync; an agent can't fire because its triggers are off.

type SortColumn = "name" | "history" | "age";
type SortDirection = "asc" | "desc";

interface Sortable {
	label: string;
	health: RunHealth;
	failures: number;
	ageMs: number | null;
}

interface TriggerRow extends Sortable {
	sessions: HistorySession[];
	// Null for a bucket with no matching declared trigger — a "chat" bucket, or
	// a trigger that has been removed since those sessions ran.
	enabled: boolean | null;
}

interface AgentHealthRow extends Sortable {
	agent: AgentSummary;
	history: AgentRunHistory;
	triggers: TriggerRow[];
	// Set when the agent is active but cannot fire anyway — a contradiction, and
	// the one state here worth an alarm.
	inertNote: string | null;
	// Set when the agent has been turned off deliberately. Not a fault: the
	// counterpart of a paused sync, which is told not to run and so is never
	// held to account for not running.
	pausedNote: string | null;
}

const columns: Array<{
	id: SortColumn;
	label: string;
	defaultDirection: SortDirection;
	getValue: (row: Sortable) => number | string;
}> = [
	{ id: "name", label: "Agent", defaultDirection: "asc", getValue: (r) => r.label.toLowerCase() },
	{
		id: "history",
		label: "History",
		defaultDirection: "asc",
		getValue: (r) => HEALTH_SORT_RANK[r.health] * 1000 - r.failures,
	},
	{ id: "age", label: "Age", defaultDirection: "desc", getValue: (r) => r.ageMs ?? 0 },
];

function countFailures(sessions: HistorySession[]): number {
	return sessions.filter(
		(s) => s.status === "failed" || s.status === "terminated" || s.agentReportedFailure,
	).length;
}

function ageOf(iso: string | null | undefined, now: number): number | null {
	if (!iso) return null;
	const started = new Date(iso).getTime();
	return Number.isFinite(started) ? now - started : null;
}

// Every trigger an agent has, whether it has fired or not, paired with the
// sessions that belong to it — plus any bucket with no declared trigger, which
// is where "chat" lands and where a removed trigger's history is kept.
function triggerRows(
	agent: AgentSummary,
	buckets: AgentRunHistory["triggers"],
	now: number,
): TriggerRow[] {
	const toRow = (
		label: string,
		sessions: HistorySession[],
		health: RunHealth,
		enabled: boolean | null,
	): TriggerRow => ({
		label,
		sessions,
		health,
		enabled,
		failures: countFailures(sessions),
		ageMs: ageOf(sessions[0]?.createdAt, now),
	});
	const matched = new Set<string>();
	const rows = agent.triggers.map((trigger) => {
		const bucket = buckets.find((b) => b.name === trigger.type);
		if (bucket) matched.add(bucket.name);
		return toRow(
			trigger.type,
			bucket?.sessions ?? [],
			bucket?.health ?? "none",
			trigger.enabled,
		);
	});
	for (const bucket of buckets) {
		if (!matched.has(bucket.name)) {
			rows.push(toRow(bucket.name, bucket.sessions, bucket.health, null));
		}
	}
	return rows;
}

export function AgentHealthList({
	loading,
	error,
	agents,
	history,
	selectedSessionId,
	onSelectAgent,
	onSelectSession,
}: {
	loading: boolean;
	error: Error | null;
	agents: AgentSummary[];
	history: Record<string, AgentRunHistory>;
	// The session currently shown in the output panel, ringed in its strip.
	selectedSessionId: string | null;
	onSelectAgent: (agentId: string) => void;
	onSelectSession: (agentId: string, sessionId: string) => void;
}) {
	const [sortColumn, setSortColumn] = useState<SortColumn>("name");
	const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
	const [failuresOnly, setFailuresOnly] = useState(false);
	const [expanded, setExpanded] = useState<Set<string>>(new Set());

	const rows = useMemo<AgentHealthRow[]>(() => {
		const now = Date.now();
		return agents.map((agent) => {
			const agentHistory = history[agent.id] ?? {
				sessions: [],
				health: "unknown" as const,
				triggers: [],
			};
			const triggers = triggerRows(agent, agentHistory.triggers, now);
			// The agent counterpart of an overdue sync, and a certainty rather than
			// an inference: an agent reading "active" whose every trigger is off can
			// never fire on its own, however healthy its past sessions look.
			//
			// An agent that is simply turned off is a different matter, and not a
			// fault — it was told to stop, exactly as a paused sync was — so it
			// reports what it is without an alarm.
			const disabled = agent.status !== "active";
			const inertNote =
				!disabled && agent.triggerCount > 0 && agent.enabledTriggerCount === 0
					? "no enabled triggers"
					: null;
			const pausedNote = disabled ? (agent.pauseReason ?? agent.status) : null;
			return {
				agent,
				history: agentHistory,
				label: agent.name,
				health: agentHistory.health,
				// Counted across every trigger's bucket rather than the agent's newest
				// ten, so a failure under a trigger too quiet to reach that window
				// still sorts and filters the agent into view.
				failures: agentHistory.triggers.reduce((n, t) => n + countFailures(t.sessions), 0),
				// The agent's own last_run_at, which covers sessions older than the
				// page this sweep read.
				ageMs: ageOf(agent.lastRunAt, now),
				triggers,
				inertNote,
				pausedNote,
			};
		});
	}, [agents, history]);

	const visible = useMemo(
		// A deliberately disabled agent is not something to answer for, so it is
		// not what this filter is looking for.
		() => (failuresOnly ? rows.filter((r) => r.failures > 0 || r.inertNote !== null) : rows),
		[rows, failuresOnly],
	);

	const compare = useMemo(() => {
		const column = columns.find((c) => c.id === sortColumn)!;
		const dir = sortDirection === "asc" ? 1 : -1;
		return (a: Sortable, b: Sortable) => {
			// A row that has never run sorts last whichever way the age column runs.
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
	if (agents.length === 0) return <Empty>No agents found.</Empty>;

	function handleHeaderClick(column: SortColumn) {
		if (column === sortColumn) {
			setSortDirection((d) => (d === "desc" ? "asc" : "desc"));
		} else {
			setSortColumn(column);
			setSortDirection(columns.find((c) => c.id === column)!.defaultDirection);
		}
	}

	function toggle(agentId: string) {
		setExpanded((prev) => {
			const next = new Set(prev);
			if (!next.delete(agentId)) next.add(agentId);
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
				Only agents with failures or that cannot fire
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
								<Empty>Nothing failing, and every agent can fire.</Empty>
							</td>
						</tr>
					) : (
						sorted.map((row) => {
							const splittable = row.triggers.length > 1;
							const isOpen = splittable && expanded.has(row.agent.id);
							return (
								<Fragment key={row.agent.id}>
									<tr className="border-t border-neutral-100 hover:bg-neutral-50 dark:border-neutral-900 dark:hover:bg-neutral-900">
										<td className="px-3 py-1.5 font-medium">
											{splittable ? (
												<button
													type="button"
													aria-expanded={isOpen}
													title={`${isOpen ? "Hide" : "Show"} this agent's ${row.triggers.length} triggers`}
													onClick={(e) => {
														e.stopPropagation();
														toggle(row.agent.id);
													}}
													className="mr-1 w-3 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
												>
													{isOpen ? "▾" : "▸"}
												</button>
											) : (
												<span className="mr-1 inline-block w-3" />
											)}
											{/* Only the name leaves this view, as on the workers tab. */}
											<button
												type="button"
												onClick={() => onSelectAgent(row.agent.id)}
												title={`Show ${row.agent.name}'s sessions`}
												className="cursor-pointer hover:underline"
											>
												{row.agent.name}
											</button>
										</td>
										<td className="px-3 py-1.5">
											<RunHistoryStrip
												bubbles={sessionBubbles(row.history.sessions)}
												selectedId={selectedSessionId}
												onSelect={(sessionId) => onSelectSession(row.agent.id, sessionId)}
											/>
										</td>
										<td className="whitespace-nowrap px-3 py-1.5 font-mono text-xs">
											{row.ageMs === null ? (
												<span className="text-neutral-400">never</span>
											) : (
												formatTimeDelta(row.ageMs)
											)}
											{row.inertNote ? (
												<span
													className="ml-1.5 text-amber-600 dark:text-amber-500"
													title="This agent reads as active but cannot fire on its own, however healthy its past sessions look"
												>
													{row.inertNote} ⚠
												</span>
											) : null}
											{row.pausedNote ? (
												<span
													className="ml-1.5 text-neutral-400 dark:text-neutral-500"
													title="This agent is turned off, so it is not expected to run"
												>
													{row.pausedNote}
												</span>
											) : null}
										</td>
									</tr>
									{isOpen
										? [...row.triggers].sort(compare).map((trigger) => (
												<tr
													key={trigger.label}
													className="border-t border-neutral-100 bg-neutral-50/60 hover:bg-neutral-100 dark:border-neutral-900 dark:bg-neutral-900/40 dark:hover:bg-neutral-900"
												>
													<td className="py-1 pl-10 pr-3 text-xs text-neutral-600 dark:text-neutral-400">
														<button
															type="button"
															onClick={() => onSelectAgent(row.agent.id)}
															title={`Show ${row.agent.name}'s sessions`}
															className="cursor-pointer hover:underline"
														>
															{trigger.label}
														</button>
														{trigger.enabled === false ? (
															<span
																className="ml-1.5 text-neutral-400"
																title="This trigger is turned off, so it is not expected to fire"
															>
																off
															</span>
														) : null}
													</td>
													<td className="px-3 py-1">
														<RunHistoryStrip
															bubbles={sessionBubbles(trigger.sessions)}
															selectedId={selectedSessionId}
															onSelect={(sessionId) =>
																onSelectSession(row.agent.id, sessionId)
															}
														/>
													</td>
													<td className="whitespace-nowrap px-3 py-1 font-mono text-xs text-neutral-500">
														{trigger.ageMs === null ? "never" : formatTimeDelta(trigger.ageMs)}
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
