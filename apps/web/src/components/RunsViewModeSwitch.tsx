import type { RunsViewMode } from "../hooks/useUIState";
import { formatDateTime } from "../format";

export function RunsViewModeSwitch({
	mode,
	onModeChange,
	markerTime,
	onAdjustTimeMarker,
}: {
	mode: RunsViewMode;
	onModeChange: (mode: RunsViewMode) => void;
	markerTime: string | null;
	onAdjustTimeMarker: () => void;
}) {
	return (
		<div className="flex items-center gap-3 text-[11px] font-normal normal-case tracking-normal text-neutral-600 dark:text-neutral-400">
			<label className="flex cursor-pointer items-center gap-1">
				<input
					type="radio"
					name="runsViewMode"
					checked={mode === "worker"}
					onChange={() => onModeChange("worker")}
				/>
				Selected Worker
			</label>
			<label className="flex cursor-pointer items-center gap-1">
				<input
					type="radio"
					name="runsViewMode"
					checked={mode === "crossWorker"}
					onChange={() => {
						onModeChange("crossWorker");
						if (!markerTime) onAdjustTimeMarker();
					}}
				/>
				All workers since{" "}
				<button
					type="button"
					onClick={(e) => {
						e.stopPropagation();
						onAdjustTimeMarker();
					}}
					className="text-blue-600 underline hover:no-underline dark:text-blue-400"
				>
					{markerTime ? formatDateTime(markerTime) : "Select"}
				</button>
			</label>
			<label className="flex cursor-pointer items-center gap-1">
				<input
					type="radio"
					name="runsViewMode"
					checked={mode === "usage"}
					onChange={() => onModeChange("usage")}
				/>
				Usage
			</label>
		</div>
	);
}
