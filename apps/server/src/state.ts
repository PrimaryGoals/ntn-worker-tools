import type { AppConfig, WorkerDeployRecord } from "@ntn-worker-tools/shared";
import { loadConfig, migrateConfig, saveConfig } from "./config.js";
import { computeFingerprints } from "./fingerprint.js";
import { headInfoFor } from "./git.js";

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

// What a deploy or push actually shipped, so staleness can be decided by
// comparing content instead of file times. Best-effort throughout: a fingerprint
// that cannot be computed leaves a record carrying only a timestamp, which is
// exactly what the old mtime comparison falls back to.
async function deployRecord(
	dir: string | null | undefined,
	kind: "code" | "env",
): Promise<WorkerDeployRecord> {
	const at = new Date().toISOString();
	if (!dir) return { at };
	const record: WorkerDeployRecord = { at };
	try {
		const fingerprints = await computeFingerprints(dir);
		const fingerprint = kind === "code" ? fingerprints.code : fingerprints.env;
		if (fingerprint) record.fingerprint = fingerprint;
	} catch {
		/* unreadable source — the record still carries its timestamp */
	}
	try {
		// Which branch and commit shipped, so a worker can say whose code a
		// workspace is actually running.
		const head = await headInfoFor(dir);
		if (head?.branch) record.branch = head.branch;
		if (head?.commit) record.commit = head.commit;
	} catch {
		/* outside git, or git unavailable */
	}
	return record;
}

// Called after this app itself successfully runs a code deploy (ntn workers
// deploy / pnpm run deploy / deploy-updated / deploy-new). The folder is what
// makes a fingerprint possible; without it only the timestamp is recorded.
export async function recordCodeDeploy(workerId: string, dir?: string | null): Promise<void> {
	const record = await deployRecord(dir, "code");
	await updateConfig({
		workerLastCodeDeployAt: { ...(config.workerLastCodeDeployAt ?? {}), [workerId]: record.at },
		workerDeploys: { ...(config.workerDeploys ?? {}), [workerId]: record },
	});
}

// Called after this app itself successfully pushes env vars (env/push or
// env/set). env/set passes no folder: it targets a worker by id and never reads
// a local .env, so there is nothing to fingerprint.
export async function recordEnvPush(workerId: string, dir?: string | null): Promise<void> {
	const record = await deployRecord(dir, "env");
	await updateConfig({
		workerLastEnvPushAt: { ...(config.workerLastEnvPushAt ?? {}), [workerId]: record.at },
		workerEnvPushes: { ...(config.workerEnvPushes ?? {}), [workerId]: record },
	});
}
