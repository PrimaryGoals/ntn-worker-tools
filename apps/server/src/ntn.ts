import { spawn } from "node:child_process";
import { homedir } from "node:os";

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
}

function runRaw(args: string[], opts: RunOptions = {}): Promise<NtnCommandResult> {
	return new Promise((resolve, reject) => {
		const start = Date.now();
		const child = spawn("ntn", args, {
			cwd: opts.cwd ?? homedir(),
			shell: process.platform === "win32",
			windowsHide: true,
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

		child.stdout.on("data", (chunk: Buffer) => {
			stdout += chunk.toString("utf8");
		});
		child.stderr.on("data", (chunk: Buffer) => {
			stderr += chunk.toString("utf8");
		});

		child.on("error", (err) => {
			if (timer) clearTimeout(timer);
			if ((err as NodeJS.ErrnoException).code === "ENOENT") {
				reject(
					new NtnError("The `ntn` CLI was not found on your PATH.", {
						detail:
							"Install it (see https://developers.notion.com/workers/get-started/overview) and make sure `ntn --version` works from a terminal.",
					}),
				);
				return;
			}
			reject(err);
		});

		child.on("close", (code) => {
			if (timer) clearTimeout(timer);
			resolve({
				command: "ntn",
				args,
				exitCode: killed ? -1 : (code ?? 0),
				stdout,
				stderr,
				durationMs: Date.now() - start,
			});
		});
	});
}

export async function runNtnJson<T>(args: string[], opts: RunOptions = {}): Promise<T> {
	const result = await runRaw([...args, "--json"], { timeoutMs: 30_000, ...opts });
	if (result.exitCode !== 0) {
		throw new NtnError(`ntn ${args.join(" ")} failed`, {
			exitCode: result.exitCode,
			stderr: result.stderr,
			detail: result.stderr.trim() || result.stdout.trim(),
		});
	}
	try {
		return JSON.parse(result.stdout) as T;
	} catch {
		throw new NtnError(`ntn ${args.join(" ")} returned invalid JSON`, {
			detail: result.stdout.slice(0, 500),
		});
	}
}

export async function runNtnPlain(args: string[], opts: RunOptions = {}): Promise<string> {
	const result = await runRaw([...args, "--plain"], { timeoutMs: 30_000, ...opts });
	if (result.exitCode !== 0) {
		throw new NtnError(`ntn ${args.join(" ")} failed`, {
			exitCode: result.exitCode,
			stderr: result.stderr,
			detail: result.stderr.trim() || result.stdout.trim(),
		});
	}
	return result.stdout;
}
