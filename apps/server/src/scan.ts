import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { normalizePathKey } from "@ntn-worker-tools/shared";
import type { ScanResult, ScanWorker, WorkersJsonState } from "@ntn-worker-tools/shared";
import { loadGitState } from "./git.js";
import { SCAN_IGNORED_DIR_NAMES } from "./scan-ignore.js";

// A folder counts as a worker when it holds a workers.json (deployed at least
// once from here) or when its own source declares a worker. The second case is
// the one workers.json cannot cover: a folder that has never been deployed has
// no workers.json at all, and those are exactly the "first deployment" rows.
const WORKER_SOURCE_PATTERN = /new\s+Worker\s*\(/;

// Caps on the source search, which only runs for folders without a
// workers.json. A worker declares itself in its entry file, so reading a whole
// source tree to find that out would make the scan cost scale with the size of
// the repo rather than with the number of folders in it.
const MAX_SOURCE_FILES = 20;
const MAX_SOURCE_BYTES = 256 * 1024;
const SOURCE_FILE_PATTERN = /\.(ts|tsx|js|mjs)$/;

// A source match on its own is too weak a marker twice over: it hits any
// file that merely mentions the constructor, documentation comments
// included (this project's own shared types matched that way), and it hits
// a src/ subfolder as readily as the project that owns it. Requiring the
// SDK dependency in the folder's own package.json makes the pair mean what
// it should: a deployable worker project lives here.
const WORKER_PACKAGE = "@notionhq/workers";

async function collectSourceFiles(from: string, depth: number, found: string[]): Promise<void> {
	if (found.length >= MAX_SOURCE_FILES || depth < 0) return;
	let entries;
	try {
		entries = await readdir(from, { withFileTypes: true });
	} catch {
		return; // no such directory, or unreadable — nothing to search
	}
	for (const entry of entries) {
		if (found.length >= MAX_SOURCE_FILES) return;
		if (entry.name.startsWith(".") || SCAN_IGNORED_DIR_NAMES.has(entry.name)) continue;
		const full = join(from, entry.name);
		if (entry.isDirectory()) await collectSourceFiles(full, depth - 1, found);
		else if (entry.isFile() && SOURCE_FILE_PATTERN.test(entry.name)) found.push(full);
	}
}

async function declaresWorker(dir: string): Promise<boolean> {
	const files: string[] = [];
	await collectSourceFiles(join(dir, "src"), 2, files);
	// Fall back to the folder's own top level for projects that keep their
	// entry file beside package.json rather than under src/.
	if (files.length === 0) await collectSourceFiles(dir, 0, files);
	for (const file of files) {
		try {
			const text = await readFile(file, "utf8");
			if (text.length <= MAX_SOURCE_BYTES && WORKER_SOURCE_PATTERN.test(text)) return true;
		} catch {
			/* unreadable file — treat as no declaration */
		}
	}
	return false;
}

async function declaresWorkerProject(dir: string, fileNames: Set<string>): Promise<boolean> {
	if (!fileNames.has("package.json")) return false;
	try {
		const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8")) as {
			dependencies?: Record<string, string>;
			devDependencies?: Record<string, string>;
		};
		const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
		if (!(WORKER_PACKAGE in deps)) return false;
	} catch {
		return false; // unreadable or invalid package.json — not a project we can deploy
	}
	return declaresWorker(dir);
}

async function inspectFolder(
	dir: string,
	root: string,
	fileNames: Set<string>,
): Promise<ScanWorker | null> {
	// The git fields are filled in one pass at the end of the scan, grouped
	// by repo, so the defaults here are what a folder outside git keeps.
	const base = {
		path: dir,
		name: basename(dir),
		root,
		repoRoot: null,
		branch: null,
		remoteUrl: null,
		workersJsonState: "absent" as WorkersJsonState,
	};
	if (fileNames.has("workers.json")) {
		try {
			const parsed = JSON.parse(await readFile(join(dir, "workers.json"), "utf8")) as {
				workspaceId?: unknown;
				workerId?: unknown;
			};
			const workspaceId = typeof parsed.workspaceId === "string" ? parsed.workspaceId : null;
			const workerId = typeof parsed.workerId === "string" ? parsed.workerId : null;
			return {
				...base,
				workspaceId,
				workerId,
				// Missing either id is as unusable as unparseable JSON: it names
				// no worker to pair with.
				workersJsonInvalid: workspaceId === null || workerId === null,
				hasWorkerSource: false,
			};
		} catch {
			return {
				...base,
				workspaceId: null,
				workerId: null,
				workersJsonInvalid: true,
				hasWorkerSource: false,
			};
		}
	}
	if (await declaresWorkerProject(dir, fileNames)) {
		return {
			...base,
			workspaceId: null,
			workerId: null,
			workersJsonInvalid: false,
			hasWorkerSource: true,
		};
	}
	return null;
}

async function walk(
	dir: string,
	root: string,
	ignored: Set<string>,
	found: ScanWorker[],
	counters: { ignored: number },
): Promise<void> {
	let entries;
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		return; // vanished or unreadable mid-scan — skip it, keep going
	}

	if (ignored.has(normalizePathKey(dir))) {
		// Folders only reach ignoredFolders by having looked like workers, so
		// counting them here needs no second inspection.
		counters.ignored++;
	} else {
		const fileNames = new Set(entries.filter((e) => e.isFile()).map((e) => e.name));
		const worker = await inspectFolder(dir, root, fileNames);
		if (worker) found.push(worker);
	}

	// Keep descending even out of a worker folder: a worker project can contain
	// other worker projects (D:\Code\NTN is itself one, and holds every other).
	// Dot-directories are skipped, which is what keeps the .deploy/ shims —
	// each carrying a copy of its worker's workers.json — from being counted a
	// second time.
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		if (entry.name.startsWith(".") || SCAN_IGNORED_DIR_NAMES.has(entry.name)) continue;
		await walk(join(dir, entry.name), root, ignored, found, counters);
	}
}

// Walks every scan root and returns the worker folders under them. Pairing a
// folder to a server worker happens later and elsewhere: this layer only
// reports what is on disk.
export async function runScan(
	scanRoot: string | null,
	extraWorkerFolders: string[],
	ignoredFolders: string[],
	options: { withGitState?: boolean } = {},
): Promise<ScanResult> {
	const started = Date.now();
	// The root first, then any retained out-of-root folder. Each retained folder
	// is walked the same way, so one holding several workers still reports them.
	const roots = [...(scanRoot ? [scanRoot] : []), ...extraWorkerFolders];
	const ignored = new Set(ignoredFolders.map(normalizePathKey));
	const workers: ScanWorker[] = [];
	const unreadableRoots: string[] = [];
	const counters = { ignored: 0 };
	const seen = new Set<string>();

	for (const root of roots) {
		try {
			await readdir(root);
		} catch {
			unreadableRoots.push(root);
			continue;
		}
		const found: ScanWorker[] = [];
		await walk(root, root, ignored, found, counters);
		for (const worker of found) {
			// Overlapping roots (D:\Code\NTN and D:\Code\NTN\PMFN) would
			// otherwise list the same folder twice. First root listed wins.
			const key = normalizePathKey(worker.path);
			if (seen.has(key)) continue;
			seen.add(key);
			workers.push(worker);
		}
	}

	workers.sort((a, b) => a.path.localeCompare(b.path, undefined, { sensitivity: "base" }));

	// Internal callers that only need the identities on disk skip the git pass:
	// it spawns two commands per repo, which is wasted work when the branch and
	// tracking state are thrown away.
	if (options.withGitState === false) {
		return {
			roots,
			workers,
			repos: [],
			unreadableRoots,
			ignoredCount: counters.ignored,
			durationMs: Date.now() - started,
		};
	}

	// Git state comes last, in one pass over the folders already found: it is
	// grouped by repo, so its cost scales with the number of repos rather than
	// with the number of workers.
	const { byWorker, repos } = await loadGitState(
		workers.map((worker) => ({ path: worker.path, hasWorkersJson: !worker.hasWorkerSource })),
	);
	for (const worker of workers) {
		const state = byWorker.get(normalizePathKey(worker.path));
		worker.repoRoot = state?.repoRoot ?? null;
		worker.branch = state?.branch ?? null;
		worker.remoteUrl = state?.remoteUrl ?? null;
		worker.workersJsonState = state?.workersJsonState ?? "no-git";
	}

	return {
		roots,
		workers,
		repos,
		unreadableRoots,
		ignoredCount: counters.ignored,
		durationMs: Date.now() - started,
	};
}
