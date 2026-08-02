import cors from "@fastify/cors";
import Fastify from "fastify";
import type {
	AppConfig,
	LogsPayload,
	RunsPayload,
	WebhookEntry,
	WebhookFireResult,
	WebhooksPayload,
	Whoami,
	Worker,
	WorkerEnvPayload,
	WorkerUsage,
} from "@ntn-ui/shared";
import { getConfigPath, loadConfig, saveConfig } from "./config.js";
import { NtnError, runNtnJson, runNtnJsonWithTrace, runNtnRawWithTrace } from "./ntn.js";

const NOTION_WEBHOOK_PREFIX = "https://www.notion.so/webhooks/worker/";

function isVerbose(v?: string): boolean {
	return v === "1" || v === "true";
}

function attachTrace<T extends object>(data: T, stderr: string): T {
	return stderr ? ({ ...data, _trace: stderr } as T) : data;
}
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

app.post<{ Body: { url: string } }>(
	"/api/webhook/fire",
	async (req, reply): Promise<WebhookFireResult> => {
		const url = req.body?.url;
		if (typeof url !== "string" || !url.startsWith(NOTION_WEBHOOK_PREFIX)) {
			return reply.code(400).send({
				error: "invalid webhook url",
				detail: `url must start with ${NOTION_WEBHOOK_PREFIX}`,
			}) as unknown as WebhookFireResult;
		}
		const start = Date.now();
		const res = await fetch(url, { method: "POST" });
		const body = await res.text();
		return {
			url,
			status: res.status,
			statusText: res.statusText,
			body,
			durationMs: Date.now() - start,
		};
	},
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
		const verbose = isVerbose(req.query.verbose);
		if (verbose) args.push("-v");
		const { data, stderr } = await runNtnJsonWithTrace<LogsPayload>(args);
		return verbose ? attachTrace(data, stderr) : data;
	},
);

try {
	await app.listen({ port: PORT, host: HOST });
	app.log.info(`ntn-ui server listening on http://${HOST}:${PORT}`);
} catch (err) {
	app.log.error(err);
	process.exit(1);
}
