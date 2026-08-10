import type {
	DeployResult,
	SyncStatus,
	WebhookEntry,
	WebhookFireResult,
	WorkerUsage,
	Whoami,
} from "@ntn-worker-tools/shared";

export function formatDuration(startedAt: string, endedAt: string | null): string {
	if (!endedAt) return "running";
	const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();
	if (!Number.isFinite(ms) || ms < 0) return "?";
	if (ms < 1000) return `${ms}ms`;
	const s = ms / 1000;
	if (s < 60) return `${s.toFixed(s < 10 ? 2 : 1)}s`;
	const m = Math.floor(s / 60);
	const rs = Math.round(s - m * 60);
	if (m < 60) return `${m}m ${rs}s`;
	const h = Math.floor(m / 60);
	return `${h}h ${m - h * 60}m`;
}

const dateTimeFmt = new Intl.DateTimeFormat(undefined, {
	year: "numeric",
	month: "short",
	day: "2-digit",
	hour: "2-digit",
	minute: "2-digit",
	second: "2-digit",
	hour12: false,
	timeZoneName: "short",
});

export function formatDateTime(iso: string): string {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return iso;
	return dateTimeFmt.format(d);
}

export function ntnCmd(args: string[]): string {
	return `ntn ${args.join(" ")}`;
}

export const SEPARATOR = "─".repeat(60);

export function formatBytes(n: number): string {
	if (!Number.isFinite(n)) return String(n);
	if (n < 1024) return `${n} B`;
	const units = ["KB", "MB", "GB", "TB"];
	let v = n / 1024;
	let i = 0;
	while (v >= 1024 && i < units.length - 1) {
		v /= 1024;
		i++;
	}
	return `${v.toFixed(v < 10 ? 2 : 1)} ${units[i]} (${n.toLocaleString()} B)`;
}

export function formatMs(ms: number): string {
	if (!Number.isFinite(ms)) return String(ms);
	if (ms < 1000) return `${ms.toLocaleString()} ms`;
	const s = ms / 1000;
	if (s < 60) return `${s.toFixed(2)} s (${ms.toLocaleString()} ms)`;
	const m = Math.floor(s / 60);
	const rs = (s - m * 60).toFixed(1);
	return `${m}m ${rs}s (${ms.toLocaleString()} ms)`;
}

export function formatWhoami(w: Whoami): string {
	const rows: Array<[string, string]> = [
		["User", w.userName],
		["User ID", w.userId],
		["User type", w.userType],
	];
	if (w.userEmail) rows.push(["Email", w.userEmail]);
	rows.push(["Workspace", w.spaceName], ["Space ID", w.spaceId]);
	if (w.ownerName) rows.push(["Owner", w.ownerName]);
	if (w.ownerId) rows.push(["Owner ID", w.ownerId]);
	if (w.ownerType) rows.push(["Owner type", w.ownerType]);
	const labelWidth = rows.reduce((m, [l]) => Math.max(m, l.length), 0);
	return rows.map(([label, value]) => `${label.padEnd(labelWidth)} ${value}`).join("\n");
}

export function formatWorkerUsage(u: WorkerUsage): string {
	const rows: Array<[string, string]> = [
		["Usage window", `${u.days} day${u.days === 1 ? "" : "s"}`],
		["Credits", u.usage.credits.toFixed(6)],
		["Sandboxes", u.usage.sandboxCount.toLocaleString()],
		["Active CPU", formatMs(u.usage.activeCpuDurationMs)],
		["Total time", formatMs(u.usage.durationMs)],
		["Ingress", formatBytes(u.usage.networkIngressBytes)],
		["Egress", formatBytes(u.usage.networkEgressBytes)],
	];
	const labelWidth = rows.reduce((m, [l]) => Math.max(m, l.length), 0);
	return rows.map(([label, value]) => `${label.padEnd(labelWidth)} ${value}`).join("\n");
}

export function formatCapabilities(caps: unknown): string {
	if (!Array.isArray(caps) || caps.length === 0) return "(none)";
	return caps
		.map((c: { _tag?: string; key?: string }) => `${c._tag ?? "unknown"}: ${c.key ?? "?"}`)
		.join("\n");
}

export function formatWebhookUrls(webhooks: WebhookEntry[]): string {
	return webhooks.map((w) => w.url).join("\n");
}

export function formatTimeAgo(ms: number | null): string {
	if (ms == null) return "never";
	const diff = Date.now() - ms;
	if (diff < 0) return `in ${formatTimeDelta(-diff)}`;
	return `${formatTimeDelta(diff)} ago`;
}

export function formatTimeUntil(ms: number | null): string {
	if (ms == null) return "unknown";
	const diff = ms - Date.now();
	if (diff < 0) return `${formatTimeDelta(-diff)} ago`;
	return `in ${formatTimeDelta(diff)}`;
}

export function formatTimeDelta(ms: number): string {
	const s = Math.floor(ms / 1000);
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m`;
	const h = Math.floor(m / 60);
	const rm = m % 60;
	if (h < 24) return rm ? `${h}h ${rm}m` : `${h}h`;
	const d = Math.floor(h / 24);
	const rh = h % 24;
	return rh ? `${d}d ${rh}h` : `${d}d`;
}

export function formatInterval(ms: number): string {
	const s = ms / 1000;
	if (s < 60) return `every ${s}s`;
	const m = s / 60;
	if (m < 60) return `every ${m}m`;
	const h = m / 60;
	if (h < 24) return `every ${h}h`;
	const d = h / 24;
	return `every ${d}d`;
}

export function formatAvgRun(durations: number[]): string {
	if (durations.length === 0) return "n/a";
	const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
	return `${(avg / 1000).toFixed(1)}s`;
}

export function formatSyncStatuses(statuses: SyncStatus[]): string {
	return statuses.map((s) => {
		const lines: string[] = [];
		lines.push(`${s.capabilityKey}  ${s.status.toUpperCase()}`);
		lines.push(`  Database:        https://www.notion.so/ds/${s.collectionId}`);
		lines.push(`  Schedule:        ${formatInterval(s.schedule.intervalMs)}`);
		lines.push("  Health");
		for (const c of s.checks) {
			lines.push(`    ${c.slug.padEnd(14)} ${c.description}`);
		}
		lines.push("  Stats");
		lines.push(`    Last succeeded:  ${formatTimeAgo(s.stats.lastSucceededAt)}`);
		lines.push(`    Last completed:  ${formatTimeAgo(s.stats.lastCompletedAt)}`);
		lines.push(`    Next run:        ${formatTimeUntil(s.nextRunAt)}`);
		lines.push(`    Cycle:           ${s.stats.cycleUpsertsProcessed} upserts, ${s.stats.cycleDeletesProcessed} deletes`);
		lines.push(`    Total:           ${s.stats.totalUpsertsProcessed} upserts, ${s.stats.totalDeletesProcessed} deletes`);
		lines.push(`    Avg run:         ${formatAvgRun(s.stats.recentRunDurationsMs)}`);
		return lines.join("\n");
	}).join("\n\n");
}

// Strip ANSI SGR escape codes (colors, dim, bold, etc.) so raw ntn output
// renders cleanly in a plain <pre>. eslint-disable is for the intentional
// control char in the regex.
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m/g;
export function stripAnsi(s: string): string {
	return s.replace(ANSI_RE, "");
}

export function formatDeployResult(r: DeployResult): string {
	const header = `cwd: ${r.cwd}\nexit ${r.exitCode}   (${r.durationMs} ms)`;
	const parts = [header];
	// Build progress (stderr) first — matches the order you'd see in a terminal.
	const stderr = stripAnsi(r.stderr).trim();
	if (stderr) parts.push(SEPARATOR, stderr);
	// If no --json summary is available, fall back to raw stdout in the same slot.
	if (!r.summary && r.stdout.trim()) {
		parts.push(SEPARATOR, stripAnsi(r.stdout).trimEnd());
	}
	// Summary last — this is the "✔ Worker updated / webhook URLs" section.
	if (r.summary) {
		const s = r.summary;
		const lines: string[] = [
			s.is_update ? "✔ Worker updated" : "✔ Worker created",
			`Worker ID:  ${s.worker_id}`,
		];
		if (s.capabilities.length) {
			lines.push("", "Capabilities:");
			for (const c of s.capabilities) lines.push(`  ${c._tag.padEnd(10)} ${c.key}`);
		}
		if (s.webhook_urls.length) {
			lines.push("", "Webhook URLs:");
			for (const w of s.webhook_urls) lines.push(`  ${w.key} → ${w.url}`);
		}
		if (s.database_links.length) {
			lines.push("", `Database links: ${s.database_links.length}`);
		}
		parts.push(SEPARATOR, lines.join("\n"));
	}
	// Followup command (e.g. env pull after env push) at the very bottom.
	if (r.followup) {
		const f = r.followup;
		const header = `${f.command}\nexit ${f.exitCode}   (${f.durationMs} ms)`;
		parts.push(SEPARATOR, header);
		const fStderr = stripAnsi(f.stderr).trim();
		if (fStderr) parts.push(fStderr);
		const fStdout = stripAnsi(f.stdout).trimEnd();
		if (fStdout) parts.push(fStdout);
	}
	return parts.join("\n");
}

// Read the WEBHOOK_SECRET value from a .env-style KEY=VALUE dump. Trims a
// trailing carriage return so Windows-shaped lines don't leak into the header.
export function extractWebhookSecret(envText: string): string | undefined {
	const m = envText.match(/^WEBHOOK_SECRET=(.*)$/m);
	if (!m) return undefined;
	const v = m[1]?.replace(/\r$/, "") ?? "";
	return v || undefined;
}

export function formatWebhookResult(r: WebhookFireResult): string {
	const status = r.statusText ? `${r.status} ${r.statusText}` : `${r.status}`;
	const lines = [`Status: ${status}   (${r.durationMs} ms)`];
	if (r.sentHeaders?.length) {
		for (const h of r.sentHeaders) lines.push(`Header sent: ${h}: (present)`);
	}
	const body = r.body?.length ? r.body : "(empty body)";
	return `${lines.join("\n")}\n${"─".repeat(60)}\n${body}`;
}

// Rewrites the raw server error into a friendlier message for folder selection
// errors. Shows the actual worker name from the folder when there's a mismatch.
export function friendlySetPathError(
	err: Error | null,
	workerName: string | null,
): Error | null {
	if (!err) return null;
	if (err.message.startsWith("worker mismatch")) {
		const folderWorkerName = (err as Record<string, unknown>).folderWorkerName;
		if (folderWorkerName) {
			return new Error(
				`The folder you chose appears to be for a worker called ${folderWorkerName}`,
			);
		}
	}
	if (
		err.message.includes("not a worker project") ||
		err.message.includes("workers.json is not valid JSON") ||
		err.message.includes("workers.json is missing a workerId") ||
		err.message.includes("path is not a directory")
	) {
		return new Error("This is not a worker folder");
	}
	return err;
}
