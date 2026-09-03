import { createServer as createNetServer } from "node:net";
import { join } from "node:path";
import cookiePlugin from "@fastify/cookie";
import cors from "@fastify/cors";
import Fastify from "fastify";
import { getConfigPath } from "./config.js";
import { NtnError } from "./ntn.js";
import agentsRoutes from "./routes/agents.js";
import configRoutes from "./routes/config.js";
import deployNewRoutes from "./routes/deploy-new.js";
import fsRoutes from "./routes/fs.js";
import oauthRoutes from "./routes/oauth.js";
import runsRoutes from "./routes/runs.js";
import sessionRoutes from "./routes/session.js";
import syncRoutes from "./routes/sync.js";
import webhookRoutes from "./routes/webhook.js";
import workerLocalRoutes from "./routes/worker-local.js";
import workersRoutes from "./routes/workers.js";
import { getTokenFilePath, loadOrCreateToken, SESSION_COOKIE_NAME, tokenMatches } from "./session.js";

// Load apps/server/.env if present — gives PORT/HOST/LOG_LEVEL/DEBUG/WEB_URL
// one unambiguous place to be set, rather than shell-specific environment
// variable syntax (differs between PowerShell, cmd, and bash). Optional: all
// of these vars have defaults, so a missing .env is not an error.
try {
	process.loadEnvFile(join(import.meta.dirname, "..", ".env"));
} catch {
	/* no apps/server/.env — fine, everything below has a default */
}

// eslint-disable-next-line no-console
console.log(`[${new Date().toLocaleString()}] Server starting...`);

const PORT = Number(process.env.PORT ?? 5174);
const HOST = process.env.HOST ?? "127.0.0.1";

function printPortInUseMessageAndExit(): never {
	// eslint-disable-next-line no-console
	console.error(
		[
			"",
			`Port ${PORT} is already in use.`,
			"",
			"Check for another running copy of this server (e.g. a `pnpm dev`",
			"that didn't shut down) and stop it, then try again. Or use a",
			"different port: create apps/server/.env (copy",
			"apps/server/.env.example) and set PORT=<a different port> in it.",
			"",
		].join("\n"),
	);
	process.exit(1);
}

// Probe the port before any of the slower startup work below (session token
// I/O, config load) — otherwise `pnpm dev`'s
// --kill-others-on-fail can SIGTERM this process, because the web dev server
// fails near-instantly on its own port conflict, before we'd ever reach the
// real app.listen() and report *our* port conflict.
await new Promise<void>((resolveProbe, rejectProbe) => {
	const probe = createNetServer();
	probe.once("error", (err: NodeJS.ErrnoException) => {
		if (err.code === "EADDRINUSE") printPortInUseMessageAndExit();
		rejectProbe(err);
	});
	probe.listen(PORT, HOST, () => probe.close(() => resolveProbe()));
});

// Log level: default warn (quiet), verbose with DEBUG=1 or LOG_LEVEL=info
// Usage: LOG_LEVEL=info pnpm dev:server  (or DEBUG=1 pnpm dev:server)
const logLevel = process.env.LOG_LEVEL || (process.env.DEBUG ? "info" : "warn");
const app = Fastify({
	logger: {
		level: logLevel,
		transport: {
			target: "pino/file",
			options: { destination: 1 }, // stdout
		},
	},
});
// Load or create the session token before anything else so we can surface
// the sign-in URL alongside the "server listening" log line.
const { token: sessionToken, created: tokenCreated } = await loadOrCreateToken();
await app.register(cors, { origin: true, credentials: true });
await app.register(cookiePlugin);

// Auth hook: reject any /api/* request without a valid session cookie, except
// endpoints explicitly needed to establish or check a session, and the health
// probe. Loopback-only binding is not enough — any browser tab on this
// machine could otherwise scrape our endpoints.
const OPEN_PATHS = new Set([
	"/api/health",
	"/api/session/login",
	"/api/session/logout",
	"/api/session/status",
]);
app.addHook("preHandler", async (req, reply) => {
	if (!req.url.startsWith("/api/")) return;
	// req.url includes the query string; compare only the path.
	const path = req.url.split("?", 1)[0] ?? "";
	if (OPEN_PATHS.has(path)) return;
	if (tokenMatches(req.cookies[SESSION_COOKIE_NAME], sessionToken)) return;
	return reply.code(401).send({ error: "session required" });
});

app.log.info({ configPath: getConfigPath() }, "config loaded");

app.setErrorHandler((err, _req, reply) => {
	if (err instanceof NtnError) {
		return reply.code(502).send({ error: err.message, detail: err.detail });
	}
	app.log.error(err);
	const message = err instanceof Error ? err.message : "internal error";
	return reply.code(500).send({ error: message });
});

await app.register(sessionRoutes, { sessionToken });
await app.register(configRoutes);
await app.register(fsRoutes);
await app.register(deployNewRoutes);
await app.register(workersRoutes);
await app.register(syncRoutes);
await app.register(workerLocalRoutes);
await app.register(webhookRoutes);
await app.register(oauthRoutes);
await app.register(runsRoutes);
await app.register(agentsRoutes);

try {
	await app.listen({ port: PORT, host: HOST });
	app.log.info(`ntn-worker-tools server listening on http://${HOST}:${PORT}`);
	// Surface the sign-in URL prominently. The client at :5173 accepts the
	// token from the ?token= query param, POSTs it to /api/session/login,
	// and then clears the URL bar so bookmarks stay clean.
	const webBase = process.env.WEB_URL ?? "http://localhost:5173";
	const signInUrl = `${webBase}/?token=${sessionToken}`;
	const banner = tokenCreated
		? "New session token generated"
		: "Session token loaded from disk";
	const rule = "═".repeat(72);
	// eslint-disable-next-line no-console
	console.log(
		[
			"",
			rule,
			`  ${banner} at ${getTokenFilePath()}`,
			"",
			"  Open this URL once to establish a session (cookie set, URL cleaned):",
			"",
			`    ${signInUrl}`,
			"",
			"  Then bookmark http://localhost:5173/ — the token is not needed again",
			"  unless you clear cookies or delete the session-token file.",
			rule,
			"",
		].join("\n"),
	);
} catch (err) {
	// The probe above catches this in the overwhelming majority of cases —
	// this remains only as a fallback for the now-tiny window between the
	// probe releasing the port and this real listen() re-acquiring it.
	if ((err as NodeJS.ErrnoException).code === "EADDRINUSE") printPortInUseMessageAndExit();
	app.log.error(err);
	process.exit(1);
}
