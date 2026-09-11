import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, parse } from "node:path";
import envPaths from "env-paths";
import { normalizePathKey } from "@ntn-worker-tools/shared";
import type { AppConfig, WorkerDeployRecord } from "@ntn-worker-tools/shared";

const paths = envPaths("ntn-worker-tools", { suffix: "" });
const configFile = join(paths.config, "config.json");
const configBackupFile = join(paths.config, "config.backup.json");
const configTempFile = join(paths.config, "config.tmp.json");

const defaultConfig: AppConfig = {
	ui: { theme: "system" },
	workerLocalPaths: {},
};

export async function loadConfig(): Promise<AppConfig> {
	try {
		const raw = await readFile(configFile, "utf8");
		const parsed = JSON.parse(raw) as Partial<AppConfig>;
		return {
			...defaultConfig,
			...parsed,
			ui: { ...defaultConfig.ui, ...(parsed.ui ?? {}) },
			workerLocalPaths: { ...defaultConfig.workerLocalPaths, ...(parsed.workerLocalPaths ?? {}) },
		};
	} catch (err) {
		const nodeErr = err as NodeJS.ErrnoException;
		if (nodeErr.code === "ENOENT") return { ...defaultConfig };
		// Main config is missing or corrupted; try to restore from backup
		if (nodeErr.code === "ERR_MODULE_NOT_FOUND" || err instanceof SyntaxError) {
			try {
				const backupRaw = await readFile(configBackupFile, "utf8");
				const backupParsed = JSON.parse(backupRaw) as Partial<AppConfig>;
				console.warn(
					"[config] Main config corrupted or unreadable; restored from backup",
				);
				return {
					...defaultConfig,
					...backupParsed,
					ui: { ...defaultConfig.ui, ...(backupParsed.ui ?? {}) },
					workerLocalPaths: {
						...defaultConfig.workerLocalPaths,
						...(backupParsed.workerLocalPaths ?? {}),
					},
				};
			} catch {
				console.warn("[config] Backup also corrupted or missing; using defaults");
			}
		}
		throw err;
	}
}

export async function saveConfig(config: AppConfig): Promise<void> {
	const configDir = dirname(configFile);
	await mkdir(configDir, { recursive: true });

	// Create backup of current config BEFORE writing any new data
	try {
		const currentRaw = await readFile(configFile, "utf8");
		await writeFile(configBackupFile, currentRaw, "utf8");
	} catch {
		/* Current config doesn't exist or can't be read; skip backup */
	}

	const jsonContent = JSON.stringify(config, null, 2) + "\n";

	// Write to temp file first for atomicity
	await writeFile(configTempFile, jsonContent, "utf8");

	// Atomically replace config file with temp file
	await rename(configTempFile, configFile);
}

export function getConfigPath(): string {
	return configFile;
}

export function getConfigBackupPath(): string {
	return configBackupFile;
}

// How far the scan-root collapse below is allowed to widen: a root must keep at
// least this many path segments below the drive. Two keeps D:\Code\NTN, where a
// scan walks ~150 directories; one would allow D:\Code, which walks ~6000.
const MIN_ROOT_SEGMENTS = 2;

// Seeds scan roots from the folders already registered, so an upgrade doesn't
// come up with an empty worker list. Each registered folder contributes its
// parent, and parents sharing an ancestor collapse into it — PMFN's workers,
// auto-tasks and ntn-sync all collapse to a single root. Paths on different
// drives never share an ancestor, so they are grouped by root first.
function seedScanRoots(paths: string[]): string[] {
	const parents = new Set<string>();
	for (const p of paths) {
		const parent = dirname(p);
		if (parent && parent !== p) parents.add(parent);
	}
	if (parents.size === 0) return [];

	const groups = new Map<string, string[][]>();
	for (const parent of parents) {
		const { root } = parse(parent);
		const segments = parent.slice(root.length).split(/[\\/]+/).filter(Boolean);
		groups.set(root, [...(groups.get(root) ?? []), segments]);
	}

	const roots: string[] = [];
	const seen = new Set<string>();
	const add = (candidate: string) => {
		const key = normalizePathKey(candidate);
		if (seen.has(key)) return;
		seen.add(key);
		roots.push(candidate);
	};
	for (const [root, members] of groups) {
		let common = members[0] ?? [];
		for (const segments of members.slice(1)) {
			let i = 0;
			while (
				i < common.length &&
				i < segments.length &&
				normalizePathKey(common[i]!) === normalizePathKey(segments[i]!)
			) {
				i++;
			}
			common = common.slice(0, i);
		}
		// Too shallow to collapse safely — keep each parent as its own root
		// rather than widening the scan to most of the drive.
		if (common.length >= MIN_ROOT_SEGMENTS) add(join(root, ...common));
		else for (const segments of members) add(join(root, ...segments));
	}
	return roots;
}

// Carries the old timestamp-only maps into deploy records. The migrated records
// have no fingerprint, which is what keeps the mtime comparison in place until
// each worker's next deploy.
function seedRecords(
	existing: Record<string, WorkerDeployRecord> | undefined,
	timestamps: Record<string, string> | undefined,
): Record<string, WorkerDeployRecord> {
	const records = { ...(existing ?? {}) };
	for (const [workerId, at] of Object.entries(timestamps ?? {})) {
		if (!records[workerId]) records[workerId] = { at };
	}
	return records;
}

// One-time move from the workerId -> folder map to scan roots and deploy
// records. Keyed on `scanRoots` being absent rather than empty, so it seeds once
// and never again — otherwise removing every root would silently re-seed them
// on the next start. Leaves workerLocalPaths in place; nothing reads the new
// fields yet, and the old ones are removed once the rest of the feature lands.
export function migrateConfig(config: AppConfig): { config: AppConfig; changed: boolean } {
	if (config.scanRoots !== undefined) return { config, changed: false };
	return {
		config: {
			...config,
			scanRoots: seedScanRoots(Object.values(config.workerLocalPaths ?? {})),
			workerDeploys: seedRecords(config.workerDeploys, config.workerLastCodeDeployAt),
			workerEnvPushes: seedRecords(config.workerEnvPushes, config.workerLastEnvPushAt),
		},
		changed: true,
	};
}
