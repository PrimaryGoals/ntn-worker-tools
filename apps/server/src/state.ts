import type { AppConfig, EnvInfo } from "@ntn-worker-tools/shared";
import { loadConfig, saveConfig } from "./config.js";
import { runShellAllowingFailure } from "./ntn.js";

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

// One-shot check for git on PATH. Never repeated during the process's life.
const gitCheck = await runShellAllowingFailure("git", ["--version"]).catch(() => null);
export const envInfo: EnvInfo =
	gitCheck && gitCheck.exitCode === 0
		? { gitAvailable: true, gitVersion: gitCheck.stdout.trim() }
		: { gitAvailable: false, gitVersion: null };

async function detectGitRoot(cwd: string): Promise<string | null> {
	if (!envInfo.gitAvailable) return null;
	const r = await runShellAllowingFailure("git", ["rev-parse", "--show-toplevel"], { cwd });
	if (r.exitCode !== 0) return null;
	const root = r.stdout.trim();
	return root || null;
}

// Only positive results are cached: repos don't un-init, so a cached `true`
// stays authoritative forever. `false` is not persisted — a `git init` after
// registration should be picked up on the next request.
export async function resolveGitRoot(workerId: string, cwd: string): Promise<string | null> {
	const cachedRoot = config.workerGitRoot?.[workerId];
	if (cachedRoot) return cachedRoot;
	// Legacy cache from before workerGitRoot existed: we know it's a repo but
	// not where the root is. Detect the root and upgrade the cache.
	const root = await detectGitRoot(cwd);
	if (root) {
		await updateConfig({
			workerIsGitRepo: { ...(config.workerIsGitRepo ?? {}), [workerId]: true },
			workerGitRoot: { ...(config.workerGitRoot ?? {}), [workerId]: root },
		});
	}
	return root;
}

export async function resolveIsGitRepo(workerId: string, cwd: string): Promise<boolean> {
	return (await resolveGitRoot(workerId, cwd)) !== null;
}
