import { isDeadRun, RUN_HEALTH_FETCH, type HistoryRun } from "@ntn-worker-tools/shared";
import { formatDateTime } from "../../format";

// One run's bubble. Four states, not two: a strip that only knew pass and fail
// would show a worker whose sandbox was killed as though nothing had happened.
// Keep the wording in sync with WorkerStatusDot, which scores the same runs.
function bubbleStyle(
	run: HistoryRun,
	deadAfterSeconds: number | undefined,
): { fill: string; label: string } {
	if (isDeadRun(run, deadAfterSeconds)) {
		return { fill: "bg-neutral-500", label: "dead — killed without reporting" };
	}
	if (run.exitCode == null) return { fill: "bg-transparent", label: "running" };
	if (run.exitCode === 0) return { fill: "bg-emerald-500", label: "exit 0" };
	return { fill: "bg-red-600", label: `exit ${run.exitCode}` };
}

// A worker's recent runs as a row of bubbles, newest on the RIGHT so the strip
// reads as a timeline and its newest run sits against the age that describes it.
//
// Short strips pad on the left rather than the right. A worker with three runs
// and one with ten then line their newest runs up in the same column, which is
// what makes a table of these scannable instead of ragged.
export function RunHistoryStrip({
	runs,
	deadAfterSeconds,
	onSelectRun,
}: {
	// Newest-first, as the history payload delivers them.
	runs: HistoryRun[];
	deadAfterSeconds?: number;
	onSelectRun?: (runId: string) => void;
}) {
	const shown = runs.slice(0, RUN_HEALTH_FETCH);
	const padding = Math.max(0, RUN_HEALTH_FETCH - shown.length);
	// Reversed for display only; `runs` itself stays newest-first everywhere else.
	const oldestFirst = [...shown].reverse();
	return (
		<div className="flex items-center gap-1">
			{Array.from({ length: padding }, (_, i) => (
				<span key={`pad-${i}`} className="inline-block h-2.5 w-2.5 shrink-0" />
			))}
			{oldestFirst.map((run) => {
				const { fill, label } = bubbleStyle(run, deadAfterSeconds);
				// The capability leads: on a worker row the strip mixes several, and
				// which one failed is the first thing you want from a red bubble.
				const title = `${run.name} — ${label} — ${formatDateTime(run.startedAt)}`;
				return (
					<button
						key={run.runId}
						type="button"
						title={title}
						aria-label={title}
						// The row underneath selects just the worker, so a bubble has to
						// stop the event or the run it selects is immediately cleared.
						onClick={(e) => {
							e.stopPropagation();
							onSelectRun?.(run.runId);
						}}
						// The ring is what makes the hollow "running" bubble visible, and
						// every bubble carries it so they all read the same size.
						className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-neutral-400/70 transition hover:ring-2 hover:ring-blue-500 ${fill}`}
					/>
				);
			})}
		</div>
	);
}
