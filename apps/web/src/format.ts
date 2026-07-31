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
