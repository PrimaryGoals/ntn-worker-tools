import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import envPaths from "env-paths";
import type { AppConfig } from "@ntn-ui/shared";

const paths = envPaths("ntn-ui", { suffix: "" });
const configFile = join(paths.config, "config.json");

const defaultConfig: AppConfig = {
	ui: { theme: "system" },
};

export async function loadConfig(): Promise<AppConfig> {
	try {
		const raw = await readFile(configFile, "utf8");
		const parsed = JSON.parse(raw) as Partial<AppConfig>;
		return { ...defaultConfig, ...parsed, ui: { ...defaultConfig.ui, ...(parsed.ui ?? {}) } };
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
