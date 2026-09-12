import { access } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { normalizePathKey } from "@ntn-worker-tools/shared";
import type { ScanRepo, WorkersJsonState } from "@ntn-worker-tools/shared";
import { runShellAllowingFailure } from "./ntn.js";

// git calls here are metadata reads that finish in milliseconds. The shared
// runner defaults to five minutes, which would hang the scan on a pathological
// repo instead of reporting what it could find.
const GIT_TIMEOUT_MS = 15_000;

function git(args: string[], cwd: string) {
	return runShellAllowingFailure("git", args, { cwd, timeoutMs: GIT_TIMEOUT_MS });
}

// Walks up looking for .git rather than asking git, so a folder outside any
// repo costs no subprocess at all — and most scanned folders share a repo, so
// this collapses many folders onto few git calls.
async function findRepoRoot(from: string): Promise<string | null> {
	let dir = from;
	for (;;) {
		try {
			// A worktree or submodule has .git as a file, not a directory, so
			// presence is the test rather than type.
			await access(join(dir, ".git"));
			return dir;
		} catch {
			const parent = dirname(dir);
			if (parent === dir) return null;
			dir = parent;
		}
	}
}

export interface WorkerGitState {
	repoRoot: string | null;
	branch: string | null;
	remoteUrl: string | null;
	workersJsonState: WorkersJsonState;
}

// Reads the branch and the workers.json status of every scanned folder, with
// two git calls per repo: one for the branch, one status over that repo's
// workers.json paths. Anything git cannot answer degrades to "no-git" rather
// than failing the scan — git is optional in this model.
export async function loadGitState(
	folders: { path: string; hasWorkersJson: boolean }[],
): Promise<{ byWorker: Map<string, WorkerGitState>; repos: ScanRepo[] }> {
	const byWorker = new Map<string, WorkerGitState>();
	const byRepo = new Map<string, { root: string; folders: typeof folders }>();

	for (const folder of folders) {
		const root = await findRepoRoot(folder.path);
		if (root === null) {
			byWorker.set(normalizePathKey(folder.path), {
				repoRoot: null,
				branch: null,
				remoteUrl: null,
				workersJsonState: folder.hasWorkersJson ? "no-git" : "absent",
			});
			continue;
		}
		const key = normalizePathKey(root);
		const entry = byRepo.get(key) ?? { root, folders: [] };
		entry.folders.push(folder);
		byRepo.set(key, entry);
	}

	const repos: ScanRepo[] = [];
	for (const { root, folders: repoFolders } of byRepo.values()) {
		const head = await git(["rev-parse", "--abbrev-ref", "HEAD"], root);
		// "HEAD" is what a detached checkout reports; it names no branch, so it
		// cannot be mapped to a workspace.
		const name = head.stdout.trim();
		let branch = head.exitCode === 0 && name && name !== "HEAD" ? name : null;
		if (branch === null) {
			// A repo with no commits yet has an unborn HEAD, which rev-parse cannot
			// resolve even though the branch a first commit would land on is known.
			// symbolic-ref reads the ref itself, and still fails when detached.
			const symbolic = await git(["symbolic-ref", "--short", "HEAD"], root);
			const symbolicName = symbolic.stdout.trim();
			if (symbolic.exitCode === 0 && symbolicName) branch = symbolicName;
		}
		// The remote is what names the repository; the root only says where this
		// clone sits. Absent for a repo with no origin, which is not an error.
		const remote = await git(["remote", "get-url", "origin"], root);
		const remoteUrl = remote.exitCode === 0 && remote.stdout.trim() ? remote.stdout.trim() : null;
		repos.push({ root, branch, remoteUrl, workerCount: repoFolders.length });

		const withFile = repoFolders.filter((f) => f.hasWorkersJson);
		const flagged = new Map<string, WorkersJsonState>();
		if (withFile.length > 0) {
			// One status call for the whole repo. --ignored=matching lists ignored
			// files individually; without it git collapses them to the containing
			// directory and an ignored workers.json never appears by name.
			const paths = withFile.map((f) => toGitPath(root, join(f.path, "workers.json")));
			const status = await git(
				["status", "--porcelain", "--ignored=matching", "--", ...paths],
				root,
			);
			if (status.exitCode === 0) {
				for (const line of status.stdout.split("\n")) {
					if (line.length < 4) continue;
					const code = line.slice(0, 2);
					const file = line.slice(3).trim().replace(/^"|"$/g, "");
					const abs = join(root, file);
					// Only ?? and !! mean git is not tracking the file. Every other
					// code (" M", "A ", …) is a tracked file in some state.
					if (code === "??") flagged.set(normalizePathKey(abs), "untracked");
					else if (code === "!!") flagged.set(normalizePathKey(abs), "ignored");
				}
			}
		}

		for (const folder of repoFolders) {
			const workersJson = normalizePathKey(join(folder.path, "workers.json"));
			byWorker.set(normalizePathKey(folder.path), {
				repoRoot: root,
				branch,
				remoteUrl,
				workersJsonState: !folder.hasWorkersJson
					? "absent"
					: (flagged.get(workersJson) ?? "tracked"),
			});
		}
	}

	repos.sort((a, b) => a.root.localeCompare(b.root, undefined, { sensitivity: "base" }));
	return { byWorker, repos };
}

// git wants repo-relative, forward-slashed paths regardless of platform.
function toGitPath(root: string, file: string): string {
	return relative(root, file).split(sep).join("/");
}
