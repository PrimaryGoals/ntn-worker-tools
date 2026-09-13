import type { FastifyInstance } from "fastify";
import { normalizePathKey } from "@ntn-worker-tools/shared";
import type { MapRepo, RepoBranchesResult } from "@ntn-worker-tools/shared";
import { isRepoRoot, listBranches, originUrl } from "../git.js";
import { getScan } from "../scan-cache.js";
import { getConfig } from "../state.js";

// Every repository the map can show: the scanned ones, plus any with saved
// links that still exists on disk. Keyed by normalized root, so a saved link
// and a scanned repo spelled differently are one column.
async function mapRepos(): Promise<MapRepo[]> {
	const scan = await getScan();
	const byKey = new Map<string, MapRepo>();
	for (const repo of scan.repos) {
		byKey.set(normalizePathKey(repo.root), {
			root: repo.root,
			remoteUrl: repo.remoteUrl,
			scanned: true,
		});
	}
	for (const [key, links] of Object.entries(getConfig().branchWorkspaces ?? {})) {
		if (byKey.has(key) || Object.keys(links).length === 0) continue;
		// Gone from disk: nothing to fetch or list, and a link to it can only be
		// cleared by hand-editing, which is better than a column that cannot load.
		if (!(await isRepoRoot(key))) continue;
		byKey.set(key, { root: key, remoteUrl: await originUrl(key), scanned: false });
	}
	return [...byKey.values()];
}

export default async function repoRoutes(app: FastifyInstance) {
	app.get("/api/repos", async (): Promise<MapRepo[]> => mapRepos());

	// Fetches, then lists. Limited to repositories the map knows about: this
	// runs git with the network in whatever directory it is given, and nothing
	// outside that list has any reason to ask.
	app.get<{ Querystring: { root?: string } }>(
		"/api/repos/branches",
		async (req, reply): Promise<RepoBranchesResult> => {
			const root = req.query.root?.trim();
			if (!root) {
				return reply.code(400).send({ error: "root required" }) as unknown as RepoBranchesResult;
			}
			const known = (await mapRepos()).find(
				(repo) => normalizePathKey(repo.root) === normalizePathKey(root),
			);
			if (!known) {
				return reply
					.code(404)
					.send({ error: "not a known repository", detail: root }) as unknown as RepoBranchesResult;
			}
			return listBranches(known.root);
		},
	);
}
