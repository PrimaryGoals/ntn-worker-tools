import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { WebhookFireResult } from "@ntn-worker-tools/shared";
import { api } from "../api";

export function useWebhookMutations(selectedWorkerId: string | null) {
	const qc = useQueryClient();
	const [webhookResult, setWebhookResult] = useState<WebhookFireResult | null>(null);

	const fireWebhook = useMutation({
		mutationFn: ({ url, webhookSecret }: { url: string; webhookSecret?: string }) =>
			api.fireWebhook(url, webhookSecret),
		onSuccess: (data) => {
			setWebhookResult(data);
			// The webhook we just fired triggers a worker run. Refresh the runs
			// query so the new entry shows up in panel_runs. Notion sometimes
			// hasn't recorded the run yet at the moment the fire returns, so we
			// also re-invalidate after a short delay to catch that late-arriving
			// entry (and its updated status once it finishes).
			if (selectedWorkerId) {
				const workerId = selectedWorkerId;
				qc.invalidateQueries({ queryKey: ["runs", workerId] });
				setTimeout(() => qc.invalidateQueries({ queryKey: ["runs", workerId] }), 2000);
			}
		},
	});

	function resetWebhookResult() {
		setWebhookResult(null);
		fireWebhook.reset();
	}

	return { fireWebhook, webhookResult, setWebhookResult, resetWebhookResult };
}
