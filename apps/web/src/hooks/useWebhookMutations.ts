import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import type { RunsPayload, WebhookFireResult } from "@ntn-worker-tools/shared";
import { api } from "../api";
import { ntnCmd } from "../format";

// Result of polling for the run this webhook fire triggered, then fetching
// its logs once it completes. "polling" covers both "no new run yet" and
// "new run still running" — the user doesn't need to distinguish those.
export type RunLogsFollowup =
	| { state: "polling" }
	| { state: "done"; command: string; output: string; trace?: string }
	| { state: "timeout" };

const POLL_CAP_SECONDS = 300; // 5 minutes

export function useWebhookMutations(selectedWorkerId: string | null, verboseLogs: boolean) {
	const qc = useQueryClient();
	const [webhookResult, setWebhookResult] = useState<WebhookFireResult | null>(null);
	const [runLogsFollowup, setRunLogsFollowup] = useState<RunLogsFollowup | null>(null);
	// Invalidated on a new fire / resetWebhookResult() so a poll round that
	// resolves after the user has moved on doesn't overwrite the panel.
	const followupTokenRef = useRef(0);
	// Snapshot of this worker's runIds taken right before firing. Comparing
	// startedAt against a client-clock timestamp used to miss runs whenever
	// the local clock ran even slightly ahead of Notion's — the comparison
	// could never become true, so the poll ran out the clock and reported a
	// false timeout even though the run had completed fine.
	const existingRunIdsRef = useRef<Set<string>>(new Set());

	// Polls `ntn workers runs list` (scoped to this one workerId) with a
	// widening gap (5s, 10s, 15s, ...) until a run whose id wasn't in the
	// pre-fire snapshot shows up with an exit code, then fetches its logs.
	async function pollForRunCompletion(workerId: string, existingRunIds: Set<string>) {
		const token = ++followupTokenRef.current;
		setRunLogsFollowup({ state: "polling" });

		let gap = 5;
		let elapsed = 0;
		while (true) {
			await new Promise((resolve) => setTimeout(resolve, gap * 1000));
			if (followupTokenRef.current !== token) return;
			elapsed += gap;
			if (elapsed > POLL_CAP_SECONDS) {
				setRunLogsFollowup({ state: "timeout" });
				return;
			}

			let runsPayload;
			try {
				runsPayload = await api.getRuns(workerId);
			} catch {
				gap += 5;
				continue;
			}
			if (followupTokenRef.current !== token) return;
			qc.setQueryData(["runs", workerId], runsPayload);

			const newRun = runsPayload.runs.find((run) => !existingRunIds.has(run.runId));
			if (newRun && newRun.exitCode != null) {
				const command = ntnCmd([
					"workers",
					"runs",
					"logs",
					newRun.runId,
					"--worker-id",
					workerId,
					...(verboseLogs ? ["-v"] : []),
				]);
				try {
					const logsResult = await api.getLogs(workerId, newRun.runId, verboseLogs);
					if (followupTokenRef.current !== token) return;
					setRunLogsFollowup({
						state: "done",
						command,
						output: logsResult.logs || "(no output)",
						trace: logsResult._trace,
					});
				} catch (err) {
					if (followupTokenRef.current !== token) return;
					setRunLogsFollowup({ state: "done", command, output: `Error: ${(err as Error).message}` });
				}
				return;
			}
			gap += 5;
		}
	}

	const fireWebhook = useMutation({
		mutationFn: ({ url, webhookSecret }: { url: string; webhookSecret?: string }) =>
			api.fireWebhook(url, webhookSecret, verboseLogs),
		onMutate: () => {
			// Scoped to this one workerId's cached run list, so it can only ever
			// match against runs belonging to the worker that's about to fire.
			const cached = selectedWorkerId
				? qc.getQueryData<RunsPayload>(["runs", selectedWorkerId])
				: undefined;
			existingRunIdsRef.current = new Set((cached?.runs ?? []).map((run) => run.runId));
		},
		onSuccess: (data) => {
			setWebhookResult(data);
			if (selectedWorkerId) {
				const workerId = selectedWorkerId;
				qc.invalidateQueries({ queryKey: ["runs", workerId] });
				pollForRunCompletion(workerId, existingRunIdsRef.current);
			}
		},
	});

	function resetWebhookResult() {
		setWebhookResult(null);
		fireWebhook.reset();
		followupTokenRef.current++;
		setRunLogsFollowup(null);
	}

	return { fireWebhook, webhookResult, setWebhookResult, runLogsFollowup, resetWebhookResult };
}
