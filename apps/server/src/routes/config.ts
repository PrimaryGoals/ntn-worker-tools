import type { FastifyInstance } from "fastify";
import type { AppConfig, EnvInfo } from "@ntn-worker-tools/shared";
import { envInfo, getConfig, updateConfig } from "../state.js";

export default async function configRoutes(app: FastifyInstance) {
	app.get("/api/config", async () => getConfig());

	app.get("/api/env-info", async (): Promise<EnvInfo> => envInfo);

	app.patch<{ Body: Partial<AppConfig["ui"]> }>("/api/config/ui", async (req) => {
		return updateConfig({ ui: { ...getConfig().ui, ...(req.body ?? {}) } });
	});

	app.post("/api/config/mark-time", async () => {
		return updateConfig({ timeMarker: new Date().toISOString() });
	});

	app.post("/api/config/clear-time-marker", async () => {
		return updateConfig({ timeMarker: undefined });
	});
}
