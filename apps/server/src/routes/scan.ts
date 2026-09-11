import type { FastifyInstance } from "fastify";
import type { ScanResult } from "@ntn-worker-tools/shared";
import { runScan } from "../scan.js";
import { getConfig } from "../state.js";

export default async function scanRoutes(app: FastifyInstance) {
	// Every worker folder under the configured scan roots. Deliberately not
	// cached and not called on a poll: a scan of a well-chosen root (D:\Code\NTN)
	// walks ~150 directories in about 0.2s, but a root one level up walks
	// thousands. The client asks for this when a root is added and when the
	// user presses refresh.
	app.get("/api/scan", async (): Promise<ScanResult> => {
		const config = getConfig();
		const result = await runScan(config.scanRoots ?? [], config.ignoredFolders ?? []);
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
