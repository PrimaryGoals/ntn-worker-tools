import { spawn } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import cookiePlugin from "@fastify/cookie";
import cors from "@fastify/cors";
import Fastify from "fastify";
import type {
	AppConfig,
	DeployResult,
	EnvInfo,
	FsListing,
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
import { getConfigPath, loadConfig, saveConfig } from "./config.js";
import {
	NtnError,
	runNtnJson,
	runNtnJsonWithTrace,
	runNtnRawAllowingFailure,
	runNtnRawWithTrace,
	runShellAllowingFailure,
} from "./ntn.js";
import { getTokenFilePath, loadOrCreateToken, SESSION_COOKIE_NAME, tokenMatches } from "./session.js";

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

const app = Fastify({
	logger: {
		level: "info",
		transport: {
			// Custom transport that logs everything except HTTP requests to keep
			// the startup banner visible. Errors/warnings still get logged.
			target: "pino/file",
			options: { destination: 1 }, // stdout
		},
		hooks: {
			// Skip request/response logs at the pino level
			logHttp: () => false,
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

let config: AppConfig = await loadConfig();
app.log.info({ configPath: getConfigPath() }, "config loaded");

// One-shot check for git on PATH. Never repeated during the process's life.
const gitCheck = await runShellAllowingFailure("git", ["--version"]).catch(() => null);
const envInfo: EnvInfo =
	gitCheck && gitCheck.exitCode === 0
		? { gitAvailable: true, gitVersion: gitCheck.stdout.trim() }
		: { gitAvailable: false, gitVersion: null };
app.log.info(envInfo, "env info");

async function detectGitRoot(cwd: string): Promise<string | null> {
	if (!envInfo.gitAvailable) return null;
	const r = await runShellAllowingFailure("git", ["rev-parse", "--show-toplevel"], { cwd });
	if (r.exitCode !== 0) return null;
	const root = r.stdout.trim();
	return root || null;
}

// Only positive results are cached: repos don't un-init, so a cached `true`
// stays authoritative forever. `false` is not persisted — a `git init` after
// registration should be picked up on the next request.
async function resolveGitRoot(workerId: string, cwd: string): Promise<string | null> {
	const cachedRoot = config.workerGitRoot?.[workerId];
	if (cachedRoot) return cachedRoot;
	// Legacy cache from before workerGitRoot existed: we know it's a repo but
	// not where the root is. Detect the root and upgrade the cache.
	const root = await detectGitRoot(cwd);
	if (root) {
		config = {
			...config,
			workerIsGitRepo: { ...(config.workerIsGitRepo ?? {}), [workerId]: true },
			workerGitRoot: { ...(config.workerGitRoot ?? {}), [workerId]: root },
		};
		await saveConfig(config);
	}
	return root;
}

async function resolveIsGitRepo(workerId: string, cwd: string): Promise<boolean> {
	return (await resolveGitRoot(workerId, cwd)) !== null;
}

app.setErrorHandler((err, _req, reply) => {
	if (err instanceof NtnError) {
		return reply.code(502).send({ error: err.message, detail: err.detail });
	}
	app.log.error(err);
	const message = err instanceof Error ? err.message : "internal error";
	return reply.code(500).send({ error: message });
});

app.get("/api/health", async () => ({ ok: true }));

app.get("/api/session/status", async (req) => ({
	authenticated: tokenMatches(req.cookies[SESSION_COOKIE_NAME], sessionToken),
}));

app.post<{ Body: { token?: string } }>(
	"/api/session/login",
	async (req, reply): Promise<{ ok: true }> => {
		if (!tokenMatches(req.body?.token, sessionToken)) {
			return reply.code(401).send({ error: "invalid token" }) as unknown as { ok: true };
		}
		reply.setCookie(SESSION_COOKIE_NAME, sessionToken, {
			path: "/",
			httpOnly: true,
			sameSite: "lax",
			// One-year cookie; the token is stable across server restarts so
			// bookmarks stay valid indefinitely unless the user clears cookies
			// or rotates the token by deleting the session-token file.
			maxAge: 60 * 60 * 24 * 365,
		});
		return { ok: true };
	},
);

app.post("/api/session/logout", async (_req, reply) => {
	reply.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
	return { ok: true };
});

app.get("/api/config", async () => config);

app.get("/api/env-info", async (): Promise<EnvInfo> => envInfo);

// Filesystem browsing endpoints — power the folder picker in the UI.
// Path is user-supplied; the browser can access anything the server user can.
// This is fine for a personal, localhost-bound tool but should be gated behind
// the session-token guard before ntn-worker-tools is ever shipped to run remotely.

app.get("/api/fs/home", async (): Promise<{ path: string }> => ({ path: homedir() }));

app.get<{ Querystring: { path?: string } }>(
	"/api/fs/list",
	async (req, reply): Promise<FsListing> => {
		const raw = req.query.path;
		if (typeof raw !== "string" || !raw) {
			return reply.code(400).send({ error: "path required" }) as unknown as FsListing;
		}
		const abs = resolve(raw);
		let dirents;
		try {
			dirents = await readdir(abs, { withFileTypes: true });
		} catch (err) {
			return reply.code(400).send({
				error: "cannot read directory",
				detail: (err as Error).message,
			}) as unknown as FsListing;
		}
		let isWorkerProject = false;
		try {
			const s = await stat(join(abs, "workers.json"));
			isWorkerProject = s.isFile();
		} catch {
			/* no workers.json here — leave false */
		}
		// Only directories, sorted case-insensitively.
		const entries = await Promise.all(
			dirents
				.filter((d) => d.isDirectory())
				.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
				.map(async (d) => {
					let hasWorkers = false;
					try {
						const s = await stat(join(abs, d.name, "workers.json"));
						hasWorkers = s.isFile();
					} catch {
						/* not a worker project — leave false */
					}
					return { name: d.name, isDirectory: true, isWorkerProject: hasWorkers };
				}),
		);
		const parent = dirname(abs);
		return {
			path: abs,
			parent: parent === abs ? null : parent,
			isWorkerProject,
			entries,
		};
	},
);

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
		config = {
			...config,
			workerLocalPaths: { ...(config.workerLocalPaths ?? {}), [req.params.id]: abs },
		};
		await saveConfig(config);
		await resolveIsGitRepo(req.params.id, abs);
		return config;
	},
);

app.get<{ Params: { id: string } }>(
	"/api/workers/:id/local-info",
	async (req, reply): Promise<LocalInfo> => {
		const path = config.workerLocalPaths?.[req.params.id];
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
		const nextPaths = { ...(config.workerLocalPaths ?? {}) };
		delete nextPaths[req.params.id];
		const nextRepo = { ...(config.workerIsGitRepo ?? {}) };
		delete nextRepo[req.params.id];
		const nextRoot = { ...(config.workerGitRoot ?? {}) };
		delete nextRoot[req.params.id];
		config = {
			...config,
			workerLocalPaths: nextPaths,
			workerIsGitRepo: nextRepo,
			workerGitRoot: nextRoot,
		};
		await saveConfig(config);
		return config;
	},
);

app.post<{ Params: { id: string } }>(
	"/api/workers/:id/reveal",
	async (req, reply): Promise<{ ok: true; path: string }> => {
		const path = config.workerLocalPaths?.[req.params.id];
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
		const path = config.workerLocalPaths?.[req.params.id];
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
		const path = config.workerLocalPaths?.[req.params.id];
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
		const path = config.workerLocalPaths?.[req.params.id];
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
		const path = config.workerLocalPaths?.[req.params.id];
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
		const path = config.workerLocalPaths?.[req.params.id];
		if (!path) {
			return reply
				.code(400)
				.send({ error: "no local path registered for this worker" }) as unknown as DeployResult;
		}
		const result = await runShellAllowingFailure("pnpm", ["run", "deploy"], { cwd: path });
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

app.post<{ Body: { url: string; webhookSecret?: string } }>(
	"/api/webhook/fire",
	async (req, reply): Promise<WebhookFireResult> => {
		const url = req.body?.url;
		if (typeof url !== "string" || !url.startsWith(NOTION_WEBHOOK_PREFIX)) {
			return reply.code(400).send({
				error: "invalid webhook url",
				detail: `url must start with ${NOTION_WEBHOOK_PREFIX}`,
			}) as unknown as WebhookFireResult;
		}
		const headers: Record<string, string> = {};
		const sentHeaders: string[] = [];
		if (typeof req.body?.webhookSecret === "string" && req.body.webhookSecret) {
			headers["X-Webhook-Secret"] = req.body.webhookSecret;
			sentHeaders.push("X-Webhook-Secret");
		}
		const start = Date.now();
		const res = await fetch(url, { method: "POST", headers });
		const body = await res.text();
		return {
			url,
			status: res.status,
			statusText: res.statusText,
			body,
			durationMs: Date.now() - start,
			sentHeaders: sentHeaders.length ? sentHeaders : undefined,
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
	app.log.error(err);
	process.exit(1);
}
