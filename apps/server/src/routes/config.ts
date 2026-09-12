import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import { isPathUnder, normalizePathKey } from "@ntn-worker-tools/shared";
import type { AppConfig } from "@ntn-worker-tools/shared";
import { runScan } from "../scan.js";
import { getConfig, updateConfig } from "../state.js";

export default async function configRoutes(app: FastifyInstance) {
	app.get("/api/config", async () => getConfig());

	app.patch<{ Body: Partial<AppConfig["ui"]> }>("/api/config/ui", async (req) => {
		return updateConfig({ ui: { ...getConfig().ui, ...(req.body ?? {}) } });
	});

	app.post<{ Body: { time?: string } }>("/api/config/mark-time", async (req) => {
		const time = req.body?.time ? new Date(req.body.time) : new Date();
		return updateConfig({ timeMarker: time.toISOString() });
	});

	app.post("/api/config/clear-time-marker", async () => {
		return updateConfig({ timeMarker: undefined });
	});

	// The scan root is a container directory, not a worker project: the scan
	// walks it looking for worker folders. There is exactly one, so choosing a
	// folder replaces it rather than adding to a list.
	app.post<{ Body: { path?: string } }>("/api/config/scan-root", async (req, reply) => {
		const raw = req.body?.path;
		if (typeof raw !== "string" || !raw.trim()) {
			return reply.code(400).send({ error: "path required" }) as unknown as AppConfig;
		}
		const abs = resolve(raw.trim());
		try {
			const s = await stat(abs);
			if (!s.isDirectory()) {
				return reply
					.code(400)
					.send({ error: "path is not a directory", detail: abs }) as unknown as AppConfig;
			}
		} catch {
			return reply
				.code(400)
				.send({ error: "directory not found", detail: abs }) as unknown as AppConfig;
		}
		// Moving the root must not silently drop a worker that is deployed. Any
		// folder the old root could see that names a worker, and that falls
		// outside the new root, is retained and scanned alongside it. Folders
		// with no workers.json are not retained: those are just source, and
		// losing sight of one costs nothing that a rescan cannot undo.
		const config = getConfig();
		const retained = (config.extraWorkerFolders ?? []).filter(
			(folder) => !isPathUnder(folder, abs),
		);
		const seen = new Set(retained.map(normalizePathKey));
		if (config.scanRoot) {
			// Identities only — the git pass would spawn two commands per repo for
			// branch and tracking state that this decision never reads.
			const previous = await runScan(
				config.scanRoot,
				config.extraWorkerFolders ?? [],
				config.ignoredFolders ?? [],
				{ withGitState: false },
			);
			for (const worker of previous.workers) {
				if (!worker.workerId) continue;
				if (isPathUnder(worker.path, abs)) continue;
				const folderKey = normalizePathKey(worker.path);
				if (seen.has(folderKey)) continue;
				seen.add(folderKey);
				retained.push(worker.path);
			}
		}
		// Drop retained folders that no longer exist. A deleted project should
		// not linger as a dead path in the header with nothing behind it.
		const alive: string[] = [];
		for (const folder of retained) {
			try {
				const folderStat = await stat(folder);
				if (folderStat.isDirectory()) alive.push(folder);
			} catch {
				/* gone from disk — drop it rather than carry a path nobody can act on */
			}
		}
		return updateConfig({ scanRoot: abs, extraWorkerFolders: alive });
	});

	// Drops a retained out-of-root folder. The root itself is replaced, never
	// removed, so there is nothing to delete for it.
	app.delete<{ Querystring: { path?: string } }>(
		"/api/config/extra-worker-folders",
		async (req, reply): Promise<AppConfig> => {
			const raw = req.query.path;
			if (typeof raw !== "string" || !raw.trim()) {
				return reply.code(400).send({ error: "path required" }) as unknown as AppConfig;
			}
			const key = normalizePathKey(resolve(raw.trim()));
			const folders = getConfig().extraWorkerFolders ?? [];
			return updateConfig({
				extraWorkerFolders: folders.filter((folder) => normalizePathKey(folder) !== key),
			});
		},
	);
}
