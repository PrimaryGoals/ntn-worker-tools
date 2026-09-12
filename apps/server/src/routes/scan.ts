import type { FastifyInstance } from "fastify";
import type { ScanResult } from "@ntn-worker-tools/shared";
import { ensureWorkspaceNames } from "../identity-names.js";
import { getScan } from "../scan-cache.js";

export default async function scanRoutes(app: FastifyInstance) {
	// Every worker folder under the configured scan roots. Deliberately not
	// cached and not called on a poll: a scan of a well-chosen root (D:\Code\NTN)
	// walks ~150 directories in about 0.2s, but a root one level up walks
	// thousands. The client asks for this when a root is added and when the
	// user presses refresh.
	app.get("/api/scan", async (): Promise<ScanResult> => {
		// Forced: asking for the scan is how the client says it wants fresh
		// truth. It fills the same cache the per-worker lookups read, so a
		// refresh here spares them a walk of their own.
		const result = await getScan(true);
		// The folders name workspaces by id. Resolving those to names here is
		// what lets the branch-linking prompt offer a workspace this app has
		// never been connected to but that 17 folders already point at.
		await ensureWorkspaceNames(result.workers.map((worker) => worker.workspaceId));
		app.log.info(
			{
				roots: result.roots.length,
				workers: result.workers.length,
				ignored: result.ignoredCount,
				durationMs: result.durationMs,
			},
			"scan complete",
		);
		return result;
	});
}
