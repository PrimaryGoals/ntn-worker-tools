import { useEffect, useState } from "react";

// The API takes a non-negative integer, or null to clear the limit. An empty
// input is how the UI expresses null, so the dialog says so explicitly rather
// than leaving clearing undiscoverable.
export function AgentCreditLimitModal({
	agentName,
	currentLimit,
	submitting,
	error,
	onClose,
	onSubmit,
}: {
	agentName: string;
	// A number, null when unset, or "hidden" when the token can't read it.
	currentLimit: number | "hidden" | null;
	submitting: boolean;
	error: Error | null;
	onClose: () => void;
	onSubmit: (creditLimit: number | null) => void;
}) {
	const [value, setValue] = useState(
		typeof currentLimit === "number" ? String(currentLimit) : "",
	);

	useEffect(() => {
		const h = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		window.addEventListener("keydown", h);
		return () => window.removeEventListener("keydown", h);
	}, [onClose]);

	const trimmed = value.trim();
	const clearing = trimmed === "";
	const parsed = Number(trimmed);
	const isValid = clearing || (/^\d+$/.test(trimmed) && Number.isInteger(parsed) && parsed >= 0);
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
				aria-label="Set agent credit limit"
			>
				<div className="flex items-center justify-between border-b border-neutral-200 px-4 py-2 dark:border-neutral-800">
					<h2 className="text-sm font-semibold">Set Credit Limit</h2>
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
						if (canSubmit) onSubmit(clearing ? null : parsed);
					}}
				>
					<label className="text-sm">
						Credit limit for <span className="font-medium">{agentName}</span>
					</label>
					<div className="flex flex-col gap-1">
						<input
							type="text"
							inputMode="numeric"
							value={value}
							onChange={(e) => setValue(e.target.value)}
							placeholder="e.g. 100"
							autoFocus
							autoComplete="off"
							spellCheck={false}
							disabled={submitting}
							className="rounded border border-neutral-300 bg-white px-2 py-1 font-mono text-xs disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900"
						/>
						<div className="text-xs text-neutral-600 dark:text-neutral-400">
							Enter an empty value to clear the limit.
						</div>
						{currentLimit === "hidden" ? (
							<div className="text-xs text-amber-600 dark:text-amber-400">
								The current limit is hidden from this token — submitting will overwrite whatever
								is set.
							</div>
						) : (
							<div className="text-xs text-neutral-500">
								Currently:{" "}
								{typeof currentLimit === "number" ? currentLimit : "no limit set"}
							</div>
						)}
						{!isValid ? (
							<div className="text-xs text-red-600 dark:text-red-400">
								Must be a non-negative whole number, or empty to clear.
							</div>
						) : null}
					</div>
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
							{submitting ? "Saving…" : clearing ? "Clear limit" : "Set limit"}
						</button>
					</div>
				</form>
			</div>
		</div>
	);
}
