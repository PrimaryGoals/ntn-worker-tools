// Resolves the Notion-Version header to hand to `ntn api`.
//
// Why this exists: the CLI discovers the version by fetching Notion's OpenAPI
// spec on EVERY `ntn api` invocation — a 1.3 MB download per call. That spec
// lives on developers.notion.com, behind Cloudflare, which intermittently
// returns 403 to the CLI's Rust HTTP client. When it does, every `ntn api`
// call fails with:
//
//   Failed to determine the latest Notion-Version header:
//   Failed to fetch OpenAPI spec: 403 Forbidden
//
// Verified on a machine mid-outage: curl, Node, and .NET all fetched that
// exact URL successfully at the same moment the CLI was refused, so the block
// is specific to the CLI's client rather than the network or the account.
// Fetching the spec here with Node and passing the version down therefore
// sidesteps the block entirely, and collapses N downloads into one per server
// process.
//
// Deliberately NOT a hardcoded constant: pinning a version in source would go
// stale. Each server process re-resolves on first use, so a restart is all it
// takes to pick up a newly published version.

const SPEC_URL = "https://developers.notion.com/openapi.json";
const FETCH_TIMEOUT_MS = 15_000;

// Guidance appended to any CLI failure caused by the spec fetch. Restarting is
// a real fix rather than a shrug: this error can only surface when resolution
// below returned null (leaving the CLI to do its own blocked fetch), and a
// fresh process retries the Node fetch, which is not subject to the block.
export const SPEC_FETCH_HINT =
	"The Notion CLI could not fetch the API spec it uses to determine the Notion-Version header — " +
	"this is an intermittent block on Notion's docs host, not a problem with your login. " +
	"Restart the server (pnpm dev) to fix it: on startup it resolves the version itself and passes " +
	"it to the CLI, which avoids the failing fetch. `ntn workers` commands are unaffected.";

// Matches the CLI's own wording for this failure, on either stream.
export function isSpecFetchFailure(text: string): boolean {
	return (
		text.includes("Failed to fetch OpenAPI spec") ||
		text.includes("Failed to determine the latest Notion-Version")
	);
}

// Appends the restart guidance when the text carries this failure, so the
// output panel explains the fix rather than only the symptom.
export function withSpecFetchHint(text: string): string {
	if (!isSpecFetchFailure(text)) return text;
	return `${text.trimEnd()}\n\n${SPEC_FETCH_HINT}`;
}

function extractVersion(spec: unknown): string | null {
	const enumValues = (
		spec as
			| {
					components?: {
						parameters?: { notionVersion?: { schema?: { enum?: unknown } } };
					};
			  }
			| undefined
	)?.components?.parameters?.notionVersion?.schema?.enum;
	if (!Array.isArray(enumValues)) return null;
	const first = enumValues[0];
	// Guard against a shape change handing us something unusable.
	return typeof first === "string" && /^\d{4}-\d{2}-\d{2}$/.test(first) ? first : null;
}

// Memoised as a Promise, not a value, so concurrent first calls share one
// fetch instead of racing several.
let pending: Promise<string | null> | null = null;

async function fetchVersion(): Promise<string | null> {
	const explicit = process.env.NOTION_API_VERSION?.trim();
	// An explicitly configured version wins outright — never second-guess it,
	// and don't spend a request confirming it.
	if (explicit) {
		// eslint-disable-next-line no-console
		console.log(`[notion-version] using NOTION_API_VERSION from environment: ${explicit}`);
		return explicit;
	}
	try {
		const res = await fetch(SPEC_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
		if (!res.ok) {
			// eslint-disable-next-line no-console
			console.warn(`[notion-version] spec fetch returned ${res.status}; leaving it to the CLI`);
			return null;
		}
		const version = extractVersion(await res.json());
		// eslint-disable-next-line no-console
		if (version) console.log(`[notion-version] resolved Notion-Version ${version}`);
		else console.warn("[notion-version] spec had no usable version; leaving it to the CLI");
		return version;
	} catch (err) {
		// eslint-disable-next-line no-console
		console.warn(
			`[notion-version] spec fetch failed (${(err as Error).message}); leaving it to the CLI`,
		);
		return null;
	}
}

// Returns the version to pass to `ntn api`, or null when it couldn't be
// resolved — in which case callers spawn the CLI unchanged and it attempts its
// own fetch, exactly as it did before this module existed. Never throws: a
// failure here must degrade, not break the request.
export function resolveNotionApiVersion(): Promise<string | null> {
	pending ??= fetchVersion();
	return pending;
}
