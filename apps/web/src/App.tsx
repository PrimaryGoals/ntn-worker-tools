import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import type { WebhookFireResult } from "@ntn-ui/shared";
import { api } from "./api";
import { formatDateTime, formatDuration } from "./format";

export function App() {
	const [selectedWorkerId, setSelectedWorkerId] = useState<string | null>(null);
	const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
	const [verboseLogs, setVerboseLogs] = useState(false);
	const [webhookResult, setWebhookResult] = useState<WebhookFireResult | null>(null);
	const fireWebhook = useMutation({
		mutationFn: api.fireWebhook,
		onSuccess: (data) => setWebhookResult(data),
	});

	function clearWebhookResult() {
		setWebhookResult(null);
		fireWebhook.reset();
	}

	const whoamiQ = useQuery({
		queryKey: ["whoami"],
		queryFn: () => api.getWhoami(true),
		retry: false,
	});
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
	const workerQ = useQuery({
		queryKey: ["worker", selectedWorkerId, verboseLogs],
		queryFn: () => api.getWorker(selectedWorkerId!, verboseLogs),
		enabled: !!selectedWorkerId,
	});
	const workerUsageQ = useQuery({
		queryKey: ["workerUsage", selectedWorkerId, verboseLogs],
		queryFn: () => api.getWorkerUsage(selectedWorkerId!, verboseLogs),
		enabled: !!selectedWorkerId,
	});
	const webhooksQ = useQuery({
		queryKey: ["webhooks", selectedWorkerId, verboseLogs],
		queryFn: () => api.getWorkerWebhooks(selectedWorkerId!, verboseLogs),
		enabled: !!selectedWorkerId,
	});
	const envQ = useQuery({
		queryKey: ["env", selectedWorkerId, verboseLogs],
		queryFn: () => api.getWorkerEnv(selectedWorkerId!, verboseLogs),
		enabled: !!selectedWorkerId,
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
							clearWebhookResult();
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
							onSelect={(id) => {
								setSelectedRunId(id);
								clearWebhookResult();
							}}
						/>
					)}
				</Panel>
			</div>

			<div className="flex gap-4 border-t border-neutral-200 bg-neutral-100 px-3 py-2 text-sm dark:border-neutral-800 dark:bg-neutral-900">
				<div className="flex flex-1 flex-col gap-1">
					{selectedWorkerId ? (
						<WebhookLine
							loading={webhooksQ.isLoading}
							error={webhooksQ.error as Error | null}
							webhooks={webhooksQ.data?.webhooks ?? []}
							onFire={(url) => {
								setWebhookResult(null);
								fireWebhook.mutate(url);
							}}
							firing={fireWebhook.isPending ? fireWebhook.variables ?? null : null}
						/>
					) : null}
					<div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
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
							<span className="text-neutral-500">
								{selectedWorkerId ? "Select a run to see its details." : "Select a worker."}
							</span>
						)}
					</div>
				</div>
				<label className="flex shrink-0 cursor-pointer items-center gap-1.5 self-start text-xs text-neutral-600 dark:text-neutral-400">
					<input
						type="checkbox"
						checked={verboseLogs}
						onChange={(e) => setVerboseLogs(e.target.checked)}
					/>
					verbose
				</label>
			</div>

			<div className="h-[38vh] border-t border-neutral-200 bg-neutral-950 p-0 dark:border-neutral-800">
				{fireWebhook.isPending ? (
					<div className="p-3 text-sm text-neutral-400">
						Firing POST to {fireWebhook.variables}…
					</div>
				) : fireWebhook.error ? (
					<div className="p-3 text-sm text-red-400">
						Webhook failed: {(fireWebhook.error as Error).message}
					</div>
				) : webhookResult ? (
					<pre className="h-full overflow-auto whitespace-pre-wrap p-3 font-mono text-xs text-neutral-100">
						{formatWebhookResult(webhookResult)}
					</pre>
				) : selectedRunId ? (
					logsQ.isLoading ? (
						<div className="p-3 text-sm text-neutral-400">Fetching logs…</div>
					) : logsQ.error ? (
						<div className="p-3 text-sm text-red-400">{(logsQ.error as Error).message}</div>
					) : (
						<OutputWithCommands
							commands={[
								ntnCmd([
									"workers",
									"runs",
									"logs",
									selectedRunId,
									"--worker-id",
									selectedWorkerId!,
									...(verboseLogs ? ["-v"] : []),
								]),
							]}
							trace={logsQ.data?._trace}
							body={logsQ.data?.logs || "(no output)"}
						/>
					)
				) : selectedWorkerId ? (
					workerQ.isLoading || workerUsageQ.isLoading || envQ.isLoading ? (
						<div className="p-3 text-sm text-neutral-400">
							Running ntn workers get / usage / env pull…
						</div>
					) : workerQ.error ? (
						<div className="p-3 text-sm text-red-400">{(workerQ.error as Error).message}</div>
					) : workerUsageQ.error ? (
						<div className="p-3 text-sm text-red-400">
							{(workerUsageQ.error as Error).message}
						</div>
					) : envQ.error ? (
						<div className="p-3 text-sm text-red-400">
							env pull failed: {(envQ.error as Error).message}
						</div>
					) : workerQ.data && workerUsageQ.data && envQ.data ? (
						<OutputWithCommands
							commands={[
								ntnCmd(["workers", "get", selectedWorkerId, ...(verboseLogs ? ["-v"] : [])]),
								ntnCmd(["workers", "usage", selectedWorkerId, ...(verboseLogs ? ["-v"] : [])]),
								ntnCmd([
									"workers",
									"webhooks",
									"list",
									selectedWorkerId,
									...(verboseLogs ? ["-v"] : []),
								]),
								ntnCmd([
									"workers",
									"env",
									"pull",
									selectedWorkerId,
									"--no-file",
									"--yes",
									...(verboseLogs ? ["-v"] : []),
								]),
							]}
							trace={[
								workerQ.data?._trace,
								workerUsageQ.data?._trace,
								webhooksQ.data?._trace,
								envQ.data?._trace,
							]
								.filter(Boolean)
								.join("\n")}
							body={
								formatWorkerDetails(workerQ.data, workerUsageQ.data) +
								"\n\n" +
								(envQ.data.text.trim() || "(no environment variables)")
							}
						/>
					) : (
						<div className="p-3 text-sm text-neutral-400">(no output)</div>
					)
				) : whoamiQ.data ? (
					<OutputWithCommands
						commands={[ntnCmd(["whoami", "-v"])]}
						trace={whoamiQ.data._trace}
						body={formatWhoami(whoamiQ.data)}
					/>
				) : whoamiQ.error ? (
					<div className="p-3 text-sm text-red-400">{(whoamiQ.error as Error).message}</div>
				) : (
					<div className="p-3 text-sm text-neutral-400">Loading whoami…</div>
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
				<span
					className={
						"text-xs " +
						(error ? "text-red-600 dark:text-red-400" : "text-neutral-500")
					}
				>
					{loading
						? "checking auth…"
						: error
							? "not signed in — run `ntn login` in a terminal"
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

function ntnCmd(args: string[]): string {
	return `ntn ${args.join(" ")}`;
}

const SEPARATOR = "─".repeat(60);

function OutputWithCommands({
	commands,
	trace,
	body,
}: {
	commands: string[];
	trace?: string;
	body: string;
}) {
	const traceText = trace?.trim() ?? "";
	return (
		<pre className="h-full overflow-auto whitespace-pre-wrap p-3 font-mono text-xs text-neutral-100">
			<span className="text-red-400">{commands.join("\n")}</span>
			{"\n"}
			<span className="text-neutral-500">{SEPARATOR}</span>
			{"\n"}
			{body}
			{traceText ? (
				<>
					{"\n"}
					<span className="text-neutral-500">{SEPARATOR}</span>
					{"\n"}
					<span className="text-neutral-500">{traceText}</span>
				</>
			) : null}
		</pre>
	);
}

function formatBytes(n: number): string {
	if (!Number.isFinite(n)) return String(n);
	if (n < 1024) return `${n} B`;
	const units = ["KB", "MB", "GB", "TB"];
	let v = n / 1024;
	let i = 0;
	while (v >= 1024 && i < units.length - 1) {
		v /= 1024;
		i++;
	}
	return `${v.toFixed(v < 10 ? 2 : 1)} ${units[i]} (${n.toLocaleString()} B)`;
}

function formatMs(ms: number): string {
	if (!Number.isFinite(ms)) return String(ms);
	if (ms < 1000) return `${ms.toLocaleString()} ms`;
	const s = ms / 1000;
	if (s < 60) return `${s.toFixed(2)} s (${ms.toLocaleString()} ms)`;
	const m = Math.floor(s / 60);
	const rs = (s - m * 60).toFixed(1);
	return `${m}m ${rs}s (${ms.toLocaleString()} ms)`;
}

function formatWhoami(w: import("@ntn-ui/shared").Whoami): string {
	const rows: Array<[string, string]> = [
		["User", w.userName],
		["User ID", w.userId],
		["User type", w.userType],
	];
	if (w.userEmail) rows.push(["Email", w.userEmail]);
	rows.push(["Workspace", w.spaceName], ["Space ID", w.spaceId]);
	if (w.ownerName) rows.push(["Owner", w.ownerName]);
	if (w.ownerId) rows.push(["Owner ID", w.ownerId]);
	if (w.ownerType) rows.push(["Owner type", w.ownerType]);
	const labelWidth = rows.reduce((m, [l]) => Math.max(m, l.length), 0);
	return rows.map(([label, value]) => `${label.padEnd(labelWidth)} ${value}`).join("\n");
}

function formatWorkerDetails(
	w: import("@ntn-ui/shared").Worker,
	u: import("@ntn-ui/shared").WorkerUsage,
): string {
	const rows: Array<[string, string]> = [
		["ID", w.workerId],
		["Name", w.name],
		["Space ID", w.spaceId],
		["Created at", formatDateTime(w.createdAt)],
		["Updated at", formatDateTime(w.updatedAt)],
		["Updated by", w.updatedByName ?? ""],
		["Usage window", `${u.days} day${u.days === 1 ? "" : "s"}`],
		["Credits", u.usage.credits.toFixed(6)],
		["Sandboxes", u.usage.sandboxCount.toLocaleString()],
		["Active CPU", formatMs(u.usage.activeCpuDurationMs)],
		["Total time", formatMs(u.usage.durationMs)],
		["Ingress", formatBytes(u.usage.networkIngressBytes)],
		["Egress", formatBytes(u.usage.networkEgressBytes)],
	];
	const labelWidth = rows.reduce((m, [l]) => Math.max(m, l.length), 0);
	return rows.map(([label, value]) => `${label.padEnd(labelWidth)} ${value}`).join("\n");
}

function WebhookLine({
	loading,
	error,
	webhooks,
	onFire,
	firing,
}: {
	loading: boolean;
	error: Error | null;
	webhooks: import("@ntn-ui/shared").WebhookEntry[];
	onFire: (url: string) => void;
	firing: string | null;
}) {
	if (loading) {
		return <div className="text-xs text-neutral-500">Loading webhooks…</div>;
	}
	if (error) {
		return <div className="text-xs text-red-600">Webhooks: {error.message}</div>;
	}
	if (webhooks.length === 0) {
		return <div className="text-xs text-neutral-500">No webhooks for this worker.</div>;
	}
	return (
		<div className="flex flex-col gap-0.5 text-xs">
			{webhooks.map((w) => {
				const isFiring = firing === w.url;
				return (
					<div key={w.key} className="flex items-baseline gap-2">
						<span className="text-neutral-500">Webhook ({w.key}):</span>
						<a
							href={w.url}
							onClick={(e) => {
								e.preventDefault();
								if (!isFiring) onFire(w.url);
							}}
							className={
								"truncate font-mono hover:underline " +
								(isFiring
									? "text-neutral-400 dark:text-neutral-500"
									: "text-blue-600 dark:text-blue-400")
							}
							title={`POST ${w.url}\n(right-click to copy the URL)`}
						>
							{w.url}
						</a>
						{isFiring ? <span className="text-neutral-500">POSTing…</span> : null}
					</div>
				);
			})}
		</div>
	);
}

function formatWebhookResult(r: WebhookFireResult): string {
	const header = `POST ${r.url}\nStatus: ${r.status} ${r.statusText}   (${r.durationMs} ms)`;
	const body = r.body?.length ? r.body : "(empty body)";
	return `${header}\n${"─".repeat(60)}\n${body}`;
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
