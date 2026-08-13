import { useState } from "react";

function toLocalDateTimeInputValue(date: Date): string {
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function AdjustTimeMarkerModal({
	currentMarkerTime,
	submitting,
	error,
	onClose,
	onSubmit,
}: {
	currentMarkerTime: string | null;
	submitting: boolean;
	error: Error | null;
	onClose: () => void;
	onSubmit: (isoTime: string) => void;
}) {
	const [value, setValue] = useState(() =>
		toLocalDateTimeInputValue(currentMarkerTime ? new Date(currentMarkerTime) : new Date()),
	);
	const nowValue = toLocalDateTimeInputValue(new Date());
	const parsed = value ? new Date(value) : null;
	const isValid = !!parsed && !isNaN(parsed.getTime()) && parsed.getTime() <= Date.now();
	const canSubmit = isValid && !submitting;

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
			onClick={onClose}
			role="presentation"
		>
			<div
				className="flex w-full max-w-lg flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-2xl dark:border-neutral-800 dark:bg-neutral-950"
				onClick={(e) => e.stopPropagation()}
				role="dialog"
				aria-modal="true"
				aria-label="Adjust time marker"
			>
				<div className="flex items-center justify-between border-b border-neutral-200 px-4 py-2 dark:border-neutral-800">
					<h2 className="text-sm font-semibold">Adjust Time Marker</h2>
					<button
						type="button"
						onClick={onClose}
						disabled={submitting}
						className="rounded px-2 py-1 text-sm text-neutral-500 hover:bg-neutral-100 disabled:opacity-50 dark:hover:bg-neutral-900"
					>
						✕
					</button>
				</div>
				<form
					className="flex flex-col gap-3 p-4"
					onSubmit={(e) => {
						e.preventDefault();
						if (canSubmit && parsed) onSubmit(parsed.toISOString());
					}}
				>
					<label className="text-sm">Select the new date and time (local time zone)</label>
					<input
						type="datetime-local"
						value={value}
						max={nowValue}
						onChange={(e) => setValue(e.target.value)}
						autoFocus
						disabled={submitting}
						className="rounded border border-neutral-300 bg-white px-2 py-1 font-mono text-xs disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900"
					/>
					{value && !isValid && (
						<div className="text-xs text-red-600 dark:text-red-400">
							Time marker must be set to a time in the past.
						</div>
					)}
					{error ? (
						<div className="text-xs text-red-600 dark:text-red-400">{error.message}</div>
					) : null}
					<div className="flex justify-end gap-2">
						<button
							type="button"
							onClick={onClose}
							disabled={submitting}
							className="rounded border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
						>
							Cancel
						</button>
						<button
							type="submit"
							disabled={!canSubmit}
							className="rounded bg-neutral-900 px-3 py-1 text-sm text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
						>
							{submitting ? "Saving…" : "Save"}
						</button>
					</div>
				</form>
			</div>
		</div>
	);
}
