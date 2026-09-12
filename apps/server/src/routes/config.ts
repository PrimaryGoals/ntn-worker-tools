import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import { normalizePathKey } from "@ntn-worker-tools/shared";
import type { AppConfig } from "@ntn-worker-tools/shared";
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
		// Worker folders already paired but outside the new root are retained, so
		// moving the root never silently drops a worker that is on the server.
		const config = getConfig();
		const key = normalizePathKey(abs);
		const kept = (config.extraWorkerFolders ?? []).filter(
			(folder) => !normalizePathKey(folder).startsWith(key + "/") && normalizePathKey(folder) !== key,
		);
		return updateConfig({ scanRoot: abs, extraWorkerFolders: kept });
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
