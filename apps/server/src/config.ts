import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import envPaths from "env-paths";
import type { AppConfig } from "@ntn-worker-tools/shared";

const paths = envPaths("ntn-worker-tools", { suffix: "" });
const configFile = join(paths.config, "config.json");
const configBackupFile = join(paths.config, "config.backup.json");
const configTempFile = join(paths.config, "config.tmp.json");

const defaultConfig: AppConfig = {
	ui: { theme: "system" },
	workerLocalPaths: {},
	workerIsGitRepo: {},
	workerGitRoot: {},
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
			workerIsGitRepo: { ...defaultConfig.workerIsGitRepo, ...(parsed.workerIsGitRepo ?? {}) },
			workerGitRoot: { ...defaultConfig.workerGitRoot, ...(parsed.workerGitRoot ?? {}) },
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
					workerIsGitRepo: {
						...defaultConfig.workerIsGitRepo,
						...(backupParsed.workerIsGitRepo ?? {}),
					},
					workerGitRoot: {
						...defaultConfig.workerGitRoot,
						...(backupParsed.workerGitRoot ?? {}),
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

	const jsonContent = JSON.stringify(config, null, 2) + "\n";

	// Write to temp file first for atomicity
	await writeFile(configTempFile, jsonContent, "utf8");

	// Create backup of current config before replacing it
	try {
		const currentRaw = await readFile(configFile, "utf8");
		await writeFile(configBackupFile, currentRaw, "utf8");
	} catch {
		/* Current config doesn't exist or can't be read; skip backup */
	}

	// Atomically replace config file with temp file
	await rename(configTempFile, configFile);
}

export function getConfigPath(): string {
	return configFile;
}

export function getConfigBackupPath(): string {
	return configBackupFile;
}
