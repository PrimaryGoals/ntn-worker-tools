import type { GitStatusEntry } from "@ntn-worker-tools/shared";

export function FileList({
	files,
	workerPathRelToRoot,
	selected,
	onToggle,
}: {
	files: GitStatusEntry[];
	workerPathRelToRoot: string;
	selected: Set<string>;
	onToggle: (path: string, on: boolean) => void;
}) {
	// Standalone worker: no grouping, one flat list.
	if (!workerPathRelToRoot) {
		return (
			<ul className="divide-y divide-neutral-100 text-sm dark:divide-neutral-900">
				{files.map((f) => (
					<FileRow key={f.path} entry={f} checked={selected.has(f.path)} onToggle={onToggle} />
				))}
			</ul>
		);
	}
	// Monorepo: split into "this worker" and "elsewhere in repo".
	const prefix = `${workerPathRelToRoot}/`;
	const inside = files.filter((f) => f.path.startsWith(prefix));
	const outside = files.filter((f) => !f.path.startsWith(prefix));
	return (
		<div className="text-sm">
			<GroupHeader label={`This worker (${workerPathRelToRoot}/)`} count={inside.length} />
			{inside.length === 0 ? (
				<div className="px-3 py-1 text-xs text-neutral-500">No changes under this worker.</div>
			) : (
				<ul className="divide-y divide-neutral-100 dark:divide-neutral-900">
					{inside.map((f) => (
						<FileRow
							key={f.path}
							entry={f}
							checked={selected.has(f.path)}
							onToggle={onToggle}
							stripPrefix={prefix}
						/>
					))}
				</ul>
			)}
			<GroupHeader label="Elsewhere in repo" count={outside.length} />
			{outside.length === 0 ? (
				<div className="px-3 py-1 text-xs text-neutral-500">
					No other pending changes in the repo.
				</div>
			) : (
				<ul className="divide-y divide-neutral-100 dark:divide-neutral-900">
					{outside.map((f) => (
						<FileRow
							key={f.path}
							entry={f}
							checked={selected.has(f.path)}
							onToggle={onToggle}
						/>
					))}
				</ul>
			)}
		</div>
	);
}

function GroupHeader({ label, count }: { label: string; count: number }) {
	return (
		<div className="sticky top-0 z-10 border-b border-neutral-200 bg-neutral-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900">
			{label} <span className="font-normal text-neutral-400">({count})</span>
		</div>
	);
}

function FileRow({
	entry,
	checked,
	onToggle,
	stripPrefix,
}: {
	entry: GitStatusEntry;
	checked: boolean;
	onToggle: (path: string, on: boolean) => void;
	stripPrefix?: string;
}) {
	const displayPath =
		stripPrefix && entry.path.startsWith(stripPrefix)
			? entry.path.slice(stripPrefix.length)
			: entry.path;
	return (
		<li>
			<label className="flex cursor-pointer items-center gap-3 px-3 py-1 hover:bg-neutral-50 dark:hover:bg-neutral-900">
				<input
					type="checkbox"
					checked={checked}
					onChange={(e) => onToggle(entry.path, e.target.checked)}
				/>
				<span className="w-8 font-mono text-xs text-neutral-500">{entry.statusCode}</span>
				<span className="font-mono text-xs" title={entry.path}>
					{displayPath}
				</span>
			</label>
		</li>
	);
}
