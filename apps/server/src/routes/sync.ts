import type { FastifyInstance } from "fastify";
import type {
	DeployResult,
	SyncScheduleUpdate,
	SyncScheduleUpdateResult,
	SyncSchedulesByWorker,
	SyncSchedulesPayload,
} from "@ntn-worker-tools/shared";
import { DEFAULT_SYNC_SCHEDULE, isValidSyncSchedule } from "@ntn-worker-tools/shared";
import { runNtnJsonWithTrace, runNtnRawAllowingFailure } from "../ntn.js";
import { isVerbose } from "../route-helpers.js";
import { applySyncScheduleUpdates, findSyncSchedules } from "../sync-schedule.js";
import { getConfig } from "../state.js";

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

	// Every registered worker's sync intervals at once, for the badge in the
	// workers list. Static path, so it's matched ahead of `/api/workers/:id` —
	// same arrangement as /api/workers/local-mtimes, which scans the same
	// folders. Workers without a local folder are absent rather than empty:
	// the list shows no badge for them, which isn't the same as "no syncs".
	app.get("/api/workers/sync-schedules", async (): Promise<SyncSchedulesByWorker> => {
		const paths = getConfig().workerLocalPaths ?? {};
		const entries = await Promise.all(
			Object.entries(paths).map(async ([workerId, path]): Promise<[string, string[]]> => {
				const { entries: found } = await findSyncSchedules(path);
				const labels: string[] = [];
				for (const e of found) {
					// An unreadable expression is shown as written; an absent
					// property resolves to the interval the platform applies.
					const label = e.expression ?? e.schedule ?? DEFAULT_SYNC_SCHEDULE;
					if (!labels.includes(label)) labels.push(label);
				}
				return [workerId, labels];
			}),
		);
		return Object.fromEntries(entries);
	});

	// Polling intervals are a source-code concern, not an `ntn` one: the CLI
	// can't report or change a sync's `schedule:`, so both routes below read
	// and rewrite the registered local folder and require one to exist.
	app.get<{ Params: { id: string } }>(
		"/api/workers/:id/sync/schedules",
		async (req, reply): Promise<SyncSchedulesPayload> => {
			const path = getConfig().workerLocalPaths?.[req.params.id];
			if (!path) {
				return reply.code(400).send({
					error: "no local path registered for this worker",
				}) as unknown as SyncSchedulesPayload;
			}
			const { entries, unparsed } = await findSyncSchedules(path);
			return { path, entries, unparsed };
		},
	);

	app.post<{ Params: { id: string }; Body: { updates?: SyncScheduleUpdate[] } }>(
		"/api/workers/:id/sync/schedules",
		async (req, reply): Promise<SyncScheduleUpdateResult> => {
			const started = Date.now();
			const path = getConfig().workerLocalPaths?.[req.params.id];
			if (!path) {
				return reply.code(400).send({
					error: "no local path registered for this worker",
				}) as unknown as SyncScheduleUpdateResult;
			}
			const raw = req.body?.updates;
			if (!Array.isArray(raw) || raw.length === 0) {
				return reply
					.code(400)
					.send({ error: "updates required" }) as unknown as SyncScheduleUpdateResult;
			}
			const updates: SyncScheduleUpdate[] = [];
			for (const u of raw) {
				if (typeof u?.key !== "string" || !u.key) {
					return reply
						.code(400)
						.send({ error: "each update needs a sync key" }) as unknown as SyncScheduleUpdateResult;
				}
				if (typeof u?.file !== "string" || !u.file) {
					return reply.code(400).send({
						error: `update for "${u.key}" is missing its source file`,
					}) as unknown as SyncScheduleUpdateResult;
				}
				const schedule = typeof u.schedule === "string" ? u.schedule.trim() : "";
				// Re-validate server-side: the dialog blocks bad values, but a
				// bad one written to source would break the next deploy.
				if (!isValidSyncSchedule(schedule)) {
					return reply.code(400).send({
						error: `"${schedule}" is not a valid schedule for "${u.key}"`,
					}) as unknown as SyncScheduleUpdateResult;
				}
				updates.push({ key: u.key, file: u.file, schedule });
			}

			const { applied, missing } = await applySyncScheduleUpdates(path, updates);
			const stdout = applied
				.map((a) => `${a.file}: ${a.key} ${a.from ?? "(default 30m)"} → ${a.to}`)
				.join("\n");
			const stderr = missing
				.map((m) => `${m.file}: could not update "${m.key}" — declaration not found or not a plain string`)
				.join("\n");
			return {
				command: "update sync polling interval",
				cwd: path,
				exitCode: missing.length > 0 ? 1 : 0,
				stdout: stdout || "No changes.",
				stderr,
				durationMs: Date.now() - started,
				updates: applied,
			};
		},
	);

	registerSyncAction(app, "/api/workers/:id/sync/trigger", ["trigger"]);
	registerSyncAction(app, "/api/workers/:id/sync/pause", ["pause"]);
	registerSyncAction(app, "/api/workers/:id/sync/resume", ["resume"]);
	registerSyncAction(app, "/api/workers/:id/sync/state-reset", ["state", "reset"]);
}
