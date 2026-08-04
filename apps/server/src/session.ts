import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import envPaths from "env-paths";

const paths = envPaths("ntn-worker-tools", { suffix: "" });
const tokenFile = join(paths.config, "session-token");

export const SESSION_COOKIE_NAME = "ntn_ui_session";

// 32 random bytes → 64 hex chars → 256 bits of entropy. Regenerated only on
// explicit deletion of the token file (a "log everyone out" gesture).
export async function loadOrCreateToken(): Promise<{ token: string; created: boolean }> {
	try {
		const existing = (await readFile(tokenFile, "utf8")).trim();
		if (/^[0-9a-f]{64}$/i.test(existing)) return { token: existing, created: false };
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
	}
	const token = randomBytes(32).toString("hex");
	await mkdir(dirname(tokenFile), { recursive: true });
	await writeFile(tokenFile, `${token}\n`, { encoding: "utf8", mode: 0o600 });
	return { token, created: true };
}

export function getTokenFilePath(): string {
	return tokenFile;
}

// Constant-time comparison so a timing side-channel can't leak the token
// byte-by-byte. Only compares when lengths match; hex length is fixed anyway.
export function tokenMatches(candidate: string | undefined, actual: string): boolean {
	if (typeof candidate !== "string") return false;
	if (candidate.length !== actual.length) return false;
	return timingSafeEqual(Buffer.from(candidate, "utf8"), Buffer.from(actual, "utf8"));
}
