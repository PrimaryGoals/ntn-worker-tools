import type { RunHealth } from "@ntn-worker-tools/shared";

// Fill + tooltip for each health value. Keep the wording here in sync with
// computeRunHealth on the server, which decides which value a worker gets.
const DOT: Record<RunHealth, { fill: string; label: string }> = {
	red: { fill: "bg-red-600", label: "Most recent run failed" },
	orange: { fill: "bg-orange-500", label: "A run failed 2-3 runs ago" },
	yellow: { fill: "bg-yellow-400", label: "A run failed 4-5 runs ago" },
	green: { fill: "bg-emerald-500", label: "No failures in the last 5 runs" },
	none: { fill: "bg-white dark:bg-neutral-50", label: "No runs yet" },
	// Grey, not hollow: an unread/unreadable worker has to stay distinct from
	// the white "never ran" dot. Also the state before the first refresh lands.
	unknown: { fill: "bg-neutral-300 dark:bg-neutral-600", label: "Run history unavailable" },
};

export function WorkerStatusDot({ health }: { health?: RunHealth }) {
	const { fill, label } = DOT[health ?? "unknown"];
	return (
		<span
			role="img"
			aria-label={label}
			title={label}
			// The ring is what makes the white and unknown dots visible against
			// the panel; every dot carries it so they all read the same size.
			className={`mr-1.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full align-middle ring-1 ring-neutral-400/70 ${fill}`}
		/>
	);
}
