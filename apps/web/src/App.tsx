import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Panel as RPanel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { api } from "./api";
import { BrandingSplash } from "./components/ui/BrandingSplash";
import { CommandOutputList, OutputWithCommands } from "./components/ui/CommandOutput";
import { ExitCodeBadge } from "./components/ui/ExitCodeBadge";
import { Empty, Panel } from "./components/ui/Panel";
import { MenuBar } from "./components/MenuBar";
import { FolderPickerModal } from "./components/modals/FolderPickerModal";
import { GitCheckinModal } from "./components/modals/GitCheckinModal";
import { RenameWorkerModal } from "./components/modals/RenameWorkerModal";
import { TokenPushModal } from "./components/modals/TokenPushModal";
import { RunsList } from "./components/RunsList";
import { WebhookLine } from "./components/WebhookLine";
import { WorkerDetailsBody } from "./components/WorkerDetailsBody";
import { WorkersList } from "./components/WorkersList";
import { useCommandMutations } from "./hooks/useCommandMutations";
import { useConfigMutations } from "./hooks/useConfigMutations";
import { useUIState } from "./hooks/useUIState";
import { useWebhookMutations } from "./hooks/useWebhookMutations";
import { useWorkerData } from "./hooks/useWorkerData";
import {
	extractWebhookSecret,
	formatCapabilities,
	formatDateTime,
	formatDeployResult,
	formatDuration,
	formatSyncStatuses,
	formatWebhookResult,
	formatWebhookUrls,
	formatWhoami,
	formatWorkerUsage,
	friendlySetPathError,
	ntnCmd,
	SEPARATOR,
} from "./format";

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
	const {
		selectedWorkerId,
		setSelectedWorkerId,
		selectedRunId,
		setSelectedRunId,
		verboseLogs,
		setVerboseLogs,
		gitCheckinOpen,
		setGitCheckinOpen,
		folderPickerOpen,
		setFolderPickerOpen,
		tokenPushOpen,
		setTokenPushOpen,
		renameWorkerOpen,
		setRenameWorkerOpen,
	} = useUIState();
	const [renamedWorkerName, setRenamedWorkerName] = useState<string | null>(null);
	const {
		deployWorker,
		pnpmDeployWorker,
		pushSecrets,
		setEnvVar,
		syncTrigger,
		syncPause,
		syncResume,
		syncStateReset,
		deployResult,
		setDeployResult,
		syncStatusFollowup,
		runningCommand,
		anyDeployError,
		resetAll: resetCommandMutations,
	} = useCommandMutations(verboseLogs, selectedWorkerId, setTokenPushOpen);
	const { fireWebhook, webhookResult, setWebhookResult, runLogsFollowup, resetWebhookResult } =
		useWebhookMutations(selectedWorkerId, verboseLogs);

	function clearTransientOutputs() {
		resetWebhookResult();
		resetCommandMutations();
	}

	const {
		whoamiQ,
		configQ,
		persistedPanelSizes,
		envInfoQ,
		gitAvailable,
		localPath,
		localInfoQ,
		hasDeployScript,
		isGitRepo,
		workersQ,
		runsQ,
		logsQ,
		workerQ,
		workerUsageQ,
		webhooksQ,
		capabilitiesQ,
		envQ,
		selectedRun,
		sortedWorkers,
		syncCapabilities,
		isSyncWorker,
		syncStatusQ,
	} = useWorkerData(selectedWorkerId, selectedRunId, verboseLogs);
	const { setLocalPath, clearLocalPath, revealWorker, renameWorker, savePanelSize, schedulePanelSave } =
		useConfigMutations(setFolderPickerOpen, persistedPanelSizes);

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
				onRenameWorker={() => {
					renameWorker.reset();
					setRenameWorkerOpen(true);
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
				isSyncWorker={isSyncWorker}
				onSyncPause={() => {
					if (!selectedWorkerId || !syncCapabilities[0]) return;
					if (window.confirm("Pause sync for this worker?")) {
						clearTransientOutputs();
						syncPause.mutate({ workerId: selectedWorkerId, syncKey: syncCapabilities[0].key });
					}
				}}
				onSyncResume={() => {
					if (!selectedWorkerId || !syncCapabilities[0]) return;
					clearTransientOutputs();
					syncResume.mutate({ workerId: selectedWorkerId, syncKey: syncCapabilities[0].key });
				}}
				onSyncStateReset={() => {
					if (!selectedWorkerId || !syncCapabilities[0]) return;
					if (window.confirm("Reset sync state for this worker?\nThis clears the sync cursor so the next run processes from scratch.")) {
						clearTransientOutputs();
						syncStateReset.mutate({ workerId: selectedWorkerId, syncKey: syncCapabilities[0].key });
					}
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
									webhookSecret: extractWebhookSecret(envQ.data?.text ?? ""),
								});
							}}
							firing={
								fireWebhook.isPending ? fireWebhook.variables?.url ?? null : null
							}
							syncCapabilities={syncCapabilities}
							onSyncTrigger={(syncKey: string) => {
								if (selectedWorkerId) syncTrigger.mutate({ workerId: selectedWorkerId, syncKey });
							}}
							syncTriggering={syncTrigger.isPending}
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
				) : deployResult && syncStatusFollowup?.state === "done" ? (
					<CommandOutputList
						items={[
							{ command: deployResult.command, output: formatDeployResult(deployResult) },
							{
								command: syncStatusFollowup.command,
								output: syncStatusFollowup.output,
								trace: syncStatusFollowup.trace,
							},
						]}
					/>
				) : deployResult ? (
					<OutputWithCommands
						commands={[deployResult.command]}
						body={
							syncStatusFollowup?.state === "pending"
								? `${formatDeployResult(deployResult)}\n\nstand by to check worker status...`
								: formatDeployResult(deployResult)
						}
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
					<OutputWithCommands
						commands={[webhookResult.command]}
						trace={webhookResult._trace}
						body={
							<>
								{formatWebhookResult(webhookResult)}
								{runLogsFollowup?.state === "polling" ? (
									"\n\nstand by, waiting for run to complete..."
								) : runLogsFollowup?.state === "timeout" ? (
									"\n\nGave up waiting for the run to complete after 5 minutes."
								) : runLogsFollowup?.state === "done" ? (
									<>
										{"\n\n"}
										<span className="text-red-400">{runLogsFollowup.command}</span>
										{"\n"}
										<span className="text-neutral-500">{SEPARATOR}</span>
										{"\n"}
										{runLogsFollowup.output}
										{runLogsFollowup.trace ? (
											<>
												{"\n"}
												<span className="text-neutral-500">{SEPARATOR}</span>
												{"\n"}
												<span className="text-neutral-500">{runLogsFollowup.trace.trim()}</span>
											</>
										) : null}
									</>
								) : null}
							</>
						}
					/>
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
					workerQ.isLoading || workerUsageQ.isLoading || capabilitiesQ.isLoading || envQ.isLoading ? (
						<div className="p-3 text-sm text-neutral-400">
							Running ntn workers get / usage / capabilities / env pull…
						</div>
					) : workerQ.error ? (
						<div className="p-3 text-sm text-red-400">{(workerQ.error as Error).message}</div>
					) : workerUsageQ.error ? (
						<div className="p-3 text-sm text-red-400">
							{(workerUsageQ.error as Error).message}
						</div>
					) : capabilitiesQ.error ? (
						<div className="p-3 text-sm text-red-400">
							{(capabilitiesQ.error as Error).message}
						</div>
					) : envQ.error ? (
						<div className="p-3 text-sm text-red-400">
							env pull failed: {(envQ.error as Error).message}
						</div>
					) : workerQ.data && workerUsageQ.data && capabilitiesQ.data && envQ.data ? (
						<CommandOutputList
							items={[
								{
									command: ntnCmd(["workers", "get", selectedWorkerId, ...(verboseLogs ? ["-v"] : [])]),
									output: (
										<WorkerDetailsBody worker={workerQ.data} />
									),
									trace: workerQ.data._trace,
								},
								{
									command: ntnCmd(["workers", "usage", selectedWorkerId, ...(verboseLogs ? ["-v"] : [])]),
									output: formatWorkerUsage(workerUsageQ.data),
									trace: workerUsageQ.data._trace,
								},
								{
									command: ntnCmd([
										"workers",
										"capabilities",
										"list",
										selectedWorkerId,
										...(verboseLogs ? ["-v"] : []),
									]),
									output: formatCapabilities(capabilitiesQ.data.capabilities),
									trace: capabilitiesQ.data._trace,
								},
								...((webhooksQ.data?.webhooks?.length ?? 0) > 0
									? [
											{
												command: ntnCmd([
													"workers",
													"webhooks",
													"list",
													selectedWorkerId,
													...(verboseLogs ? ["-v"] : []),
												]),
												output: formatWebhookUrls(webhooksQ.data!.webhooks),
												trace: webhooksQ.data?._trace,
											},
										]
									: []),
								...(isSyncWorker && syncStatusQ.data
									? [
											{
												command: ntnCmd([
													"workers",
													"sync",
													"status",
													"--worker-id",
													selectedWorkerId,
													"--no-watch",
													...(verboseLogs ? ["-v"] : []),
												]),
												output: formatSyncStatuses(syncStatusQ.data.statuses),
												trace: syncStatusQ.data._trace,
											},
										]
									: []),
								{
									command: ntnCmd([
										"workers",
										"env",
										"pull",
										selectedWorkerId,
										"--no-file",
										"--yes",
										...(verboseLogs ? ["-v"] : []),
									]),
									output: envQ.data.text,
									trace: envQ.data._trace,
								},
							]}
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
			{renameWorkerOpen && selectedWorkerId ? (
				<RenameWorkerModal
					workerName={
						workersQ.data?.find((w) => w.workerId === selectedWorkerId)?.name ?? "worker"
					}
					workerId={selectedWorkerId}
					submitting={renameWorker.isPending || deployWorker.isPending}
					error={(renameWorker.error as Error | null) || (deployWorker.error as Error | null)}
					success={!!renameWorker.data && renameWorker.data.exitCode === 0}
					successName={renamedWorkerName ?? undefined}
					onClose={() => {
						setRenameWorkerOpen(false);
						renameWorker.reset();
						setRenamedWorkerName(null);
					}}
					onSubmit={(newName) => {
						clearTransientOutputs();
						setRenamedWorkerName(newName);
						renameWorker.mutate({ workerId: selectedWorkerId, newName });
					}}
					onRedeploy={() => {
						deployWorker.mutate(selectedWorkerId);
					}}
				/>
			) : null}
		</>
	);
}

