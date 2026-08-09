import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import type { WebhookFireResult } from "@ntn-worker-tools/shared";
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
	const fireStartRef = useRef(0);

	// Polls `ntn workers runs list` with a widening gap (5s, 10s, 15s, ...)
	// until a run that started at/after `firedAt` shows up with an exit code,
	// then fetches and displays its logs. Runs that predate `firedAt` are
	// ignored — they're a leftover from before this fire, not its result.
	async function pollForRunCompletion(workerId: string, firedAt: number) {
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

			const mostRecent = runsPayload.runs[0];
			const isOurs = mostRecent && new Date(mostRecent.startedAt).getTime() >= firedAt;
			if (isOurs && mostRecent.exitCode != null) {
				const command = ntnCmd([
					"workers",
					"runs",
					"logs",
					mostRecent.runId,
					"--worker-id",
					workerId,
					...(verboseLogs ? ["-v"] : []),
				]);
				try {
					const logsResult = await api.getLogs(workerId, mostRecent.runId, verboseLogs);
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
			fireStartRef.current = Date.now();
		},
		onSuccess: (data) => {
			setWebhookResult(data);
			if (selectedWorkerId) {
				const workerId = selectedWorkerId;
				qc.invalidateQueries({ queryKey: ["runs", workerId] });
				pollForRunCompletion(workerId, fireStartRef.current);
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
