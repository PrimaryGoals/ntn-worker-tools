import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Panel as RPanel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import type { DeployResult, WebhookFireResult } from "@ntn-worker-tools/shared";
import { api } from "./api";
import { formatDateTime, formatDuration } from "./format";

export function App() {
	return (
		<SessionGate>
			<AppContent />
		</SessionGate>
	);
}

function SessionGate({ children }: { children: React.ReactNode }) {
	const qc = useQueryClient();
	const [manualToken, setManualToken] = useState("");
	// If the URL carries ?token=…, consume it once: log in, then clean the URL
	// so bookmarks and Referer headers never expose the secret. The consumed
	// flag prevents StrictMode's double-invoke from calling login twice.
	const [urlHandled, setUrlHandled] = useState(false);
	const urlToken = useMemo(() => {
		if (typeof window === "undefined") return null;
		const p = new URLSearchParams(window.location.search);
		return p.get("token");
	}, []);

	const login = useMutation({
		mutationFn: (token: string) => api.sessionLogin(token),
		onSuccess: () => {
			// Blow away any stale unauthenticated status result, then let the
			// next status fetch re-run against the freshly-set cookie.
			qc.invalidateQueries({ queryKey: ["sessionStatus"] });
		},
	});

	useEffect(() => {
		if (urlHandled) return;
		if (!urlToken) {
			setUrlHandled(true);
			return;
		}
		login.mutate(urlToken, {
			onSettled: () => {
				const url = new URL(window.location.href);
				url.searchParams.delete("token");
				window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
				setUrlHandled(true);
			},
		});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [urlToken, urlHandled]);

	const statusQ = useQuery({
		queryKey: ["sessionStatus"],
		queryFn: api.getSessionStatus,
		enabled: urlHandled,
		retry: false,
	});

	if (!urlHandled || statusQ.isLoading) {
		return (
			<div className="flex h-screen items-center justify-center text-sm text-neutral-500">
				Checking session…
			</div>
		);
	}

	if (statusQ.data?.authenticated) return <>{children}</>;

	const loginError =
		(login.error as Error | null) ?? (statusQ.error as Error | null) ?? null;

	return (
		<div className="flex h-screen items-center justify-center p-4">
			<div className="w-full max-w-md rounded-lg border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-950">
				<h1 className="text-lg font-semibold">Session required</h1>
				<p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
					Open the sign-in URL printed by your <code>pnpm dev</code> (or
					<code> pnpm dev:server</code>) terminal — it looks like{" "}
					<code className="font-mono text-xs">http://localhost:5173/?token=…</code>. Once
					you visit it, a cookie is set and this page will load normally. Bookmark
					<code> http://localhost:5173/</code> afterward.
				</p>
				<form
					className="mt-4 flex flex-col gap-2"
					onSubmit={(e) => {
						e.preventDefault();
						if (manualToken.trim()) login.mutate(manualToken.trim());
					}}
				>
					<label className="text-xs font-medium text-neutral-700 dark:text-neutral-300">
						Or paste the token directly:
					</label>
					<input
						type="password"
						value={manualToken}
						onChange={(e) => setManualToken(e.target.value)}
						placeholder="64-char hex token"
						className="rounded border border-neutral-300 bg-white px-2 py-1 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-900"
					/>
					<button
						type="submit"
						disabled={!manualToken.trim() || login.isPending}
						className="rounded bg-neutral-900 px-3 py-1 text-sm text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
					>
						{login.isPending ? "Signing in…" : "Sign in"}
					</button>
				</form>
				{loginError ? (
					<p className="mt-3 text-xs text-red-600 dark:text-red-400">
						{loginError.message}
					</p>
				) : null}
			</div>
		</div>
	);
}

function AppContent() {
	const qc = useQueryClient();
	const [selectedWorkerId, setSelectedWorkerId] = useState<string | null>(null);
	const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
	const [verboseLogs, setVerboseLogs] = useState(false);
	const [webhookResult, setWebhookResult] = useState<WebhookFireResult | null>(null);
	const [deployResult, setDeployResult] = useState<DeployResult | null>(null);
	const [gitCheckinOpen, setGitCheckinOpen] = useState(false);
	const [folderPickerOpen, setFolderPickerOpen] = useState(false);
	const [tokenPushOpen, setTokenPushOpen] = useState(false);

	const fireWebhook = useMutation({
		mutationFn: ({ url, webhookSecret }: { url: string; webhookSecret?: string }) =>
			api.fireWebhook(url, webhookSecret),
		onSuccess: (data) => {
			setWebhookResult(data);
			// The webhook we just fired triggers a worker run. Refresh the runs
			// query so the new entry shows up in panel_runs. Notion sometimes
			// hasn't recorded the run yet at the moment the fire returns, so we
			// also re-invalidate after a short delay to catch that late-arriving
			// entry (and its updated status once it finishes).
			if (selectedWorkerId) {
				const workerId = selectedWorkerId;
				qc.invalidateQueries({ queryKey: ["runs", workerId] });
				setTimeout(() => qc.invalidateQueries({ queryKey: ["runs", workerId] }), 2000);
			}
		},
	});

	const setLocalPath = useMutation({
		mutationFn: ({ workerId, path }: { workerId: string; path: string }) =>
			api.setWorkerLocalPath(workerId, path),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["config"] });
			// Only close the folder picker after the workerId-match check server-side
			// has accepted the path. On failure (e.g. worker mismatch) it stays open
			// so the user sees the inline error and can navigate somewhere else.
			setFolderPickerOpen(false);
		},
	});
	const clearLocalPath = useMutation({
		mutationFn: (workerId: string) => api.clearWorkerLocalPath(workerId),
		onSuccess: () => qc.invalidateQueries({ queryKey: ["config"] }),
	});
	const revealWorker = useMutation({
		mutationFn: api.revealWorker,
		onError: (err) => window.alert(`Reveal failed: ${(err as Error).message}`),
	});
	const deployWorker = useMutation({
		mutationFn: (workerId: string) => api.deployWorker(workerId, verboseLogs),
		onSuccess: (data) => setDeployResult(data),
	});
	const pnpmDeployWorker = useMutation({
		mutationFn: api.pnpmDeployWorker,
		onSuccess: (data) => setDeployResult(data),
	});
	const pushSecrets = useMutation({
		mutationFn: (workerId: string) => api.pushWorkerSecrets(workerId, verboseLogs),
		onSuccess: (data) => setDeployResult(data),
	});
	const setEnvVar = useMutation({
		mutationFn: ({ workerId, key, value }: { workerId: string; key: string; value: string }) =>
			api.setWorkerEnvVar(workerId, key, value, verboseLogs),
		onSuccess: (data) => {
			setDeployResult(data);
			setTokenPushOpen(false);
		},
	});
	const runningCommand = deployWorker.isPending
		? "ntn workers deploy"
		: pnpmDeployWorker.isPending
			? "pnpm run deploy"
			: pushSecrets.isPending
				? "ntn workers env push"
				: setEnvVar.isPending
					? "ntn workers env set"
					: null;
	const anyDeployError =
		(deployWorker.error as Error | null) ??
		(pnpmDeployWorker.error as Error | null) ??
		(pushSecrets.error as Error | null) ??
		(setEnvVar.error as Error | null);

	function clearTransientOutputs() {
		setWebhookResult(null);
		fireWebhook.reset();
		setDeployResult(null);
		deployWorker.reset();
		pnpmDeployWorker.reset();
		pushSecrets.reset();
		setEnvVar.reset();
	}

	const whoamiQ = useQuery({
		queryKey: ["whoami"],
		queryFn: () => api.getWhoami(true),
		retry: false,
	});
	const configQ = useQuery({ queryKey: ["config"], queryFn: api.getConfig });
	const persistedPanelSizes = configQ.data?.ui?.panelSizes ?? {};
	const savePanelSize = useMutation({
		mutationFn: (patch: Record<string, number>) =>
			api.updateUiConfig({ panelSizes: { ...persistedPanelSizes, ...patch } }),
		onSuccess: (config) => qc.setQueryData(["config"], config),
	});
	// Debounce onLayout — the library fires it many times per drag frame,
	// and each fire round-trips through the config-file writer on the server.
	const schedulePanelSave = useMemo(() => {
		let timer: ReturnType<typeof setTimeout> | null = null;
		let pending: Record<string, number> = {};
		return (patch: Record<string, number>) => {
			pending = { ...pending, ...patch };
			if (timer) clearTimeout(timer);
			timer = setTimeout(() => {
				savePanelSize.mutate(pending);
				pending = {};
			}, 250);
		};
		// savePanelSize.mutate is a stable reference from useMutation, so we can
		// safely close over the outer savePanelSize handle without a dep.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);
	const envInfoQ = useQuery({ queryKey: ["envInfo"], queryFn: api.getEnvInfo, staleTime: Infinity });
	const gitAvailable = envInfoQ.data?.gitAvailable ?? false;
	const localPath = selectedWorkerId
		? (configQ.data?.workerLocalPaths?.[selectedWorkerId] ?? null)
		: null;
	const localInfoQ = useQuery({
		queryKey: ["localInfo", selectedWorkerId, localPath],
		queryFn: () => api.getWorkerLocalInfo(selectedWorkerId!),
		enabled: !!(selectedWorkerId && localPath),
	});
	const hasDeployScript = localInfoQ.data?.hasDeployScript ?? false;
	const isGitRepo = localInfoQ.data?.isGitRepo ?? false;
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
	const sortedWorkers = useMemo(
		() =>
			[...(workersQ.data ?? [])].sort((a, b) =>
				a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
			),
		[workersQ.data],
	);

	return (
		<>
		<div className="flex h-screen flex-col">
			<MenuBar
				workspaceName={whoamiQ.data?.spaceName}
				userName={whoamiQ.data?.userName}
				loading={whoamiQ.isLoading}
				error={whoamiQ.error as Error | null}
				workerId={selectedWorkerId}
				workerName={
					workersQ.data?.find((w) => w.workerId === selectedWorkerId)?.name ?? null
				}
				localPath={localPath}
				hasDeployScript={hasDeployScript}
				gitAvailable={gitAvailable}
				isGitRepo={isGitRepo}
				setLocalPathError={friendlySetPathError(
					setLocalPath.error as Error | null,
					workersQ.data?.find((w) => w.workerId === selectedWorkerId)?.name ?? null,
				)}
				onSetLocalPath={() => {
					if (!selectedWorkerId) return;
					setLocalPath.reset();
					setFolderPickerOpen(true);
				}}
				onClearLocalPath={() => {
					if (!selectedWorkerId) return;
					if (window.confirm("Forget the local folder for this worker?")) {
						clearLocalPath.mutate(selectedWorkerId);
					}
				}}
				onReveal={() => {
					if (selectedWorkerId) revealWorker.mutate(selectedWorkerId);
				}}
				onNtnDeploy={() => {
					if (!selectedWorkerId || !localPath) return;
					if (
						window.confirm(
							`Deploy from ${localPath}?\nThis runs \`ntn workers deploy\` and pushes local changes to Notion.`,
						)
					) {
						clearTransientOutputs();
						deployWorker.mutate(selectedWorkerId);
					}
				}}
				onPnpmDeploy={() => {
					if (!selectedWorkerId || !localPath) return;
					if (
						window.confirm(
							`Run \`pnpm run deploy\` in ${localPath}?\nThis executes whatever the project's package.json defines under scripts.deploy.`,
						)
					) {
						clearTransientOutputs();
						pnpmDeployWorker.mutate(selectedWorkerId);
					}
				}}
				hasEnvFile={localInfoQ.data?.hasEnvFile ?? false}
				onPushSecrets={() => {
					if (!selectedWorkerId || !localPath) return;
					if (
						window.confirm(
							`Push .env from ${localPath} to this worker's remote environment on Notion?\nThis overwrites remote env vars.`,
						)
					) {
						clearTransientOutputs();
						pushSecrets.mutate(selectedWorkerId);
					}
				}}
				onOpenGitCheckin={() => setGitCheckinOpen(true)}
				onOpenTokenPush={() => {
					setEnvVar.reset();
					setTokenPushOpen(true);
				}}
			/>

			<PanelGroup
				direction="vertical"
				className="flex-1"
				onLayout={(sizes) => {
					if (sizes[0] !== undefined) schedulePanelSave({ topBottom: sizes[0] });
				}}
			>
				<RPanel defaultSize={persistedPanelSizes.topBottom ?? 50} minSize={20}>
					<PanelGroup
						direction="horizontal"
						onLayout={(sizes) => {
							if (sizes[0] !== undefined) schedulePanelSave({ workersRuns: sizes[0] });
						}}
					>
						<RPanel defaultSize={persistedPanelSizes.workersRuns ?? 30} minSize={15}>
							<div className="h-full p-2">
								<Panel title="Workers">
									<WorkersList
										loading={workersQ.isLoading}
										error={workersQ.error as Error | null}
										workers={sortedWorkers}
										selectedId={selectedWorkerId}
										localPaths={configQ.data?.workerLocalPaths ?? {}}
										onSelect={(id) => {
											setSelectedWorkerId(id);
											setSelectedRunId(null);
											clearTransientOutputs();
										}}
										onRevealPath={(id) => revealWorker.mutate(id)}
									/>
								</Panel>
							</div>
						</RPanel>
						<PanelResizeHandle className="w-1 cursor-col-resize bg-neutral-200 hover:bg-neutral-400 dark:bg-neutral-800 dark:hover:bg-neutral-600" />
						<RPanel defaultSize={100 - (persistedPanelSizes.workersRuns ?? 30)} minSize={30}>
							<div className="h-full p-2">
								<Panel title="Runs">
									{!selectedWorkerId ? (
										<BrandingSplash />
									) : (
										<RunsList
											loading={runsQ.isLoading}
											error={runsQ.error as Error | null}
											runs={runsQ.data?.runs ?? []}
											selectedId={selectedRunId}
											onSelect={(id) => {
												setSelectedRunId(id);
												clearTransientOutputs();
											}}
										/>
									)}
								</Panel>
							</div>
						</RPanel>
					</PanelGroup>
				</RPanel>
				<PanelResizeHandle className="h-1 cursor-row-resize bg-neutral-200 hover:bg-neutral-400 dark:bg-neutral-800 dark:hover:bg-neutral-600" />
				<RPanel defaultSize={100 - (persistedPanelSizes.topBottom ?? 50)} minSize={20}>
					<div className="flex h-full flex-col">
			<div className="flex gap-4 border-b border-neutral-200 bg-neutral-100 px-3 py-2 text-sm dark:border-neutral-800 dark:bg-neutral-900">
				<div className="flex flex-1 flex-col gap-1">
					{selectedWorkerId ? (
						<WebhookLine
							loading={webhooksQ.isLoading}
							error={webhooksQ.error as Error | null}
							webhooks={webhooksQ.data?.webhooks ?? []}
							onFire={(url) => {
								setWebhookResult(null);
								fireWebhook.mutate({
									url,
									// Extract WEBHOOK_SECRET from the already-loaded env pull output,
									// if present. Server will send it as an X-Webhook-Secret header.
									webhookSecret: extractWebhookSecret(envQ.data?.text ?? ""),
								});
							}}
							firing={
								fireWebhook.isPending ? fireWebhook.variables?.url ?? null : null
							}
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

			<div className="min-h-0 flex-1 bg-neutral-950 p-0">
				{runningCommand ? (
					<div className="p-3 text-sm text-neutral-400">Running {runningCommand}…</div>
				) : anyDeployError ? (
					<div className="p-3 text-sm text-red-400">
						Command failed: {anyDeployError.message}
					</div>
				) : deployResult ? (
					<OutputWithCommands
						commands={[deployResult.command]}
						body={formatDeployResult(deployResult)}
					/>
				) : fireWebhook.isPending ? (
					<div className="p-3 text-sm text-neutral-400">
						Firing POST to {fireWebhook.variables?.url}…
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
								<WorkerDetailsBody
									worker={workerQ.data}
									usage={workerUsageQ.data}
									envText={envQ.data.text}
								/>
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
			</RPanel>
		</PanelGroup>
		</div>
		{gitCheckinOpen && selectedWorkerId && localPath ? (
			<GitCheckinModal
				workerId={selectedWorkerId}
				localPath={localPath}
				onClose={() => setGitCheckinOpen(false)}
				onCommitted={(result) => {
					setGitCheckinOpen(false);
					clearTransientOutputs();
					setDeployResult(result);
				}}
			/>
		) : null}
			{tokenPushOpen && selectedWorkerId ? (
				<TokenPushModal
					workerName={
						workersQ.data?.find((w) => w.workerId === selectedWorkerId)?.name ?? "worker"
					}
					submitting={setEnvVar.isPending}
					error={setEnvVar.error as Error | null}
					onClose={() => setTokenPushOpen(false)}
					onSubmit={(token) => {
						clearTransientOutputs();
						setEnvVar.mutate({
							workerId: selectedWorkerId,
							key: "NOTION_API_TOKEN",
							value: token,
						});
					}}
				/>
			) : null}
			{folderPickerOpen && selectedWorkerId ? (
				<FolderPickerModal
					workerName={
						workersQ.data?.find((w) => w.workerId === selectedWorkerId)?.name ?? null
					}
					startPath={localPath}
					submitting={setLocalPath.isPending}
					error={friendlySetPathError(
						setLocalPath.error as Error | null,
						workersQ.data?.find((w) => w.workerId === selectedWorkerId)?.name ?? null,
					)}
					onClose={() => setFolderPickerOpen(false)}
					onResetError={() => setLocalPath.reset()}
					onSelect={(path) => {
						clearTransientOutputs();
						setLocalPath.mutate({ workerId: selectedWorkerId, path });
					}}
				/>
			) : null}
		</>
	);
}

function MenuBar({
	workspaceName,
	userName,
	loading,
	error,
	workerId,
	workerName,
	localPath,
	hasDeployScript,
	hasEnvFile,
	gitAvailable,
	isGitRepo,
	onSetLocalPath,
	onClearLocalPath,
	onReveal,
	onNtnDeploy,
	onPnpmDeploy,
	onPushSecrets,
	onOpenGitCheckin,
	onOpenTokenPush,
	setLocalPathError,
}: {
	workspaceName?: string;
	userName?: string;
	loading: boolean;
	error: Error | null;
	workerId: string | null;
	workerName: string | null;
	localPath: string | null;
	hasDeployScript: boolean;
	hasEnvFile: boolean;
	gitAvailable: boolean;
	isGitRepo: boolean;
	onSetLocalPath: () => void;
	onClearLocalPath: () => void;
	onReveal: () => void;
	onNtnDeploy: () => void;
	onPnpmDeploy: () => void;
	onPushSecrets: () => void;
	onOpenGitCheckin: () => void;
	onOpenTokenPush: () => void;
	setLocalPathError: Error | null;
}) {
	const [open, setOpen] = useState(false);
	const disabled = !workerId;
	return (
		<header className="flex items-center justify-between border-b border-neutral-200 bg-white px-4 py-2 dark:border-neutral-800 dark:bg-neutral-950">
			<div className="flex items-center gap-3">
				<h1 className="text-sm font-semibold">WIT for Notion</h1>
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
			<div className="relative">
				<button
					type="button"
					disabled={disabled}
					onClick={() => setOpen((v) => !v)}
					title={disabled ? "Select a worker first" : undefined}
					className={
						"rounded border px-2 py-1 text-xs " +
						(disabled
							? "cursor-not-allowed border-neutral-200 text-neutral-400 dark:border-neutral-800 dark:text-neutral-600"
							: "border-neutral-300 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900")
					}
				>
					Worker{workerName ? `: ${workerName}` : ""} ▾
				</button>
				{open && workerId ? (
					<div
						className="absolute right-0 top-full z-10 mt-1 w-64 rounded border border-neutral-200 bg-white shadow-lg dark:border-neutral-800 dark:bg-neutral-950"
						onMouseLeave={() => setOpen(false)}
					>
						<MenuItem
							label={localPath ? "Change local folder…" : "Set local folder…"}
							onClick={() => {
								setOpen(false);
								onSetLocalPath();
							}}
						/>
						<MenuItem
							label="Reveal in Explorer"
							disabled={!localPath}
							disabledReason="No local folder registered — use Set local folder… first."
							onClick={() => {
								setOpen(false);
								onReveal();
							}}
						/>
						<MenuItem
							label="ntn workers deploy"
							disabled={!localPath || hasDeployScript}
							disabledReason={
								!localPath
									? "Requires a registered local folder."
									: "This project defines scripts.deploy in package.json — use pnpm run deploy."
							}
							onClick={() => {
								setOpen(false);
								onNtnDeploy();
							}}
						/>
						<MenuItem
							label="pnpm run deploy"
							disabled={!localPath || !hasDeployScript}
							disabledReason={
								!localPath
									? "Requires a registered local folder."
									: "This project has no scripts.deploy in package.json — use ntn workers deploy."
							}
							onClick={() => {
								setOpen(false);
								onPnpmDeploy();
							}}
						/>
						<MenuItem
							label="push secrets to Notion"
							disabled={!localPath || !hasEnvFile}
							disabledReason={
								!localPath
									? "Requires a registered local folder."
									: "No .env file found in the registered local folder."
							}
							onClick={() => {
								setOpen(false);
								onPushSecrets();
							}}
						/>
						<MenuItem
							label="push NOTION_API_TOKEN"
							disabled={!!localPath}
							disabledReason="You have a local folder — use 'push secrets to Notion' to push all env vars from your .env file."
							onClick={() => {
								setOpen(false);
								onOpenTokenPush();
							}}
						/>
						<MenuItem
							label="local check-in"
							disabled={!localPath || !gitAvailable || !isGitRepo}
							disabledReason={
								!localPath
									? "Requires a registered local folder."
									: !gitAvailable
										? "git is not installed on this machine — install git to enable this."
										: "The registered local folder is not a git repository."
							}
							onClick={() => {
								setOpen(false);
								onOpenGitCheckin();
							}}
						/>
						{localPath ? (
							<>
								<div className="border-t border-neutral-200 dark:border-neutral-800" />
								<div
									className="px-3 py-1 font-mono text-[10px] text-neutral-500"
									title={localPath}
								>
									{localPath}
								</div>
								<MenuItem
									label="Forget local folder"
									onClick={() => {
										setOpen(false);
										onClearLocalPath();
									}}
								/>
							</>
						) : null}
						{setLocalPathError ? (
							<div className="border-t border-red-200 px-3 py-1 text-[11px] text-red-600 dark:border-red-900/40 dark:text-red-400">
								{setLocalPathError.message}
							</div>
						) : null}
					</div>
				) : null}
			</div>
		</header>
	);
}

function MenuItem({
	label,
	onClick,
	disabled,
	disabledReason,
}: {
	label: string;
	onClick: () => void;
	disabled?: boolean;
	disabledReason?: string;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			title={disabled ? disabledReason : undefined}
			className={
				"block w-full px-3 py-1.5 text-left text-sm " +
				(disabled
					? "cursor-not-allowed text-neutral-400 dark:text-neutral-600"
					: "hover:bg-neutral-100 dark:hover:bg-neutral-900")
			}
		>
			{label}
		</button>
	);
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
	return (
		<section className="flex h-full min-h-0 flex-col rounded border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
			<div className="border-b border-neutral-200 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:border-neutral-800">
				{title}
			</div>
			<div className="min-h-0 flex-1 overflow-auto">{children}</div>
		</section>
	);
}

function Empty({ children }: { children: React.ReactNode }) {
	return <div className="p-3 text-sm text-neutral-500">{children}</div>;
}

function BrandingSplash() {
	return (
		<div className="flex h-full min-h-0 flex-col items-center justify-center gap-6 overflow-auto p-6 text-center">
			<a
				href="https://PrimaryGoals.com"
				target="_blank"
				rel="noopener noreferrer"
				className="group flex flex-col items-center gap-2 transition-opacity hover:opacity-80"
				title="PrimaryGoals.com"
			>
				<img
					src="/images/primarygoals-logo.gif"
					alt="Primary Goals Marketing Automation"
				/>
				<span className="text-sm font-medium text-blue-600 group-hover:underline dark:text-blue-400">
					https://PrimaryGoals.com
				</span>
			</a>

			<div className="max-w-md">
				<h2 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">
					Worker Integration Testing
				</h2>
				<h2 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">
					for Notion
				</h2>
			</div>

			<div className="flex flex-wrap items-center justify-center gap-4">
				<img
					src="/images/Consulting%20Partner%20Badge.png"
					alt="Notion Consulting Partner"
					className="dark:rounded dark:bg-neutral-100 dark:p-1"
				/>
				<img
					src="/images/notion-certified-admin-204.png"
					alt="Notion Certified Admin"
					className="dark:rounded dark:bg-neutral-100 dark:p-1"
				/>
			</div>

			<p className="text-xs text-neutral-500">Select a worker to see its runs.</p>
		</div>
	);
}

function WorkersList({
	loading,
	error,
	workers,
	selectedId,
	localPaths,
	onSelect,
	onRevealPath,
}: {
	loading: boolean;
	error: Error | null;
	workers: import("@ntn-worker-tools/shared").Worker[];
	selectedId: string | null;
	localPaths: Record<string, string>;
	onSelect: (id: string) => void;
	onRevealPath: (id: string) => void;
}) {
	if (loading) return <Empty>Loading workers…</Empty>;
	if (error) return <div className="p-3 text-sm text-red-600">{error.message}</div>;
	if (workers.length === 0) return <Empty>No workers in this workspace.</Empty>;
	return (
		<ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
			{workers.map((w) => {
				const localPath = localPaths[w.workerId];
				const isSelected = selectedId === w.workerId;
				return (
					<li
						key={w.workerId}
						className={isSelected ? "bg-neutral-100 dark:bg-neutral-900" : ""}
					>
						<button
							type="button"
							onClick={() => onSelect(w.workerId)}
							className="block w-full px-3 pt-2 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-900"
						>
							<div>
								<span className="font-medium">{w.name}</span>
								<span className="font-mono text-xs text-neutral-500"> - {w.workerId}</span>
							</div>
						</button>
						{localPath ? (
							<button
								type="button"
								onClick={() => onRevealPath(w.workerId)}
								title={`Reveal ${localPath} in file explorer`}
								className="block w-full px-3 pb-2 text-left font-mono text-xs font-medium text-neutral-500 hover:text-blue-600 hover:underline dark:hover:text-blue-400"
							>
								{localPath}
							</button>
						) : (
							<div className="pb-2" />
						)}
					</li>
				);
			})}
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
	runs: import("@ntn-worker-tools/shared").Run[];
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
	body: React.ReactNode;
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

function formatWhoami(w: import("@ntn-worker-tools/shared").Whoami): string {
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

// Local-path row is highlighted; the rest is plain text.
function WorkerDetailsBody({
	worker: w,
	usage: u,
	envText,
}: {
	worker: import("@ntn-worker-tools/shared").Worker;
	usage: import("@ntn-worker-tools/shared").WorkerUsage;
	envText: string;
}) {
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
	const env = envText.trim() || "(no environment variables)";
	return (
		<>
			{rows.map(([label, value]) => `${label.padEnd(labelWidth)} ${value}\n`).join("")}
			{"\n"}
			{env}
		</>
	);
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
	webhooks: import("@ntn-worker-tools/shared").WebhookEntry[];
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

// Strip ANSI SGR escape codes (colors, dim, bold, etc.) so raw ntn output
// renders cleanly in a plain <pre>. eslint-disable is for the intentional
// control char in the regex.
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m/g;
function stripAnsi(s: string): string {
	return s.replace(ANSI_RE, "");
}

function formatDeployResult(r: DeployResult): string {
	const header = `cwd: ${r.cwd}\nexit ${r.exitCode}   (${r.durationMs} ms)`;
	const parts = [header];
	// Build progress (stderr) first — matches the order you'd see in a terminal.
	const stderr = stripAnsi(r.stderr).trim();
	if (stderr) parts.push(SEPARATOR, stderr);
	// If no --json summary is available, fall back to raw stdout in the same slot.
	if (!r.summary && r.stdout.trim()) {
		parts.push(SEPARATOR, stripAnsi(r.stdout).trimEnd());
	}
	// Summary last — this is the "✔ Worker updated / webhook URLs" section.
	if (r.summary) {
		const s = r.summary;
		const lines: string[] = [
			s.is_update ? "✔ Worker updated" : "✔ Worker created",
			`Worker ID:  ${s.worker_id}`,
		];
		if (s.capabilities.length) {
			lines.push("", "Capabilities:");
			for (const c of s.capabilities) lines.push(`  ${c._tag.padEnd(10)} ${c.key}`);
		}
		if (s.webhook_urls.length) {
			lines.push("", "Webhook URLs:");
			for (const w of s.webhook_urls) lines.push(`  ${w.key} → ${w.url}`);
		}
		if (s.database_links.length) {
			lines.push("", `Database links: ${s.database_links.length}`);
		}
		parts.push(SEPARATOR, lines.join("\n"));
	}
	// Followup command (e.g. env pull after env push) at the very bottom.
	if (r.followup) {
		const f = r.followup;
		const header = `${f.command}\nexit ${f.exitCode}   (${f.durationMs} ms)`;
		parts.push(SEPARATOR, header);
		const fStderr = stripAnsi(f.stderr).trim();
		if (fStderr) parts.push(fStderr);
		const fStdout = stripAnsi(f.stdout).trimEnd();
		if (fStdout) parts.push(fStdout);
	}
	return parts.join("\n");
}

// Read the WEBHOOK_SECRET value from a .env-style KEY=VALUE dump. Trims a
// trailing carriage return so Windows-shaped lines don't leak into the header.
function extractWebhookSecret(envText: string): string | undefined {
	const m = envText.match(/^WEBHOOK_SECRET=(.*)$/m);
	if (!m) return undefined;
	const v = m[1]?.replace(/\r$/, "") ?? "";
	return v || undefined;
}

function formatWebhookResult(r: WebhookFireResult): string {
	const lines = [
		`POST ${r.url}`,
		`Status: ${r.status} ${r.statusText}   (${r.durationMs} ms)`,
	];
	if (r.sentHeaders?.length) {
		for (const h of r.sentHeaders) lines.push(`Header sent: ${h}: (present)`);
	}
	const body = r.body?.length ? r.body : "(empty body)";
	return `${lines.join("\n")}\n${"─".repeat(60)}\n${body}`;
}

// Rewrites the raw server error into a friendlier message when we recognise
// the workerId-mismatch case. Any other error passes through unchanged.
function friendlySetPathError(
	err: Error | null,
	workerName: string | null,
): Error | null {
	if (!err) return null;
	if (err.message.startsWith("worker mismatch")) {
		const name = workerName ?? "the selected worker";
		return new Error(
			`The folder you chose appears to be for a different worker than ${name}.`,
		);
	}
	return err;
}

function TokenPushModal({
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

function FolderPickerModal({
	workerName,
	startPath,
	submitting,
	error,
	onClose,
	onResetError,
	onSelect,
}: {
	workerName: string | null;
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

	const canSelect = !!listingQ.data?.isWorkerProject;

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
						Choose a local worker folder{workerName ? ` for ${workerName}` : ""}
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
								canSelect
									? undefined
									: "Selectable only when the current folder contains workers.json"
							}
							className="rounded bg-neutral-900 px-3 py-1 text-sm text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
						>
							{submitting ? "Setting…" : "Select this folder"}
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}

// Join a directory path and a name into an absolute path preserving the
// separator style of `dir` (backslash on Windows-style paths, forward slash
// otherwise). Node's path.join isn't available in the browser bundle.
function joinPath(dir: string, name: string): string {
	const sep = dir.includes("\\") && !dir.startsWith("/") ? "\\" : "/";
	return dir.endsWith(sep) ? dir + name : dir + sep + name;
}

function FileList({
	files,
	workerPathRelToRoot,
	selected,
	onToggle,
}: {
	files: import("@ntn-worker-tools/shared").GitStatusEntry[];
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
	entry: import("@ntn-worker-tools/shared").GitStatusEntry;
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

function GitCheckinModal({
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
		onSuccess: onCommitted,
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
