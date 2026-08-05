import { useEffect, useState } from "react";

export function TokenPushModal({
	workerName,
	submitting,
	error,
	onClose,
	onSubmit,
}: {
	workerName: string;
	submitting: boolean;
	error: Error | null;
	onClose: () => void;
	onSubmit: (token: string) => void;
}) {
	const [token, setToken] = useState("");
	useEffect(() => {
		const h = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		window.addEventListener("keydown", h);
		return () => window.removeEventListener("keydown", h);
	}, [onClose]);
	const canSubmit = token.trim().length > 0 && !submitting;
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
				aria-label={`Push NOTION_API_TOKEN to ${workerName}`}
			>
				<div className="flex items-center justify-between border-b border-neutral-200 px-4 py-2 dark:border-neutral-800">
					<h2 className="text-sm font-semibold">Push NOTION_API_TOKEN</h2>
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
						if (canSubmit) onSubmit(token.trim());
					}}
				>
					<label className="text-sm">
						What NOTION_API_TOKEN should be pushed to{" "}
						<span className="font-medium">{workerName}</span>?
					</label>
					<input
						type="password"
						value={token}
						onChange={(e) => setToken(e.target.value)}
						placeholder="ntn_…"
						autoFocus
						autoComplete="off"
						spellCheck={false}
						className="rounded border border-neutral-300 bg-white px-2 py-1 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-900"
					/>
					{error ? (
						<div className="text-xs text-red-600 dark:text-red-400">
							{error.message}
						</div>
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
							{submitting ? "Pushing…" : "Push"}
						</button>
					</div>
				</form>
			</div>
		</div>
	);
}
