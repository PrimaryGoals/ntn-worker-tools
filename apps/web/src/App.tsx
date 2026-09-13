import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Panel as RPanel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { api } from "./api";
import { buildWorkerMenuGroups, contextMenuGroups, dropdownGroups } from "./workerMenu";
import { normalizePathKey } from "@ntn-worker-tools/shared";
import { buildLocalOnlyRows } from "./workerRows";
import { buildRepoStatuses, knownWorkspaces, type RepoStatus } from "./repoStatus";
import { RepoBanner, UnmappedReposLine } from "./components/RepoBanner";
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
import { BranchWorkspaceMapModal } from "./components/modals/BranchWorkspaceMapModal";
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
		branchMapOpen,
		setBranchMapOpen,
		tokenPushOpen,
		setTokenPushOpen,
		renameWorkerOpen,
		setRenameWorkerOpen,
		adjustTimeMarkerOpen,
		setAdjustTimeMarkerOpen,
		deployNewWorkerOpen,
		deployNewWorkerPath,
		setDeployNewWorkerPath,
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
		checkWorkerFolder,
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
		localMtimesQ,
		scanQ,
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
		syncPausedQ,
		syncWorkerIds,
		syncCapabilities,
		isSyncWorker,
		syncStatusQ,
		oauthCapabilityKey,
	} = useWorkerData(selectedWorkerId, selectedRunId, verboseLogs, runsViewMode);
	// The scan can span several repos, and a worker may sit in one of its own
	// entirely, so the header names the repository as well as the branch. Both
	// are null when no scanned folder claims the selected worker.
	const selectedWorkerFolder = useMemo(
		() => scanQ.data?.workers.find((worker) => worker.workerId === selectedWorkerId) ?? null,
		[scanQ.data, selectedWorkerId],
	);
	const selectedWorkerBranch = selectedWorkerFolder?.branch ?? null;
	const selectedWorkerRepoRoot = selectedWorkerFolder?.repoRoot ?? null;
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
		setScanRoot,
		saveBranchWorkspaces,
		ignoreFolder,
		unignoreFolder,
		revealWorker,
		revealPath,
		renameWorker,
		markTime,
		clearTimeMarker,
		savePanelSize,
		schedulePanelSave,
	} = useConfigMutations(setFolderPickerOpen, persistedPanelSizes);

	// Everything the workers panel reads, re-read. The refresh button and a
	// saved branch map both use it.
	function refreshWorkersPanel() {
		// The connected workspace can change under the app: `ntn login` in a
		// terminal switches it, and everything else here is read against whoever
		// is connected now - the worker list, the scan pairing, the header
		// itself. So confirm the identity first.
		whoamiQ.refetch();
		runHealthQ.refetch();
		syncPausedQ.refetch();
		// The out-of-date badges are a memo over these three, and nothing else
		// re-reads them: local edits made outside the app are invisible until a
		// deploy/env push invalidates them or the page reloads. Without these the
		// button would refresh the dots but leave a stale "needs redeploy".
		localMtimesQ.refetch();
		workersQ.refetch();
		configQ.refetch();
		// The rows for folders with no worker in this workspace are built from
		// the scan, so without this a folder deployed since the last scan keeps
		// saying "not on server" however often you refresh.
		scanQ.refetch();
	}

	function openBranchMap() {
		saveBranchWorkspaces.reset();
		setBranchMapOpen(true);
	}

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

	// Where each repository stands against the connected workspace. Computed
	// here rather than on the server: the scan already reports every repo with
	// its branch, and the config and whoami are both already in hand, so this
	// costs no call at all.
	const repoStatuses = useMemo(
		() =>
			buildRepoStatuses(
				scanQ.data?.repos ?? [],
				configQ.data,
				whoamiQ.data?.spaceId ?? null,
			),
		[scanQ.data, configQ.data, whoamiQ.data],
	);
	const workspaceChoices = useMemo(
		() =>
			knownWorkspaces(
				configQ.data,
				whoamiQ.data?.spaceId ?? null,
				whoamiQ.data?.spaceName ?? null,
			),
		[configQ.data, whoamiQ.data],
	);
	const workspaceName = (id: string) =>
		workspaceChoices.find((workspace) => workspace.id === id)?.name ?? id;
	const connectedWorkspaceName = whoamiQ.data?.spaceName ?? null;

	// Every repo not deployable into the connected workspace from where it is
	// checked out. Their undeployed folders are withheld from the list: a row
	// per folder offering a first deployment would put another workspace's code
	// here. Workers already on the server are never withheld.
	const hiddenRepoRoots = useMemo(
		() =>
			new Set(
				repoStatuses
					.filter((status) => status.kind !== "aligned")
					.map((status) => normalizePathKey(status.repo.root)),
			),
		[repoStatuses],
	);
	const wrongBranchStatuses = repoStatuses.filter((status) => status.kind === "wrong-branch");
	// Where each worker's code lives, for the rows and the bulk modal. Derived
	// from the scan rather than a saved map, so a folder that moved is simply
	// found where it is now, and one that is gone stops being claimed.
	const workerFolders = useMemo(() => {
		const map: Record<string, string> = {};
		for (const folder of scanQ.data?.workers ?? []) {
			if (folder.workerId) map[folder.workerId] = folder.path;
		}
		return map;
	}, [scanQ.data]);
	const localOnly = useMemo(
		() =>
			buildLocalOnlyRows(
				scanQ.data?.workers ?? [],
				workersQ.data ?? [],
				whoamiQ.data?.spaceId ?? null,
				hiddenRepoRoots,
			),
		[scanQ.data, workersQ.data, whoamiQ.data, hiddenRepoRoots],
	);
	const suppressedFor = (status: RepoStatus) =>
		localOnly.suppressedByRepo.get(normalizePathKey(status.repo.root)) ?? 0;
	// Only repos that actually withheld something are worth counting.
	const unmappedStatuses = repoStatuses.filter(
		(status) => status.kind === "not-in-workspace" && suppressedFor(status) > 0,
	);

	// First run: with no folder to scan the app has almost nothing to show, so
	// setup starts by asking for one. Checked once per page load, and only once
	// both the session and `ntn whoami` have answered - opening the picker over a
	// "run ntn login" message would hide the step that has to come first. It can
	// be closed; it comes back on the next load until a folder is chosen.
	const freshStartCheckedRef = useRef(false);
	// Set while a first-run folder choice is waiting on its scan. The map opens
	// once when that scan lands, and never again by itself: cancelling it, or
	// reloading before then, leaves the "not mapped" line to offer it.
	const [setupMapPending, setSetupMapPending] = useState(false);
	useEffect(() => {
		if (freshStartCheckedRef.current || !whoamiQ.data || !configQ.data) return;
		freshStartCheckedRef.current = true;
		if (configQ.data.scanRoot) return;
		setScanRoot.reset();
		setFolderPickerOpen(true);
		setSetupMapPending(true);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [whoamiQ.data, configQ.data]);
	useEffect(() => {
		if (!setupMapPending) return;
		const root = configQ.data?.scanRoot;
		const scan = scanQ.data;
		if (!root || !scan || scanQ.isFetching) return;
		// The scan that ran before a folder was chosen covers nothing; wait for
		// the one that walked the folder.
		if (!scan.roots.some((r) => normalizePathKey(r) === normalizePathKey(root))) return;
		setSetupMapPending(false);
		// Only repos holding worker folders are reported, so a folder with no
		// workers in git opens nothing.
		if (scan.repos.length > 0) openBranchMap();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [setupMapPending, configQ.data, scanQ.data, scanQ.isFetching]);

	const localOnlyRows = localOnly.rows;
	const filteredLocalOnly = useMemo(() => {
		const q = workerFilter.trim().toLowerCase();
		if (!q) return localOnlyRows;
		return localOnlyRows.filter(
			(row) => row.name.toLowerCase().includes(q) || row.path.toLowerCase().includes(q),
		);
	}, [localOnlyRows, workerFilter]);
	const filteredWorkers = useMemo(() => {
		const q = workerFilter.trim().toLowerCase();
		if (!q) return sortedWorkers;
		return sortedWorkers.filter((w) => w.name.toLowerCase().includes(q));
	}, [sortedWorkers, workerFilter]);


	const selectedWorkerName =
		workersQ.data?.find((w) => w.workerId === selectedWorkerId)?.name ?? null;

	// Check the folder still belongs to this worker before the confirmation
	// dialog, not when the deploy runs. Confirming a deploy that was never
	// going to be allowed wastes the decision the dialog is asking for, and
	// the answer reads the same either way - it is the same check.
	async function confirmDeployAfterFolderCheck(kind: "ntn" | "pnpm") {
		if (!selectedWorkerId || !localPath) return;
		clearTransientOutputs();
		checkWorkerFolder.reset();
		try {
			await checkWorkerFolder.mutateAsync(selectedWorkerId);
		} catch {
			// Reported through anyDeployError; the dialog stays shut.
			return;
		}
		setDeployConfirmKind(kind);
	}

	function selectWorker(id: string) {
		setSelectedWorkerId(id);
		setSelectedRunId(null);
		setSelectedAgentId(null);
		setSelectedSessionId(null);
		setRunsViewMode("worker");
		clearTransientOutputs();
	}

	// A selection belongs to the workspace it was made in. The connected
	// workspace can change underneath the app - `ntn login` in a terminal, then
	// refresh - and holding the old id would leave the details pane querying a
	// worker the new workspace does not have. Cleared the same way selecting
	// clears, so the runs panel and outputs stop describing something gone.
	const connectedSpaceId = whoamiQ.data?.spaceId ?? null;
	const lastSpaceIdRef = useRef<string | null>(null);
	useEffect(() => {
		if (!connectedSpaceId) return;
		const previous = lastSpaceIdRef.current;
		lastSpaceIdRef.current = connectedSpaceId;
		// First resolution is not a change: nothing was selected against an
		// earlier workspace.
		if (!previous || previous === connectedSpaceId) return;
		setSelectedWorkerId(null);
		setSelectedRunId(null);
		setSelectedAgentId(null);
		setSelectedSessionId(null);
		setRunsViewMode("worker");
		clearTransientOutputs();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [connectedSpaceId]);

	// Whether the sync that pause/resume act on — the first sync capability,
	// the one every sync menu item uses — is currently paused. Read from the
	// same map the sidebar's "paused" marker is built from, so it needs no
	// call of its own and moves in step with that marker. undefined entry
	// (worker has no local folder, or none of its source declares a sync)
	// means unknown, and neither item is gated.
	const menuSyncKey = syncCapabilities[0]?.key ?? null;
	const menuPausedKeys = selectedWorkerId ? syncPausedQ.data?.[selectedWorkerId] : undefined;
	const menuSyncPaused =
		menuSyncKey && menuPausedKeys ? menuPausedKeys.includes(menuSyncKey) : null;

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
			syncPaused: menuSyncPaused,
			hasWebhook: (webhooksQ.data?.webhooks?.length ?? 0) > 0,
			hasTimeMarker: !!configQ.data?.timeMarker,
		},
		{
			scanForWorkers: () => {
				// No worker needed: this picks a folder to scan for workers, rather
				// than a folder to attach to one selected worker.
				setScanRoot.reset();
				setFolderPickerOpen(true);
			},
			mapBranches: openBranchMap,
			reveal: () => {
				if (selectedWorkerId) revealWorker.mutate(selectedWorkerId);
			},
			renameWorker: () => {
				renameWorker.reset();
				setRenameWorkerOpen(true);
			},
			ntnDeploy: () => confirmDeployAfterFolderCheck("ntn"),
			pnpmDeploy: () => confirmDeployAfterFolderCheck("pnpm"),
			deployUpdatedWorkers: () => setDeployUpdatedWorkersOpen(true),
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
				scanRoot={configQ.data?.scanRoot || null}
				branch={selectedWorkerBranch}
				repoRoot={selectedWorkerRepoRoot}
				repoRemoteUrl={selectedWorkerFolder?.remoteUrl ?? null}
				onRevealRepo={(path) => revealPath.mutate(path)}
				workerName={selectedWorkerName}
				groups={dropdownGroups(workerMenuGroups)}
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
													// Each tab carries its own refresh, scoped to what
													// that tab shows. Clicking one also moves you to
													// that tab — refreshing a view you can't see would
													// be a no-op from the user's side.
													after: (
														<RefreshButton
															title="Refresh workers"
															spinning={
																whoamiQ.isFetching ||
																runHealthQ.isFetching ||
																syncPausedQ.isFetching ||
																localMtimesQ.isFetching ||
																scanQ.isFetching
															}
															onClick={() => {
																// Only switch when needed: switchBrowserTab
																// clears the output panel, which would be a
																// surprising side effect of a refresh click.
																if (browserTab !== "workers") switchBrowserTab("workers");
																refreshWorkersPanel();
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
									<>
										{/* Above the list: they explain why workers or folders
										    are missing from it, and below it they went unnoticed. */}
										{wrongBranchStatuses.map((status) => (
											<RepoBanner
												key={status.repo.root}
												status={status}
												connectedName={connectedWorkspaceName}
												workspaceName={workspaceName}
												suppressedCount={suppressedFor(status)}
											/>
										))}
										<UnmappedReposLine
											statuses={unmappedStatuses}
											suppressedCount={unmappedStatuses.reduce(
												(sum, status) => sum + suppressedFor(status),
												0,
											)}
											connectedName={connectedWorkspaceName}
											onMap={openBranchMap}
										/>
									<WorkersList
										loading={workersQ.isLoading}
										error={workersQ.error as Error | null}
										workers={filteredWorkers}
										selectedId={selectedWorkerId}
										runHealth={workerHealth}
										localPaths={workerFolders}
									syncSchedules={syncSchedulesQ.data ?? {}}
										syncPaused={syncPausedQ.data ?? {}}
										codeOutOfDateWorkerIds={codeOutOfDateWorkerIds}
										envOutOfDateWorkerIds={envOutOfDateWorkerIds}
										localOnly={filteredLocalOnly}
										ignoredFolders={configQ.data?.ignoredFolders ?? []}
										onIgnoreFolder={(path) => ignoreFolder.mutate(path)}
										onUnignoreFolder={(path) => unignoreFolder.mutate(path)}
										onDeployFolder={(path) => {
											setDeployNewWorkerPath(path);
											setDeployNewWorkerOpen(true);
										}}
										filtered={!!workerFilter.trim()}
										onSelect={selectWorker}
										onContextMenu={(id, x, y) => {
											setContextMenu(null);
											if (id !== selectedWorkerId) selectWorker(id);
											setPendingContextMenu({ workerId: id, x, y });
										}}
									/>
									</>
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
					<div className="whitespace-pre-wrap p-3 text-sm text-red-400">
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
			{folderPickerOpen ? (
				<FolderPickerModal
					workerName={null}
					title="Choose a folder to scan for workers"
					selectLabel="Use this folder"
					requireWorkerProject={false}
					startPath={configQ.data?.scanRoot || localPath}
					submitting={setScanRoot.isPending}
					error={setScanRoot.error as Error | null}
					onClose={() => setFolderPickerOpen(false)}
					onResetError={() => setScanRoot.reset()}
					onSelect={(path) => {
						clearTransientOutputs();
						setScanRoot.mutate(path);
					}}
				/>
			) : null}
			{branchMapOpen ? (
				<BranchWorkspaceMapModal
					workspaces={workspaceChoices}
					savedLinks={configQ.data?.branchWorkspaces ?? {}}
					saving={saveBranchWorkspaces.isPending}
					error={saveBranchWorkspaces.error as Error | null}
					onClose={() => setBranchMapOpen(false)}
					onSave={(links) =>
						saveBranchWorkspaces.mutate(links, {
							// The banners and rows follow from the saved config at
							// once; the refresh also picks up any branch switched or
							// login changed while the dialog was open.
							onSuccess: () => {
								setBranchMapOpen(false);
								refreshWorkersPanel();
							},
						})
					}
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
					initialPath={deployNewWorkerPath}
					startPath={localPath}
					whoami={whoamiQ.data ?? null}
					existingWorkers={workersQ.data ?? []}
					onClose={() => {
						setDeployNewWorkerOpen(false);
						setDeployNewWorkerPath(null);
					}}
					onDeployed={(result) => {
						setDeployNewWorkerOpen(false);
						setDeployNewWorkerPath(null);
						clearTransientOutputs();
						setDeployResult(result);
					}}
				/>
			) : null}
			{deployUpdatedWorkersOpen ? (
				<DeployUpdatedWorkersModal
					workers={sortedWorkers}
					localPaths={workerFolders}
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

