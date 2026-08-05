import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { DeployResult } from "@ntn-worker-tools/shared";
import { api } from "../api";

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
		onSuccess: (data) => {
			setDeployResult(data);
			if (selectedWorkerId) qc.invalidateQueries({ queryKey: ["syncStatus", selectedWorkerId] });
		},
	});
	const syncResume = useMutation({
		mutationFn: ({ workerId, syncKey }: { workerId: string; syncKey: string }) =>
			api.syncResume(workerId, syncKey, verboseLogs),
		onSuccess: (data) => {
			setDeployResult(data);
			if (selectedWorkerId) qc.invalidateQueries({ queryKey: ["syncStatus", selectedWorkerId] });
		},
	});
	const syncStateReset = useMutation({
		mutationFn: ({ workerId, syncKey }: { workerId: string; syncKey: string }) =>
			api.syncStateReset(workerId, syncKey, verboseLogs),
		onSuccess: (data) => {
			setDeployResult(data);
			if (selectedWorkerId) qc.invalidateQueries({ queryKey: ["syncStatus", selectedWorkerId] });
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
		(pushSecrets.error as Error | null) ??
		(setEnvVar.error as Error | null) ??
		(syncTrigger.error as Error | null) ??
		(syncPause.error as Error | null) ??
		(syncResume.error as Error | null) ??
		(syncStateReset.error as Error | null);

	function resetAll() {
		setDeployResult(null);
		deployWorker.reset();
		pnpmDeployWorker.reset();
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
		resetAll,
	};
}
