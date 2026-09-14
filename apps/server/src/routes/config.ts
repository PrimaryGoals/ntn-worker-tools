import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import { isPathUnder, normalizePathKey } from "@ntn-worker-tools/shared";
import type { AppConfig } from "@ntn-worker-tools/shared";
import { lookupWorkspaceName, rememberWorkspaceName } from "../identity-names.js";
import { runScan } from "../scan.js";
import { getConfig, updateConfig } from "../state.js";

export default async function configRoutes(app: FastifyInstance) {
	app.get("/api/config", async () => getConfig());

	app.patch<{ Body: Partial<AppConfig["ui"]> }>("/api/config/ui", async (req) => {
		return updateConfig({ ui: { ...getConfig().ui, ...(req.body ?? {}) } });
	});

	app.post<{ Body: { time?: string } }>("/api/config/mark-time", async (req) => {
		const time = req.body?.time ? new Date(req.body.time) : new Date();
		return updateConfig({ timeMarker: time.toISOString() });
	});

	app.post("/api/config/clear-time-marker", async () => {
		return updateConfig({ timeMarker: undefined });
	});

	// The scan root is a container directory, not a worker project: the scan
	// walks it looking for worker folders. There is exactly one, so choosing a
	// folder replaces it rather than adding to a list.
	app.post<{ Body: { path?: string } }>("/api/config/scan-root", async (req, reply) => {
		const raw = req.body?.path;
		if (typeof raw !== "string" || !raw.trim()) {
			return reply.code(400).send({ error: "path required" }) as unknown as AppConfig;
		}
		const abs = resolve(raw.trim());
		try {
			const s = await stat(abs);
			if (!s.isDirectory()) {
				return reply
					.code(400)
					.send({ error: "path is not a directory", detail: abs }) as unknown as AppConfig;
			}
		} catch {
			return reply
				.code(400)
				.send({ error: "directory not found", detail: abs }) as unknown as AppConfig;
		}
		// Moving the root must not silently drop a worker that is deployed. Any
		// folder the old root could see that names a worker, and that falls
		// outside the new root, is retained and scanned alongside it. Folders
		// with no workers.json are not retained: those are just source, and
		// losing sight of one costs nothing that a rescan cannot undo.
		const config = getConfig();
		const retained = (config.extraWorkerFolders ?? []).filter(
			(folder) => !isPathUnder(folder, abs),
		);
		const seen = new Set(retained.map(normalizePathKey));
		if (config.scanRoot) {
			// Identities only — the git pass would spawn two commands per repo for
			// branch and tracking state that this decision never reads.
			const previous = await runScan(
				config.scanRoot,
				config.extraWorkerFolders ?? [],
				config.ignoredFolders ?? [],
				{ withGitState: false },
			);
			for (const worker of previous.workers) {
				if (!worker.workerId) continue;
				if (isPathUnder(worker.path, abs)) continue;
				const folderKey = normalizePathKey(worker.path);
				if (seen.has(folderKey)) continue;
				seen.add(folderKey);
				retained.push(worker.path);
			}
		}
		// Drop retained folders that no longer exist. A deleted project should
		// not linger as a dead path in the header with nothing behind it.
		const alive: string[] = [];
		for (const folder of retained) {
			try {
				const folderStat = await stat(folder);
				if (folderStat.isDirectory()) alive.push(folder);
			} catch {
				/* gone from disk — drop it rather than carry a path nobody can act on */
			}
		}
		return updateConfig({ scanRoot: abs, extraWorkerFolders: alive });
	});

	// Adds a workspace to the ones the app can name, by id. `ntn` cannot list
	// workspaces, so without this a workspace is known only once connected to or
	// named by a scanned workers.json - too late to map branches to it ahead of
	// a first deployment.
	app.post<{ Body: { workspaceId?: string } }>(
		"/api/config/workspace-names",
		async (req, reply): Promise<AppConfig> => {
			// Accepted with or without dashes; stored in the dashed form ntn reports.
			const hex = (req.body?.workspaceId ?? "").trim().toLowerCase().replace(/-/g, "");
			if (!/^[0-9a-f]{32}$/.test(hex)) {
				return reply.code(400).send({
					error: "A workspace ID is 32 hexadecimal characters, with or without dashes.",
				}) as unknown as AppConfig;
			}
			const workspaceId = [
				hex.slice(0, 8),
				hex.slice(8, 12),
				hex.slice(12, 16),
				hex.slice(16, 20),
				hex.slice(20),
			].join("-");
			const name = await lookupWorkspaceName(workspaceId);
			if (!name) {
				return reply.code(404).send({
					error: `ntn has no login for workspace ${workspaceId}. Run ntn login for it once, then add it again.`,
				}) as unknown as AppConfig;
			}
			await rememberWorkspaceName(workspaceId, name);
			return getConfig();
		},
	);

	// Replaces the links of every repository named, in one write - the map
	// dialog saves all its columns at once, and unticking a branch there is how
	// a link is removed. A repository left out of the body keeps what it has.
	// The shape itself enforces one workspace per branch.
	app.put<{ Body: { repos?: Record<string, Record<string, string>> } }>(
		"/api/config/branch-workspaces",
		async (req, reply): Promise<AppConfig> => {
			const repos = req.body?.repos;
			if (!repos || typeof repos !== "object") {
				return reply.code(400).send({ error: "repos required" }) as unknown as AppConfig;
			}
			const all = { ...(getConfig().branchWorkspaces ?? {}) };
			for (const [repoRoot, links] of Object.entries(repos)) {
				if (!repoRoot.trim() || !links || typeof links !== "object") {
					return reply
						.code(400)
						.send({ error: "each repo needs a map of branch to workspaceId" }) as unknown as AppConfig;
				}
				const clean: Record<string, string> = {};
				for (const [branch, workspaceId] of Object.entries(links)) {
					if (typeof workspaceId !== "string" || !branch.trim() || !workspaceId.trim()) {
						return reply
							.code(400)
							.send({ error: "branch and workspaceId must be non-empty", detail: branch }) as unknown as AppConfig;
					}
					clean[branch.trim()] = workspaceId.trim();
				}
				const key = normalizePathKey(resolve(repoRoot.trim()));
				if (Object.keys(clean).length > 0) all[key] = clean;
				else delete all[key];
			}
			return updateConfig({ branchWorkspaces: all });
		},
	);

	// Folders the scan finds that are not workers to act on: a template, a
	// scaffold, a project that merely depends on the SDK. Reversible by design —
	// this remembers a path, it does not touch the folder.
	app.post<{ Body: { path?: string } }>("/api/config/ignored-folders", async (req, reply) => {
		const raw = req.body?.path;
		if (typeof raw !== "string" || !raw.trim()) {
			return reply.code(400).send({ error: "path required" }) as unknown as AppConfig;
		}
		const abs = resolve(raw.trim());
		const folders = getConfig().ignoredFolders ?? [];
		if (folders.some((folder) => normalizePathKey(folder) === normalizePathKey(abs))) {
			return getConfig();
		}
		return updateConfig({ ignoredFolders: [...folders, abs] });
	});

	app.delete<{ Querystring: { path?: string } }>(
		"/api/config/ignored-folders",
		async (req, reply): Promise<AppConfig> => {
			const raw = req.query.path;
			if (typeof raw !== "string" || !raw.trim()) {
				return reply.code(400).send({ error: "path required" }) as unknown as AppConfig;
			}
			const key = normalizePathKey(resolve(raw.trim()));
			const folders = getConfig().ignoredFolders ?? [];
			return updateConfig({
				ignoredFolders: folders.filter((folder) => normalizePathKey(folder) !== key),
			});
		},
	);

	// Drops a retained out-of-root folder. The root itself is replaced, never
	// removed, so there is nothing to delete for it.
	app.delete<{ Querystring: { path?: string } }>(
		"/api/config/extra-worker-folders",
		async (req, reply): Promise<AppConfig> => {
			const raw = req.query.path;
			if (typeof raw !== "string" || !raw.trim()) {
				return reply.code(400).send({ error: "path required" }) as unknown as AppConfig;
			}
			const key = normalizePathKey(resolve(raw.trim()));
			const folders = getConfig().extraWorkerFolders ?? [];
			return updateConfig({
				extraWorkerFolders: folders.filter((folder) => normalizePathKey(folder) !== key),
			});
		},
	);
}
