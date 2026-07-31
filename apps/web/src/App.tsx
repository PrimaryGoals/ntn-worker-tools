import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api } from "./api";
import { formatDateTime, formatDuration } from "./format";

export function App() {
	const [selectedWorkerId, setSelectedWorkerId] = useState<string | null>(null);
	const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
	const [verboseLogs, setVerboseLogs] = useState(false);

	const whoamiQ = useQuery({ queryKey: ["whoami"], queryFn: api.getWhoami, retry: false });
	const workersQ = useQuery({
		queryKey: ["workers"],
		queryFn: api.getWorkers,
		enabled: !!whoamiQ.data,
	});
	const runsQ = useQuery({
		queryKey: ["runs", selectedWorkerId],
		queryFn: () => api.getRuns(selectedWorkerId!),
		enabled: !!selectedWorkerId,
	});
	const logsQ = useQuery({
		queryKey: ["logs", selectedWorkerId, selectedRunId, verboseLogs],
		queryFn: () => api.getLogs(selectedWorkerId!, selectedRunId!, verboseLogs),
		enabled: !!(selectedWorkerId && selectedRunId),
	});

	const selectedRun = useMemo(
		() => runsQ.data?.runs.find((r) => r.runId === selectedRunId) ?? null,
		[runsQ.data, selectedRunId],
	);

	return (
		<div className="flex h-screen flex-col">
			<MenuBar
				workspaceName={whoamiQ.data?.spaceName}
				userName={whoamiQ.data?.userName}
				loading={whoamiQ.isLoading}
				error={whoamiQ.error as Error | null}
			/>

			<div className="grid flex-1 grid-cols-[minmax(240px,1fr)_2fr] gap-2 overflow-hidden p-2">
				<Panel title="Workers">
					<WorkersList
						loading={workersQ.isLoading}
						error={workersQ.error as Error | null}
						workers={workersQ.data ?? []}
						selectedId={selectedWorkerId}
						onSelect={(id) => {
							setSelectedWorkerId(id);
							setSelectedRunId(null);
						}}
					/>
				</Panel>

				<Panel title="Runs">
					{!selectedWorkerId ? (
						<Empty>Select a worker to see its runs.</Empty>
					) : (
						<RunsList
							loading={runsQ.isLoading}
							error={runsQ.error as Error | null}
							runs={runsQ.data?.runs ?? []}
							selectedId={selectedRunId}
							onSelect={setSelectedRunId}
						/>
					)}
				</Panel>
			</div>

			<div className="flex items-center gap-4 border-t border-neutral-200 bg-neutral-100 px-3 py-2 text-sm dark:border-neutral-800 dark:bg-neutral-900">
				<div className="flex flex-1 flex-wrap items-baseline gap-x-6 gap-y-1">
					{selectedRun ? (
						<>
							<span className="font-mono text-xs text-neutral-500">{selectedRun.runId}</span>
							<span className="font-medium">{selectedRun.name}</span>
							<span>
								<span className="text-neutral-500">Actor:</span> {selectedRun.actorName}
							</span>
							<span>
								<span className="text-neutral-500">Exit:</span>{" "}
								<ExitCodeBadge code={selectedRun.exitCode} />
							</span>
							<span>
								<span className="text-neutral-500">Started:</span>{" "}
								{formatDateTime(selectedRun.startedAt)}
							</span>
							<span>
								<span className="text-neutral-500">Duration:</span>{" "}
								{formatDuration(selectedRun.startedAt, selectedRun.endedAt)}
							</span>
						</>
					) : (
						<span className="text-neutral-500">Select a run to see its details.</span>
					)}
				</div>
				<label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-400">
					<input
						type="checkbox"
						checked={verboseLogs}
						onChange={(e) => setVerboseLogs(e.target.checked)}
					/>
					verbose
				</label>
			</div>

			<div className="h-[38vh] border-t border-neutral-200 bg-neutral-950 p-0 dark:border-neutral-800">
				{!selectedRunId ? (
					<div className="p-3 text-sm text-neutral-400">Select a run to load logs.</div>
				) : logsQ.isLoading ? (
					<div className="p-3 text-sm text-neutral-400">Fetching logs…</div>
				) : logsQ.error ? (
					<div className="p-3 text-sm text-red-400">{(logsQ.error as Error).message}</div>
				) : (
					<pre className="h-full overflow-auto whitespace-pre-wrap p-3 font-mono text-xs text-neutral-100">
						{logsQ.data?.logs || "(no output)"}
					</pre>
				)}
			</div>
		</div>
	);
}

function MenuBar({
	workspaceName,
	userName,
	loading,
	error,
}: {
	workspaceName?: string;
	userName?: string;
	loading: boolean;
	error: Error | null;
}) {
	return (
		<header className="flex items-center justify-between border-b border-neutral-200 bg-white px-4 py-2 dark:border-neutral-800 dark:bg-neutral-950">
			<div className="flex items-center gap-3">
				<h1 className="text-sm font-semibold">ntn-ui</h1>
				<span className="text-xs text-neutral-500">
					{loading
						? "checking auth…"
						: error
							? `not signed in — run \`ntn login\` in a terminal`
							: `${workspaceName} · ${userName}`}
				</span>
			</div>
		</header>
	);
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
	return (
		<section className="flex min-h-0 flex-col rounded border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
			<div className="border-b border-neutral-200 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:border-neutral-800">
				{title}
			</div>
			<div className="flex-1 overflow-auto">{children}</div>
		</section>
	);
}

function Empty({ children }: { children: React.ReactNode }) {
	return <div className="p-3 text-sm text-neutral-500">{children}</div>;
}

function WorkersList({
	loading,
	error,
	workers,
	selectedId,
	onSelect,
}: {
	loading: boolean;
	error: Error | null;
	workers: import("@ntn-ui/shared").Worker[];
	selectedId: string | null;
	onSelect: (id: string) => void;
}) {
	if (loading) return <Empty>Loading workers…</Empty>;
	if (error) return <div className="p-3 text-sm text-red-600">{error.message}</div>;
	if (workers.length === 0) return <Empty>No workers in this workspace.</Empty>;
	return (
		<ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
			{workers.map((w) => (
				<li key={w.workerId}>
					<button
						type="button"
						onClick={() => onSelect(w.workerId)}
						className={
							"block w-full px-3 py-2 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-900 " +
							(selectedId === w.workerId ? "bg-neutral-100 dark:bg-neutral-900" : "")
						}
					>
						<div className="font-medium">{w.name}</div>
						<div className="font-mono text-[10px] text-neutral-500">{w.workerId}</div>
					</button>
				</li>
			))}
		</ul>
	);
}

function RunsList({
	loading,
	error,
	runs,
	selectedId,
	onSelect,
}: {
	loading: boolean;
	error: Error | null;
	runs: import("@ntn-ui/shared").Run[];
	selectedId: string | null;
	onSelect: (id: string) => void;
}) {
	if (loading) return <Empty>Loading runs…</Empty>;
	if (error) return <div className="p-3 text-sm text-red-600">{error.message}</div>;
	if (runs.length === 0) return <Empty>No runs for this worker yet.</Empty>;
	return (
		<table className="w-full text-sm">
			<thead className="sticky top-0 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500 dark:bg-neutral-900">
				<tr>
					<th className="px-3 py-2 text-left">Name</th>
					<th className="px-3 py-2 text-left">Actor</th>
					<th className="px-3 py-2 text-left">Exit</th>
					<th className="px-3 py-2 text-left">Duration</th>
					<th className="px-3 py-2 text-left">Started</th>
				</tr>
			</thead>
			<tbody>
				{runs.map((r) => (
					<tr
						key={r.runId}
						onClick={() => onSelect(r.runId)}
						className={
							"cursor-pointer border-t border-neutral-100 hover:bg-neutral-50 dark:border-neutral-900 dark:hover:bg-neutral-900 " +
							(selectedId === r.runId ? "bg-neutral-100 dark:bg-neutral-900" : "")
						}
					>
						<td className="px-3 py-1.5 font-medium">{r.name}</td>
						<td className="px-3 py-1.5">{r.actorName}</td>
						<td className="px-3 py-1.5">
							<ExitCodeBadge code={r.exitCode} />
						</td>
						<td className="px-3 py-1.5 font-mono text-xs">
							{formatDuration(r.startedAt, r.endedAt)}
						</td>
						<td className="px-3 py-1.5 text-xs text-neutral-500">{formatDateTime(r.startedAt)}</td>
					</tr>
				))}
			</tbody>
		</table>
	);
}

function ExitCodeBadge({ code }: { code: number | null }) {
	if (code == null) {
		return (
			<span className="inline-block rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
				running
			</span>
		);
	}
	const ok = code === 0;
	return (
		<span
			className={
				"inline-block rounded px-1.5 py-0.5 font-mono text-xs " +
				(ok
					? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
					: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200")
			}
		>
			{code}
		</span>
	);
}
