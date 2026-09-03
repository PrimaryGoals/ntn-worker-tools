import { useEffect } from "react";

/**
 * Confirms a deploy from the Worker menu, replacing the plain window.confirm
 * those two items used to raise.
 *
 * A sync worker owns a managed database, so `ntn` stops to confirm before
 * deploying it — and that stop can't be answered here, because the CLI is
 * always spawned non-interactively. Deploying such a worker without `--yes`
 * therefore can't succeed; it only burns a build and returns exit 1. So the
 * flag isn't offered as a choice: it's implied by the worker having a sync,
 * and stated here so it isn't invisible. Not wanting it is the same decision
 * as not deploying, which is what Cancel is for.
 */
export function DeployConfirmModal({
	kind,
	workerName,
	localPath,
	isSyncWorker,
	submitting,
	onClose,
	onConfirm,
}: {
	// Which of the two menu items opened this — they run different commands and
	// carry different warnings.
	kind: "ntn" | "pnpm";
	workerName: string;
	localPath: string;
	// Drives whether `--yes` goes along, and the note explaining it.
	isSyncWorker: boolean;
	submitting: boolean;
	onClose: () => void;
	onConfirm: () => void;
}) {
	useEffect(() => {
		const h = (e: KeyboardEvent) => {
			if (e.key === "Escape" && !submitting) onClose();
		};
		window.addEventListener("keydown", h);
		return () => window.removeEventListener("keydown", h);
	}, [onClose, submitting]);

	const command = kind === "pnpm" ? "pnpm run deploy" : "ntn workers deploy";

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
			onClick={submitting ? undefined : onClose}
			role="presentation"
		>
			<div
				className="flex w-full max-w-lg flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-2xl dark:border-neutral-800 dark:bg-neutral-950"
				onClick={(e) => e.stopPropagation()}
				role="dialog"
				aria-modal="true"
				aria-label="Confirm deploy"
			>
				<div className="flex items-center justify-between border-b border-neutral-200 px-4 py-2 dark:border-neutral-800">
					<h2 className="text-sm font-semibold">
						Deploy <span className="font-normal text-neutral-500">({workerName})</span>
					</h2>
					<button
						type="button"
						onClick={onClose}
						disabled={submitting}
						className="rounded px-2 py-1 text-sm text-neutral-500 hover:bg-neutral-100 disabled:opacity-50 dark:hover:bg-neutral-900"
					>
						✕
					</button>
				</div>
				<div className="flex flex-col gap-3 p-4">
					<div className="flex flex-col gap-1">
						<div className="font-mono text-xs">
							{command}
							{isSyncWorker ? " --yes" : ""}
						</div>
						<div className="truncate font-mono text-[10px] text-neutral-500" title={localPath}>
							{localPath}
						</div>
					</div>
					<p className="text-xs text-neutral-600 dark:text-neutral-400">
						{kind === "pnpm"
							? "Runs whatever this project's package.json defines under scripts.deploy."
							: "Pushes local changes to Notion."}
					</p>
					{isSyncWorker ? (
						<p className="text-xs text-neutral-600 dark:text-neutral-400">
							This worker has a sync, so its managed database needs confirming —{" "}
							<span className="font-mono">--yes</span> is included, since the prompt can't be
							answered from here and the deploy would otherwise fail. If a schema migration is
							pending, this runs it.
						</p>
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
							type="button"
							onClick={onConfirm}
							disabled={submitting}
							className="rounded bg-neutral-900 px-3 py-1 text-sm text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
						>
							{submitting ? "Deploying…" : "Deploy"}
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}
