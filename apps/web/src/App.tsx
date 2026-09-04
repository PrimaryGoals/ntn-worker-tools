import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Panel as RPanel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { api, type ApiRequestError } from "./api";
import { buildWorkerMenuGroups, contextMenuGroups, dropdownGroups } from "./workerMenu";
import { agentDefinitionUrl } from "./constants";
import { BrandingSplash } from "./components/ui/BrandingSplash";
import { CommandOutputList, OutputWithCommands } from "./components/ui/CommandOutput";
import { ExitCodeBadge } from "./components/ui/ExitCodeBadge";
import { Panel } from "./components/ui/Panel";
import { PanelTabs } from "./components/ui/PanelTabs";
import { RefreshButton } from "./components/ui/RefreshButton";
import { MenuBar } from "./components/MenuBar";
import { AgentMenuBar } from "./components/AgentMenuBar";
import { AgentsList } from "./components/AgentsList";
import { AgentsViewModeSwitch } from "./components/AgentsViewModeSwitch";
import { AgentUsageList } from "./components/AgentUsageList";
import { AdjustTimeMarkerModal } from "./components/modals/AdjustTimeMarkerModal";
import { AgentCreditLimitModal } from "./components/modals/AgentCreditLimitModal";
import { AgentStatusModal } from "./components/modals/AgentStatusModal";
import { DeployConfirmModal } from "./components/modals/DeployConfirmModal";
import { DeployNewWorkerModal } from "./components/modals/DeployNewWorkerModal";
import { DeployUpdatedWorkersModal } from "./components/modals/DeployUpdatedWorkersModal";
import { FolderPickerModal } from "./components/modals/FolderPickerModal";
import { RenameWorkerModal } from "./components/modals/RenameWorkerModal";
import { SyncScheduleModal } from "./components/modals/SyncScheduleModal";
import { TokenPushModal } from "./components/modals/TokenPushModal";
import { RunsList } from "./components/RunsList";
import { SessionsList } from "./components/SessionsList";
import { UsageList } from "./components/UsageList";
import { RunsViewModeSwitch } from "./components/RunsViewModeSwitch";
import { WebhookLine } from "./components/WebhookLine";
import { WorkerDetailsBody } from "./components/WorkerDetailsBody";
import { WorkerSearchBox } from "./components/WorkerSearchBox";
import { WorkerContextMenu } from "./components/WorkerContextMenu";
import { WorkersList } from "./components/WorkersList";
import { useCommandMutations } from "./hooks/useCommandMutations";
import { useAgentData } from "./hooks/useAgentData";
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
	formatSessionEvents,
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
	const qc = useQueryClient();
	const {
		selectedWorkerId,
		setSelectedWorkerId,
		selectedRunId,
		setSelectedRunId,
		verboseLogs,
		setVerboseLogs,
		folderPickerOpen,
		setFolderPickerOpen,
		tokenPushOpen,
		setTokenPushOpen,
		renameWorkerOpen,
		setRenameWorkerOpen,
		adjustTimeMarkerOpen,
		setAdjustTimeMarkerOpen,
		deployNewWorkerOpen,
		setDeployNewWorkerOpen,
		deployUpdatedWorkersOpen,
		setDeployUpdatedWorkersOpen,
		syncScheduleOpen,
		setSyncScheduleOpen,
		deployConfirmKind,
		setDeployConfirmKind,
		runsViewMode,
		setRunsViewMode,
		workerFilter,
		setWorkerFilter,
		browserTab,
		setBrowserTab,
		agentsTabVisited,
		setAgentsTabVisited,
		selectedAgentId,
		setSelectedAgentId,
		selectedSessionId,
		setSelectedSessionId,
		agentsViewMode,
		setAgentsViewMode,
	} = useUIState();
	const [renamedWorkerName, setRenamedWorkerName] = useState<string | null>(null);
	const [agentCreditLimitOpen, setAgentCreditLimitOpen] = useState(false);
	const [agentStatusOpen, setAgentStatusOpen] = useState(false);
	const {
		deployWorker,
		pnpmDeployWorker,
		pushSecrets,
		setEnvVar,
		syncTrigger,
		syncPause,
		syncResume,
		syncStateReset,
		oauthShowRedirectUrl,
		oauthStart,
		oauthToken,
		setAgentStatus,
		setAgentCreditLimit,
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
		localPath,
		localInfoQ,
		hasDeployScript,
		workersQ,
		runHealthQ,
		workerHealth,
		runsQ,
		crossWorkerRunsQ,
		crossWorkerUsageQ,
		logsQ,
		workerQ,
		workerUsageQ,
		webhooksQ,
		capabilitiesQ,
		envQ,
		selectedRun,
		sortedWorkers,
		workerNamesById,
		codeOutOfDateWorkerIds,
		envOutOfDateWorkerIds,
		syncSchedulesQ,
		syncWorkerIds,
		syncCapabilities,
		isSyncWorker,
		syncStatusQ,
		oauthCapabilityKey,
	} = useWorkerData(selectedWorkerId, selectedRunId, verboseLogs, runsViewMode);
	const {
		agentsQ,
		agentHealthQ,
		agentInsightsQ,
		agentSessionsQ,
		sessionEventsQ,
		crossAgentSessionsQ,
		agentUsageQ,
	} = useAgentData(
		selectedAgentId,
		selectedSessionId,
		agentsViewMode,
		configQ.data?.timeMarker ?? null,
		agentsTabVisited,
	);
	const selectedAgent = agentsQ.data?.find((a) => a.id === selectedAgentId) ?? null;
	const agentNamesById = useMemo(
		() => Object.fromEntries((agentsQ.data ?? []).map((a) => [a.id, a.name])),
		[agentsQ.data],
	);
	// The selected session can come from either list — the per-agent one, or
	// the cross-agent one when that view is active.
	const selectedSession =
		agentSessionsQ.data?.sessions.find((x) => x.id === selectedSessionId) ??
		crossAgentSessionsQ.data?.sessions.find((x) => x.id === selectedSessionId) ??
		null;
	const crossWorkerView = runsViewMode === "crossWorker";
	const {
		setLocalPath,
		clearLocalPath,
		revealWorker,
		renameWorker,
		markTime,
		clearTimeMarker,
		savePanelSize,
		schedulePanelSave,
	} = useConfigMutations(setFolderPickerOpen, persistedPanelSizes);

	function openAdjustTimeMarker() {
		markTime.reset();
		setAdjustTimeMarkerOpen(true);
	}

	function switchRunsViewMode(mode: typeof runsViewMode) {
		clearTransientOutputs();
		setSelectedRunId(null);
		setRunsViewMode(mode);
	}

	function switchAgentsViewMode(mode: typeof agentsViewMode) {
		clearTransientOutputs();
		setSelectedSessionId(null);
		setAgentsViewMode(mode);
	}

	// Workers and Agents are exclusive contexts, so leaving a tab drops that
	// tab's selection. Without this, a leftover selectedAgentId keeps the Runs
	// panel in session mode — and its view-mode switch hidden — until you click
	// an individual worker.
	function switchBrowserTab(tab: typeof browserTab) {
		clearTransientOutputs();
		setBrowserTab(tab);
		// Latches the health fetch on first visit; a no-op on every later switch.
		if (tab === "agents") setAgentsTabVisited(true);
		if (tab === "workers") {
			setSelectedAgentId(null);
			setSelectedSessionId(null);
		} else {
			setSelectedWorkerId(null);
			setSelectedRunId(null);
		}
	}

	const filteredWorkers = useMemo(() => {
		const q = workerFilter.trim().toLowerCase();
		if (!q) return sortedWorkers;
		return sortedWorkers.filter((w) => w.name.toLowerCase().includes(q));
	}, [sortedWorkers, workerFilter]);


	const selectedWorkerName =
		workersQ.data?.find((w) => w.workerId === selectedWorkerId)?.name ?? null;

	function selectWorker(id: string) {
		setSelectedWorkerId(id);
		setSelectedRunId(null);
		setSelectedAgentId(null);
		setSelectedSessionId(null);
		setRunsViewMode("worker");
		clearTransientOutputs();
	}

	// Built fresh on every render rather than memoised: these actions close
	// over current state, and a stale dependency list here would mean a menu
	// item acting on the worker that was selected a moment ago.
	const workerMenuGroups = buildWorkerMenuGroups(
		{
			workerId: selectedWorkerId,
			localPath,
			hasDeployScript,
			hasEnvFile: localInfoQ.data?.hasEnvFile ?? false,
			oauthCapabilityKey,
			isSyncWorker,
			hasWebhook: (webhooksQ.data?.webhooks?.length ?? 0) > 0,
			hasTimeMarker: !!configQ.data?.timeMarker,
		},
		{
			setLocalPath: () => {
				if (!selectedWorkerId) return;
				setLocalPath.reset();
				setFolderPickerOpen(true);
			},
			reveal: () => {
				if (selectedWorkerId) revealWorker.mutate(selectedWorkerId);
			},
			clearLocalPath: () => {
				if (!selectedWorkerId) return;
				if (window.confirm("Forget the local folder for this worker?")) {
					clearLocalPath.mutate(selectedWorkerId);
				}
			},
			renameWorker: () => {
				renameWorker.reset();
				setRenameWorkerOpen(true);
			},
			ntnDeploy: () => {
				if (!selectedWorkerId || !localPath) return;
				setDeployConfirmKind("ntn");
			},
			pnpmDeploy: () => {
				if (!selectedWorkerId || !localPath) return;
				setDeployConfirmKind("pnpm");
			},
			deployUpdatedWorkers: () => setDeployUpdatedWorkersOpen(true),
			deployToNewWorkspace: () => setDeployNewWorkerOpen(true),
			pushSecrets: () => {
				if (!selectedWorkerId || !localPath) return;
				if (
					window.confirm(
						`Push .env from ${localPath} to this worker's remote environment on Notion?\nThis overwrites remote env vars.`,
					)
				) {
					clearTransientOutputs();
					pushSecrets.mutate(selectedWorkerId);
				}
			},
			openTokenPush: () => {
				setEnvVar.reset();
				setTokenPushOpen(true);
			},
			oauthShowRedirectUrl: () => {
				clearTransientOutputs();
				oauthShowRedirectUrl.mutate();
			},
			oauthStart: () => {
				if (!selectedWorkerId || !oauthCapabilityKey) return;
				if (
					window.confirm(
						`Start the OAuth flow for "${oauthCapabilityKey}"?\nThis opens your browser to the provider's consent screen.`,
					)
				) {
					clearTransientOutputs();
					// The consent screen is opened by the server, in the OS default
					// browser: `ntn workers oauth start` only prints the URL when run
					// non-interactively (which is how the server always spawns it),
					// and opening it from here instead would mean a window.open()
					// that the browser blocks as an unsolicited popup, since the
					// confirm() above has already spent the click's user activation.
					oauthStart.mutate({ workerId: selectedWorkerId, key: oauthCapabilityKey });
				}
			},
			oauthToken: () => {
				if (!selectedWorkerId || !oauthCapabilityKey) return;
				clearTransientOutputs();
				oauthToken.mutate({ workerId: selectedWorkerId, key: oauthCapabilityKey });
			},
			markTime: () => markTime.mutate(undefined),
			clearTimeMarker: () => clearTimeMarker.mutate(),
			adjustTimeMarker: openAdjustTimeMarker,
			fireWebhook: () => {
				// The same POST the webhook URL in the details pane fires, aimed at
				// the first webhook — the menu is a flat list with nowhere to choose
				// between several, so a worker with more than one still needs that
				// pane.
				const webhook = webhooksQ.data?.webhooks?.[0];
				if (!webhook) return;
				clearTransientOutputs();
				fireWebhook.mutate({
					url: webhook.url,
					webhookSecret: extractWebhookSecret(envQ.data?.text ?? ""),
				});
			},
			syncTrigger: () => {
				if (!selectedWorkerId || !syncCapabilities[0]) return;
				clearTransientOutputs();
				syncTrigger.mutate({ workerId: selectedWorkerId, syncKey: syncCapabilities[0].key });
			},
			syncPause: () => {
				if (!selectedWorkerId || !syncCapabilities[0]) return;
				if (window.confirm("Pause sync for this worker?")) {
					clearTransientOutputs();
					syncPause.mutate({ workerId: selectedWorkerId, syncKey: syncCapabilities[0].key });
				}
			},
			syncResume: () => {
				if (!selectedWorkerId || !syncCapabilities[0]) return;
				clearTransientOutputs();
				syncResume.mutate({ workerId: selectedWorkerId, syncKey: syncCapabilities[0].key });
			},
			syncStateReset: () => {
				if (!selectedWorkerId || !syncCapabilities[0]) return;
				if (
					window.confirm(
						"Reset sync state for this worker?\nThis clears the sync cursor so the next run processes from scratch.",
					)
				) {
					clearTransientOutputs();
					syncStateReset.mutate({ workerId: selectedWorkerId, syncKey: syncCapabilities[0].key });
				}
			},
			updatePollingInterval: () => {
				if (!selectedWorkerId || !localPath) return;
				setSyncScheduleOpen(true);
			},
		},
	);

	// A right-click selects its row immediately (so the highlight is the
	// feedback) but the menu itself waits until the gates that decide which
	// items appear are known — it is then correct on first paint and never
	// rearranges under the pointer. Folder gates come from config, already
	// loaded for every worker; capabilities and the package.json/.env facts
	// each need an `ntn` spawn for the newly selected worker, so only a
	// right-click on an unselected row actually waits.
	const [contextMenu, setContextMenu] = useState<{
		workerId: string;
		x: number;
		y: number;
	} | null>(null);
	const [pendingContextMenu, setPendingContextMenu] = useState<{
		workerId: string;
		x: number;
		y: number;
	} | null>(null);
	// A failed gate query counts as settled: the menu should still open with
	// the groups that did resolve rather than never opening at all.
	const menuGatesReady =
		!capabilitiesQ.isPending && !webhooksQ.isPending && (localPath ? !localInfoQ.isPending : true);

	useEffect(() => {
		if (!pendingContextMenu) return;
		if (pendingContextMenu.workerId !== selectedWorkerId || !menuGatesReady) return;
		setContextMenu(pendingContextMenu);
		setPendingContextMenu(null);
	}, [pendingContextMenu, selectedWorkerId, menuGatesReady]);

	// Abandon a wait the user has moved on from. The right-click's own
	// pointerdown has already fired by the time this runs, so it cannot
	// cancel the menu it just asked for; right-clicking another row cancels
	// and then re-arms, leaving the latest one to win.
	useEffect(() => {
		if (!pendingContextMenu) return;
		const cancel = () => setPendingContextMenu(null);
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") cancel();
		};
		window.addEventListener("pointerdown", cancel, true);
		window.addEventListener("keydown", onKeyDown);
		return () => {
			window.removeEventListener("pointerdown", cancel, true);
			window.removeEventListener("keydown", onKeyDown);
		};
	}, [pendingContextMenu]);

	return (
		<>
		<div className="flex h-screen flex-col">
			<MenuBar
				leftMenu={
					browserTab === "agents" ? (
						<AgentMenuBar
							agentName={selectedAgent?.name ?? null}
							agentId={selectedAgentId}
							onSetCreditLimit={() => {
								setAgentCreditLimit.reset();
								setAgentCreditLimitOpen(true);
							}}
							onSetStatus={() => {
								setAgentStatus.reset();
								setAgentStatusOpen(true);
							}}
							onMarkTime={() => markTime.mutate(undefined)}
							hasTimeMarker={!!configQ.data?.timeMarker}
							onClearTimeMarker={() => clearTimeMarker.mutate()}
							onAdjustTimeMarker={openAdjustTimeMarker}
						/>
					) : undefined
				}
				loading={whoamiQ.isLoading}
				error={whoamiQ.error as Error | null}
				spaceName={whoamiQ.data?.spaceName ?? null}
				workerName={selectedWorkerName}
				localPath={localPath}
				groups={dropdownGroups(workerMenuGroups)}
				setLocalPathError={friendlySetPathError(
					setLocalPath.error as ApiRequestError | null,
					selectedWorkerName,
				)}
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
								<Panel
									title={
										<PanelTabs
											tabs={[
												{
													id: "workers" as const,
													label: "Workers",
													// Each tab carries its own refresh, scoped to that
													// tab's health sweep. Clicking one also moves you to
													// that tab — refreshing a view you can't see would
													// be a no-op from the user's side.
													after: (
														<RefreshButton
															title="Refresh worker health"
															spinning={runHealthQ.isFetching}
															onClick={() => {
																// Only switch when needed: switchBrowserTab
																// clears the output panel, which would be a
																// surprising side effect of a refresh click.
																if (browserTab !== "workers") switchBrowserTab("workers");
																runHealthQ.refetch();
															}}
														/>
													),
												},
												{
													id: "agents" as const,
													label: "Agents",
													after: (
														<RefreshButton
															title="Refresh agent health"
															spinning={agentHealthQ.isFetching || agentsQ.isFetching}
															onClick={() => {
																const firstVisit = !agentsTabVisited;
																if (browserTab !== "agents") switchBrowserTab("agents");
																// On the very first visit switchBrowserTab latches
																// the health query on and it fetches by itself;
																// refetching too would just double the sweep.
																if (!firstVisit) {
																	agentsQ.refetch();
																	agentHealthQ.refetch();
																}
															}}
														/>
													),
												},
											]}
											active={browserTab}
											onChange={switchBrowserTab}
										/>
									}
									headerRight={
										browserTab === "workers" && sortedWorkers.length > 10 ? (
											<WorkerSearchBox value={workerFilter} onChange={setWorkerFilter} />
										) : null
									}
								>
									{browserTab === "agents" ? (
										<AgentsList
											loading={agentsQ.isLoading}
											error={agentsQ.error as Error | null}
											agents={agentsQ.data ?? []}
											selectedId={selectedAgentId}
											health={agentHealthQ.data?.health ?? {}}
											onSelect={(id) => {
												// Exclusive with the worker context: picking an
												// agent drops the worker selection, so worker-scoped
												// chrome (Worker menu, webhook line) goes inert.
												setSelectedAgentId(id);
												setSelectedSessionId(null);
												setSelectedWorkerId(null);
												setSelectedRunId(null);
												// Picking a specific agent means you want that
												// agent's sessions, not the cross-agent or usage
												// view you may have been looking at.
												setAgentsViewMode("agent");
												clearTransientOutputs();
											}}
										/>
									) : (
									<WorkersList
										loading={workersQ.isLoading}
										error={workersQ.error as Error | null}
										workers={filteredWorkers}
										selectedId={selectedWorkerId}
										runHealth={workerHealth}
										localPaths={configQ.data?.workerLocalPaths ?? {}}
									syncSchedules={syncSchedulesQ.data ?? {}}
										codeOutOfDateWorkerIds={codeOutOfDateWorkerIds}
										envOutOfDateWorkerIds={envOutOfDateWorkerIds}
										filtered={!!workerFilter.trim()}
										onSelect={selectWorker}
										onContextMenu={(id, x, y) => {
											setContextMenu(null);
											if (id !== selectedWorkerId) selectWorker(id);
											setPendingContextMenu({ workerId: id, x, y });
										}}
									/>
									)}
								</Panel>
							</div>
						</RPanel>
						<PanelResizeHandle className="w-1 cursor-col-resize bg-neutral-200 hover:bg-neutral-400 dark:bg-neutral-800 dark:hover:bg-neutral-600" />
						<RPanel defaultSize={100 - (persistedPanelSizes.workersRuns ?? 30)} minSize={30}>
							<div className="h-full p-2">
								<Panel
									title={browserTab === "agents" ? "Sessions" : "Runs"}
									headerRight={
										// Each tab gets its own switch: the two sets of metrics
										// don't merge (agents have no CPU/duration/network, workers
										// have no credit limit or pause reason), so they stay apart.
										browserTab === "agents" ? (
											<AgentsViewModeSwitch
												mode={agentsViewMode}
												onModeChange={switchAgentsViewMode}
												markerTime={configQ.data?.timeMarker ?? null}
												onAdjustTimeMarker={openAdjustTimeMarker}
											/>
										) : (
											<RunsViewModeSwitch
												mode={runsViewMode}
												onModeChange={switchRunsViewMode}
												markerTime={configQ.data?.timeMarker ?? null}
												onAdjustTimeMarker={openAdjustTimeMarker}
											/>
										)
									}
								>
									{browserTab === "agents" ? (
										agentsViewMode === "usage" ? (
											<AgentUsageList
												loading={agentUsageQ.isLoading}
												error={agentUsageQ.error as Error | null}
												usages={agentUsageQ.data?.usages ?? []}
												windowStart={agentUsageQ.data?.windowStart ?? null}
												windowEnd={agentUsageQ.data?.windowEnd ?? null}
											/>
										) : agentsViewMode === "crossAgent" ? (
											<SessionsList
												loading={crossAgentSessionsQ.isLoading}
												error={crossAgentSessionsQ.error as Error | null}
												sessions={crossAgentSessionsQ.data?.sessions ?? []}
												hasMore={crossAgentSessionsQ.data?.hasMore ?? false}
												selectedId={selectedSessionId}
												agentNames={agentNamesById}
												onSelect={(id) =>
													setSelectedSessionId((prev) => (prev === id ? null : id))
												}
											/>
										) : !selectedAgentId ? (
											<BrandingSplash />
										) : (
											<SessionsList
												loading={agentSessionsQ.isLoading}
												error={agentSessionsQ.error as Error | null}
												sessions={agentSessionsQ.data?.sessions ?? []}
												hasMore={agentSessionsQ.data?.hasMore ?? false}
												selectedId={selectedSessionId}
												onSelect={(id) =>
													setSelectedSessionId((prev) => (prev === id ? null : id))
												}
											/>
										)
									) : runsViewMode === "usage" ? (
										<UsageList
											loading={crossWorkerUsageQ.isLoading}
											error={crossWorkerUsageQ.error as Error | null}
											usages={crossWorkerUsageQ.data?.usages ?? []}
										/>
									) : !selectedWorkerId && !crossWorkerView ? (
										<BrandingSplash />
									) : (
										<RunsList
											loading={
												crossWorkerView ? crossWorkerRunsQ.isLoading : runsQ.isLoading
											}
											error={
												(crossWorkerView ? crossWorkerRunsQ.error : runsQ.error) as Error | null
											}
											runs={
												(crossWorkerView ? crossWorkerRunsQ.data : runsQ.data)?.runs ?? []
											}
											selectedId={selectedRunId}
											markerTime={configQ.data?.timeMarker ?? null}
											workerNames={workerNamesById}
											showWorkerColumn={crossWorkerView}
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
					{selectedAgent ? (
						<div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
							<span className="font-medium">{selectedAgent.name}</span>
							<a
								href={agentDefinitionUrl(selectedAgent.id)}
								target="_blank"
								rel="noopener noreferrer"
								className="text-blue-600 underline hover:no-underline dark:text-blue-400"
							>
								Open agent definition ↗
							</a>
							{selectedAgent.description ? (
								<span className="text-neutral-500">{selectedAgent.description}</span>
							) : null}
						</div>
					) : null}
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
								{crossWorkerView ? (
									<span>
										<span className="text-neutral-500">Worker:</span>{" "}
										{selectedRun.workerName ??
											workerNamesById[selectedRun.workerId] ??
											selectedRun.workerId}
									</span>
								) : null}
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
						) : selectedSession ? (
							<>
								<span className="font-mono text-xs text-neutral-500">{selectedSession.id}</span>
								<span>
									<span className="text-neutral-500">Trigger:</span>{" "}
									{selectedSession.triggerType}
								</span>
								<span>
									<span className="text-neutral-500">Status:</span> {selectedSession.status}
									{selectedSession.agentReportedFailure ? " (agent reported failure)" : ""}
								</span>
								<span>
									<span className="text-neutral-500">Credits:</span>{" "}
									{selectedSession.creditsUsed}
								</span>
								<span>
									<span className="text-neutral-500">Started:</span>{" "}
									{formatDateTime(selectedSession.createdAt)}
								</span>
								<span>
									<span className="text-neutral-500">Duration:</span>{" "}
									{formatDuration(selectedSession.createdAt, selectedSession.updatedAt)}
								</span>
								{selectedSession.error ? (
									<span className="text-red-600 dark:text-red-400">
										{selectedSession.error.code}: {selectedSession.error.message}
									</span>
								) : null}
							</>
						) : (
							<span className="text-neutral-500">
								{selectedAgentId
									? "Select a session to see its transcript."
									: selectedWorkerId
										? "Select a run to see its details."
										: "Select a worker or an agent."}
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
					<OutputWithCommands
						commands={[`POST ${fireWebhook.variables?.url ?? "(unknown url)"}`]}
						body={
							<span className="text-red-400">
								Webhook failed: {(fireWebhook.error as Error).message}
							</span>
						}
					/>
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
				) : selectedSessionId ? (
					sessionEventsQ.isLoading ? (
						<div className="p-3 text-sm text-neutral-400">Fetching session transcript…</div>
					) : sessionEventsQ.error ? (
						<div className="p-3 text-sm text-red-400">
							{(sessionEventsQ.error as Error).message}
						</div>
					) : (
						<OutputWithCommands
							commands={[
								ntnCmd(["api", `/v1/sessions/${selectedSessionId}/events/query`, "-d", "{}"]),
							]}
							body={formatSessionEvents(
								sessionEventsQ.data?.events ?? [],
								sessionEventsQ.data?.hasMore ?? false,
							)}
						/>
					)
				) : selectedAgentId ? (
					agentInsightsQ.isLoading ? (
						<div className="p-3 text-sm text-neutral-400">Running ntn api agents insights…</div>
					) : agentInsightsQ.error ? (
						<div className="p-3 text-sm text-red-400">
							{(agentInsightsQ.error as Error).message}
						</div>
					) : agentInsightsQ.data ? (
						<OutputWithCommands
							commands={[agentInsightsQ.data.command]}
							body={formatDeployResult(agentInsightsQ.data)}
						/>
					) : null
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
									command: ntnCmd(["workers", "runs", "list", selectedWorkerId]),
									output: runsQ.isLoading
										? "Fetching runs…"
										: runsQ.error
											? (runsQ.error as Error).message
											: `${runsQ.data?.runs.length ?? 0} run${runsQ.data?.runs.length === 1 ? "" : "s"} retrieved.`,
								},
								{
									command: ntnCmd(["workers", "get", selectedWorkerId, ...(verboseLogs ? ["-v"] : [])]),
									output: (
										<WorkerDetailsBody
											worker={workerQ.data}
											lastCodeDeployAt={configQ.data?.workerLastCodeDeployAt?.[selectedWorkerId]}
											lastEnvPushAt={configQ.data?.workerLastEnvPushAt?.[selectedWorkerId]}
										/>
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
						commands={[ntnCmd(["whoami"])]}
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
						setLocalPath.error as ApiRequestError | null,
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
					currentWorkerName={
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
						if (!selectedWorkerId) return;
						clearTransientOutputs();
						if (hasDeployScript) {
							pnpmDeployWorker.mutate({ workerId: selectedWorkerId });
						} else {
							deployWorker.mutate({ workerId: selectedWorkerId });
						}
					}}
				/>
			) : null}
			{syncScheduleOpen && selectedWorkerId ? (
				<SyncScheduleModal
					workerId={selectedWorkerId}
					workerName={
						workersQ.data?.find((w) => w.workerId === selectedWorkerId)?.name ?? "worker"
					}
					syncStatuses={syncStatusQ.data?.statuses ?? []}
					creditsPerExecution={
						workerUsageQ.data && workerUsageQ.data.usage.sandboxCount > 0
							? workerUsageQ.data.usage.credits / workerUsageQ.data.usage.sandboxCount
							: null
					}
					hasDeployScript={hasDeployScript}
					deploying={deployWorker.isPending || pnpmDeployWorker.isPending}
					onClose={() => setSyncScheduleOpen(false)}
					onSaved={(result) => {
						clearTransientOutputs();
						setDeployResult(result);
						// The edit changes source mtimes, which drives the
						// "code out of date" flag and the deploy-updated-workers list,
						// and the intervals shown beside each worker's name.
						qc.invalidateQueries({ queryKey: ["localMtimes"] });
						qc.invalidateQueries({ queryKey: ["allSyncSchedules"] });
					}}
					onDeploy={() => {
						if (!selectedWorkerId) return;
						clearTransientOutputs();
						if (hasDeployScript) {
							pnpmDeployWorker.mutate({ workerId: selectedWorkerId, assumeYes: isSyncWorker });
						} else {
							deployWorker.mutate({ workerId: selectedWorkerId, assumeYes: isSyncWorker });
						}
					}}
				/>
			) : null}
			{deployConfirmKind && selectedWorkerId && localPath ? (
				<DeployConfirmModal
					kind={deployConfirmKind}
					workerName={
						workersQ.data?.find((w) => w.workerId === selectedWorkerId)?.name ?? "worker"
					}
					localPath={localPath}
					isSyncWorker={isSyncWorker}
					submitting={deployWorker.isPending || pnpmDeployWorker.isPending}
					onClose={() => setDeployConfirmKind(null)}
					onConfirm={() => {
						const kind = deployConfirmKind;
						setDeployConfirmKind(null);
						clearTransientOutputs();
						if (kind === "pnpm") {
							pnpmDeployWorker.mutate({ workerId: selectedWorkerId, assumeYes: isSyncWorker });
						} else {
							deployWorker.mutate({ workerId: selectedWorkerId, assumeYes: isSyncWorker });
						}
					}}
				/>
			) : null}
			{deployNewWorkerOpen ? (
				<DeployNewWorkerModal
					startPath={localPath}
					whoami={whoamiQ.data ?? null}
					existingWorkers={workersQ.data ?? []}
					onClose={() => setDeployNewWorkerOpen(false)}
					onDeployed={(result) => {
						setDeployNewWorkerOpen(false);
						clearTransientOutputs();
						setDeployResult(result);
					}}
				/>
			) : null}
			{deployUpdatedWorkersOpen ? (
				<DeployUpdatedWorkersModal
					workers={sortedWorkers}
					localPaths={configQ.data?.workerLocalPaths ?? {}}
					codeOutOfDateWorkerIds={codeOutOfDateWorkerIds}
					envOutOfDateWorkerIds={envOutOfDateWorkerIds}
					syncWorkerIds={syncWorkerIds}
					verbose={verboseLogs}
					onClose={() => setDeployUpdatedWorkersOpen(false)}
					onFinished={(result) => {
						clearTransientOutputs();
						setDeployResult(result);
						qc.invalidateQueries({ queryKey: ["workers"] });
						qc.invalidateQueries({ queryKey: ["config"] });
						qc.invalidateQueries({ queryKey: ["localMtimes"] });
					}}
				/>
			) : null}
			{agentCreditLimitOpen && selectedAgent ? (
				<AgentCreditLimitModal
					agentName={selectedAgent.name}
					currentLimit={selectedAgent.creditLimit}
					submitting={setAgentCreditLimit.isPending}
					error={setAgentCreditLimit.error as Error | null}
					onClose={() => {
						setAgentCreditLimitOpen(false);
						setAgentCreditLimit.reset();
					}}
					onSubmit={(creditLimit) => {
						clearTransientOutputs();
						setAgentCreditLimit.mutate(
							{ agentId: selectedAgent.id, creditLimit },
							{ onSuccess: () => setAgentCreditLimitOpen(false) },
						);
					}}
				/>
			) : null}
			{agentStatusOpen && selectedAgent ? (
				<AgentStatusModal
					agentName={selectedAgent.name}
					currentStatus={selectedAgent.status}
					pauseReason={selectedAgent.pauseReason}
					submitting={setAgentStatus.isPending}
					error={setAgentStatus.error as Error | null}
					onClose={() => {
						setAgentStatusOpen(false);
						setAgentStatus.reset();
					}}
					onSubmit={(status) => {
						clearTransientOutputs();
						setAgentStatus.mutate(
							{ agentId: selectedAgent.id, status },
							{ onSuccess: () => setAgentStatusOpen(false) },
						);
					}}
				/>
			) : null}
			{adjustTimeMarkerOpen ? (
				<AdjustTimeMarkerModal
					currentMarkerTime={configQ.data?.timeMarker ?? null}
					submitting={markTime.isPending}
					error={markTime.error as Error | null}
					onClose={() => {
						setAdjustTimeMarkerOpen(false);
						markTime.reset();
					}}
					onSubmit={(isoTime) => {
						markTime.mutate(isoTime, {
							onSuccess: () => setAdjustTimeMarkerOpen(false),
						});
					}}
				/>
			) : null}
			{contextMenu && contextMenu.workerId === selectedWorkerId ? (
				<WorkerContextMenu
					groups={contextMenuGroups(workerMenuGroups)}
					workerName={selectedWorkerName}
					x={contextMenu.x}
					y={contextMenu.y}
					onClose={() => setContextMenu(null)}
				/>
			) : null}
		</>
	);
}

