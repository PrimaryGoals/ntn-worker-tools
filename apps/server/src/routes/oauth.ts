import type { FastifyInstance } from "fastify";
import type { DeployResult } from "@ntn-worker-tools/shared";
import { runNtnRawAllowingFailure } from "../ntn.js";
import { isVerbose } from "../route-helpers.js";

export default async function oauthRoutes(app: FastifyInstance) {
	// Not worker-scoped: `ntn workers oauth show-redirect-url` has no
	// --worker-id flag (confirmed via --help) — it isn't tied to a specific
	// worker or local folder, so this runs from the app's default working
	// directory like `ntn whoami` does elsewhere in this app.
	app.post<{ Querystring: { verbose?: string } }>(
		"/api/oauth/show-redirect-url",
		async (req): Promise<DeployResult> => {
			const verbose = isVerbose(req.query.verbose);
			const args = ["workers", "oauth", "show-redirect-url", ...(verbose ? ["-v"] : [])];
			const { exitCode, stdout, stderr, durationMs } = await runNtnRawAllowingFailure(args);
			return {
				command: `ntn ${args.join(" ")}`,
				cwd: "",
				exitCode,
				stdout,
				stderr,
				durationMs,
			};
		},
	);

	app.post<{
		Params: { id: string };
		Body: { key?: string };
		Querystring: { verbose?: string };
	}>(
		"/api/workers/:id/oauth/start",
		async (req, reply): Promise<DeployResult> => {
			const key = req.body?.key?.trim();
			if (!key) {
				return reply
					.code(400)
					.send({ error: "oauth capability key required" }) as unknown as DeployResult;
			}
			const verbose = isVerbose(req.query.verbose);
			const args = [
				"workers",
				"oauth",
				"start",
				"--worker-id",
				req.params.id,
				key,
				...(verbose ? ["-v"] : []),
			];
			// Opens a browser and waits for the user to complete the provider's
			// consent screen before exiting — runNtnRawAllowingFailure's default
			// 5-minute timeout (see ntn.ts) gives that flow room to finish.
			const { exitCode, stdout, stderr, durationMs } = await runNtnRawAllowingFailure(args);
			return {
				command: `ntn ${args.join(" ")}`,
				cwd: "",
				exitCode,
				stdout,
				stderr,
				durationMs,
			};
		},
	);

	app.post<{
		Params: { id: string };
		Body: { key?: string };
		Querystring: { verbose?: string };
	}>(
		"/api/workers/:id/oauth/token",
		async (req, reply): Promise<DeployResult> => {
			const key = req.body?.key?.trim();
			if (!key) {
				return reply
					.code(400)
					.send({ error: "oauth capability key required" }) as unknown as DeployResult;
			}
			const verbose = isVerbose(req.query.verbose);
			const args = [
				"workers",
				"oauth",
				"token",
				"--worker-id",
				req.params.id,
				key,
				...(verbose ? ["-v"] : []),
			];
			const { exitCode, stdout, stderr, durationMs } = await runNtnRawAllowingFailure(args);
			return {
				command: `ntn ${args.join(" ")}`,
				cwd: "",
				exitCode,
				stdout,
				stderr,
				durationMs,
			};
		},
	);
}
