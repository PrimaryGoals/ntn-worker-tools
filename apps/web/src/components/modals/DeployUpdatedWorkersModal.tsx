import { useEffect, useRef, useState } from "react";
import type { DeployResult, Worker } from "@ntn-worker-tools/shared";

interface WorkerAction {
	redeploy: boolean;
	pushSecrets: boolean;
}

// Matches the NDJSON events written by POST /api/workers/batch-actions.
type BatchEvent =
	| { type: "chunk"; text: string }
	| { type: "done"; exitCode: number; durationMs: number };

// Replaces the old auto-detected "deploy updated workers" confirm() dialog.
// Shows every worker with a registered local folder, lets the user review
// and override which get redeployed and/or have secrets pushed, then
// streams output live as each action completes instead of going silent
// until the whole batch finishes — this fetches the batch-actions endpoint
// directly (not through the shared api.ts/useMutation plumbing), since that
// helper only supports one-shot JSON responses, not a growing stream.
export function DeployUpdatedWorkersModal({
	workers,
	localPaths,
	codeOutOfDateWorkerIds,
	envOutOfDateWorkerIds,
	verbose,
	onClose,
	onFinished,
}: {
	workers: Worker[];
	localPaths: Record<string, string>;
	codeOutOfDateWorkerIds: Set<string>;
	envOutOfDateWorkerIds: Set<string>;
	verbose: boolean;
	onClose: () => void;
	// Called once the stream completes (success or per-action failure — this
	// only rejects for a genuine request/network failure), so the caller can
	// still surface the result in the app's normal output panel after close.
	onFinished: (result: DeployResult) => void;
}) {
	// Only workers with a registered local folder can be redeployed or have
	// secrets pushed — nothing to offer for the rest, so they're left out.
	const eligible = workers.filter((w) => !!localPaths[w.workerId]);

	const [actions, setActions] = useState<Record<string, WorkerAction>>(() => {
		const initial: Record<string, WorkerAction> = {};
		for (const w of eligible) {
			const redeploy = codeOutOfDateWorkerIds.has(w.workerId);
			// Redeploying forces secrets along with it, same as the live toggle
			// below — keeps the prepopulated state consistent with that rule.
			const pushSecrets = redeploy || envOutOfDateWorkerIds.has(w.workerId);
			initial[w.workerId] = { redeploy, pushSecrets };
		}
		return initial;
	});

	const [submitting, setSubmitting] = useState(false);
	const [output, setOutput] = useState("");
	const [error, setError] = useState<Error | null>(null);
	const [finished, setFinished] = useState<{ exitCode: number } | null>(null);
	const outputRef = useRef<HTMLPreElement>(null);
	const started = submitting || finished !== null;

	// Auto-scroll the output pane as new chunks arrive.
	useEffect(() => {
		if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight;
	}, [output]);

	useEffect(() => {
		const h = (e: KeyboardEvent) => {
			if (e.key === "Escape" && !submitting) onClose();
		};
		window.addEventListener("keydown", h);
		return () => window.removeEventListener("keydown", h);
	}, [onClose, submitting]);

	function toggleRedeploy(workerId: string, checked: boolean) {
		setActions((prev) => ({
			...prev,
			[workerId]: {
				redeploy: checked,
				// Checking redeploy forces secrets checked and locks it (see the
				// disabled= on the checkbox below). Unchecking redeploy just
				// unlocks the secrets checkbox again — it stays whatever it was.
				pushSecrets: checked ? true : (prev[workerId]?.pushSecrets ?? false),
			},
		}));
	}

	function togglePushSecrets(workerId: string, checked: boolean) {
		setActions((prev) => ({
			...prev,
			[workerId]: { redeploy: prev[workerId]?.redeploy ?? false, pushSecrets: checked },
		}));
	}

	const sortByName = (a: Worker, b: Worker) =>
		a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
	const needsUpdate = eligible
		.filter((w) => codeOutOfDateWorkerIds.has(w.workerId) || envOutOfDateWorkerIds.has(w.workerId))
		.sort(sortByName);
	const upToDate = eligible
		.filter((w) => !codeOutOfDateWorkerIds.has(w.workerId) && !envOutOfDateWorkerIds.has(w.workerId))
		.sort(sortByName);

	const values = Object.values(actions);
	const redeployCount = values.filter((a) => a.redeploy).length;
	const secretsCount = values.filter((a) => a.pushSecrets).length;
	const selectedCount = values.filter((a) => a.redeploy || a.pushSecrets).length;
	const allRedeployChecked = eligible.length > 0 && redeployCount === eligible.length;
	const someRedeployChecked = redeployCount > 0 && !allRedeployChecked;
	const allSecretsChecked = eligible.length > 0 && secretsCount === eligible.length;
	const someSecretsChecked = secretsCount > 0 && !allSecretsChecked;
	const selectAllRedeployRef = useRef<HTMLInputElement>(null);
	const selectAllSecretsRef = useRef<HTMLInputElement>(null);
	useEffect(() => {
		if (selectAllRedeployRef.current) selectAllRedeployRef.current.indeterminate = someRedeployChecked;
	}, [someRedeployChecked]);
	useEffect(() => {
		if (selectAllSecretsRef.current) selectAllSecretsRef.current.indeterminate = someSecretsChecked;
	}, [someSecretsChecked]);

	function toggleAllRedeploy(checked: boolean) {
		setActions((prev) => {
			const next = { ...prev };
			for (const w of eligible) {
				const current = next[w.workerId] ?? { redeploy: false, pushSecrets: false };
				// Same rule as the per-row checkbox: checking forces + locks
				// secrets true; unchecking just unlocks it, leaving it as-is.
				next[w.workerId] = { redeploy: checked, pushSecrets: checked ? true : current.pushSecrets };
			}
			return next;
		});
	}

	function toggleAllSecrets(checked: boolean) {
		setActions((prev) => {
			const next = { ...prev };
			for (const w of eligible) {
				const current = next[w.workerId] ?? { redeploy: false, pushSecrets: false };
				// Unchecking "select all" can't override the lock: a worker with
				// redeploy checked keeps secrets forced true regardless.
				next[w.workerId] = { ...current, pushSecrets: checked || current.redeploy };
			}
			return next;
		});
	}

	function renderRow(w: Worker) {
		const a = actions[w.workerId] ?? { redeploy: false, pushSecrets: false };
		return (
			<li key={w.workerId} className="flex items-center gap-3 px-3 py-1.5 text-sm">
				<label className="flex items-center gap-1.5" title="Redeploy this worker's code">
					<input
						type="checkbox"
						checked={a.redeploy}
						onChange={(e) => toggleRedeploy(w.workerId, e.target.checked)}
					/>
					<span className="text-[10px] text-neutral-500">code</span>
				</label>
				<label className="flex items-center gap-1.5" title="Push this worker's .env secrets">
					<input
						type="checkbox"
						checked={a.pushSecrets}
						disabled={a.redeploy}
						title={a.redeploy ? "Included automatically because redeploy is checked." : undefined}
						onChange={(e) => togglePushSecrets(w.workerId, e.target.checked)}
					/>
					<span className="text-[10px] text-neutral-500">secrets</span>
				</label>
				<span className="flex-1 truncate">{w.name}</span>
				{codeOutOfDateWorkerIds.has(w.workerId) ? (
					<span className="text-[10px] font-medium text-red-600 dark:text-red-400">code</span>
				) : null}
				{envOutOfDateWorkerIds.has(w.workerId) ? (
					<span className="text-[10px] font-medium text-amber-600 dark:text-amber-400">secrets</span>
				) : null}
			</li>
		);
	}

	async function handleSubmit() {
		const list = eligible
			.map((w) => ({
				workerId: w.workerId,
				name: w.name,
				...(actions[w.workerId] ?? { redeploy: false, pushSecrets: false }),
			}))
			.filter((a) => a.redeploy || a.pushSecrets);
		if (list.length === 0) {
			onClose();
			return;
		}

		setSubmitting(true);
		setOutput("");
		setError(null);
		setFinished(null);

		let accumulated = "";
		let exitCode = 0;
		let durationMs = 0;
		try {
			const res = await fetch(`/api/workers/batch-actions${verbose ? "?verbose=1" : ""}`, {
				method: "POST",
				credentials: "same-origin",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ actions: list }),
			});
			if (!res.ok || !res.body) {
				const text = await res.text().catch(() => "");
				throw new Error(text || `${res.status} ${res.statusText}`);
			}
			const reader = res.body.getReader();
			const decoder = new TextDecoder();
			let buffer = "";
			for (;;) {
				const { value, done: streamDone } = await reader.read();
				if (streamDone) break;
				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split("\n");
				buffer = lines.pop() ?? "";
				for (const line of lines) {
					if (!line.trim()) continue;
					const event = JSON.parse(line) as BatchEvent;
					if (event.type === "chunk") {
						accumulated += (accumulated ? "\n" : "") + event.text;
						setOutput(accumulated);
					} else {
						exitCode = event.exitCode;
						durationMs = event.durationMs;
					}
				}
			}
			setFinished({ exitCode });
			onFinished({
				command: "deploy / push secrets",
				cwd: "",
				exitCode,
				stdout: accumulated,
				stderr: "",
				durationMs,
			});
		} catch (err) {
			setError(err instanceof Error ? err : new Error(String(err)));
		} finally {
			setSubmitting(false);
		}
	}

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
			onClick={submitting ? undefined : onClose}
			role="presentation"
		>
			<div
				className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-2xl dark:border-neutral-800 dark:bg-neutral-950"
				onClick={(e) => e.stopPropagation()}
				role="dialog"
				aria-modal="true"
				aria-label="Deploy / push secrets"
			>
				<div className="flex items-center justify-between border-b border-neutral-200 px-4 py-2 dark:border-neutral-800">
					<h2 className="text-sm font-semibold">Deploy / push secrets</h2>
					{!submitting ? (
						<button
							type="button"
							onClick={onClose}
							className="rounded px-2 py-1 text-sm text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-900"
						>
							✕
						</button>
					) : null}
				</div>

				{!started ? (
					<div className="min-h-0 flex-1 overflow-auto">
						{eligible.length === 0 ? (
							<div className="p-4 text-sm text-neutral-500">
								No workers have a registered local folder.
							</div>
						) : (
							<>
								<div className="flex items-center gap-3 border-b border-neutral-100 px-3 py-1.5 text-xs text-neutral-500 dark:border-neutral-900">
									<label className="flex items-center gap-1.5">
										<input
											ref={selectAllRedeployRef}
											type="checkbox"
											checked={allRedeployChecked}
											onChange={(e) => toggleAllRedeploy(e.target.checked)}
										/>
										select all code
									</label>
									<label className="flex items-center gap-1.5">
										<input
											ref={selectAllSecretsRef}
											type="checkbox"
											checked={allSecretsChecked}
											onChange={(e) => toggleAllSecrets(e.target.checked)}
										/>
										select all secrets
									</label>
								</div>
								<ul className="divide-y divide-neutral-100 dark:divide-neutral-900">
									{needsUpdate.map(renderRow)}
									{needsUpdate.length > 0 && upToDate.length > 0 ? (
										<li>
											<div className="border-t-2 border-neutral-300 dark:border-neutral-700" />
										</li>
									) : null}
									{upToDate.map(renderRow)}
								</ul>
							</>
						)}
					</div>
				) : (
					<pre
						ref={outputRef}
						className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap bg-neutral-950 p-3 font-mono text-xs text-neutral-100"
					>
						{output || "Starting…"}
					</pre>
				)}

				{error ? (
					<div className="border-t border-red-200 px-4 py-2 text-xs text-red-600 dark:border-red-900/40 dark:text-red-400">
						{error.message}
					</div>
				) : null}

				<div className="flex items-center justify-between border-t border-neutral-200 px-4 py-2 dark:border-neutral-800">
					<span className="text-xs text-neutral-500">
						{!started
							? `${redeployCount} to redeploy, ${secretsCount} to push secrets`
							: submitting
								? "Working…"
								: finished?.exitCode === 0
									? "Done."
									: "Done, with errors — see output above."}
					</span>
					<div className="flex gap-2">
						<button
							type="button"
							onClick={onClose}
							disabled={submitting}
							className="rounded border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
						>
							{started ? "Close" : "Cancel"}
						</button>
						{!started ? (
							<button
								type="button"
								disabled={selectedCount === 0}
								onClick={handleSubmit}
								className="rounded bg-neutral-900 px-3 py-1 text-sm text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
							>
								{`Apply to ${selectedCount} worker${selectedCount === 1 ? "" : "s"}`}
							</button>
						) : null}
					</div>
				</div>
			</div>
		</div>
	);
}
