import type { AppConfig } from "@ntn-worker-tools/shared";
import { loadConfig, saveConfig } from "./config.js";

let config: AppConfig = await loadConfig();

export function getConfig(): AppConfig {
	return config;
}

export async function updateConfig(patch: Partial<AppConfig>): Promise<AppConfig> {
	const oldConfig = config;
	config = { ...config, ...patch };
	try {
		await saveConfig(config);
	} catch (err) {
		config = oldConfig;
		throw new Error(
			`Failed to save config: ${err instanceof Error ? err.message : String(err)}`,
		);
	}
	return config;
}

// Called after this app itself successfully runs a code deploy (ntn workers
// deploy / pnpm run deploy / deploy-updated / deploy-new) — see AppConfig's
// workerLastCodeDeployAt doc for why this is tracked locally instead of
// re-reading the worker's live `updatedAt` each time.
export async function recordCodeDeploy(workerId: string): Promise<void> {
	await updateConfig({
		workerLastCodeDeployAt: {
			...(config.workerLastCodeDeployAt ?? {}),
			[workerId]: new Date().toISOString(),
		},
	});
}

// Called after this app itself successfully pushes env vars (env/push or
// env/set).
export async function recordEnvPush(workerId: string): Promise<void> {
	await updateConfig({
		workerLastEnvPushAt: {
			...(config.workerLastEnvPushAt ?? {}),
			[workerId]: new Date().toISOString(),
		},
	});
}
