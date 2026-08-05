import type { Worker } from "@ntn-worker-tools/shared";
import { formatDateTime } from "../format";

export function WorkerDetailsBody({ worker: w }: { worker: Worker }) {
	const rows: Array<[string, string]> = [
		["ID", w.workerId],
		["Name", w.name],
		["Space ID", w.spaceId],
		["Created at", formatDateTime(w.createdAt)],
		["Updated at", formatDateTime(w.updatedAt)],
		["Updated by", w.updatedByName ?? ""],
	];
	const labelWidth = rows.reduce((m, [l]) => Math.max(m, l.length), 0);
	return <>{rows.map(([label, value]) => `${label.padEnd(labelWidth)} ${value}\n`).join("")}</>;
}
