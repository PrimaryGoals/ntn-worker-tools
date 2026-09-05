import { spawn } from "node:child_process";
import type { FastifyInstance } from "fastify";
import type { DeployResult } from "@ntn-worker-tools/shared";
import { runNtnRawAllowingFailure } from "../ntn.js";
import { isVerbose } from "../route-helpers.js";

// `ntn workers oauth start` only launches a browser when its stdout is a TTY.
// The server always spawns it non-interactively, so the CLI takes its
// machine-readable path instead: it prints the authorization URL and exits 0
// without opening anything. Pulling the URL back out is what lets this route
// keep the promise the UI makes ("this opens your browser").
function extractAuthorizationUrl(stdout: string): string | null {
	const match = stdout.match(/https:\/\/\S+/);
	return match ? match[0] : null;
}

// Note: unlike the `reveal` route, which hands a filesystem path to
// explorer.exe, this can't use explorer.exe — given an http(s) URL it exits
// silently without launching anything. url.dll's FileProtocolHandler is the
// documented shell entry point for URLs and receives the full query string
// intact (no shell is involved, so `&` needs no escaping).
function openInDefaultBrowser(app: FastifyInstance, url: string): void {
	const [cmd, args]: [string, string[]] =
		process.platform === "win32"
			? ["rundll32.exe", ["url.dll,FileProtocolHandler", url]]
			: process.platform === "darwin"
				? ["open", [url]]
				: ["xdg-open", [url]];
	const child = spawn(cmd, args, { detached: true, windowsHide: true });
	child.on("error", (err) => app.log.error({ err, cmd }, "oauth browser open failed"));
	child.unref();
	app.log.info({ cmd, platform: process.platform }, "oauth browser open spawned");
}

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
			const { exitCode, stdout, stderr, durationMs } = await runNtnRawAllowingFailure(args);
			// The CLI returns as soon as it has printed the URL, so this opens the
			// consent screen itself; the URL stays in stdout for the output panel
			// so it can still be copied by hand if the OS opener does nothing.
			const authorizationUrl = exitCode === 0 ? extractAuthorizationUrl(stdout) : null;
			if (authorizationUrl) openInDefaultBrowser(app, authorizationUrl);
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
