import type { FastifyInstance } from "fastify";
import type { WebhookFireResult } from "@ntn-worker-tools/shared";
import { runShellAllowingFailure } from "../ntn.js";
import { isVerbose } from "../route-helpers.js";

// Notion moved worker webhook URLs from www.notion.so to app.notion.com
// (the same cutover that broke the OAuth redirect URL). Accepting both
// prefixes instead of swapping outright, in case any environment still
// hands back the old domain.
const NOTION_WEBHOOK_PREFIXES = [
	"https://www.notion.so/webhooks/worker/",
	"https://app.notion.com/webhooks/worker/",
];

export default async function webhookRoutes(app: FastifyInstance) {
	app.post<{ Body: { url: string; webhookSecret?: string }; Querystring: { verbose?: string } }>(
		"/api/webhook/fire",
		async (req, reply): Promise<WebhookFireResult> => {
			const url = req.body?.url;
			if (typeof url !== "string" || !NOTION_WEBHOOK_PREFIXES.some((p) => url.startsWith(p))) {
				return reply.code(400).send({
					error: "invalid webhook url",
					detail: `url must start with one of: ${NOTION_WEBHOOK_PREFIXES.join(", ")}`,
				}) as unknown as WebhookFireResult;
			}
			const verbose = isVerbose(req.query.verbose);
			const args: string[] = ["-s", "-X", "POST"];
			const logAs: string[] = ["-s", "-X", "POST"];

			// -i includes the response headers ahead of the body, letting us read
			// the real status line and full header block instead of just a code.
			// Only added under -v: the headers are noisy (Notion's CSP header alone
			// is huge) and not worth showing by default.
			if (verbose) {
				args.push("-i");
				logAs.push("-i");
			}

			args.push("-H", "User-Agent: ntn-worker-tools");
			logAs.push("-H", "User-Agent: ntn-worker-tools");

			const sentHeaders: string[] = [];
			if (typeof req.body?.webhookSecret === "string" && req.body.webhookSecret) {
				args.push("-H", `X-Webhook-Secret: ${req.body.webhookSecret}`);
				logAs.push("-H", "X-Webhook-Secret: <redacted>");
				sentHeaders.push("X-Webhook-Secret");
			}

			if (!verbose) {
				// Without -i we still need the status code: append it after the body
				// on its own line. `\n` here is curl's own write-out escape (two
				// literal characters), not a real newline in this argument — curl
				// turns it into one when it writes its output.
				args.push("-w", "\\n%{http_code}");
				logAs.push("-w", "\\n%{http_code}");
			}
			args.push(url);
			logAs.push(url);

			// On Windows, PowerShell aliases the bare `curl` name to Invoke-WebRequest,
			// which doesn't understand curl's flags — a copy-pasted command must say
			// `curl.exe` to reach the real binary. execFile() bypasses PowerShell
			// entirely so this only matters for the displayed/copy-pasted command.
			const curlCmd = process.platform === "win32" ? "curl.exe" : "curl";
			const result = await runShellAllowingFailure(curlCmd, args, { logAs });

			let status: number;
			let statusText: string;
			let body: string;
			let trace: string | undefined;
			if (verbose) {
				// Parse curl's -i output: status line, headers, blank line, then body.
				// HTTP requires CRLF but tolerate a bare LF too.
				const headerSep = result.stdout.match(/\r?\n\r?\n/);
				const headerBlock = headerSep ? result.stdout.slice(0, headerSep.index) : result.stdout;
				body = headerSep ? result.stdout.slice((headerSep.index ?? 0) + headerSep[0].length) : "";
				const statusLine = headerBlock.split(/\r?\n/)[0] ?? "";
				const statusMatch = statusLine.match(/^HTTP\/[\d.]+\s+(\d+)\s*(.*)$/);
				status = statusMatch ? parseInt(statusMatch[1] ?? "0", 10) : 0;
				statusText = statusMatch?.[2]?.trim() ?? "";
				trace = headerBlock.trim() || undefined;
			} else {
				// Body + trailing newline + status code, as written by -w above.
				const lines = result.stdout.split("\n");
				status = parseInt(lines[lines.length - 1] ?? "", 10) || 0;
				statusText = "";
				body = lines.slice(0, -1).join("\n");
			}

			return {
				command: result.command,
				url,
				status,
				statusText,
				body,
				durationMs: result.durationMs,
				sentHeaders: sentHeaders.length ? sentHeaders : undefined,
				_trace: trace,
			};
		},
	);
}
