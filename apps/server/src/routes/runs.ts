import type { FastifyInstance } from "fastify";
import type { LogsPayload, RunsPayload } from "@ntn-worker-tools/shared";
import { runNtnJson, runNtnJsonWithTrace } from "../ntn.js";
import { attachTrace, isVerbose } from "../route-helpers.js";

export default async function runsRoutes(app: FastifyInstance) {
	app.get<{ Params: { id: string }; Querystring: { cursor?: string; pageSize?: string } }>(
		"/api/workers/:id/runs",
		async (req): Promise<RunsPayload> => {
			const args = ["workers", "runs", "list", req.params.id];
			if (req.query.cursor) args.push("--cursor", req.query.cursor);
			if (req.query.pageSize) args.push("--page-size", req.query.pageSize);
			return runNtnJson<RunsPayload>(args);
		},
	);

	app.get<{ Params: { id: string; runId: string }; Querystring: { verbose?: string } }>(
		"/api/workers/:id/runs/:runId/logs",
		async (req): Promise<LogsPayload> => {
			const args = ["workers", "runs", "logs", req.params.runId, "--worker-id", req.params.id];
			const verbose = isVerbose(req.query.verbose);
			if (verbose) args.push("-v");
			const { data, stderr } = await runNtnJsonWithTrace<LogsPayload>(args);
			return verbose ? attachTrace(data, stderr) : data;
		},
	);
}
