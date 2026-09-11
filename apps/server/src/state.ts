import type { AppConfig } from "@ntn-worker-tools/shared";
import { loadConfig, migrateConfig, saveConfig } from "./config.js";

// Migration runs before anything reads the config, and the result is persisted
// immediately: the seeded scan roots are what the first scan walks, and
// re-deriving them on every start would undo a root the user later removed.
const migration = migrateConfig(await loadConfig());
let config: AppConfig = migration.config;
if (migration.changed) {
	try {
		await saveConfig(config);
	} catch (err) {
		// Not fatal — the app runs on the migrated config in memory and tries
		// again next start. A lost write only means seeding happens later.
		console.warn(
			`[config] Could not save migrated config: ${err instanceof Error ? err.message : String(err)}`,
		);
	}
}

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
