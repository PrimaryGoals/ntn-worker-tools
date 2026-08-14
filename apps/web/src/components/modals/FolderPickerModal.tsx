import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "../../api";

// Join a directory path and a name into an absolute path preserving the
// separator style of `dir` (backslash on Windows-style paths, forward slash
// otherwise). Node's path.join isn't available in the browser bundle.
function joinPath(dir: string, name: string): string {
	const sep = dir.includes("\\") && !dir.startsWith("/") ? "\\" : "/";
	return dir.endsWith(sep) ? dir + name : dir + sep + name;
}

export function FolderPickerModal({
	workerName,
	title,
	selectLabel,
	requireWorkerProject = true,
	startPath,
	submitting,
	error,
	onClose,
	onResetError,
	onSelect,
}: {
	workerName: string | null;
	// Overrides the default "Choose a local worker folder" heading — useful
	// when the folder being picked isn't (yet) a registered worker.
	title?: string;
	selectLabel?: string;
	// When false, any directory can be selected, not just ones containing
	// workers.json — for flows (like deploying a fresh copy) that start from
	// a folder that has never been deployed.
	requireWorkerProject?: boolean;
	startPath: string | null;
	submitting: boolean;
	error: Error | null;
	onClose: () => void;
	onResetError: () => void;
	onSelect: (path: string) => void;
}) {
	const [currentPath, setCurrentPath] = useState<string | null>(startPath);
	const [pathInput, setPathInput] = useState<string>(startPath ?? "");

	// Fetch the user's home dir if we weren't given a start path.
	const homeQ = useQuery({
		queryKey: ["fsHome"],
		queryFn: api.getFsHome,
		enabled: currentPath === null,
		staleTime: Infinity,
	});
	useEffect(() => {
		if (currentPath === null && homeQ.data?.path) {
			setCurrentPath(homeQ.data.path);
			setPathInput(homeQ.data.path);
		}
	}, [currentPath, homeQ.data]);

	const listingQ = useQuery({
		queryKey: ["fsListing", currentPath],
		queryFn: () => api.getFsListing(currentPath!),
		enabled: !!currentPath,
	});

	// Escape to close.
	useEffect(() => {
		const h = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		window.addEventListener("keydown", h);
		return () => window.removeEventListener("keydown", h);
	}, [onClose]);

	function navigate(newPath: string) {
		setCurrentPath(newPath);
		setPathInput(newPath);
		// Clear any prior submit error — the user has picked a different target,
		// so keeping the old "wrong worker" message on screen is confusing.
		onResetError();
	}

	const canSelect = requireWorkerProject ? !!listingQ.data?.isWorkerProject : !!listingQ.data;

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
			onClick={onClose}
			role="presentation"
		>
			<div
				className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-2xl dark:border-neutral-800 dark:bg-neutral-950"
				onClick={(e) => e.stopPropagation()}
				role="dialog"
				aria-modal="true"
				aria-label="Choose local worker folder"
			>
				<div className="flex items-center justify-between border-b border-neutral-200 px-4 py-2 dark:border-neutral-800">
					<h2 className="text-sm font-semibold">
						{title ?? `Choose a local worker folder${workerName ? ` for ${workerName}` : ""}`}
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
					className="flex gap-2 border-b border-neutral-200 p-2 dark:border-neutral-800"
					onSubmit={(e) => {
						e.preventDefault();
						if (pathInput.trim()) navigate(pathInput.trim());
					}}
				>
					<button
						type="button"
						title="Up one level"
						disabled={!listingQ.data?.parent}
						onClick={() => listingQ.data?.parent && navigate(listingQ.data.parent)}
						className="rounded border border-neutral-300 px-2 py-1 text-xs disabled:opacity-50 dark:border-neutral-700"
					>
						↑
					</button>
					<input
						type="text"
						value={pathInput}
						onChange={(e) => setPathInput(e.target.value)}
						placeholder="Type or paste an absolute path"
						className="flex-1 rounded border border-neutral-300 bg-white px-2 py-1 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-900"
					/>
					<button
						type="submit"
						className="rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900"
					>
						Go
					</button>
				</form>

				<div className="flex min-h-0 flex-1 flex-col overflow-hidden">
					{listingQ.isLoading ? (
						<div className="p-4 text-sm text-neutral-500">Loading…</div>
					) : listingQ.error ? (
						<div className="p-4 text-sm text-red-600 dark:text-red-400">
							{(listingQ.error as Error).message}
						</div>
					) : listingQ.data ? (
						<div className="flex-1 overflow-auto">
							{listingQ.data.entries.length === 0 ? (
								<div className="p-4 text-sm text-neutral-500">
									(no subdirectories here)
								</div>
							) : (
								<ul className="divide-y divide-neutral-100 dark:divide-neutral-900">
									{listingQ.data.entries.map((entry) => (
										<li key={entry.name}>
											<button
												type="button"
												onClick={() =>
													navigate(joinPath(listingQ.data!.path, entry.name))
												}
												className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-900"
											>
												<span aria-hidden="true">📁</span>
												<span className="flex-1 font-mono text-xs">{entry.name}</span>
												{entry.isWorkerProject ? (
													<span
														className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
														title="Contains workers.json"
													>
														worker
													</span>
												) : null}
											</button>
										</li>
									))}
								</ul>
							)}
						</div>
					) : null}
				</div>

				<div className="border-t border-neutral-200 p-3 dark:border-neutral-800">
					<div className="mb-2 text-xs">
						{listingQ.data?.isWorkerProject ? (
							<span className="text-emerald-700 dark:text-emerald-400">
								✓ This folder contains workers.json — ready to select.
							</span>
						) : !requireWorkerProject && listingQ.data ? (
							<span className="text-neutral-600 dark:text-neutral-400">
								No workers.json here — this folder has never been deployed.
							</span>
						) : listingQ.data ? (
							<span className="text-red-600 dark:text-red-400">
								No workers.json here — navigate into a worker project directory.
							</span>
						) : null}
					</div>
					{error ? (
						<div className="mb-2 text-xs text-red-600 dark:text-red-400">
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
							type="button"
							disabled={!canSelect || !currentPath || submitting}
							onClick={() => currentPath && onSelect(currentPath)}
							title={
								canSelect || !requireWorkerProject
									? undefined
									: "Selectable only when the current folder contains workers.json"
							}
							className="rounded bg-neutral-900 px-3 py-1 text-sm text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
						>
							{submitting ? "Setting…" : (selectLabel ?? "Select this folder")}
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}
