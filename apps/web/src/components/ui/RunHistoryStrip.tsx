import {
	isDeadRun,
	RUN_HEALTH_FETCH,
	sessionOutcome,
	type HistoryRun,
	type HistorySession,
} from "@ntn-worker-tools/shared";
import { formatDateTime } from "../../format";

// One execution reduced to what a bubble draws. Deliberately not a worker run
// or an agent session: the two carry different evidence of having gone wrong
// (an exit code, a session status), and this is the shape they agree on.
export interface HistoryBubble {
	// The run or session id, for selecting it.
	id: string;
	// Which capability or trigger it belongs to, shown first in the tooltip.
	label: string;
	outcome: "ok" | "failed" | "pending" | "dead";
	startedAt: string;
	// How it ended, in that source's own terms: "exit 1", "terminated".
	detail: string;
}

// Four states, not two: a strip that only knew pass and fail would show a
// worker whose sandbox was killed as though nothing had happened. Keep the
// wording in sync with WorkerStatusDot, which scores the same executions.
const FILL: Record<HistoryBubble["outcome"], string> = {
	ok: "bg-emerald-500",
	failed: "bg-red-600",
	pending: "bg-transparent",
	dead: "bg-neutral-500",
};

export function runBubbles(runs: HistoryRun[], deadAfterSeconds: number | undefined) {
	return runs.map((run): HistoryBubble => {
		const dead = isDeadRun(run, deadAfterSeconds);
		return {
			id: run.runId,
			label: run.name,
			outcome: dead
				? "dead"
				: run.exitCode == null
					? "pending"
					: run.exitCode === 0
						? "ok"
						: "failed",
			startedAt: run.startedAt,
			detail: dead
				? "dead — killed without reporting"
				: run.exitCode == null
					? "running"
					: `exit ${run.exitCode}`,
		};
	});
}

export function sessionBubbles(sessions: HistorySession[]) {
	return sessions.map((session): HistoryBubble => {
		const outcome = sessionOutcome(session);
		return {
			id: session.sessionId,
			label: session.triggerType,
			// A session has no sandbox to be killed, so "dead" never applies here.
			outcome,
			startedAt: session.createdAt,
			// The status alone would read "completed" for a session the agent itself
			// reported as failed, which is the whole point of that flag.
			detail: session.agentReportedFailure ? "agent reported failure" : session.status,
		};
	});
}

// A row of bubbles, newest on the RIGHT so the strip reads as a timeline and
// its newest sits against the age that describes it.
//
// Short strips pad on the left rather than the right. A row with three and one
// with ten then line their newest up in the same column, which is what makes a
// table of these scannable instead of ragged.
export function RunHistoryStrip({
	bubbles,
	onSelect,
}: {
	// Newest-first, as the history payloads deliver them.
	bubbles: HistoryBubble[];
	onSelect?: (id: string) => void;
}) {
	const shown = bubbles.slice(0, RUN_HEALTH_FETCH);
	const padding = Math.max(0, RUN_HEALTH_FETCH - shown.length);
	// Reversed for display only; the source arrays stay newest-first.
	const oldestFirst = [...shown].reverse();
	return (
		<div className="flex items-center gap-1">
			{Array.from({ length: padding }, (_, i) => (
				<span key={`pad-${i}`} className="inline-block h-2.5 w-2.5 shrink-0" />
			))}
			{oldestFirst.map((bubble) => {
				// The capability or trigger leads: on a collapsed row the strip mixes
				// several, and which one failed is the first thing you want from a red
				// bubble.
				const title = `${bubble.label} — ${bubble.detail} — ${formatDateTime(bubble.startedAt)}`;
				return (
					<button
						key={bubble.id}
						type="button"
						title={title}
						aria-label={title}
						// The row underneath selects just the worker or agent, so a bubble
						// has to stop the event or what it selects is immediately cleared.
						onClick={(e) => {
							e.stopPropagation();
							onSelect?.(bubble.id);
						}}
						// The ring is what makes the hollow "pending" bubble visible, and
						// every bubble carries it so they all read the same size.
						className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-neutral-400/70 transition hover:ring-2 hover:ring-blue-500 ${FILL[bubble.outcome]}`}
					/>
				);
			})}
		</div>
	);
}
