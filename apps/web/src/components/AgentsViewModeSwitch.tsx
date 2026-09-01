import type { AgentsViewMode } from "../hooks/useUIState";
import { formatDateTime } from "../format";

// Agent-side counterpart to RunsViewModeSwitch. Same three shapes as the
// worker switch — one selection, everything since the marker, and usage — so
// the two tabs read the same way even though their data doesn't merge.
export function AgentsViewModeSwitch({
	mode,
	onModeChange,
	markerTime,
	onAdjustTimeMarker,
}: {
	mode: AgentsViewMode;
	onModeChange: (mode: AgentsViewMode) => void;
	markerTime: string | null;
	onAdjustTimeMarker: () => void;
}) {
	return (
		<div className="flex items-center gap-3 text-[11px] font-normal normal-case tracking-normal text-neutral-600 dark:text-neutral-400">
			<label className="flex cursor-pointer items-center gap-1">
				<input
					type="radio"
					name="agentsViewMode"
					checked={mode === "agent"}
					onChange={() => onModeChange("agent")}
				/>
				Selected Agent
			</label>
			<label className="flex cursor-pointer items-center gap-1">
				<input
					type="radio"
					name="agentsViewMode"
					checked={mode === "crossAgent"}
					onChange={() => {
						onModeChange("crossAgent");
						if (!markerTime) onAdjustTimeMarker();
					}}
				/>
				All agents since{" "}
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
					name="agentsViewMode"
					checked={mode === "usage"}
					onChange={() => onModeChange("usage")}
				/>
				Usage
			</label>
		</div>
	);
}
