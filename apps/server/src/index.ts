import { spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { join, relative, resolve } from "node:path";
import cookiePlugin from "@fastify/cookie";
import cors from "@fastify/cors";
import Fastify from "fastify";
import type {
	AppConfig,
	DeployResult,
	GitStatus,
	GitStatusEntry,
	LocalInfo,
	LogsPayload,
	RunsPayload,
	WebhookEntry,
	WebhookFireResult,
	WebhooksPayload,
	Whoami,
	Worker,
	WorkerEnvPayload,
	WorkerUsage,
} from "@ntn-worker-tools/shared";
import { getConfigPath } from "./config.js";
import {
	NtnError,
	runNtnJson,
	runNtnJsonWithTrace,
	runNtnRawAllowingFailure,
	runNtnRawWithTrace,
	runShellAllowingFailure,
} from "./ntn.js";
import configRoutes from "./routes/config.js";
import fsRoutes from "./routes/fs.js";
import sessionRoutes from "./routes/session.js";
import { getTokenFilePath, loadOrCreateToken, SESSION_COOKIE_NAME, tokenMatches } from "./session.js";
import { envInfo, getConfig, resolveGitRoot, resolveIsGitRepo, updateConfig } from "./state.js";

const NOTION_WEBHOOK_PREFIX = "https://www.notion.so/webhooks/worker/";

function isVerbose(v?: string): boolean {
	return v === "1" || v === "true";
}

function attachTrace<T extends object>(data: T, stderr: string): T {
	return stderr ? ({ ...data, _trace: stderr } as T) : data;
}
import { fetchWhoami } from "./whoami.js";

// Load apps/server/.env if present — gives PORT/HOST/LOG_LEVEL/DEBUG/WEB_URL
// one unambiguous place to be set, rather than shell-specific environment
// variable syntax (differs between PowerShell, cmd, and bash). Optional: all
// of these vars have defaults, so a missing .env is not an error.
try {
	process.loadEnvFile(join(import.meta.dirname, "..", ".env"));
} catch {
	/* no apps/server/.env — fine, everything below has a default */
}

// node --watch's own "Restarting '<file>'" message has no timestamp. This is
// the earliest point our own code runs after a restart (imports are hoisted
// ahead of it regardless of source order), so it prints right after that line.
// eslint-disable-next-line no-console
console.log(`[${new Date().toLocaleString()}] Server (re)starting...`);

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
// I/O, git version check, config load) — otherwise `pnpm dev`'s
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
app.log.info(envInfo, "env info");

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
	"/api/workers/:id/sync/status",
	async (req) => {
		const args = ["workers", "sync", "status", "--worker-id", req.params.id, "--no-watch"];
		const verbose = isVerbose(req.query.verbose);
		if (verbose) args.push("-v");
		const { data, stderr } = await runNtnJsonWithTrace<unknown[]>(args);
		return verbose && stderr ? { statuses: data, _trace: stderr } : { statuses: data };
	},
);

app.post<{ Params: { id: string }; Querystring: { verbose?: string }; Body: { syncKey: string } }>(
	"/api/workers/:id/sync/trigger",
	async (req) => {
		const args = ["workers", "sync", "trigger", "--worker-id", req.params.id, req.body.syncKey];
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

app.post<{ Params: { id: string }; Querystring: { verbose?: string }; Body: { syncKey: string } }>(
	"/api/workers/:id/sync/pause",
	async (req) => {
		const args = ["workers", "sync", "pause", "--worker-id", req.params.id, req.body.syncKey];
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

app.post<{ Params: { id: string }; Querystring: { verbose?: string }; Body: { syncKey: string } }>(
	"/api/workers/:id/sync/resume",
	async (req) => {
		const args = ["workers", "sync", "resume", "--worker-id", req.params.id, req.body.syncKey];
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

app.post<{ Params: { id: string }; Querystring: { verbose?: string }; Body: { syncKey: string } }>(
	"/api/workers/:id/sync/state-reset",
	async (req) => {
		const args = ["workers", "sync", "state", "reset", "--worker-id", req.params.id, req.body.syncKey];
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

app.post<{ Params: { id: string }; Body: { path: string } }>(
	"/api/workers/:id/local-path",
	async (req, reply): Promise<AppConfig> => {
		const raw = req.body?.path;
		if (typeof raw !== "string" || !raw.trim()) {
			return reply.code(400).send({ error: "path required" }) as unknown as AppConfig;
		}
		const abs = resolve(raw.trim());
		const workersJsonPath = join(abs, "workers.json");
		try {
			const s = await stat(abs);
			if (!s.isDirectory()) {
				return reply
					.code(400)
					.send({ error: "path is not a directory", detail: abs }) as unknown as AppConfig;
			}
			await stat(workersJsonPath);
		} catch {
			return reply.code(400).send({
				error: "not a worker project",
				detail: `Expected ${abs} to be a directory containing workers.json`,
			}) as unknown as AppConfig;
		}
		let folderWorkerId: unknown;
		try {
			const parsed = JSON.parse(await readFile(workersJsonPath, "utf8")) as {
				workerId?: unknown;
			};
			folderWorkerId = parsed.workerId;
		} catch {
			return reply.code(400).send({
				error: "workers.json is not valid JSON",
				detail: workersJsonPath,
			}) as unknown as AppConfig;
		}
		if (typeof folderWorkerId !== "string" || !folderWorkerId) {
			return reply.code(400).send({
				error: "workers.json is missing a workerId",
				detail: workersJsonPath,
			}) as unknown as AppConfig;
		}
		if (folderWorkerId !== req.params.id) {
			return reply.code(400).send({
				error: "worker mismatch",
				detail: `Folder ${abs} is registered to workerId=${folderWorkerId}, but you have workerId=${req.params.id} selected.`,
				folderWorkerId,
				selectedWorkerId: req.params.id,
			}) as unknown as AppConfig;
		}
		// Register the path first, then let resolveIsGitRepo cache positive detections.
		const updated = await updateConfig({
			workerLocalPaths: { ...(getConfig().workerLocalPaths ?? {}), [req.params.id]: abs },
		});
		await resolveIsGitRepo(req.params.id, abs);
		return updated;
	},
);

app.get<{ Params: { id: string } }>(
	"/api/workers/:id/local-info",
	async (req, reply): Promise<LocalInfo> => {
		const path = getConfig().workerLocalPaths?.[req.params.id];
		if (!path) {
			return reply
				.code(404)
				.send({ error: "no local path registered for this worker" }) as unknown as LocalInfo;
		}
		let hasPackageJson = false;
		let deployScript: string | null = null;
		try {
			const pkgRaw = await readFile(join(path, "package.json"), "utf8");
			hasPackageJson = true;
			const pkg = JSON.parse(pkgRaw) as { scripts?: Record<string, string> };
			const raw = pkg.scripts?.deploy;
			if (typeof raw === "string" && raw.trim()) deployScript = raw;
		} catch {
			/* no package.json or unreadable — leave defaults */
		}
		let hasEnvFile = false;
		try {
			const s = await stat(join(path, ".env"));
			hasEnvFile = s.isFile();
		} catch {
			/* no .env — leave false */
		}
		const isGitRepo = await resolveIsGitRepo(req.params.id, path);
		return {
			path,
			hasPackageJson,
			hasDeployScript: deployScript !== null,
			deployScript,
			hasEnvFile,
			isGitRepo,
		};
	},
);

app.delete<{ Params: { id: string } }>(
	"/api/workers/:id/local-path",
	async (req): Promise<AppConfig> => {
		const nextPaths = { ...(getConfig().workerLocalPaths ?? {}) };
		delete nextPaths[req.params.id];
		const nextRepo = { ...(getConfig().workerIsGitRepo ?? {}) };
		delete nextRepo[req.params.id];
		const nextRoot = { ...(getConfig().workerGitRoot ?? {}) };
		delete nextRoot[req.params.id];
		return updateConfig({
			workerLocalPaths: nextPaths,
			workerIsGitRepo: nextRepo,
			workerGitRoot: nextRoot,
		});
	},
);

app.post<{ Params: { id: string } }>(
	"/api/workers/:id/reveal",
	async (req, reply): Promise<{ ok: true; path: string }> => {
		const path = getConfig().workerLocalPaths?.[req.params.id];
		if (!path) {
			return reply
				.code(400)
				.send({ error: "no local path registered for this worker" }) as unknown as {
				ok: true;
				path: string;
			};
		}
		let child;
		if (process.platform === "win32") {
			// explorer.exe (with the .exe suffix so Node's spawn finds it without
			// needing shell: true). Explorer signals the running shell to open a
			// new window at `path` and typically exits with a non-zero code even
			// on success — that's fine, we're not observing exit.
			child = spawn("explorer.exe", [path], { detached: true });
		} else if (process.platform === "darwin") {
			child = spawn("open", [path], { detached: true });
		} else {
			child = spawn("xdg-open", [path], { detached: true });
		}
		child.on("error", (err) => app.log.error({ err, path }, "reveal spawn failed"));
		child.unref();
		app.log.info({ path, platform: process.platform }, "reveal spawned");
		return { ok: true, path };
	},
);

app.post<{ Params: { id: string }; Querystring: { verbose?: string } }>(
	"/api/workers/:id/deploy",
	async (req, reply): Promise<DeployResult> => {
		const path = getConfig().workerLocalPaths?.[req.params.id];
		if (!path) {
			return reply
				.code(400)
				.send({ error: "no local path registered for this worker" }) as unknown as DeployResult;
		}
		const args = ["workers", "deploy", "--json"];
		const verbose = isVerbose(req.query.verbose);
		if (verbose) args.push("-v");
		const { exitCode, stdout, stderr, durationMs } = await runNtnRawAllowingFailure(args, {
			cwd: path,
		});
		let summary: DeployResult["summary"];
		if (exitCode === 0) {
			try {
				summary = JSON.parse(stdout.trim()) as DeployResult["summary"];
			} catch {
				/* stdout wasn't clean JSON; leave summary undefined */
			}
		}
		return {
			command: `ntn ${args.join(" ")}`,
			cwd: path,
			exitCode,
			stdout,
			stderr,
			durationMs,
			summary,
		};
	},
);

app.get<{ Params: { id: string } }>(
	"/api/workers/:id/git-status",
	async (req, reply): Promise<GitStatus> => {
		const path = getConfig().workerLocalPaths?.[req.params.id];
		if (!path) {
			return reply
				.code(400)
				.send({ error: "no local path registered for this worker" }) as unknown as GitStatus;
		}
		if (!envInfo.gitAvailable) {
			return reply
				.code(400)
				.send({ error: "git is not installed on this machine" }) as unknown as GitStatus;
		}
		const gitRoot = await resolveGitRoot(req.params.id, path);
		if (!gitRoot) {
			return {
				isGitRepo: false,
				files: [],
				diff: "",
				gitRoot: "",
				workerPathRelToRoot: "",
			};
		}
		const workerPathRelToRoot = relative(gitRoot, path).replace(/\\/g, "/");
		const status = await runShellAllowingFailure("git", ["status", "--porcelain=v1"], {
			cwd: gitRoot,
		});
		const files: GitStatusEntry[] = [];
		for (const line of status.stdout.split(/\r?\n/)) {
			if (!line) continue;
			// Porcelain v1: first 2 chars are status codes, char 3 is a space, rest is path.
			const statusCode = line.slice(0, 2);
			const rest = line.slice(3);
			// Rename entries look like "R  old -> new" — take the destination.
			const arrow = rest.indexOf(" -> ");
			const p = arrow >= 0 ? rest.slice(arrow + 4) : rest;
			files.push({ statusCode, path: p });
		}
		const diff = await runShellAllowingFailure("git", ["diff", "HEAD"], { cwd: gitRoot });
		return {
			isGitRepo: true,
			files,
			diff: diff.exitCode === 0 ? diff.stdout : "",
			gitRoot,
			workerPathRelToRoot,
		};
	},
);

app.post<{ Params: { id: string }; Body: { files: string[]; message: string } }>(
	"/api/workers/:id/git-commit",
	async (req, reply): Promise<DeployResult> => {
		const path = getConfig().workerLocalPaths?.[req.params.id];
		if (!path) {
			return reply
				.code(400)
				.send({ error: "no local path registered for this worker" }) as unknown as DeployResult;
		}
		const { files, message } = req.body ?? {};
		if (!Array.isArray(files) || files.length === 0) {
			return reply.code(400).send({ error: "no files selected" }) as unknown as DeployResult;
		}
		if (!files.every((f): f is string => typeof f === "string" && f.length > 0)) {
			return reply.code(400).send({ error: "invalid files list" }) as unknown as DeployResult;
		}
		if (typeof message !== "string" || !message.trim()) {
			return reply
				.code(400)
				.send({ error: "commit message required" }) as unknown as DeployResult;
		}
		// All git ops must run from the repo's top-level, since porcelain paths
		// (which files[] echoes back) are relative to that root, not to `path`.
		const gitRoot = await resolveGitRoot(req.params.id, path);
		if (!gitRoot) {
			return reply
				.code(400)
				.send({ error: "not a git repository" }) as unknown as DeployResult;
		}
		// `--` prevents any path that starts with `-` from being interpreted as a flag.
		const add = await runShellAllowingFailure("git", ["add", "--", ...files], { cwd: gitRoot });
		if (add.exitCode !== 0) {
			return {
				command: add.command,
				cwd: gitRoot,
				exitCode: add.exitCode,
				stdout: add.stdout,
				stderr: add.stderr,
				durationMs: add.durationMs,
			};
		}
		const commit = await runShellAllowingFailure(
			"git",
			["commit", "-m", message.trim()],
			{ cwd: gitRoot },
		);
		return {
			command: `${add.command}\n${commit.command}`,
			cwd: gitRoot,
			exitCode: commit.exitCode,
			stdout: commit.stdout,
			stderr: commit.stderr,
			durationMs: add.durationMs + commit.durationMs,
			followup: {
				command: "git log --oneline -3",
				exitCode: 0,
				stdout: (await runShellAllowingFailure("git", ["log", "--oneline", "-3"], { cwd: gitRoot }))
					.stdout,
				stderr: "",
				durationMs: 0,
			},
		};
	},
);

app.post<{
	Params: { id: string };
	Querystring: { verbose?: string };
	Body: { key?: string; value?: string };
}>(
	"/api/workers/:id/env/set",
	async (req, reply): Promise<DeployResult> => {
		const key = req.body?.key?.trim();
		const value = req.body?.value;
		if (!key) return reply.code(400).send({ error: "key required" }) as unknown as DeployResult;
		if (typeof value !== "string" || !value) {
			return reply.code(400).send({ error: "value required" }) as unknown as DeployResult;
		}
		const verbose = isVerbose(req.query.verbose);
		const args = [
			"workers",
			"env",
			"set",
			"--worker-id",
			req.params.id,
			`${key}=${value}`,
			...(verbose ? ["-v"] : []),
		];
		// Redacted display args — used both for the [ntn spawn] log line and
		// for the DeployResult.command echoed back to the client.
		const logAs = [
			"workers",
			"env",
			"set",
			"--worker-id",
			req.params.id,
			`${key}=<redacted>`,
			...(verbose ? ["-v"] : []),
		];
		const result = await runShellAllowingFailure("ntn", args, { logAs });
		return {
			command: `ntn ${logAs.join(" ")}`,
			cwd: "",
			exitCode: result.exitCode,
			stdout: result.stdout,
			stderr: result.stderr,
			durationMs: result.durationMs,
		};
	},
);

app.post<{ Params: { id: string }; Querystring: { verbose?: string } }>(
	"/api/workers/:id/env/push",
	async (req, reply): Promise<DeployResult> => {
		const path = getConfig().workerLocalPaths?.[req.params.id];
		if (!path) {
			return reply
				.code(400)
				.send({ error: "no local path registered for this worker" }) as unknown as DeployResult;
		}
		const verbose = isVerbose(req.query.verbose);
		const pushArgs = ["workers", "env", "push", "--yes"];
		if (verbose) pushArgs.push("-v");
		const push = await runNtnRawAllowingFailure(pushArgs, { cwd: path });
		let followup: DeployResult["followup"];
		if (push.exitCode === 0) {
			const pullArgs = ["workers", "env", "pull", req.params.id, "--no-file", "--yes"];
			if (verbose) pullArgs.push("-v");
			const pull = await runNtnRawAllowingFailure(pullArgs, { cwd: path });
			followup = {
				command: `ntn ${pullArgs.join(" ")}`,
				exitCode: pull.exitCode,
				stdout: pull.stdout,
				stderr: pull.stderr,
				durationMs: pull.durationMs,
			};
		}
		return {
			command: `ntn ${pushArgs.join(" ")}`,
			cwd: path,
			exitCode: push.exitCode,
			stdout: push.stdout,
			stderr: push.stderr,
			durationMs: push.durationMs,
			followup,
		};
	},
);

app.post<{ Params: { id: string } }>(
	"/api/workers/:id/pnpm-deploy",
	async (req, reply): Promise<DeployResult> => {
		const path = getConfig().workerLocalPaths?.[req.params.id];
		if (!path) {
			return reply
				.code(400)
				.send({ error: "no local path registered for this worker" }) as unknown as DeployResult;
		}
		const result = await runShellAllowingFailure("pnpm", ["run", "deploy"], {
			cwd: path,
			shell: true,
		});
		return {
			command: result.command,
			cwd: path,
			exitCode: result.exitCode,
			stdout: result.stdout,
			stderr: result.stderr,
			durationMs: result.durationMs,
		};
	},
);

app.post<{ Body: { url: string; webhookSecret?: string }; Querystring: { verbose?: string } }>(
	"/api/webhook/fire",
	async (req, reply): Promise<WebhookFireResult> => {
		const url = req.body?.url;
		if (typeof url !== "string" || !url.startsWith(NOTION_WEBHOOK_PREFIX)) {
			return reply.code(400).send({
				error: "invalid webhook url",
				detail: `url must start with ${NOTION_WEBHOOK_PREFIX}`,
			}) as unknown as WebhookFireResult;
		}
		const verbose = isVerbose(req.query.verbose);
		const args: string[] = ["-s", "-X", "POST"];
		const logAs: string[] = ["-s", "-X", "POST"];

		// -i includes the response headers ahead of the body, letting us read
		// the real status line and full header block instead of just a code.
		// Only added under -v: the headers are noisy (Notion's CSP header alone
		// is huge) and not worth showing by default.
		if (verbose) {
			args.push("-i");
			logAs.push("-i");
		}

		args.push("-H", "User-Agent: ntn-worker-tools");
		logAs.push("-H", "User-Agent: ntn-worker-tools");

		const sentHeaders: string[] = [];
		if (typeof req.body?.webhookSecret === "string" && req.body.webhookSecret) {
			args.push("-H", `X-Webhook-Secret: ${req.body.webhookSecret}`);
			logAs.push("-H", "X-Webhook-Secret: <redacted>");
			sentHeaders.push("X-Webhook-Secret");
		}

		if (!verbose) {
			// Without -i we still need the status code: append it after the body
			// on its own line. `\n` here is curl's own write-out escape (two
			// literal characters), not a real newline in this argument — curl
			// turns it into one when it writes its output.
			args.push("-w", "\\n%{http_code}");
			logAs.push("-w", "\\n%{http_code}");
		}
		args.push(url);
		logAs.push(url);

		// On Windows, PowerShell aliases the bare `curl` name to Invoke-WebRequest,
		// which doesn't understand curl's flags — a copy-pasted command must say
		// `curl.exe` to reach the real binary. execFile() bypasses PowerShell
		// entirely so this only matters for the displayed/copy-pasted command.
		const curlCmd = process.platform === "win32" ? "curl.exe" : "curl";
		const result = await runShellAllowingFailure(curlCmd, args, { logAs });

		let status: number;
		let statusText: string;
		let body: string;
		let trace: string | undefined;
		if (verbose) {
			// Parse curl's -i output: status line, headers, blank line, then body.
			// HTTP requires CRLF but tolerate a bare LF too.
			const headerSep = result.stdout.match(/\r?\n\r?\n/);
			const headerBlock = headerSep ? result.stdout.slice(0, headerSep.index) : result.stdout;
			body = headerSep ? result.stdout.slice((headerSep.index ?? 0) + headerSep[0].length) : "";
			const statusLine = headerBlock.split(/\r?\n/)[0] ?? "";
			const statusMatch = statusLine.match(/^HTTP\/[\d.]+\s+(\d+)\s*(.*)$/);
			status = statusMatch ? parseInt(statusMatch[1] ?? "0", 10) : 0;
			statusText = statusMatch?.[2]?.trim() ?? "";
			trace = headerBlock.trim() || undefined;
		} else {
			// Body + trailing newline + status code, as written by -w above.
			const lines = result.stdout.split("\n");
			status = parseInt(lines[lines.length - 1] ?? "", 10) || 0;
			statusText = "";
			body = lines.slice(0, -1).join("\n");
		}

		return {
			command: result.command,
			url,
			status,
			statusText,
			body,
			durationMs: result.durationMs,
			sentHeaders: sentHeaders.length ? sentHeaders : undefined,
			_trace: trace,
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
