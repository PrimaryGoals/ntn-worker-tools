import type { FastifyInstance } from "fastify";
import type {
	CrossWorkerRunsPayload,
	LogsPayload,
	Run,
	RunHealth,
	RunHealthPayload,
	RunsPayload,
	Worker,
} from "@ntn-worker-tools/shared";
import { computeRunHealth, RUN_HEALTH_WINDOW } from "@ntn-worker-tools/shared";
import { runNtnJson, runNtnJsonWithTrace } from "../ntn.js";
import { attachTrace, isVerbose } from "../route-helpers.js";

// Safety cap on pagination depth per worker — protects against an
// unbounded loop if the CLI ever returns a cursor that never terminates.
const MAX_PAGES_PER_WORKER = 50;

// Pages through one worker's runs (newest-first, per the CLI's own
// ordering) until a run older than `sinceMs` is seen or the pages run out,
// so the caller gets every run newer than the marker without over-fetching
// a worker's full history.
//
// Also scores the worker's health off the first page, which is a full,
// unfiltered page of its newest runs — the same data the sidebar dots need,
// already in hand. Scoring it here is what keeps this endpoint from costing
// an extra `runs list` call per worker.
async function fetchRunsSince(
	worker: Worker,
	sinceMs: number,
): Promise<{ runs: Run[]; health: RunHealth }> {
	const collected: Run[] = [];
	let health: RunHealth = "unknown";
	let cursor: string | undefined;
	for (let page = 0; page < MAX_PAGES_PER_WORKER; page++) {
		const args = ["workers", "runs", "list", worker.workerId];
		if (cursor) args.push("--cursor", cursor);
		const { runs, nextCursor } = await runNtnJson<RunsPayload>(args);
		if (page === 0) health = computeRunHealth(runs);
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
	return { runs: collected, health };
}

export default async function runsRoutes(app: FastifyInstance) {
	app.get("/api/workers/run-health", async (): Promise<RunHealthPayload> => {
		const workers = await runNtnJson<Worker[]>(["workers", "list"]);
		const entries = await Promise.all(
			workers.map(async (worker): Promise<[string, RunHealth]> => {
				try {
					const { runs } = await runNtnJson<RunsPayload>([
						"workers",
						"runs",
						"list",
						worker.workerId,
						"--page-size",
						String(RUN_HEALTH_WINDOW),
					]);
					return [worker.workerId, computeRunHealth(runs)];
				} catch {
					// One worker's lookup failing (deleted mid-flight, transient
					// API error) shouldn't blank out every other worker's dot.
					return [worker.workerId, "unknown"];
				}
			}),
		);
		return { health: Object.fromEntries(entries) };
	});

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
		async (req, reply): Promise<CrossWorkerRunsPayload> => {
			const since = req.query.since ? new Date(req.query.since) : null;
			if (!since || isNaN(since.getTime())) {
				return reply.code(400).send({
					error: "since must be a valid ISO timestamp",
				}) as unknown as CrossWorkerRunsPayload;
			}
			const workers = await runNtnJson<Worker[]>(["workers", "list"]);
			const perWorker = await Promise.all(
				workers.map((worker) => fetchRunsSince(worker, since.getTime())),
			);
			const runs = perWorker
				.flatMap((result) => result.runs)
				.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
			const health = Object.fromEntries(
				workers.map((worker, i) => [worker.workerId, perWorker[i]!.health]),
			);
			return { runs, health };
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
