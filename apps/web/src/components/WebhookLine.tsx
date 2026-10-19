import type { WebhookEntry } from "@ntn-worker-tools/shared";

export function WebhookLine({
	loading,
	error,
	webhooks,
	onFire,
	firing,
	syncCapabilities,
	onSyncTrigger,
	syncTriggering,
}: {
	loading: boolean;
	error: Error | null;
	webhooks: WebhookEntry[];
	onFire: (url: string) => void;
	firing: string | null;
	syncCapabilities: Array<{ _tag: string; key: string }>;
	onSyncTrigger: (syncKey: string) => void;
	syncTriggering: boolean;
}) {
	if (loading) {
		return <div className="text-xs text-neutral-500">Loading webhooks…</div>;
	}
	if (error) {
		return <div className="text-xs text-red-600">Webhooks: {error.message}</div>;
	}
	if (webhooks.length === 0) {
		if (syncCapabilities.length > 0) {
			return (
				<div className="flex flex-col gap-0.5 text-xs">
					{syncCapabilities.map((c) => (
						<div key={c.key} className="flex items-baseline gap-2">
							<span className="text-neutral-500">Trigger:</span>
							<button
								type="button"
								disabled={syncTriggering}
								onClick={() => onSyncTrigger(c.key)}
								className={
									"hover:underline " +
									(syncTriggering
										? "text-neutral-400 dark:text-neutral-500"
										: "text-blue-600 dark:text-blue-400")
								}
							>
								{c.key}
							</button>
							{syncTriggering ? <span className="text-neutral-500">triggering…</span> : null}
						</div>
					))}
				</div>
			);
		}
		return <div className="text-xs text-neutral-500">No webhooks for this worker.</div>;
	}
	return (
		<div className="flex flex-col gap-0.5 text-xs">
			{webhooks.map((w) => {
				const isFiring = firing === w.url;
				return (
					<div key={w.key} className="flex items-baseline gap-2">
						<span className="text-neutral-500">Webhook ({w.key}):</span>
						<a
							href={w.url}
							onClick={(e) => {
								e.preventDefault();
								if (!isFiring) onFire(w.url);
							}}
							className={
								"truncate font-mono hover:underline " +
								(isFiring
									? "text-neutral-400 dark:text-neutral-500"
									: "text-blue-600 dark:text-blue-400")
							}
							title={`POST ${w.url}\n(right-click to copy the URL)`}
						>
							{w.url}
						</a>
						{isFiring ? <span className="text-neutral-500">POSTing…</span> : null}
					</div>
				);
			})}
		</div>
	);
}
