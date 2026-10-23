import type { FastifyInstance } from "fastify";
import type {
	CrossWorkerRunsPayload,
	DeclaredCapability,
	LogsPayload,
	Run,
	RunHealthPayload,
	RunsPayload,
	Worker,
	WorkerRunHistory,
} from "@ntn-worker-tools/shared";
import {
	buildWorkerHistory,
	DEFAULT_WORKER_DEAD_TIMEOUT_SECONDS,
	RUN_HEALTH_SCAN,
} from "@ntn-worker-tools/shared";
import { runNtnJson, runNtnJsonWithTrace } from "../ntn.js";
import { attachTrace, isSafeArg, isVerbose } from "../route-helpers.js";

// Safety cap on pagination depth per worker — protects against an
// unbounded loop if the CLI ever returns a cursor that never terminates.
const MAX_PAGES_PER_WORKER = 50;

// WORKER_DEAD_TIMEOUT (seconds, from apps/server/.env): how long a run may sit
// without an exit code or end time before the UI calls it dead. .env is read once
// at startup, so a change needs a server restart. An unset, non-numeric or
// non-positive value falls back to the default.
function deadAfterSeconds(): number {
	const n = Number.parseInt(process.env.WORKER_DEAD_TIMEOUT ?? "", 10);
	return Number.isFinite(n) && n > 0 ? n : DEFAULT_WORKER_DEAD_TIMEOUT_SECONDS;
}

// Pages through one worker's runs (newest-first, per the CLI's own
// ordering) until a run older than `sinceMs` is seen or the pages run out,
// so the caller gets every run newer than the marker without over-fetching
// a worker's full history.
//
// Also takes the worker's recent-run history off the first page, which is a
// full, unfiltered page of its newest runs — the same data the sidebar dots and
// the health view need, already in hand. Taking it here is what keeps this
// endpoint from costing an extra `runs list` call per worker.
async function fetchRunsSince(
	worker: Worker,
	sinceMs: number,
): Promise<{ runs: Run[]; history: WorkerRunHistory }> {
	const collected: Run[] = [];
	let history: WorkerRunHistory = { runs: [], health: "unknown", capabilities: [] };
	let cursor: string | undefined;
	for (let page = 0; page < MAX_PAGES_PER_WORKER; page++) {
		const args = ["workers", "runs", "list", worker.workerId];
		if (cursor) args.push("--cursor", cursor);
		const { runs, nextCursor } = await runNtnJson<RunsPayload>(args);
		if (page === 0) history = buildWorkerHistory(runs);
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
	return { runs: collected, history };
}

export default async function runsRoutes(app: FastifyInstance) {
	app.get("/api/workers/run-health", async (): Promise<RunHealthPayload> => {
		const workers = await runNtnJson<Worker[]>(["workers", "list"]);
		const entries = await Promise.all(
			workers.map(
				async (
					worker,
				): Promise<[string, WorkerRunHistory, DeclaredCapability[] | null]> => {
					// Two calls per worker, run together: the runs, and the list of
					// capabilities those runs belong to. The second is what lets a
					// declared-but-never-run capability appear at all — history can
					// only ever show the ones that have produced a run.
					const [history, declared] = await Promise.all([
						runNtnJson<RunsPayload>([
							"workers",
							"runs",
							"list",
							worker.workerId,
							"--page-size",
							String(RUN_HEALTH_SCAN),
						])
							.then(({ runs }) => buildWorkerHistory(runs))
							// One worker's lookup failing (deleted mid-flight, transient
							// API error) shouldn't blank out every other worker's dot.
							.catch(
								(): WorkerRunHistory => ({ runs: [], health: "unknown", capabilities: [] }),
							),
						runNtnJson<Array<{ _tag?: string; key?: string }>>([
							"workers",
							"capabilities",
							"list",
							worker.workerId,
						])
							.then((caps) =>
								caps
									.filter((cap) => !!cap._tag && !!cap.key)
									.map((cap) => ({ tag: cap._tag!, key: cap.key! })),
							)
							// A worker that has never deployed has no capabilities to
							// report. Absent rather than empty: "we could not ask" is not
							// the same as "it declares none", and only the second should
							// make the rows fall back to what ran.
							.catch(() => null),
					]);
					return [worker.workerId, history, declared];
				},
			),
		);
		return {
			history: Object.fromEntries(entries.map(([id, history]) => [id, history])),
			declared: Object.fromEntries(
				entries
					.filter((entry): entry is [string, WorkerRunHistory, DeclaredCapability[]] =>
						entry[2] !== null,
					)
					.map(([id, , declared]) => [id, declared]),
			),
			deadAfterSeconds: deadAfterSeconds(),
		};
	});

	app.get<{ Params: { id: string }; Querystring: { cursor?: string; pageSize?: string } }>(
		"/api/workers/:id/runs",
		async (req, reply): Promise<RunsPayload> => {
			const { cursor, pageSize } = req.query;
			if ((cursor && !isSafeArg(cursor)) || (pageSize && !/^\d{1,4}$/.test(pageSize))) {
				return reply.code(400).send({ error: "invalid cursor or pageSize" }) as unknown as RunsPayload;
			}
			const args = ["workers", "runs", "list", req.params.id];
			if (req.query.cursor) args.push("--cursor", req.query.cursor);
			if (req.query.pageSize) args.push("--page-size", req.query.pageSize);
			const payload = await runNtnJson<RunsPayload>(args);
			return { ...payload, deadAfterSeconds: deadAfterSeconds() };
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
			const history = Object.fromEntries(
				workers.map((worker, i) => [worker.workerId, perWorker[i]!.history]),
			);
			return { runs, history, deadAfterSeconds: deadAfterSeconds() };
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
