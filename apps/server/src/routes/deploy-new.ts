import { readFile, stat, unlink, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import type { DeployNewInspection, DeployResult } from "@ntn-worker-tools/shared";
import { runNtnRawAllowingFailure, runShellAllowingFailure } from "../ntn.js";
import { detectGitRoot, getConfig, updateConfig } from "../state.js";

// The only two files this flow is ever allowed to delete, and only inside
// whatever directory the caller already told us they're inspecting — never
// arbitrary filenames from the request body.
const CLEANABLE_FILES = ["workers.json", ".env"] as const;
type CleanableFile = (typeof CLEANABLE_FILES)[number];

const WORKER_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export default async function deployNewRoutes(app: FastifyInstance) {
	// Inspects an arbitrary directory (not yet a registered worker — the
	// "Deploy to new workspace" flow starts from a raw filesystem path) for
	// the two things that tie it to a prior deployment.
	app.get<{ Querystring: { path?: string } }>(
		"/api/deploy-new/inspect",
		async (req, reply): Promise<DeployNewInspection> => {
			const raw = req.query.path;
			if (typeof raw !== "string" || !raw.trim()) {
				return reply.code(400).send({ error: "path required" }) as unknown as DeployNewInspection;
			}
			const abs = resolve(raw.trim());
			let dirStat;
			try {
				dirStat = await stat(abs);
			} catch {
				return reply
					.code(400)
					.send({ error: "directory not found", detail: abs }) as unknown as DeployNewInspection;
			}
			if (!dirStat.isDirectory()) {
				return reply
					.code(400)
					.send({ error: "path is not a directory", detail: abs }) as unknown as DeployNewInspection;
			}

			let hasWorkersJson = false;
			let workersJson: DeployNewInspection["workersJson"];
			try {
				const raw2 = await readFile(join(abs, "workers.json"), "utf8");
				hasWorkersJson = true;
				const parsed = JSON.parse(raw2) as Partial<{
					workspaceId: string;
					workerId: string;
					environment: string;
				}>;
				if (typeof parsed.workerId === "string" && typeof parsed.workspaceId === "string") {
					workersJson = {
						workspaceId: parsed.workspaceId,
						workerId: parsed.workerId,
						environment: typeof parsed.environment === "string" ? parsed.environment : "",
					};
				}
			} catch {
				/* no workers.json, or unreadable/invalid — hasWorkersJson still reflects presence */
			}

			let hasEnvFile = false;
			try {
				const s = await stat(join(abs, ".env"));
				hasEnvFile = s.isFile();
			} catch {
				/* no .env — leave false */
			}

			let hasDeployScript = false;
			let deployScript: string | null = null;
			let hasWorkspaceProtocolDeps = false;
			let packageName: string | null = null;
			try {
				const pkgRaw = await readFile(join(abs, "package.json"), "utf8");
				const pkg = JSON.parse(pkgRaw) as {
					name?: string;
					scripts?: Record<string, string>;
					dependencies?: Record<string, string>;
					devDependencies?: Record<string, string>;
				};
				const rawScript = pkg.scripts?.deploy;
				if (typeof rawScript === "string" && rawScript.trim()) {
					hasDeployScript = true;
					deployScript = rawScript;
				}
				const allDeps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
				hasWorkspaceProtocolDeps = Object.values(allDeps).some(
					(v) => typeof v === "string" && v.startsWith("workspace:"),
				);
				if (typeof pkg.name === "string" && pkg.name) {
					packageName = pkg.name.replace(/^@[^/]+\//, "");
				}
			} catch {
				/* no package.json or unreadable — leave defaults */
			}

			return {
				path: abs,
				folderName: basename(abs),
				hasWorkersJson,
				workersJson,
				hasEnvFile,
				hasDeployScript,
				deployScript,
				hasWorkspaceProtocolDeps,
				packageName,
			};
		},
	);

	// Deletes workers.json and/or .env from a folder before it's deployed as a
	// fresh worker. Deliberately narrow: only the two whitelisted filenames,
	// only via unlink (never recursive), and silently no-ops on files that are
	// already gone.
	app.post<{ Body: { path?: string; files?: string[] } }>(
		"/api/deploy-new/clean",
		async (req, reply): Promise<{ ok: true }> => {
			const raw = req.body?.path;
			if (typeof raw !== "string" || !raw.trim()) {
				return reply.code(400).send({ error: "path required" }) as unknown as { ok: true };
			}
			const files = req.body?.files;
			if (!Array.isArray(files) || files.length === 0) {
				return reply.code(400).send({ error: "files required" }) as unknown as { ok: true };
			}
			if (!files.every((f): f is CleanableFile => CLEANABLE_FILES.includes(f as CleanableFile))) {
				return reply
					.code(400)
					.send({ error: "only workers.json and .env may be deleted here" }) as unknown as {
					ok: true;
				};
			}
			const abs = resolve(raw.trim());
			for (const f of files as CleanableFile[]) {
				try {
					await unlink(join(abs, f));
				} catch {
					/* already gone — fine */
				}
			}
			return { ok: true };
		},
	);

	// Deploys a directory as a brand-new worker (`ntn workers deploy --name`)
	// and, on success, registers it as a local path so it shows up immediately.
	app.post<{ Body: { path?: string; name?: string } }>(
		"/api/deploy-new/deploy",
		async (req, reply): Promise<DeployResult> => {
			const raw = req.body?.path;
			const name = req.body?.name?.trim();
			if (typeof raw !== "string" || !raw.trim()) {
				return reply.code(400).send({ error: "path required" }) as unknown as DeployResult;
			}
			if (!name || !WORKER_NAME_PATTERN.test(name)) {
				return reply
					.code(400)
					.send({ error: "a valid kebab-case name is required" }) as unknown as DeployResult;
			}
			const abs = resolve(raw.trim());

			// Defense in depth: the UI only enables this once workers.json is
			// gone, but re-check here too. Deploying with a stale workers.json
			// present would silently UPDATE whatever worker it points to,
			// instead of creating a new one — the one thing this whole flow
			// exists to prevent.
			try {
				await stat(join(abs, "workers.json"));
				return reply.code(400).send({
					error: "workers.json still present",
					detail:
						"Delete workers.json before deploying a fresh copy — otherwise this would update the original worker instead of creating a new one.",
				}) as unknown as DeployResult;
			} catch {
				/* good — no workers.json, safe to create fresh */
			}

			// Same defense in depth for the monorepo/workspace: case — the remote
			// build sandbox runs plain `npm install`, which fails on the
			// `workspace:` protocol (EUNSUPPORTEDPROTOCOL). A project with its own
			// scripts.deploy needs that custom build, not this plain command.
			try {
				const pkgRaw = await readFile(join(abs, "package.json"), "utf8");
				const pkg = JSON.parse(pkgRaw) as {
					scripts?: Record<string, string>;
					dependencies?: Record<string, string>;
					devDependencies?: Record<string, string>;
				};
				const allDeps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
				const hasWorkspaceDeps = Object.values(allDeps).some(
					(v) => typeof v === "string" && v.startsWith("workspace:"),
				);
				const hasDeployScript =
					typeof pkg.scripts?.deploy === "string" && pkg.scripts.deploy.trim().length > 0;
				if (hasWorkspaceDeps || hasDeployScript) {
					return reply.code(400).send({
						error: "this project needs a custom build",
						detail: hasWorkspaceDeps
							? "package.json depends on workspace:* packages — the remote build sandbox can't install those. Bundle locally and deploy with --local-build, or use this project's own deploy script."
							: "package.json defines scripts.deploy — use that instead of a plain ntn workers deploy.",
					}) as unknown as DeployResult;
				}
			} catch {
				/* no package.json — nothing to guard against */
			}

			const args = ["workers", "deploy", "--name", name, "--json"];
			const { exitCode, stdout, stderr, durationMs } = await runNtnRawAllowingFailure(args, {
				cwd: abs,
			});

			let summary: DeployResult["summary"];
			if (exitCode === 0) {
				try {
					summary = JSON.parse(stdout.trim()) as DeployResult["summary"];
				} catch {
					/* stdout wasn't clean JSON; leave summary undefined */
				}

				// workers.json now exists (ntn just wrote it) — read it back rather
				// than trust stdout's shape, since that file is the source of truth
				// every other command in this app uses to find the worker.
				let newWorkerId = summary?.worker_id;
				try {
					const wj = JSON.parse(await readFile(join(abs, "workers.json"), "utf8")) as {
						workerId?: string;
					};
					if (typeof wj.workerId === "string" && wj.workerId) newWorkerId = wj.workerId;
				} catch {
					/* fall back to summary.worker_id, if any */
				}

				// package.json's name is almost always stale here — this folder is
				// typically a copy of some other worker and still carries its name
				// (e.g. still says "@pmfn/pm-echo" after being deployed as
				// "pm-echo-secure2"). Bring it in line with what was actually
				// deployed, preserving any npm scope, so it doesn't silently drift
				// from the worker it now represents.
				try {
					const pkgPath = join(abs, "package.json");
					const pkg = JSON.parse(await readFile(pkgPath, "utf8")) as Record<string, unknown>;
					const currentName = typeof pkg.name === "string" ? pkg.name : "";
					const scope = /^@[^/]+\//.exec(currentName)?.[0] ?? "";
					const newPkgName = `${scope}${name}`;
					if (currentName !== newPkgName) {
						pkg.name = newPkgName;
						await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
					}
				} catch {
					/* no package.json, or unreadable/unwritable — not fatal, deploy already succeeded */
				}

				if (newWorkerId) {
					const gitRoot = await detectGitRoot(abs);
					await updateConfig({
						workerLocalPaths: { ...(getConfig().workerLocalPaths ?? {}), [newWorkerId]: abs },
						workerIsGitRepo: {
							...(getConfig().workerIsGitRepo ?? {}),
							[newWorkerId]: gitRoot !== null,
						},
						workerGitRoot: gitRoot
							? { ...(getConfig().workerGitRoot ?? {}), [newWorkerId]: gitRoot }
							: (getConfig().workerGitRoot ?? {}),
					});
				}
			}

			return {
				command: `ntn ${args.join(" ")}`,
				cwd: abs,
				exitCode,
				stdout,
				stderr,
				durationMs,
				summary,
			};
		},
	);

	// For projects with their own scripts.deploy (typically a monorepo that
	// needs local bundling before `ntn workers deploy` — see /inspect's
	// hasDeployScript). Runs that script instead of a plain `ntn workers
	// deploy`. The script — not this route — decides the worker's name; the
	// UI is expected to have shown its contents and gotten confirmation
	// before calling this, since a script copied from another worker can
	// carry a hardcoded reference to the wrong directory.
	app.post<{ Body: { path?: string; newName?: string } }>(
		"/api/deploy-new/pnpm-deploy",
		async (req, reply): Promise<DeployResult> => {
			const raw = req.body?.path;
			if (typeof raw !== "string" || !raw.trim()) {
				return reply.code(400).send({ error: "path required" }) as unknown as DeployResult;
			}
			const newName = req.body?.newName?.trim();
			if (newName && !WORKER_NAME_PATTERN.test(newName)) {
				return reply
					.code(400)
					.send({ error: "a valid kebab-case name is required" }) as unknown as DeployResult;
			}
			const abs = resolve(raw.trim());

			try {
				await stat(join(abs, "workers.json"));
				return reply.code(400).send({
					error: "workers.json still present",
					detail:
						"Delete workers.json before deploying a fresh copy — otherwise this would update the original worker instead of creating a new one.",
				}) as unknown as DeployResult;
			} catch {
				/* good — no workers.json, safe to create fresh */
			}

			// Rename before deploying, if asked: package.json's name is almost
			// always stale here (still says the worker this folder was copied
			// from), and — for scripts like PMFN's deploy-worker.ts that use the
			// same token to both locate the source directory and name the
			// worker on first create — the argument inside scripts.deploy has to
			// be kept in sync too, or the script will target the wrong project.
			let renameFollowup: DeployResult["followup"];
			if (newName) {
				try {
					const pkgPath = join(abs, "package.json");
					const pkg = JSON.parse(await readFile(pkgPath, "utf8")) as Record<string, unknown>;
					const currentName = typeof pkg.name === "string" ? pkg.name : "";
					const scope = /^@[^/]+\//.exec(currentName)?.[0] ?? "";
					const bareName = currentName.slice(scope.length);
					if (bareName && bareName !== newName) {
						pkg.name = `${scope}${newName}`;
						const notes: string[] = [`package.json name: ${currentName} -> ${pkg.name}`];
						if (pkg.scripts && typeof pkg.scripts === "object") {
							const scripts = pkg.scripts as Record<string, unknown>;
							if (typeof scripts.deploy === "string" && scripts.deploy.includes(bareName)) {
								const before = scripts.deploy;
								scripts.deploy = scripts.deploy.split(bareName).join(newName);
								notes.push(`scripts.deploy: ${before} -> ${scripts.deploy}`);
							} else if (typeof scripts.deploy === "string") {
								notes.push(
									`WARNING: "${bareName}" not found in scripts.deploy — it was not updated and may still target the wrong folder:\n  ${scripts.deploy}`,
								);
							}
						}
						await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
						renameFollowup = {
							command: "rename in package.json before deploy",
							exitCode: 0,
							stdout: notes.join("\n"),
							stderr: "",
							durationMs: 0,
						};
					}
				} catch (err) {
					renameFollowup = {
						command: "rename in package.json before deploy",
						exitCode: 1,
						stdout: "",
						stderr: `Could not update package.json: ${err instanceof Error ? err.message : String(err)}`,
						durationMs: 0,
					};
				}
			}

			const result = await runShellAllowingFailure("pnpm", ["run", "deploy"], {
				cwd: abs,
				shell: true,
			});

			if (result.exitCode === 0) {
				let newWorkerId: string | undefined;
				try {
					const wj = JSON.parse(await readFile(join(abs, "workers.json"), "utf8")) as {
						workerId?: string;
					};
					if (typeof wj.workerId === "string" && wj.workerId) newWorkerId = wj.workerId;
				} catch {
					/* the script may write workers.json somewhere else — nothing to register here */
				}
				if (newWorkerId) {
					const gitRoot = await detectGitRoot(abs);
					await updateConfig({
						workerLocalPaths: { ...(getConfig().workerLocalPaths ?? {}), [newWorkerId]: abs },
						workerIsGitRepo: {
							...(getConfig().workerIsGitRepo ?? {}),
							[newWorkerId]: gitRoot !== null,
						},
						workerGitRoot: gitRoot
							? { ...(getConfig().workerGitRoot ?? {}), [newWorkerId]: gitRoot }
							: (getConfig().workerGitRoot ?? {}),
					});
				}
			}

			return {
				command: result.command,
				cwd: abs,
				exitCode: result.exitCode,
				stdout: result.stdout,
				stderr: result.stderr,
				durationMs: result.durationMs,
				followup: renameFollowup,
			};
		},
	);
}
