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

	// A scan root is a container directory, not a worker project: the scan walks
	// it looking for worker folders. Several are allowed, so this appends rather
	// than replaces.
	app.post<{ Body: { path?: string } }>("/api/config/scan-roots", async (req, reply) => {
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
		const roots = getConfig().scanRoots ?? [];
		// Compared through normalizePathKey so the same folder cannot be added
		// twice under two spellings, which on Windows are the same directory.
		if (roots.some((root) => normalizePathKey(root) === normalizePathKey(abs))) return getConfig();
		return updateConfig({ scanRoots: [...roots, abs] });
	});

	app.delete<{ Querystring: { path?: string } }>(
		"/api/config/scan-roots",
		async (req, reply): Promise<AppConfig> => {
			const raw = req.query.path;
			if (typeof raw !== "string" || !raw.trim()) {
				return reply.code(400).send({ error: "path required" }) as unknown as AppConfig;
			}
			const key = normalizePathKey(resolve(raw.trim()));
			const roots = getConfig().scanRoots ?? [];
			return updateConfig({ scanRoots: roots.filter((root) => normalizePathKey(root) !== key) });
		},
	);
}
