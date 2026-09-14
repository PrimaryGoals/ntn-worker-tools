import { readFile } from "node:fs/promises";
import { join } from "node:path";

// Notion requires a version header on every API call. Pinned rather than taken
// from resolveNotionApiVersion: that helper exists to hand `ntn api` whatever is
// newest and is allowed to return null, while this call reads one field that has
// been stable since this version.
const NOTION_VERSION = "2022-06-28";
const TIMEOUT_MS = 15_000;

export interface TokenWorkspace {
	workspaceId: string;
	workspaceName: string;
	botName: string;
}

// Cached by token: a batch push asks the same question once per worker, and the
// answer cannot change unless the token does.
const cache = new Map<string, TokenWorkspace>();

// Pulls NOTION_API_TOKEN out of a worker folder's .env. These files are plain
// KEY=value with # comments — no quoting, no export prefixes — so a full dotenv
// parser would be more machinery than the format needs.
export async function readEnvToken(dir: string): Promise<string | null> {
	let text: string;
	try {
		text = await readFile(join(dir, ".env"), "utf8");
	} catch {
		return null; // no .env — nothing to check
	}
	for (const line of text.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const eq = trimmed.indexOf("=");
		if (eq === -1) continue;
		if (trimmed.slice(0, eq).trim() !== "NOTION_API_TOKEN") continue;
		return trimmed.slice(eq + 1).trim() || null;
	}
	return null;
}

export type TokenWorkspaceResult =
	| { status: "ok"; workspace: TokenWorkspace }
	| { status: "rejected"; detail: string }
	| { status: "unknown"; detail: string };

// Asks Notion which workspace a token belongs to. The token goes to Notion and
// nowhere else, and never appears in a returned message or a log line.
export async function resolveTokenWorkspace(token: string): Promise<TokenWorkspaceResult> {
	const cached = cache.get(token);
	if (cached) return { status: "ok", workspace: cached };

	let res: Response;
	try {
		res = await fetch("https://api.notion.com/v1/users/me", {
			headers: {
				Authorization: `Bearer ${token}`,
				"Notion-Version": NOTION_VERSION,
				// undici otherwise parks a pooled socket, which on Windows can abort
				// the process at exit with a libuv assertion instead of exiting.
				Connection: "close",
			},
			keepalive: false,
			signal: AbortSignal.timeout(TIMEOUT_MS),
		});
	} catch (err) {
		// Offline, DNS failure, timeout: not an answer about the token.
		return { status: "unknown", detail: err instanceof Error ? err.message : String(err) };
	}

	if (res.status === 401 || res.status === 403) {
		return { status: "rejected", detail: `Notion rejected it (HTTP ${res.status})` };
	}
	if (!res.ok) return { status: "unknown", detail: `HTTP ${res.status} ${res.statusText}` };

	let me: { name?: string; bot?: { workspace_id?: string; workspace_name?: string } };
	try {
		me = (await res.json()) as typeof me;
	} catch (err) {
		return { status: "unknown", detail: err instanceof Error ? err.message : String(err) };
	}

	const workspaceId = me.bot?.workspace_id;
	if (typeof workspaceId !== "string" || !workspaceId) {
		// A user token has no bot block. It cannot be placed in a workspace this
		// way, so there is nothing to compare against.
		return { status: "unknown", detail: "no bot.workspace_id — not an integration token?" };
	}

	const workspace: TokenWorkspace = {
		workspaceId,
		workspaceName: me.bot?.workspace_name ?? "(unnamed workspace)",
		botName: me.name ?? "(unnamed integration)",
	};
	cache.set(token, workspace);
	return { status: "ok", workspace };
}

export interface TokenWorkspaceMismatch {
	error: string;
	detail: string;
	tokenWorkspaceId?: string;
	tokenWorkspaceName?: string;
}

// Null when a push is safe to run, or the reason it is not.
//
// Why this exists: .env is gitignored, so it belongs to a clone rather than to a
// branch. Checking out another branch does not restore that branch's
// credentials, so a token swapped in for one workspace stays in place — which is
// how a worker in one workspace comes to be handed a credential for another.
//
// Deliberately degrades to "safe" whenever the answer is unavailable: no .env,
// no token in it, or Notion unreachable. Blocking on an unanswerable check would
// mean an offline machine could never push secrets at all. A token Notion
// actively rejects is an answer, and does stop the push.
export async function tokenWorkspaceMismatch(
	dir: string,
	expectedWorkspaceId: string | null,
): Promise<TokenWorkspaceMismatch | null> {
	if (!expectedWorkspaceId) return null;
	const token = await readEnvToken(dir);
	if (!token) return null;

	const result = await resolveTokenWorkspace(token);
	if (result.status === "unknown") return null;
	if (result.status === "rejected") {
		return {
			error: "NOTION_API_TOKEN is not valid",
			detail:
				`${join(dir, ".env")} holds a NOTION_API_TOKEN that Notion will not accept — ` +
				`${result.detail}. Pushing it would leave the worker with a credential that ` +
				`cannot authenticate.`,
		};
	}
	if (result.workspace.workspaceId === expectedWorkspaceId) return null;

	return {
		error: "token belongs to another workspace",
		detail:
			`${join(dir, ".env")} holds a NOTION_API_TOKEN for ${result.workspace.workspaceName} ` +
			`(${result.workspace.workspaceId}), but this worker lives in workspace ` +
			`${expectedWorkspaceId}. Pushing would give a worker in one workspace a credential ` +
			`for another. .env is not in git, so a branch switch leaves the previous ` +
			`workspace's token in place — regenerate it for this workspace before pushing.`,
		tokenWorkspaceId: result.workspace.workspaceId,
		tokenWorkspaceName: result.workspace.workspaceName,
	};
}
