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
		const base = { id: run.runId, label: run.name, startedAt: run.startedAt };
		if (run.exitCode != null) {
			return {
				...base,
				outcome: run.exitCode === 0 ? "ok" : "failed",
				detail: `exit ${run.exitCode}`,
			};
		}
		// No exit code, so either it is still going or it will never report one.
		if (isDeadRun(run, deadAfterSeconds)) {
			return { ...base, outcome: "dead", detail: "dead — killed without reporting" };
		}
		// It ended, it just never said how. isDeadRun deliberately excludes this —
		// the run's duration is known, so the runs table must not call it dead —
		// but here it is not running either, and drawing it hollow would leave a
		// run that finished days ago reading as in flight for ever.
		if (run.endedAt) {
			return { ...base, outcome: "dead", detail: "ended without an exit code" };
		}
		return { ...base, outcome: "pending", detail: "running" };
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
	selectedId,
	onSelect,
}: {
	// Newest-first, as the history payloads deliver them.
	bubbles: HistoryBubble[];
	// The run or session being shown below, ringed so it stays findable among
	// ten near-identical bubbles.
	selectedId?: string | null;
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
						// every bubble carries one so they all read the same size — the
						// selected bubble just wears a heavier, bluer one.
						className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full transition hover:ring-2 hover:ring-blue-500 ${
							bubble.id === selectedId
								? "ring-2 ring-blue-600 dark:ring-blue-400"
								: "ring-1 ring-neutral-400/70"
						} ${FILL[bubble.outcome]}`}
					/>
				);
			})}
		</div>
	);
}
