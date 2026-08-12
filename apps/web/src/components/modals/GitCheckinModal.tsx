import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { DeployResult } from "@ntn-worker-tools/shared";
import { api } from "../../api";
import { FileList } from "./FileList";

export function GitCheckinModal({
	workerId,
	localPath,
	onClose,
	onCommitted,
}: {
	workerId: string;
	localPath: string;
	onClose: () => void;
	onCommitted: (result: DeployResult) => void;
}) {
	const qc = useQueryClient();
	const statusQ = useQuery({
		queryKey: ["gitStatus", workerId],
		queryFn: () => api.getGitStatus(workerId),
		retry: false,
	});
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [message, setMessage] = useState("");

	// Default: check files under the worker's own directory. In the standalone
	// case (worker path == repo root) that's everything; in a monorepo it's
	// only files inside the worker, so cross-worker changes aren't accidentally
	// swept into this commit.
	useEffect(() => {
		const d = statusQ.data;
		if (!d?.files) return;
		if (!d.workerPathRelToRoot) {
			setSelected(new Set(d.files.map((f) => f.path)));
			return;
		}
		const prefix = `${d.workerPathRelToRoot}/`;
		setSelected(new Set(d.files.filter((f) => f.path.startsWith(prefix)).map((f) => f.path)));
	}, [statusQ.data]);

	// Escape closes.
	useEffect(() => {
		const h = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		window.addEventListener("keydown", h);
		return () => window.removeEventListener("keydown", h);
	}, [onClose]);

	const commit = useMutation({
		mutationFn: () => api.gitCommit(workerId, [...selected], message),
		onSuccess: (result) => {
			// The files just committed were edited before this modal was even
			// opened, possibly after the last local-mtimes scan — rescan so the
			// out-of-date indicator reflects those edits without a browser refresh.
			qc.invalidateQueries({ queryKey: ["localMtimes"] });
			onCommitted(result);
		},
	});

	function toggle(path: string, on: boolean) {
		const s = new Set(selected);
		if (on) s.add(path);
		else s.delete(path);
		setSelected(s);
	}

	const canCommit =
		selected.size > 0 && message.trim().length > 0 && !commit.isPending && statusQ.data?.isGitRepo;

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
			onClick={onClose}
			onKeyDown={(e) => {
				if (e.key === "Escape") onClose();
			}}
			role="presentation"
		>
			<div
				className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-2xl dark:border-neutral-800 dark:bg-neutral-950"
				onClick={(e) => e.stopPropagation()}
				role="dialog"
				aria-modal="true"
				aria-label="Local check-in"
			>
				<div className="flex items-center justify-between border-b border-neutral-200 px-4 py-2 dark:border-neutral-800">
					<div>
						<h2 className="text-sm font-semibold">Local check-in</h2>
						<div className="font-mono text-[10px] text-neutral-500">{localPath}</div>
					</div>
					<button
						type="button"
						onClick={onClose}
						className="rounded px-2 py-1 text-sm text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-900"
					>
						✕
					</button>
				</div>

				{statusQ.isLoading ? (
					<div className="p-6 text-sm text-neutral-500">Loading git status…</div>
				) : statusQ.error ? (
					<div className="p-6 text-sm text-red-600 dark:text-red-400">
						{(statusQ.error as Error).message}
					</div>
				) : !statusQ.data?.isGitRepo ? (
					<div className="p-6 text-sm text-red-600 dark:text-red-400">
						Not a git repository at <span className="font-mono">{localPath}</span>.
					</div>
				) : statusQ.data.files.length === 0 ? (
					<div className="p-6 text-sm text-neutral-500">
						Nothing to commit — working tree clean.
					</div>
				) : (
					<>
						<div className="flex min-h-0 flex-1 flex-col overflow-hidden">
							<div className="border-b border-neutral-200 dark:border-neutral-800">
								<div className="max-h-48 overflow-auto">
									<FileList
										files={statusQ.data.files}
										workerPathRelToRoot={statusQ.data.workerPathRelToRoot}
										selected={selected}
										onToggle={toggle}
									/>
								</div>
							</div>
							<pre className="flex-1 overflow-auto bg-neutral-950 p-3 font-mono text-xs text-neutral-100">
								{statusQ.data.diff.trim() ||
									"(no diff to show — only untracked files, or the repo has no commits yet)"}
							</pre>
						</div>

						<div className="border-t border-neutral-200 p-3 dark:border-neutral-800">
							<textarea
								value={message}
								onChange={(e) => setMessage(e.target.value)}
								placeholder="Commit message"
								className="h-20 w-full resize-none rounded border border-neutral-300 bg-white p-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
							/>
							{commit.error ? (
								<div className="mt-1 text-xs text-red-600 dark:text-red-400">
									{(commit.error as Error).message}
								</div>
							) : null}
							<div className="mt-2 flex items-center justify-between">
								<div className="text-xs text-neutral-500">
									{selected.size} of {statusQ.data.files.length} file
									{statusQ.data.files.length === 1 ? "" : "s"} selected
								</div>
								<div className="flex gap-2">
									<button
										type="button"
										onClick={onClose}
										className="rounded border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900"
									>
										Cancel
									</button>
									<button
										type="button"
										disabled={!canCommit}
										onClick={() => commit.mutate()}
										className="rounded bg-neutral-900 px-3 py-1 text-sm text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
									>
										{commit.isPending
											? "Committing…"
											: `Commit ${selected.size} file${selected.size === 1 ? "" : "s"}`}
									</button>
								</div>
							</div>
						</div>
					</>
				)}
			</div>
		</div>
	);
}
