import { spawn } from "node:child_process";
import { readFile, rename, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import type {
	AppConfig,
	DeployResult,
	GitStatus,
	GitStatusEntry,
	LocalInfo,
} from "@ntn-worker-tools/shared";
import { runNtnRawAllowingFailure, runShellAllowingFailure } from "../ntn.js";
import { isVerbose } from "../route-helpers.js";
import { envInfo, getConfig, resolveGitRoot, resolveIsGitRepo, updateConfig } from "../state.js";

export default async function workerLocalRoutes(app: FastifyInstance) {
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
				let folderWorkerName: string | undefined;
				try {
					const pkgRaw = await readFile(join(abs, "package.json"), "utf8");
					const pkg = JSON.parse(pkgRaw) as { name?: string };
					folderWorkerName = pkg.name;
				} catch {
					/* no package.json or invalid JSON — leave undefined */
				}
				return reply.code(400).send({
					error: "worker mismatch",
					detail: `Folder ${abs} is registered to workerId=${folderWorkerId}, but you have workerId=${req.params.id} selected.`,
					folderWorkerId,
					folderWorkerName,
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

	app.post<{ Params: { id: string }; Body: { newName: string } }>(
		"/api/workers/:id/rename",
		async (req, reply): Promise<DeployResult> => {
			const path = getConfig().workerLocalPaths?.[req.params.id];
			if (!path) {
				return reply
					.code(400)
					.send({ error: "no local path registered for this worker" }) as unknown as DeployResult;
			}
			const newName = req.body?.newName?.trim();
			if (!newName) {
				return reply
					.code(400)
					.send({ error: "new worker name required" }) as unknown as DeployResult;
			}

			const parentDir = dirname(path);
			const newPath = join(parentDir, newName);

			try {
				await rename(path, newPath);
			} catch (err) {
				return reply.code(400).send({
					error: "failed to rename directory",
					detail: `Could not rename folder from ${basename(path)} to ${newName}. It may be in use.`,
				}) as unknown as DeployResult;
			}

			await updateConfig({
				workerLocalPaths: { ...(getConfig().workerLocalPaths ?? {}), [req.params.id]: newPath },
			});

			const ntnResult = await runNtnRawAllowingFailure(
				["workers", "rename", "--worker-id", req.params.id, newName],
				{},
			);

			if (ntnResult.exitCode !== 0) {
				return {
					command: `ntn workers rename --worker-id ${req.params.id} ${newName}`,
					cwd: "",
					exitCode: ntnResult.exitCode,
					stdout: ntnResult.stdout,
					stderr: ntnResult.stderr,
					durationMs: ntnResult.durationMs,
				};
			}

			try {
				const pkgRaw = await readFile(join(newPath, "package.json"), "utf8");
				const pkg = JSON.parse(pkgRaw) as Record<string, unknown>;
				const oldName = basename(path);
				let replacementCount = 0;

				if (typeof pkg.name === "string" && pkg.name.includes(oldName)) {
					pkg.name = pkg.name.replaceAll(oldName, newName);
					replacementCount++;
				}

				if (pkg.scripts && typeof pkg.scripts === "object") {
					const scripts = pkg.scripts as Record<string, unknown>;
					if (typeof scripts.deploy === "string" && scripts.deploy.includes(oldName)) {
						scripts.deploy = scripts.deploy.replaceAll(oldName, newName);
						replacementCount++;
					}
				}

				if (replacementCount > 0) {
					await writeFile(join(newPath, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
				}
			} catch {
				/* no package.json or update failed — continue */
			}

			return {
				command: `ntn workers rename --worker-id ${req.params.id} ${newName}`,
				cwd: newPath,
				exitCode: ntnResult.exitCode,
				stdout: ntnResult.stdout,
				stderr: ntnResult.stderr,
				durationMs: ntnResult.durationMs,
			};
		},
	);
}
