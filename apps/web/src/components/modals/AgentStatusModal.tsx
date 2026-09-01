import { useEffect, useState } from "react";
import { AGENT_STATUS_VALUES, type AgentStatus } from "@ntn-worker-tools/shared";

export function AgentStatusModal({
	agentName,
	currentStatus,
	pauseReason,
	submitting,
	error,
	onClose,
	onSubmit,
}: {
	agentName: string;
	currentStatus: string;
	// Set by the platform when it paused the agent itself (credit limit, run
	// limit, repeated failures). Shown because re-activating such an agent may
	// be refused — the API only promises to re-enable agents disabled through it.
	pauseReason: string | null;
	submitting: boolean;
	error: Error | null;
	onClose: () => void;
	onSubmit: (status: AgentStatus) => void;
}) {
	const [status, setStatus] = useState<AgentStatus>(
		AGENT_STATUS_VALUES.includes(currentStatus as AgentStatus)
			? (currentStatus as AgentStatus)
			: "active",
	);

	useEffect(() => {
		const h = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		window.addEventListener("keydown", h);
		return () => window.removeEventListener("keydown", h);
	}, [onClose]);

	const unchanged = status === currentStatus;

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
				aria-label="Set agent status"
			>
				<div className="flex items-center justify-between border-b border-neutral-200 px-4 py-2 dark:border-neutral-800">
					<h2 className="text-sm font-semibold">Set Agent Status</h2>
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
						if (!submitting && !unchanged) onSubmit(status);
					}}
				>
					<label className="text-sm">
						Status for <span className="font-medium">{agentName}</span>
					</label>
					<select
						value={status}
						onChange={(e) => setStatus(e.target.value as AgentStatus)}
						disabled={submitting}
						autoFocus
						className="rounded border border-neutral-300 bg-white px-2 py-1 text-sm disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900"
					>
						{AGENT_STATUS_VALUES.map((value) => (
							<option key={value} value={value}>
								{value}
							</option>
						))}
					</select>
					<div className="text-xs text-neutral-500">
						Currently: {currentStatus}
						{unchanged ? " — pick a different value to apply a change." : ""}
					</div>
					{pauseReason ? (
						<div className="text-xs text-amber-600 dark:text-amber-400">
							This agent was paused by Notion ({pauseReason}). Re-activating through the API only
							works for agents disabled through the API, so this may be refused.
						</div>
					) : null}
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
							disabled={submitting || unchanged}
							className="rounded bg-neutral-900 px-3 py-1 text-sm text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
						>
							{submitting ? "Saving…" : `Set ${status}`}
						</button>
					</div>
				</form>
			</div>
		</div>
	);
}
