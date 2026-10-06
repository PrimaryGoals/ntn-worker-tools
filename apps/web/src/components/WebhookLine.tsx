import type { WebhookEntry } from "@ntn-worker-tools/shared";

// Notion now hands back webhook URLs on <id>.webhook.notionusercontent.com;
// the previous format was https://app.notion.com/webhooks/worker/... Returns
// null when the URL is not in the new format.
function toOldFormatUrl(url: string): string | null {
	const next = url.replace(/^https:\/\/[^/]+\.webhook\.notionusercontent\.com\//, "https://app.notion.com/");
	return next === url ? null : next;
}

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
					const oldUrl = toOldFormatUrl(w.url);
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
							{oldUrl ? (
								<a
									href={oldUrl}
									onClick={(e) => {
										e.preventDefault();
										if (firing === null) onFire(oldUrl);
									}}
									className="shrink-0 text-blue-600 hover:underline dark:text-blue-400"
									title={`POST ${oldUrl}`}
								>
									(use old format)
								</a>
							) : null}
					</div>
				);
			})}
		</div>
	);
}
