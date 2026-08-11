import type { FastifyInstance } from "fastify";
import type {
	WebhookEntry,
	WebhooksPayload,
	Whoami,
	Worker,
	WorkerEnvPayload,
	WorkerUsage,
} from "@ntn-worker-tools/shared";
import { runNtnJson, runNtnJsonWithTrace, runNtnRawWithTrace } from "../ntn.js";
import { attachTrace, isVerbose } from "../route-helpers.js";
import { fetchWhoami } from "../whoami.js";

export default async function workersRoutes(app: FastifyInstance) {
	app.get<{ Querystring: { verbose?: string } }>(
		"/api/whoami",
		async (req): Promise<Whoami> => fetchWhoami(isVerbose(req.query.verbose)),
	);

	app.get("/api/workers", async (): Promise<Worker[]> => runNtnJson<Worker[]>(["workers", "list"]));

	app.get<{ Params: { id: string }; Querystring: { verbose?: string } }>(
		"/api/workers/:id",
		async (req): Promise<Worker> => {
			const args = ["workers", "get", req.params.id];
			const verbose = isVerbose(req.query.verbose);
			if (verbose) args.push("-v");
			const { data, stderr } = await runNtnJsonWithTrace<Worker>(args);
			return verbose ? attachTrace(data, stderr) : data;
		},
	);

	app.get<{ Params: { id: string }; Querystring: { verbose?: string } }>(
		"/api/workers/:id/webhooks",
		async (req): Promise<WebhooksPayload> => {
			const args = ["workers", "webhooks", "list", req.params.id];
			const verbose = isVerbose(req.query.verbose);
			if (verbose) args.push("-v");
			const { data, stderr } = await runNtnJsonWithTrace<WebhookEntry[]>(args);
			return verbose && stderr ? { webhooks: data, _trace: stderr } : { webhooks: data };
		},
	);

	app.get<{ Params: { id: string }; Querystring: { verbose?: string } }>(
		"/api/workers/:id/capabilities",
		async (req) => {
			const args = ["workers", "capabilities", "list", req.params.id];
			const verbose = isVerbose(req.query.verbose);
			if (verbose) args.push("-v");
			const { data, stderr } = await runNtnJsonWithTrace<unknown>(args);
			return verbose && stderr ? { capabilities: data, _trace: stderr } : { capabilities: data };
		},
	);

	app.get<{ Params: { id: string }; Querystring: { verbose?: string } }>(
		"/api/workers/:id/usage",
		async (req): Promise<WorkerUsage> => {
			const args = ["workers", "usage", req.params.id];
			const verbose = isVerbose(req.query.verbose);
			if (verbose) args.push("-v");
			const { data, stderr } = await runNtnJsonWithTrace<WorkerUsage>(args);
			return verbose ? attachTrace(data, stderr) : data;
		},
	);

	app.get<{ Params: { id: string }; Querystring: { verbose?: string } }>(
		"/api/workers/:id/env",
		async (req): Promise<WorkerEnvPayload> => {
			const args = ["workers", "env", "pull", req.params.id, "--no-file", "--yes"];
			const verbose = isVerbose(req.query.verbose);
			if (verbose) args.push("-v");
			const { stdout, stderr } = await runNtnRawWithTrace(args);
			return verbose && stderr ? { text: stdout, _trace: stderr } : { text: stdout };
		},
	);
}
