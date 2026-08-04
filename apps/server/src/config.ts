import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import envPaths from "env-paths";
import type { AppConfig } from "@ntn-worker-tools/shared";

const paths = envPaths("ntn-worker-tools", { suffix: "" });
const configFile = join(paths.config, "config.json");

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
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return { ...defaultConfig };
		throw err;
	}
}

export async function saveConfig(config: AppConfig): Promise<void> {
	await mkdir(dirname(configFile), { recursive: true });
	await writeFile(configFile, JSON.stringify(config, null, 2), "utf8");
}

export function getConfigPath(): string {
	return configFile;
}
