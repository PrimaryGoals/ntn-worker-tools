import type { FastifyInstance } from "fastify";
import type { LogsPayload, Run, RunsPayload, Worker } from "@ntn-worker-tools/shared";
import { runNtnJson, runNtnJsonWithTrace } from "../ntn.js";
import { attachTrace, isVerbose } from "../route-helpers.js";

// Safety cap on pagination depth per worker — protects against an
// unbounded loop if the CLI ever returns a cursor that never terminates.
const MAX_PAGES_PER_WORKER = 50;

// Pages through one worker's runs (newest-first, per the CLI's own
// ordering) until a run older than `sinceMs` is seen or the pages run out,
// so the caller gets every run newer than the marker without over-fetching
// a worker's full history.
async function fetchRunsSince(worker: Worker, sinceMs: number): Promise<Run[]> {
	const collected: Run[] = [];
	let cursor: string | undefined;
	for (let page = 0; page < MAX_PAGES_PER_WORKER; page++) {
		const args = ["workers", "runs", "list", worker.workerId];
		if (cursor) args.push("--cursor", cursor);
		const { runs, nextCursor } = await runNtnJson<RunsPayload>(args);
		let hitOlderRun = false;
		for (const run of runs) {
			if (new Date(run.startedAt).getTime() < sinceMs) {
				hitOlderRun = true;
				break;
			}
			collected.push({ ...run, workerName: worker.name });
		}
		if (hitOlderRun || !nextCursor) break;
		cursor = nextCursor;
	}
	return collected;
}

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

	app.get<{ Querystring: { since?: string } }>(
		"/api/runs/cross-worker",
		async (req, reply): Promise<RunsPayload> => {
			const since = req.query.since ? new Date(req.query.since) : null;
			if (!since || isNaN(since.getTime())) {
				return reply.code(400).send({
					error: "since must be a valid ISO timestamp",
				}) as unknown as RunsPayload;
			}
			const workers = await runNtnJson<Worker[]>(["workers", "list"]);
			const perWorker = await Promise.all(
				workers.map((worker) => fetchRunsSince(worker, since.getTime())),
			);
			const runs = perWorker
				.flat()
				.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
			return { runs };
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
