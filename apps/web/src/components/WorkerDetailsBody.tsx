import type { Worker } from "@ntn-worker-tools/shared";
import { formatDateTime } from "../format";

export function WorkerDetailsBody({
	worker: w,
	lastCodeDeployAt,
	lastEnvPushAt,
}: {
	worker: Worker;
	// ISO timestamps this app recorded itself (see AppConfig.workerLastCodeDeployAt /
	// workerLastEnvPushAt) — undefined when no local path is registered for this
	// worker, or it hasn't been deployed/pushed through this app yet.
	lastCodeDeployAt?: string;
	lastEnvPushAt?: string;
}) {
	const rows: Array<[string, string]> = [
		["ID", w.workerId],
		["Name", w.name],
		["Space ID", w.spaceId],
		["Created at", formatDateTime(w.createdAt)],
		["Updated at", formatDateTime(w.updatedAt)],
		["Updated by", w.updatedByName ?? ""],
		["Secrets pushed", lastEnvPushAt ? formatDateTime(lastEnvPushAt) : "—"],
		["Code pushed", lastCodeDeployAt ? formatDateTime(lastCodeDeployAt) : "—"],
	];
	const labelWidth = rows.reduce((m, [l]) => Math.max(m, l.length), 0);
	return <>{rows.map(([label, value]) => `${label.padEnd(labelWidth)} ${value}\n`).join("")}</>;
}
