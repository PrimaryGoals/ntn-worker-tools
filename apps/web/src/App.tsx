import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Panel as RPanel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import type { DeployResult } from "@ntn-worker-tools/shared";
import { api } from "./api";
import { BrandingSplash } from "./components/ui/BrandingSplash";
import { CommandOutputList, OutputWithCommands } from "./components/ui/CommandOutput";
import { ExitCodeBadge } from "./components/ui/ExitCodeBadge";
import { Empty, Panel } from "./components/ui/Panel";
import { MenuBar } from "./components/MenuBar";
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
	} = useUIState();
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
		runningCommand,
		anyDeployError,
		resetAll: resetCommandMutations,
	} = useCommandMutations(verboseLogs, selectedWorkerId, setTokenPushOpen);
	const { fireWebhook, webhookResult, setWebhookResult, resetWebhookResult } =
		useWebhookMutations(selectedWorkerId);

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
	const { setLocalPath, clearLocalPath, revealWorker, savePanelSize, schedulePanelSave } =
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
		</>
	);
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

