import cors from "@fastify/cors";
import Fastify from "fastify";
import type { AppConfig, LogsPayload, RunsPayload, Whoami, Worker } from "@ntn-ui/shared";
import { getConfigPath, loadConfig, saveConfig } from "./config.js";
import { NtnError, runNtnJson } from "./ntn.js";
import { fetchWhoami } from "./whoami.js";

const PORT = Number(process.env.PORT ?? 5174);
const HOST = process.env.HOST ?? "127.0.0.1";

const app = Fastify({ logger: { level: "info" } });
await app.register(cors, { origin: true });

let config: AppConfig = await loadConfig();
app.log.info({ configPath: getConfigPath() }, "config loaded");

app.setErrorHandler((err, _req, reply) => {
	if (err instanceof NtnError) {
		return reply.code(502).send({ error: err.message, detail: err.detail });
	}
	app.log.error(err);
	const message = err instanceof Error ? err.message : "internal error";
	return reply.code(500).send({ error: message });
});

app.get("/api/health", async () => ({ ok: true }));

app.get("/api/config", async () => config);

app.patch<{ Body: Partial<AppConfig["ui"]> }>("/api/config/ui", async (req) => {
	config = { ...config, ui: { ...config.ui, ...(req.body ?? {}) } };
	await saveConfig(config);
	return config;
});

app.get("/api/whoami", async (): Promise<Whoami> => fetchWhoami());

app.get("/api/workers", async (): Promise<Worker[]> => runNtnJson<Worker[]>(["workers", "list"]));

app.get<{ Params: { id: string } }>(
	"/api/workers/:id",
	async (req): Promise<Worker> => runNtnJson<Worker>(["workers", "get", req.params.id]),
);

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
		if (req.query.verbose === "1" || req.query.verbose === "true") args.push("-v");
		return runNtnJson<LogsPayload>(args);
	},
);

try {
	await app.listen({ port: PORT, host: HOST });
	app.log.info(`ntn-ui server listening on http://${HOST}:${PORT}`);
} catch (err) {
	app.log.error(err);
	process.exit(1);
}
