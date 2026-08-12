import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { api } from "../api";

// All read-only data for the app: whoami, config, workers, the selected
// worker's runs/logs/details, and derived values computed from that data.
// Takes the navigation-selection primitives as params since it doesn't own
// them (see useUIState) but every query here depends on them.
export function useWorkerData(
	selectedWorkerId: string | null,
	selectedRunId: string | null,
	verboseLogs: boolean,
) {
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
	// workerId -> local files were modified more recently than the worker's
	// last deploy (updatedAt). Only meaningful for workers with a registered
	// local path — a null/missing mtime means "can't tell", not "up to date".
	const outOfDateWorkerIds = useMemo(() => {
		const mtimes = localMtimesQ.data;
		if (!mtimes) return new Set<string>();
		const ids = new Set<string>();
		for (const w of workersQ.data ?? []) {
			const mtime = mtimes[w.workerId];
			if (mtime && new Date(mtime) > new Date(w.updatedAt)) ids.add(w.workerId);
		}
		return ids;
	}, [workersQ.data, localMtimesQ.data]);

	const capabilities = capabilitiesQ.data?.capabilities;
	const syncCapabilities = useMemo(() => {
		if (!Array.isArray(capabilities)) return [];
		return capabilities.filter((c: { _tag?: string }) => c._tag === "sync") as Array<{ _tag: string; key: string }>;
	}, [capabilities]);
	const isSyncWorker = syncCapabilities.length > 0;

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
		logsQ,
		workerQ,
		workerUsageQ,
		webhooksQ,
		capabilitiesQ,
		envQ,
		selectedRun,
		sortedWorkers,
		outOfDateWorkerIds,
		syncCapabilities,
		isSyncWorker,
		syncStatusQ,
	};
}
