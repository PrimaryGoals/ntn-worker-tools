import type { ScanResult } from "@ntn-worker-tools/shared";
import { runScan } from "./scan.js";
import { getConfig } from "./state.js";

// The scan is the single source for where a worker's code lives, replacing the
// workerId -> folder map the config used to keep. That map could only ever go
// stale: it recorded a path once and never looked again, so it accumulated
// folders that had moved, been deleted, or belonged to a worker in another
// workspace entirely.
//
// Scanning is not cheap — a directory walk plus a content hash per worker — so
// routes that need one folder read a cached result instead of rescanning.

const TTL_MS = 30_000;
// How recent a cached result must be before a lookup miss is believed rather
// than re-checked. Without this, every request for an unknown worker would
// trigger a full scan.
const TRUST_MISS_MS = 5_000;

let cached: { at: number; result: ScanResult } | null = null;
let inFlight: Promise<ScanResult> | null = null;

// Called when something changes what a scan would find: a deploy writes a new
// workers.json, a rename moves a folder, the roots change.
export function invalidateScan(): void {
	cached = null;
}

export async function getScan(force = false): Promise<ScanResult> {
	if (!force && cached && Date.now() - cached.at < TTL_MS) return cached.result;
	// Concurrent callers share one walk rather than racing several.
	if (!force && inFlight) return inFlight;
	const config = getConfig();
	const pending = runScan(
		config.scanRoot || null,
		config.extraWorkerFolders ?? [],
		config.ignoredFolders ?? [],
	);
	inFlight = pending;
	try {
		const result = await pending;
		cached = { at: Date.now(), result };
		return result;
	} finally {
		if (inFlight === pending) inFlight = null;
	}
}

function findPath(result: ScanResult, workerId: string): string | null {
	return result.workers.find((worker) => worker.workerId === workerId)?.path ?? null;
}

// The folder holding a worker, matched by the id in its own workers.json. Null
// when no scanned folder claims it — the honest answer where the old map would
// hand back a path that had long since moved.
export async function folderForWorker(workerId: string): Promise<string | null> {
	const found = findPath(await getScan(), workerId);
	if (found) return found;
	// A worker deployed since the last scan is not in the cache yet, so a miss
	// against a stale cache is worth one rescan before it is believed.
	if (cached && Date.now() - cached.at < TRUST_MISS_MS) return null;
	return findPath(await getScan(true), workerId);
}

export async function foldersByWorkerId(): Promise<Map<string, string>> {
	const map = new Map<string, string>();
	for (const worker of (await getScan()).workers) {
		if (worker.workerId) map.set(worker.workerId, worker.path);
	}
	return map;
}
