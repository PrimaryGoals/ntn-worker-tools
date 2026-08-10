import { useEffect, useState } from "react";

const VALID_NAME_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function normalizeWorkerName(input: string): string {
	return input
		.toLowerCase()
		.trim()
		.replace(/\s+/g, "-")
		.replace(/[^a-z0-9-]/g, "");
}

function isValidWorkerName(name: string): boolean {
	return name.length > 0 && VALID_NAME_REGEX.test(name);
}

export function RenameWorkerModal({
	workerName,
	currentWorkerName,
	workerId,
	submitting,
	error,
	onClose,
	onSubmit,
	onRedeploy,
	success,
	successName,
}: {
	workerName: string;
	currentWorkerName: string;
	workerId: string;
	submitting: boolean;
	error: Error | null;
	onClose: () => void;
	onSubmit: (newName: string) => void;
	onRedeploy: () => void;
	success: boolean;
	successName?: string;
}) {
	const [newName, setNewName] = useState(currentWorkerName);
	const normalized = normalizeWorkerName(newName);
	const isValid = isValidWorkerName(normalized);

	useEffect(() => {
		const h = (e: KeyboardEvent) => {
			if (e.key === "Escape" && !success) onClose();
		};
		window.addEventListener("keydown", h);
		return () => window.removeEventListener("keydown", h);
	}, [onClose, success]);

	if (success) {
		return (
			<div
				className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
				role="presentation"
			>
				<div
					className="flex w-full max-w-lg flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-2xl dark:border-neutral-800 dark:bg-neutral-950"
					onClick={(e) => e.stopPropagation()}
					role="dialog"
					aria-modal="true"
					aria-label="Rename worker successful"
				>
					<div className="flex items-center justify-between border-b border-neutral-200 px-4 py-2 dark:border-neutral-800">
						<h2 className="text-sm font-semibold">Rename Complete</h2>
					</div>
					<div className="flex flex-col gap-3 p-4">
						<p className="text-sm">
							Worker <span className="font-medium">{workerName}</span> has been successfully
							renamed to <span className="font-medium">{successName}</span>.
						</p>
						<p className="text-xs text-neutral-600 dark:text-neutral-400">
							Would you like to redeploy the worker now?
						</p>
						<div className="flex justify-end gap-2">
							<button
								type="button"
								onClick={onClose}
								className="rounded border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900"
							>
								Close
							</button>
							<button
								type="button"
								onClick={() => {
									onClose();
									onRedeploy();
								}}
								disabled={submitting}
								className="rounded bg-neutral-900 px-3 py-1 text-sm text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
							>
								{submitting ? "Deploying…" : "Redeploy"}
							</button>
						</div>
					</div>
				</div>
			</div>
		);
	}

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
				aria-label="Rename worker"
			>
				<div className="flex items-center justify-between border-b border-neutral-200 px-4 py-2 dark:border-neutral-800">
					<h2 className="text-sm font-semibold">Rename Worker</h2>
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
						if (canSubmit) onSubmit(normalized);
					}}
				>
					<label className="text-sm">
						Enter new name for <span className="font-medium">{workerName}</span>
					</label>
					<div className="flex flex-col gap-1">
						<input
							type="text"
							value={newName}
							onChange={(e) => setNewName(e.target.value)}
							placeholder="new-worker-name"
							autoFocus
							autoComplete="off"
							spellCheck={false}
							disabled={submitting}
							className="rounded border border-neutral-300 bg-white px-2 py-1 font-mono text-xs disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900"
						/>
						{newName && !isValid && (
							<div className="text-xs text-red-600 dark:text-red-400">
								Name must contain only lowercase letters, numbers, and hyphens
							</div>
						)}
						{newName && isValid && normalized !== newName && (
							<div className="text-xs text-neutral-600 dark:text-neutral-400">
								Will be renamed to: <span className="font-mono">{normalized}</span>
							</div>
						)}
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
							{submitting ? "Renaming…" : "Rename"}
						</button>
					</div>
				</form>
			</div>
		</div>
	);
}
