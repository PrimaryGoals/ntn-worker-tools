import { useEffect, useState } from "react";

export interface SyncPickerOption {
	key: string;
	// Schedule and paused state, shown under the key so a backfill (manual
	// schedule) is told apart from a delta without reading the source.
	detail: string;
	// Set when the action makes no sense for this sync right now (resuming one
	// that is running). The row stays visible but cannot be chosen.
	disabledReason?: string;
}

/**
 * Asks which sync an action applies to, for workers that declare more than
 * one. The menu items for pause/resume/reset/trigger all act on exactly one
 * sync capability, so with several there is nothing to default to.
 */
export function SyncPickerModal({
	title,
	workerName,
	confirmLabel,
	options,
	preselect,
	onClose,
	onPick,
}: {
	title: string;
	workerName: string;
	confirmLabel: string;
	options: SyncPickerOption[];
	// Whether the first usable row starts selected. Off for actions that are
	// slow or costly to start by accident (trigger, reset): the choice must be
	// made, not accepted by default.
	preselect: boolean;
	onClose: () => void;
	onPick: (key: string) => void;
}) {
	const [selected, setSelected] = useState<string | null>(
		preselect ? (options.find((o) => !o.disabledReason)?.key ?? null) : null,
	);

	useEffect(() => {
		const h = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		window.addEventListener("keydown", h);
		return () => window.removeEventListener("keydown", h);
	}, [onClose]);

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
				aria-label={title}
			>
				<div className="flex items-center justify-between border-b border-neutral-200 px-4 py-2 dark:border-neutral-800">
					<h2 className="text-sm font-semibold">
						{title} <span className="font-normal text-neutral-500">({workerName})</span>
					</h2>
					<button
						type="button"
						onClick={onClose}
						className="rounded px-2 py-1 text-sm text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-900"
					>
						✕
					</button>
				</div>
				<form
					className="flex flex-col gap-3 p-4"
					onSubmit={(e) => {
						e.preventDefault();
						if (selected) onPick(selected);
					}}
				>
					<p className="text-sm">This worker has several syncs. Which one?</p>
					<div className="flex flex-col gap-1" role="radiogroup" aria-label="Sync">
						{options.map((o) => (
							<label
								key={o.key}
								title={o.disabledReason}
								className={
									"flex items-start gap-2 rounded border border-neutral-200 p-2 dark:border-neutral-800 " +
									(o.disabledReason
										? "opacity-50"
										: "cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-900")
								}
							>
								<input
									type="radio"
									name="sync"
									className="mt-1"
									checked={selected === o.key}
									disabled={!!o.disabledReason}
									onChange={() => setSelected(o.key)}
								/>
								<span className="min-w-0">
									<span className="block truncate font-mono text-sm font-medium">{o.key}</span>
									<span className="block text-[11px] text-neutral-500">
										{o.disabledReason ?? o.detail}
									</span>
								</span>
							</label>
						))}
					</div>
					<div className="flex justify-end gap-2">
						<button
							type="button"
							onClick={onClose}
							className="rounded border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900"
						>
							Cancel
						</button>
						<button
							type="submit"
							disabled={!selected}
							className="rounded bg-neutral-900 px-3 py-1 text-sm text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
						>
							{selected ? `${confirmLabel} ${selected}` : confirmLabel}
						</button>
					</div>
				</form>
			</div>
		</div>
	);
}
