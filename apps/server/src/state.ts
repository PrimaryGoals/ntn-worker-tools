import type { AppConfig, WorkerDeployRecord } from "@ntn-worker-tools/shared";
import {
	APP_VERSION,
	CONFIG_VERSION,
	getConfigPath,
	loadConfig,
	migrateConfig,
	preserveConfigCopy,
	saveConfig,
} from "./config.js";
import { computeFingerprints } from "./fingerprint.js";
import { headInfoFor } from "./git.js";

// Migration runs before anything reads the config, and the result is persisted
// immediately: the seeded scan roots are what the first scan walks, and
// re-deriving them on every start would undo a root the user later removed.
const migration = migrateConfig(await loadConfig());
let config: AppConfig = migration.config;

// A file from a newer server is read but never saved over. Saving would write
// back only the fields this version knows, silently dropping the rest - which
// is exactly how switching an install between releases used to lose settings.
const newerFileMessage = migration.newer
	? `${getConfigPath()} was saved by NTN Worker Tools ${config.writtenBy ?? "(unknown)"} ` +
		`(config version ${migration.fromVersion}), which is newer than this one ` +
		`(${APP_VERSION}, config version ${CONFIG_VERSION}). Changes are not being saved, ` +
		`so nothing the newer version recorded is lost. Run the newer version to make changes.`
	: null;
if (newerFileMessage) console.warn(`[config] ${newerFileMessage}`);

if (migration.changed) {
	// Before anything is written, so the pre-conversion file survives the
	// backup rotation that every save performs.
	const copy = await preserveConfigCopy(migration.fromVersion);
	if (copy) {
		console.log(
			`[config] Converted config from version ${migration.fromVersion} to ${CONFIG_VERSION}; the original is kept at ${copy}`,
		);
	}
	config = stamped(config);
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

// The deploy or push has already happened by the time it is recorded. Under a
// newer file the record cannot be saved, and reporting that as a failure would
// misstate an action that succeeded - so it is skipped, and said so in the log.
function skipRecordForNewerFile(workerId: string): boolean {
	if (!newerFileMessage) return false;
	console.warn(`[config] Not recording the deploy or push for ${workerId}: ${newerFileMessage}`);
	return true;
}

// Every save records which app version wrote it.
function stamped(next: AppConfig): AppConfig {
	return { ...next, writtenBy: APP_VERSION };
}

export function getConfig(): AppConfig {
	return config;
}

export async function updateConfig(patch: Partial<AppConfig>): Promise<AppConfig> {
	if (newerFileMessage) throw new Error(newerFileMessage);
	const oldConfig = config;
	config = stamped({ ...config, ...patch });
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
	if (skipRecordForNewerFile(workerId)) return;
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
	if (skipRecordForNewerFile(workerId)) return;
	const record = await deployRecord(dir, "env");
	await updateConfig({
		workerLastEnvPushAt: { ...(config.workerLastEnvPushAt ?? {}), [workerId]: record.at },
		workerEnvPushes: { ...(config.workerEnvPushes ?? {}), [workerId]: record },
	});
}
