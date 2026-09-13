import { readFileSync } from "node:fs";
import { constants, copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, parse } from "node:path";
import envPaths from "env-paths";
import { isPathUnder, normalizePathKey } from "@ntn-worker-tools/shared";
import type { AppConfig, WorkerDeployRecord } from "@ntn-worker-tools/shared";

const paths = envPaths("ntn-worker-tools", { suffix: "" });
const configFile = join(paths.config, "config.json");
const configBackupFile = join(paths.config, "config.backup.json");
const configTempFile = join(paths.config, "config.tmp.json");

const defaultConfig: AppConfig = {
	ui: { theme: "system" },
};

export async function loadConfig(): Promise<AppConfig> {
	try {
		const raw = await readFile(configFile, "utf8");
		const parsed = JSON.parse(raw) as Partial<AppConfig>;
		return {
			...defaultConfig,
			...parsed,
			ui: { ...defaultConfig.ui, ...(parsed.ui ?? {}) },
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

// The app version recorded as `writtenBy`. Read from the root package.json,
// three levels above both src/ and dist/.
export const APP_VERSION = (() => {
	try {
		const raw = readFileSync(join(import.meta.dirname, "..", "..", "..", "package.json"), "utf8");
		return (JSON.parse(raw) as { version?: string }).version ?? "unknown";
	} catch {
		return "unknown";
	}
})();

// Keeps the file as it was before a conversion, as config.v<version>.json.
// config.backup.json cannot do this: every save overwrites it, so two saves
// after an upgrade it holds the converted file. Never overwrites an existing
// copy, so the first file seen at each version is the one kept. Returns the
// copy's path, or null when there was no file to copy.
export async function preserveConfigCopy(version: number): Promise<string | null> {
	const copy = join(paths.config, `config.v${version}.json`);
	try {
		await copyFile(configFile, copy, constants.COPYFILE_EXCL);
		return copy;
	} catch {
		// No config.json (a first run), or a copy already kept for this version.
		return null;
	}
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

// Reduces candidate roots to the one the scan runs from, plus whatever sits
// outside it. The shallowest candidate wins, since a nested one finds nothing
// its parent would not. Anything left over is kept as an extra folder rather
// than discarded: a worker already paired to it must not disappear.
function splitRoot(
	candidates: string[],
	savedFolders: string[],
): { root: string | undefined; extras: string[] } {
	const sorted = [...candidates].sort((a, b) => normalizePathKey(a).length - normalizePathKey(b).length);
	const root = sorted[0];
	if (root === undefined) return { root: undefined, extras: [] };
	const extras: string[] = [];
	const seen = new Set<string>([normalizePathKey(root)]);
	for (const candidate of [...sorted.slice(1), ...savedFolders]) {
		if (isPathUnder(candidate, root)) continue;
		const key = normalizePathKey(candidate);
		if (seen.has(key)) continue;
		seen.add(key);
		extras.push(candidate);
	}
	return { root, extras };
}

// Fingerprints are only comparable within one scheme. Scheme 1 hashed each
// folder's absolute path alongside its contents, so a worker deployed from
// D:\Code\... and scanned from d:\code\... never matched itself.
const FINGERPRINT_SCHEME = 2;

function stripStaleFingerprints(config: AppConfig): { config: AppConfig; changed: boolean } {
	if ((config.fingerprintScheme ?? 1) >= FINGERPRINT_SCHEME) return { config, changed: false };
	// Dropped rather than kept: a value from the old scheme reports a change
	// that never happened, every time. The timestamps stay, which is what the
	// comparison falls back to until the next deploy writes a fresh hash.
	const strip = (records: Record<string, WorkerDeployRecord> | undefined) =>
		Object.fromEntries(
			Object.entries(records ?? {}).map(([workerId, record]) => [
				workerId,
				{ ...record, fingerprint: undefined },
			]),
		);
	return {
		config: {
			...config,
			workerDeploys: strip(config.workerDeploys),
			workerEnvPushes: strip(config.workerEnvPushes),
			fingerprintScheme: FINGERPRINT_SCHEME,
		},
		changed: true,
	};
}

// One-time move from the workerId -> folder map to a scan root and deploy
// records. Keyed on `scanRoot` being absent, so it seeds once and never again —
// otherwise clearing the root would silently re-seed it on the next start. Also
// collapses the earlier multi-root shape, where a second root was allowed.
// The old workerId -> folder map is read here and nowhere else: it is the only
// record of where an installation kept its workers before the scan existed.
function migrateScanRoot(config: AppConfig): { config: AppConfig; changed: boolean } {
	if (config.scanRoot !== undefined) return { config, changed: false };
	// Read through a cast: the field is gone from AppConfig, but a config
	// written before it was retired still carries it, and it is the only
	// record of where that installation kept its workers.
	const legacyPaths = (config as { workerLocalPaths?: Record<string, string> })
		.workerLocalPaths;
	const saved = Object.values(legacyPaths ?? {});
	const legacyRoots = (config as { scanRoots?: string[] }).scanRoots;
	const candidates = legacyRoots?.length ? legacyRoots : seedScanRoots(saved);
	const { root, extras } = splitRoot(candidates, saved);
	const next: AppConfig & { scanRoots?: string[] } = {
		...config,
		scanRoot: root ?? "",
		extraWorkerFolders: extras,
		workerDeploys: seedRecords(config.workerDeploys, config.workerLastCodeDeployAt),
		workerEnvPushes: seedRecords(config.workerEnvPushes, config.workerLastEnvPushAt),
	};
	// The multi-root field is gone rather than left to rot beside its
	// replacement, where a later reader could pick the wrong one.
	delete next.scanRoots;
	return { config: next, changed: true };
}

// Fields no longer part of AppConfig and read by nothing. `workerLocalPaths` is
// the exception while `scanRoot` is still absent: migrateScanRoot seeds from
// it, so this runs after that and only once a root exists. The others were
// written by earlier versions — per-worker git detection, and per-worker time
// markers from before the single global `timeMarker`.
const RETIRED_FIELDS = ["workerLocalPaths", "workerIsGitRepo", "workerGitRoot", "timeMarkers"];

function dropRetiredFields(config: AppConfig): { config: AppConfig; changed: boolean } {
	if (config.scanRoot === undefined) return { config, changed: false };
	const present = RETIRED_FIELDS.filter((field) => field in config);
	if (present.length === 0) return { config, changed: false };
	const next: Record<string, unknown> = { ...config };
	for (const field of present) delete next[field];
	return { config: next as unknown as AppConfig, changed: true };
}

// MIGRATIONS[n] carries a file from configVersion n to n + 1, so adding a step
// raises CONFIG_VERSION with it. Version 0 is every file from before versioning,
// including 1.5.0 files that are already partly converted - which is why its
// step is the content-keyed conversions above, each of which skips itself when
// there is nothing to do. Later steps are keyed on the version alone.
const MIGRATIONS: Array<(config: AppConfig) => AppConfig> = [
	(config) =>
		[migrateScanRoot, stripStaleFingerprints, dropRetiredFields].reduce(
			(current, step) => step(current).config,
			config,
		),
];

export const CONFIG_VERSION = MIGRATIONS.length;

export interface MigrationResult {
	config: AppConfig;
	// Converted, and so needs saving.
	changed: boolean;
	// The version the file was at when read.
	fromVersion: number;
	// Written by a newer server than this one. Nothing is converted, and the
	// file must not be saved over: this server would drop what it cannot read.
	newer: boolean;
}

// Brings a file up to CONFIG_VERSION, one step at a time, and stamps it.
export function migrateConfig(config: AppConfig): MigrationResult {
	const fromVersion = config.configVersion ?? 0;
	if (fromVersion > CONFIG_VERSION) {
		return { config, changed: false, fromVersion, newer: true };
	}
	if (fromVersion === CONFIG_VERSION) {
		return { config, changed: false, fromVersion, newer: false };
	}
	let current = config;
	for (let version = fromVersion; version < CONFIG_VERSION; version++) {
		current = MIGRATIONS[version]!(current);
	}
	return {
		config: { ...current, configVersion: CONFIG_VERSION },
		changed: true,
		fromVersion,
		newer: false,
	};
}
