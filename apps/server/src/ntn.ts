import { execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Any ntn command that writes files (e.g. `workers new`, `workers deploy`)
// will land here by default instead of the user's home directory root.
export const DEFAULT_WORK_DIR = join(homedir(), "ntn-worker-tools");
try {
	mkdirSync(DEFAULT_WORK_DIR, { recursive: true });
} catch {
	// created lazily by whichever command needs it; ignore on startup
}

interface NtnCommandResult {
	command: string;
	args: string[];
	exitCode: number;
	stdout: string;
	stderr: string;
	durationMs: number;
}

export class NtnError extends Error {
	readonly detail?: string;
	readonly exitCode?: number;
	readonly stderr?: string;

	constructor(message: string, opts?: { detail?: string; exitCode?: number; stderr?: string }) {
		super(message);
		this.name = "NtnError";
		this.detail = opts?.detail;
		this.exitCode = opts?.exitCode;
		this.stderr = opts?.stderr;
	}
}

export interface RunOptions {
	timeoutMs?: number;
	cwd?: string;
	// If set, these strings are used in the `[<cmd> spawn]` log line INSTEAD
	// of the real args. Use when args contain secrets so they don't get
	// written to any log surface. The real args still get passed to spawn().
	logAs?: string[];
	// Needed for npm-installed CLI shims (e.g. pnpm) — on Windows these are
	// .CMD files, and execFile without a shell only resolves literal
	// extension-less filenames, not PATHEXT-based lookups. Only set this for
	// commands with fixed, non-secret args: with shell:true, args are passed
	// through cmd.exe's parsing, which is unsafe for user-supplied values
	// (see the `ntn workers env set` call, which must never set this).
	shell?: boolean;
}

function runRaw(args: string[], opts: RunOptions = {}): Promise<NtnCommandResult> {
	return runRawCommand("ntn", args, opts);
}

// Quotes an arg for display so the printed command is copy-pasteable into a
// real shell (PowerShell, cmd, or POSIX). Whitelist rather than blacklist:
// PowerShell treats characters like % and { } specially even mid-token with
// no surrounding whitespace (e.g. `%{http_code}` is parsed as a ForEach-Object
// script block, not a literal string) — bare flags and simple tokens
// (letters, digits, and -_./:=,@) stay unquoted to match how you'd type them
// by hand; anything else gets wrapped in double quotes, which passes through
// unmodified in PowerShell, cmd, and POSIX shells alike. None of our values
// contain embedded double quotes.
function quoteForDisplay(arg: string): string {
	return /^[A-Za-z0-9_\-.\/:=,@]*$/.test(arg) ? arg : `"${arg}"`;
}

function formatCommandForDisplay(cmd: string, args: string[]): string {
	return [cmd, ...args.map(quoteForDisplay)].join(" ");
}

function runRawCommand(
	cmd: string,
	args: string[],
	opts: RunOptions = {},
): Promise<NtnCommandResult> {
	return new Promise((resolve, reject) => {
		const start = Date.now();
		// eslint-disable-next-line no-console
		console.log(`[${cmd} spawn] ${formatCommandForDisplay(cmd, opts.logAs ?? args)}`);
		const child = execFile(cmd, args, {
			cwd: opts.cwd ?? DEFAULT_WORK_DIR,
			windowsHide: true,
			shell: opts.shell,
		});

		let stdout = "";
		let stderr = "";
		let killed = false;

		const timer = opts.timeoutMs
			? setTimeout(() => {
					killed = true;
					child.kill();
				}, opts.timeoutMs)
			: null;

		child.stdout?.on("data", (chunk: Buffer) => {
			stdout += chunk.toString("utf8");
		});
		child.stderr?.on("data", (chunk: Buffer) => {
			stderr += chunk.toString("utf8");
		});

		child.on("error", (err) => {
			if (timer) clearTimeout(timer);
			if ((err as NodeJS.ErrnoException).code === "ENOENT") {
				reject(
					new NtnError(`The \`${cmd}\` command was not found on your PATH.`, {
						detail:
							cmd === "ntn"
								? "Install it (see https://developers.notion.com/workers/get-started/overview) and make sure `ntn --version` works from a terminal."
								: `Install ${cmd} and make sure \`${cmd} --version\` works from a terminal.`,
					}),
				);
				return;
			}
			reject(err);
		});

		child.on("close", (code) => {
			if (timer) clearTimeout(timer);
			resolve({
				command: cmd,
				args,
				exitCode: killed ? -1 : (code ?? 0),
				stdout,
				stderr,
				durationMs: Date.now() - start,
			});
		});
	});
}

// Spawns any executable (e.g. pnpm), captures stdout+stderr, never throws on
// non-zero exit — caller inspects exitCode and surfaces partial output.
export async function runShellAllowingFailure(
	cmd: string,
	args: string[],
	opts: RunOptions = {},
): Promise<{ command: string; exitCode: number; stdout: string; stderr: string; durationMs: number }> {
	const result = await runRawCommand(cmd, args, { timeoutMs: 5 * 60_000, ...opts });
	return {
		command: formatCommandForDisplay(cmd, opts.logAs ?? args),
		exitCode: result.exitCode,
		stdout: result.stdout,
		stderr: result.stderr,
		durationMs: result.durationMs,
	};
}

export async function runNtnJson<T>(args: string[], opts: RunOptions = {}): Promise<T> {
	const { data } = await runNtnJsonWithTrace<T>(args, opts);
	return data;
}

export async function runNtnJsonWithTrace<T>(
	args: string[],
	opts: RunOptions = {},
): Promise<{ data: T; stderr: string }> {
	const result = await runRaw([...args, "--json"], { timeoutMs: 30_000, ...opts });
	if (result.exitCode !== 0) {
		throw new NtnError(`ntn ${args.join(" ")} failed`, {
			exitCode: result.exitCode,
			stderr: result.stderr,
			detail: result.stderr.trim() || result.stdout.trim(),
		});
	}
	try {
		return { data: JSON.parse(result.stdout) as T, stderr: result.stderr };
	} catch {
		throw new NtnError(`ntn ${args.join(" ")} returned invalid JSON`, {
			detail: result.stdout.slice(0, 500),
		});
	}
}

export async function runNtnPlain(args: string[], opts: RunOptions = {}): Promise<string> {
	const { stdout } = await runNtnPlainWithTrace(args, opts);
	return stdout;
}

export async function runNtnPlainWithTrace(
	args: string[],
	opts: RunOptions = {},
): Promise<{ stdout: string; stderr: string }> {
	const result = await runRaw([...args, "--plain"], { timeoutMs: 30_000, ...opts });
	if (result.exitCode !== 0) {
		throw new NtnError(`ntn ${args.join(" ")} failed`, {
			exitCode: result.exitCode,
			stderr: result.stderr,
			detail: result.stderr.trim() || result.stdout.trim(),
		});
	}
	return { stdout: result.stdout, stderr: result.stderr };
}

// For commands whose native (no --json / --plain) stdout is the artifact,
// e.g. `workers env pull --no-file` which prints .env-style KEY=VALUE lines.
export async function runNtnRawWithTrace(
	args: string[],
	opts: RunOptions = {},
): Promise<{ stdout: string; stderr: string }> {
	const result = await runRaw(args, { timeoutMs: 30_000, ...opts });
	if (result.exitCode !== 0) {
		throw new NtnError(`ntn ${args.join(" ")} failed`, {
			exitCode: result.exitCode,
			stderr: result.stderr,
			detail: result.stderr.trim() || result.stdout.trim(),
		});
	}
	return { stdout: result.stdout, stderr: result.stderr };
}

// Like runNtnRawWithTrace but never throws on non-zero exit; returns exit code so
// the caller (e.g. deploy) can surface partial output when the command fails.
export async function runNtnRawAllowingFailure(
	args: string[],
	opts: RunOptions = {},
): Promise<{ exitCode: number; stdout: string; stderr: string; durationMs: number }> {
	const start = Date.now();
	const result = await runRaw(args, { timeoutMs: 5 * 60_000, ...opts });
	return {
		exitCode: result.exitCode,
		stdout: result.stdout,
		stderr: result.stderr,
		durationMs: Date.now() - start,
	};
}
