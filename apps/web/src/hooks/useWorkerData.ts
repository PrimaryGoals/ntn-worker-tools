import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { api } from "../api";
import type { RunsViewMode } from "./useUIState";

// All read-only data for the app: whoami, config, workers, the selected
// worker's runs/logs/details, and derived values computed from that data.
// Takes the navigation-selection primitives as params since it doesn't own
// them (see useUIState) but every query here depends on them.
export function useWorkerData(
	selectedWorkerId: string | null,
	selectedRunId: string | null,
	verboseLogs: boolean,
	runsViewMode: RunsViewMode,
) {
	const crossWorkerView = runsViewMode === "crossWorker";
	const whoamiQ = useQuery({
		queryKey: ["whoami"],
		queryFn: () => api.getWhoami(true),
		retry: false,
	});
	const configQ = useQuery({ queryKey: ["config"], queryFn: api.getConfig });
	const persistedPanelSizes = configQ.data?.ui?.panelSizes ?? {};
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
	const localMtimesQ = useQuery({
		queryKey: ["localMtimes"],
		queryFn: api.getLocalMtimes,
		enabled: !!whoamiQ.data,
	});
	const runsQ = useQuery({
		queryKey: ["runs", selectedWorkerId],
		queryFn: () => api.getRuns(selectedWorkerId!),
		enabled: !!selectedWorkerId && !crossWorkerView,
	});
	const timeMarker = configQ.data?.timeMarker;
	const crossWorkerRunsQ = useQuery({
		queryKey: ["crossWorkerRuns", timeMarker],
		queryFn: () => api.getCrossWorkerRuns(timeMarker!),
		enabled: crossWorkerView && !!timeMarker,
	});
	const crossWorkerUsageQ = useQuery({
		queryKey: ["crossWorkerUsage"],
		queryFn: () => api.getCrossWorkerUsage(),
		enabled: runsViewMode === "usage",
	});
	const activeRunsData = crossWorkerView ? crossWorkerRunsQ.data : runsQ.data;
	const selectedRun = useMemo(
		() => activeRunsData?.runs.find((r) => r.runId === selectedRunId) ?? null,
		[activeRunsData, selectedRunId],
	);
	// Use the run's own workerId (rather than the sidebar's selectedWorkerId)
	// so a cross-worker run's logs load correctly even though selecting it
	// doesn't change which worker is selected in the sidebar.
	const logsWorkerId = selectedRun?.workerId ?? selectedWorkerId;
	const logsQ = useQuery({
		queryKey: ["logs", logsWorkerId, selectedRunId, verboseLogs],
		queryFn: () => api.getLogs(logsWorkerId!, selectedRunId!, verboseLogs),
		enabled: !!(logsWorkerId && selectedRunId),
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
	const capabilitiesQ = useQuery({
		queryKey: ["capabilities", selectedWorkerId, verboseLogs],
		queryFn: () => api.getWorkerCapabilities(selectedWorkerId!, verboseLogs),
		enabled: !!selectedWorkerId,
	});
	const envQ = useQuery({
		queryKey: ["env", selectedWorkerId, verboseLogs],
		queryFn: () => api.getWorkerEnv(selectedWorkerId!, verboseLogs),
		enabled: !!selectedWorkerId,
	});

	const workerNamesById = useMemo(
		() => Object.fromEntries((workersQ.data ?? []).map((w) => [w.workerId, w.name])),
		[workersQ.data],
	);
	const sortedWorkers = useMemo(
		() =>
			[...(workersQ.data ?? [])].sort((a, b) =>
				a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
			),
		[workersQ.data],
	);
	// workerId -> local code changed more recently than the last code deploy
	// THIS APP recorded (see AppConfig.workerLastCodeDeployAt). Only
	// meaningful for workers with a registered local path AND at least one
	// recorded deploy — a missing mtime or missing record means "can't tell",
	// not "up to date". Deliberately NOT compared against the worker's live
	// `updatedAt`: that bumps on any mutation (including env pushes), which
	// can mask an undeployed code change behind an unrelated secrets push.
	const codeOutOfDateWorkerIds = useMemo(() => {
		const mtimes = localMtimesQ.data;
		const lastDeploy = configQ.data?.workerLastCodeDeployAt;
		if (!mtimes || !lastDeploy) return new Set<string>();
		const ids = new Set<string>();
		for (const w of workersQ.data ?? []) {
			const mtime = mtimes[w.workerId]?.code;
			const last = lastDeploy[w.workerId];
			if (mtime && last && new Date(mtime) > new Date(last)) ids.add(w.workerId);
		}
		return ids;
	}, [workersQ.data, localMtimesQ.data, configQ.data?.workerLastCodeDeployAt]);

	// Same idea for .env: local .env changed more recently than the last env
	// push THIS APP recorded.
	const envOutOfDateWorkerIds = useMemo(() => {
		const mtimes = localMtimesQ.data;
		const lastPush = configQ.data?.workerLastEnvPushAt;
		if (!mtimes || !lastPush) return new Set<string>();
		const ids = new Set<string>();
		for (const w of workersQ.data ?? []) {
			const mtime = mtimes[w.workerId]?.env;
			const last = lastPush[w.workerId];
			if (mtime && last && new Date(mtime) > new Date(last)) ids.add(w.workerId);
		}
		return ids;
	}, [workersQ.data, localMtimesQ.data, configQ.data?.workerLastEnvPushAt]);

	const capabilities = capabilitiesQ.data?.capabilities;
	const syncCapabilities = useMemo(() => {
		if (!Array.isArray(capabilities)) return [];
		return capabilities.filter((c: { _tag?: string }) => c._tag === "sync") as Array<{ _tag: string; key: string }>;
	}, [capabilities]);
	const isSyncWorker = syncCapabilities.length > 0;

	// The oauth capability's key (e.g. "googleDrive") — undefined/no entry
	// means this worker has no oauth capability at all.
	const oauthCapabilityKey = useMemo(() => {
		if (!Array.isArray(capabilities)) return null;
		const found = (capabilities as Array<{ _tag?: string; key?: string }>).find(
			(c) => c._tag === "oauth",
		);
		return found?.key ?? null;
	}, [capabilities]);

	const syncStatusQ = useQuery({
		queryKey: ["syncStatus", selectedWorkerId, verboseLogs],
		queryFn: () => api.getSyncStatus(selectedWorkerId!, verboseLogs),
		enabled: !!(selectedWorkerId && isSyncWorker),
	});

	return {
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
		localMtimesQ,
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
		syncCapabilities,
		isSyncWorker,
		syncStatusQ,
		oauthCapabilityKey,
	};
}
