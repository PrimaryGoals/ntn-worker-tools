import type { FastifyInstance } from "fastify";
import type { DeployResult } from "@ntn-worker-tools/shared";
import { runNtnJsonWithTrace, runNtnRawAllowingFailure } from "../ntn.js";
import { isVerbose } from "../route-helpers.js";

// trigger/pause/resume/state-reset are identical apart from the ntn
// subcommand — one handler parameterized by that subcommand replaces four
// near-duplicate route bodies.
function registerSyncAction(app: FastifyInstance, path: string, subcommand: string[]) {
	app.post<{ Params: { id: string }; Querystring: { verbose?: string }; Body: { syncKey: string } }>(
		path,
		async (req) => {
			const args = ["workers", "sync", ...subcommand, "--worker-id", req.params.id, req.body.syncKey];
			const verbose = isVerbose(req.query.verbose);
			if (verbose) args.push("-v");
			const result = await runNtnRawAllowingFailure(args);
			return {
				command: `ntn ${args.join(" ")}`,
				cwd: "",
				exitCode: result.exitCode,
				stdout: result.stdout,
				stderr: result.stderr,
				durationMs: result.durationMs,
			} satisfies DeployResult;
		},
	);
}

export default async function syncRoutes(app: FastifyInstance) {
	app.get<{ Params: { id: string }; Querystring: { verbose?: string } }>(
		"/api/workers/:id/sync/status",
		async (req) => {
			const args = ["workers", "sync", "status", "--worker-id", req.params.id, "--no-watch"];
			const verbose = isVerbose(req.query.verbose);
			if (verbose) args.push("-v");
			const { data, stderr } = await runNtnJsonWithTrace<unknown[]>(args);
			return verbose && stderr ? { statuses: data, _trace: stderr } : { statuses: data };
		},
	);

	registerSyncAction(app, "/api/workers/:id/sync/trigger", ["trigger"]);
	registerSyncAction(app, "/api/workers/:id/sync/pause", ["pause"]);
	registerSyncAction(app, "/api/workers/:id/sync/resume", ["resume"]);
	registerSyncAction(app, "/api/workers/:id/sync/state-reset", ["state", "reset"]);
}
