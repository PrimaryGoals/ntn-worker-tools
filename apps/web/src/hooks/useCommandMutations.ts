import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import type { DeployResult } from "@ntn-worker-tools/shared";
import { api } from "../api";
import { formatSyncStatuses, ntnCmd } from "../format";

// Result of the "check sync status" follow-up fired ~5s after sync
// pause/resume/reset, so the user can see the effect of the action they
// just took without a separate click. "pending" is shown while waiting.
export type SyncStatusFollowup =
	| { state: "pending" }
	| { state: "done"; command: string; output: string; trace?: string };

// Deploy and sync mutations share deployResult (the output panel shows
// whichever one ran most recently) and are combined in runningCommand /
// anyDeployError, so they live together in one hook rather than split.
export function useCommandMutations(
	verboseLogs: boolean,
	selectedWorkerId: string | null,
	setTokenPushOpen: (open: boolean) => void,
) {
	const qc = useQueryClient();
	const [deployResult, setDeployResult] = useState<DeployResult | null>(null);
	const [syncStatusFollowup, setSyncStatusFollowup] = useState<SyncStatusFollowup | null>(null);
	// Invalidated on every new sync action / resetAll() so a status check
	// that resolves after the user has moved on doesn't overwrite the panel.
	const followupTokenRef = useRef(0);

	// Fired after sync pause/resume/reset (not trigger — that's launched from
	// a different control). Waits ~5s, then re-checks sync status so the user
	// can see the effect of the action without a separate click.
	function scheduleSyncStatusFollowup(workerId: string) {
		const token = ++followupTokenRef.current;
		setSyncStatusFollowup({ state: "pending" });
		const command = ntnCmd([
			"workers",
			"sync",
			"status",
			"--worker-id",
			workerId,
			"--no-watch",
			...(verboseLogs ? ["-v"] : []),
		]);
		setTimeout(async () => {
			try {
				const result = await api.getSyncStatus(workerId, verboseLogs);
				if (followupTokenRef.current !== token) return;
				setSyncStatusFollowup({
					state: "done",
					command,
					output: formatSyncStatuses(result.statuses),
					trace: result._trace,
				});
			} catch (err) {
				if (followupTokenRef.current !== token) return;
				setSyncStatusFollowup({
					state: "done",
					command,
					output: `Error: ${(err as Error).message}`,
				});
			}
		}, 5000);
	}

	const deployWorker = useMutation({
		mutationFn: (workerId: string) => api.deployWorker(workerId, verboseLogs),
		onSuccess: (data) => {
			setDeployResult(data);
			qc.invalidateQueries({ queryKey: ["workers"] });
		},
	});
	const pnpmDeployWorker = useMutation({
		mutationFn: api.pnpmDeployWorker,
		onSuccess: (data) => {
			setDeployResult(data);
			qc.invalidateQueries({ queryKey: ["workers"] });
		},
	});
	const deployUpdatedWorkers = useMutation({
		mutationFn: (verbose: boolean) => api.deployUpdatedWorkers(verbose),
		onSuccess: (data) => {
			setDeployResult(data);
			qc.invalidateQueries({ queryKey: ["workers"] });
		},
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
	const syncTrigger = useMutation({
		mutationFn: ({ workerId, syncKey }: { workerId: string; syncKey: string }) =>
			api.syncTrigger(workerId, syncKey, verboseLogs),
		onSuccess: (data) => {
			setDeployResult(data);
			if (selectedWorkerId) {
				const workerId = selectedWorkerId;
				qc.invalidateQueries({ queryKey: ["runs", workerId] });
				qc.invalidateQueries({ queryKey: ["syncStatus", workerId] });
				setTimeout(() => {
					qc.invalidateQueries({ queryKey: ["runs", workerId] });
					qc.invalidateQueries({ queryKey: ["syncStatus", workerId] });
				}, 2000);
			}
		},
	});
	const syncPause = useMutation({
		mutationFn: ({ workerId, syncKey }: { workerId: string; syncKey: string }) =>
			api.syncPause(workerId, syncKey, verboseLogs),
		onSuccess: (data, variables) => {
			setDeployResult(data);
			scheduleSyncStatusFollowup(variables.workerId);
			if (selectedWorkerId) qc.invalidateQueries({ queryKey: ["syncStatus", selectedWorkerId] });
		},
	});
	const syncResume = useMutation({
		mutationFn: ({ workerId, syncKey }: { workerId: string; syncKey: string }) =>
			api.syncResume(workerId, syncKey, verboseLogs),
		onSuccess: (data, variables) => {
			setDeployResult(data);
			scheduleSyncStatusFollowup(variables.workerId);
			if (selectedWorkerId) qc.invalidateQueries({ queryKey: ["syncStatus", selectedWorkerId] });
		},
	});
	const syncStateReset = useMutation({
		mutationFn: ({ workerId, syncKey }: { workerId: string; syncKey: string }) =>
			api.syncStateReset(workerId, syncKey, verboseLogs),
		onSuccess: (data, variables) => {
			setDeployResult(data);
			scheduleSyncStatusFollowup(variables.workerId);
			if (selectedWorkerId) qc.invalidateQueries({ queryKey: ["syncStatus", selectedWorkerId] });
		},
	});

	const runningCommand = deployWorker.isPending
		? "ntn workers deploy"
		: pnpmDeployWorker.isPending
			? "pnpm run deploy"
			: deployUpdatedWorkers.isPending
				? "deploy updated workers"
				: pushSecrets.isPending
				? "ntn workers env push"
				: setEnvVar.isPending
					? "ntn workers env set"
					: syncTrigger.isPending
						? "ntn workers sync trigger"
						: syncPause.isPending
							? "ntn workers sync pause"
							: syncResume.isPending
								? "ntn workers sync resume"
								: syncStateReset.isPending
									? "ntn workers sync state reset"
									: null;
	const anyDeployError =
		(deployWorker.error as Error | null) ??
		(pnpmDeployWorker.error as Error | null) ??
		(deployUpdatedWorkers.error as Error | null) ??
		(pushSecrets.error as Error | null) ??
		(setEnvVar.error as Error | null) ??
		(syncTrigger.error as Error | null) ??
		(syncPause.error as Error | null) ??
		(syncResume.error as Error | null) ??
		(syncStateReset.error as Error | null);

	function resetAll() {
		followupTokenRef.current++;
		setSyncStatusFollowup(null);
		setDeployResult(null);
		deployWorker.reset();
		pnpmDeployWorker.reset();
		deployUpdatedWorkers.reset();
		pushSecrets.reset();
		setEnvVar.reset();
		syncTrigger.reset();
		syncPause.reset();
		syncResume.reset();
		syncStateReset.reset();
	}

	return {
		deployWorker,
		pnpmDeployWorker,
		deployUpdatedWorkers,
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
		resetAll,
	};
}
