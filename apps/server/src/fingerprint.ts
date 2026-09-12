import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { SCAN_IGNORED_DIR_NAMES } from "./scan-ignore.js";

// What a worker actually deploys, hashed — so "needs redeploy" can mean "this
// is not what that workspace is running" rather than "a file was touched".
//
// File times cannot answer that question across branches: `git checkout`
// rewrites every file that differs between two branches, so after any switch
// nearly every worker looks modified. They also miss the opposite case, where a
// shared package changes and nothing inside the worker's own folder does.

// workers.json is identity, not code: it changes on a branch switch and on a
// deploy, neither of which is a source change. Dot-files are skipped by the
// walk below, which is what excludes .env, .git and the .deploy shim.
const EXCLUDED_FILES = new Set(["workers.json"]);
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const WORKSPACE_PROTOCOL = "workspace:";
const WORKSPACE_MARKERS = ["pnpm-workspace.yaml", "pnpm-workspace.yml"];

export interface FingerprintCache {
	// Folder path -> its content hash. Shared packages are depended on by every
	// worker in a monorepo, so without this each one would be re-read per worker.
	folders: Map<string, Promise<string | null>>;
	// Workspace root -> package name -> package directory.
	packages: Map<string, Map<string, string>>;
}

export function newFingerprintCache(): FingerprintCache {
	return { folders: new Map(), packages: new Map() };
}

async function readJson(file: string): Promise<Record<string, unknown> | null> {
	try {
		return JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
	} catch {
		return null;
	}
}

async function hashFolderUncached(dir: string): Promise<string | null> {
	const parts: string[] = [];
	const walk = async (current: string): Promise<void> => {
		let entries;
		try {
			entries = await readdir(current, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			// Dot-entries carry .env and .deploy as well as .git — none of which is
			// source, and the first two of which would make every fingerprint a
			// moving target.
			if (entry.name.startsWith(".") || SCAN_IGNORED_DIR_NAMES.has(entry.name)) continue;
			const full = join(current, entry.name);
			if (entry.isDirectory()) {
				await walk(full);
				continue;
			}
			if (!entry.isFile() || EXCLUDED_FILES.has(entry.name)) continue;
			try {
				const info = await stat(full);
				if (info.size > MAX_FILE_BYTES) continue;
				const content = await readFile(full);
				const fileHash = createHash("sha256").update(content).digest("hex");
				// Path included, so moving a file changes the fingerprint even when
				// its bytes do not.
				parts.push(`${relative(dir, full).split(sep).join("/")}:${fileHash}`);
			} catch {
				/* vanished or unreadable mid-walk — skip it */
			}
		}
	};
	await walk(dir);
	if (parts.length === 0) return null;
	parts.sort();
	return createHash("sha256").update(parts.join("\n")).digest("hex");
}

function hashFolder(dir: string, cache: FingerprintCache): Promise<string | null> {
	const existing = cache.folders.get(dir);
	if (existing) return existing;
	const pending = hashFolderUncached(dir);
	cache.folders.set(dir, pending);
	return pending;
}

// The directory holding pnpm-workspace.yaml, or a package.json declaring
// workspaces. Null when the worker is a standalone project.
async function findWorkspaceRoot(from: string): Promise<string | null> {
	let dir = from;
	for (;;) {
		for (const marker of WORKSPACE_MARKERS) {
			try {
				await stat(join(dir, marker));
				return dir;
			} catch {
				/* not here */
			}
		}
		const pkg = await readJson(join(dir, "package.json"));
		if (pkg && pkg.workspaces) return dir;
		const parent = dirname(dir);
		if (parent === dir) return null;
		dir = parent;
	}
}

// Every package under the workspace root, by name. Built by reading package.json
// names rather than by interpreting the workspace globs — that avoids a YAML
// dependency, and handles negations like "!workers/_template" for free, since a
// package nobody depends on is never looked up.
async function indexPackages(root: string, cache: FingerprintCache): Promise<Map<string, string>> {
	const cached = cache.packages.get(root);
	if (cached) return cached;
	const index = new Map<string, string>();
	const walk = async (current: string, depth: number): Promise<void> => {
		if (depth < 0) return;
		let entries;
		try {
			entries = await readdir(current, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			if (entry.name.startsWith(".") || SCAN_IGNORED_DIR_NAMES.has(entry.name)) continue;
			if (!entry.isDirectory()) continue;
			const full = join(current, entry.name);
			const pkg = await readJson(join(full, "package.json"));
			const name = pkg?.name;
			if (typeof name === "string" && name && !index.has(name)) index.set(name, full);
			await walk(full, depth - 1);
		}
	};
	// Three levels covers packages/*, apps/*, workers/* and one nesting beyond.
	await walk(root, 3);
	cache.packages.set(root, index);
	return index;
}

// The worker's folder plus every workspace package it depends on, directly or
// through another workspace package. A change in @pmfn/util reaches sixteen
// workers, and none of them would notice otherwise.
async function dependencyDirs(dir: string, cache: FingerprintCache): Promise<string[]> {
	const pkg = await readJson(join(dir, "package.json"));
	if (!pkg) return [];
	const root = await findWorkspaceRoot(dir);
	if (!root) return [];
	const index = await indexPackages(root, cache);

	const found = new Map<string, string>();
	const visit = async (packageJson: Record<string, unknown>): Promise<void> => {
		const deps = {
			...((packageJson.dependencies as Record<string, string>) ?? {}),
			...((packageJson.devDependencies as Record<string, string>) ?? {}),
		};
		for (const [name, version] of Object.entries(deps)) {
			if (typeof version !== "string" || !version.startsWith(WORKSPACE_PROTOCOL)) continue;
			const depDir = index.get(name);
			if (!depDir || found.has(name)) continue; // unknown, or already walked
			found.set(name, depDir);
			const depPkg = await readJson(join(depDir, "package.json"));
			if (depPkg) await visit(depPkg); // transitive: db depends on util
		}
	};
	await visit(pkg);
	return [...found.values()].sort();
}

export interface Fingerprints {
	code: string | null;
	env: string | null;
}

export async function computeFingerprints(
	dir: string,
	cache: FingerprintCache = newFingerprintCache(),
): Promise<Fingerprints> {
	const dirs = [dir, ...(await dependencyDirs(dir, cache))];
	const hashes = await Promise.all(dirs.map((each) => hashFolder(each, cache)));
	const parts = dirs
		.map((each, index) => (hashes[index] ? `${each}:${hashes[index]}` : null))
		.filter((part): part is string => part !== null);

	let env: string | null = null;
	try {
		// Secrets are excluded from the code hash, and tracked separately: a
		// changed .env means a push is due, not a deploy.
		env = createHash("sha256")
			.update(await readFile(join(dir, ".env")))
			.digest("hex");
	} catch {
		/* no .env — nothing to push */
	}

	return {
		code: parts.length > 0 ? createHash("sha256").update(parts.join("\n")).digest("hex") : null,
		env,
	};
}
