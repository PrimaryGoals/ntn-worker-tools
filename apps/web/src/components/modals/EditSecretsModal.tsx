import { useEffect, useMemo, useState } from "react";
import { parseEnvText } from "../../format";

// Left to its own "push NOTION_API_TOKEN" menu item.
const HIDDEN_KEYS = new Set(["NOTION_API_TOKEN"]);

interface Row {
	key: string;
	original: string;
	value: string;
	deleted: boolean;
}

export interface SecretChanges {
	set: Array<{ key: string; value: string }>;
	unset: string[];
}

// Edits are held here and only handed to onSave when Save is pressed; Cancel
// (or Escape, or a click outside) discards them.
export function EditSecretsModal({
	workerName,
	envText,
	loading,
	loadError,
	submitting,
	error,
	onClose,
	onSave,
}: {
	workerName: string;
	envText: string | undefined;
	loading: boolean;
	loadError: Error | null;
	submitting: boolean;
	error: string | null;
	onClose: () => void;
	onSave: (changes: SecretChanges) => void;
}) {
	const [rows, setRows] = useState<Row[] | null>(null);
	// Built once, from the first read that finishes after opening: a refetch
	// after a failed save must not throw away what is still being edited.
	useEffect(() => {
		if (rows !== null || loading || envText === undefined) return;
		setRows(
			parseEnvText(envText)
				.filter((v) => !HIDDEN_KEYS.has(v.key))
				.map((v) => ({ key: v.key, original: v.value, value: v.value, deleted: false })),
		);
	}, [rows, loading, envText]);

	useEffect(() => {
		const h = (e: KeyboardEvent) => {
			if (e.key === "Escape" && !submitting) onClose();
		};
		window.addEventListener("keydown", h);
		return () => window.removeEventListener("keydown", h);
	}, [onClose, submitting]);

	const changes = useMemo<SecretChanges>(() => {
		const list = rows ?? [];
		return {
			unset: list.filter((r) => r.deleted).map((r) => r.key),
			set: list
				.filter((r) => !r.deleted && r.value !== r.original)
				.map((r) => ({ key: r.key, value: r.value })),
		};
	}, [rows]);
	const emptyKeys = changes.set.filter((s) => s.value === "").map((s) => s.key);
	const changeCount = changes.set.length + changes.unset.length;
	const canSave = changeCount > 0 && emptyKeys.length === 0 && !submitting;

	function update(key: string, patch: Partial<Row>) {
		setRows((prev) => prev?.map((r) => (r.key === key ? { ...r, ...patch } : r)) ?? prev);
	}

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
			onClick={() => {
				if (!submitting) onClose();
			}}
			role="presentation"
		>
			<div
				className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-2xl dark:border-neutral-800 dark:bg-neutral-950"
				onClick={(e) => e.stopPropagation()}
				role="dialog"
				aria-modal="true"
				aria-label={`Edit secrets for ${workerName}`}
			>
				<div className="flex items-center justify-between border-b border-neutral-200 px-4 py-2 dark:border-neutral-800">
					<h2 className="text-sm font-semibold">Edit Secrets — {workerName}</h2>
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
					className="flex min-h-0 flex-col gap-3 p-4"
					onSubmit={(e) => {
						e.preventDefault();
						if (canSave) onSave(changes);
					}}
				>
					<div className="rounded border border-amber-500 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200">
						You will be changing LIVE secrets. Your local .env remains untouched.
					</div>
					<div className="flex min-h-0 flex-col gap-2 overflow-y-auto">
						{loadError ? (
							<div className="text-xs text-red-600 dark:text-red-400">
								Could not read this worker's variables: {loadError.message}
							</div>
						) : rows === null ? (
							<div className="text-xs text-neutral-500">Loading secrets…</div>
						) : rows.length === 0 ? (
							<div className="text-xs text-neutral-500">This worker has no variables set.</div>
						) : (
							rows.map((r) => {
								const edited = !r.deleted && r.value !== r.original;
								return (
									<div key={r.key} className="flex items-center gap-2">
										<span
											className={
												"w-48 shrink-0 truncate font-mono text-xs " +
												(r.deleted ? "text-neutral-400 line-through" : "")
											}
											title={r.key}
										>
											{r.key}
										</span>
										<input
											type="text"
											value={r.value}
											disabled={r.deleted || submitting}
											onChange={(e) => update(r.key, { value: e.target.value })}
											autoComplete="off"
											spellCheck={false}
											className={
												"min-w-0 flex-1 rounded border bg-white px-2 py-1 font-mono text-xs disabled:opacity-50 dark:bg-neutral-900 " +
												(edited
													? "border-amber-500"
													: "border-neutral-300 dark:border-neutral-700")
											}
										/>
										<button
											type="button"
											disabled={submitting}
											onClick={() => update(r.key, { deleted: !r.deleted })}
											title={r.deleted ? `Keep ${r.key}` : `Delete ${r.key}`}
											aria-label={r.deleted ? `Keep ${r.key}` : `Delete ${r.key}`}
											className="shrink-0 rounded p-1 text-neutral-500 hover:bg-neutral-100 hover:text-red-600 disabled:opacity-50 dark:hover:bg-neutral-900"
										>
											{r.deleted ? (
												<span className="px-1 text-xs">undo</span>
											) : (
												<svg
													xmlns="http://www.w3.org/2000/svg"
													viewBox="0 0 24 24"
													fill="none"
													stroke="currentColor"
													strokeWidth="2"
													strokeLinecap="round"
													strokeLinejoin="round"
													className="h-4 w-4"
													aria-hidden="true"
												>
													<path d="M3 6h18" />
													<path d="M8 6V4h8v2" />
													<path d="M19 6l-1 14H6L5 6" />
													<path d="M10 11v6M14 11v6" />
												</svg>
											)}
										</button>
									</div>
								);
							})
						)}
					</div>
					{emptyKeys.length > 0 ? (
						<div className="text-xs text-amber-700 dark:text-amber-500">
							A value cannot be empty ({emptyKeys.join(", ")}) — delete the variable instead.
						</div>
					) : null}
					{error ? (
						<pre className="whitespace-pre-wrap text-xs text-red-600 dark:text-red-400">{error}</pre>
					) : null}
					<div className="flex items-center justify-between gap-2">
						<span className="text-xs text-neutral-500">
							{changeCount === 0
								? "No changes"
								: `${changes.set.length} to set, ${changes.unset.length} to delete`}
						</span>
						<div className="flex gap-2">
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
								disabled={!canSave}
								className="rounded bg-neutral-900 px-3 py-1 text-sm text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
							>
								{submitting ? "Saving…" : "Save"}
							</button>
						</div>
					</div>
				</form>
			</div>
		</div>
	);
}
