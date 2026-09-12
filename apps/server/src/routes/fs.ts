import { spawn } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import type { FastifyInstance } from "fastify";
import type { FsListing } from "@ntn-worker-tools/shared";

// Filesystem browsing endpoints — power the folder picker in the UI.
// Path is user-supplied; the browser can access anything the server user can.
// This is fine for a personal, localhost-bound tool but should be gated behind
// the session-token guard before ntn-worker-tools is ever shipped to run remotely.
export default async function fsRoutes(app: FastifyInstance) {
	app.get("/api/fs/home", async (): Promise<{ path: string }> => ({ path: homedir() }));

	// Opens any directory in the OS file browser. The worker-scoped reveal
	// resolves a workerId through the config; this takes the path directly,
	// for places that are not a registered worker folder - a repository root,
	// say.
	app.post<{ Body: { path?: string } }>("/api/fs/reveal", async (req, reply) => {
		const raw = req.body?.path;
		if (typeof raw !== "string" || !raw.trim()) {
			return reply.code(400).send({ error: "path required" });
		}
		const abs = resolve(raw.trim());
		try {
			const s = await stat(abs);
			if (!s.isDirectory()) {
				return reply.code(400).send({ error: "path is not a directory", detail: abs });
			}
		} catch {
			return reply.code(400).send({ error: "directory not found", detail: abs });
		}
		// explorer.exe exits non-zero even when it worked, so nothing observes
		// the exit code here - the same reasoning as the worker-scoped reveal.
		const child =
			process.platform === "win32"
				? spawn("explorer.exe", [abs], { detached: true })
				: process.platform === "darwin"
					? spawn("open", [abs], { detached: true })
					: spawn("xdg-open", [abs], { detached: true });
		child.on("error", (err) => app.log.error({ err, path: abs }, "reveal spawn failed"));
		child.unref();
		return { ok: true, path: abs };
	});

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
			// Only directories (excluding hidden ones starting with "."), sorted case-insensitively.
			const entries = await Promise.all(
				dirents
					.filter((d) => d.isDirectory() && !d.name.startsWith("."))
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
}
