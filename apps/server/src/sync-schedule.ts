import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import type { SyncScheduleEntry, SyncScheduleUpdate } from "@ntn-worker-tools/shared";
import { SCAN_IGNORED_DIR_NAMES } from "./scan-ignore.js";

// Reads and rewrites the `schedule:` property of `worker.sync()` declarations
// in a worker's local source.
//
// This is deliberately a small hand-rolled scanner rather than a TypeScript AST
// parse: the app has no compiler dependency, and the edit is a single string
// literal in a known position. The scanner's failure mode is safe — anything it
// can't balance is reported as unparsed and left untouched, never guessed at.

// Matches `worker.sync("key", {` — the receiver is any identifier (projects
// don't always name their Worker instance `worker`) and the match ends on the
// config object's opening brace.
const SYNC_CALL_RE = /\b[A-Za-z_$][\w$]*\s*\.\s*sync\s*\(\s*(['"])((?:[^'"\\\n]|\\.)*)\1\s*,\s*\{/g;

// A whole string literal, for reading and rewriting a `schedule:` value while
// preserving the file's quote style.
const STRING_LITERAL_RE = /^(['"])((?:[^'"\\\n]|\\.)*)\1$/;

// A bare identifier — a `schedule:` whose value is just a reference, which we
// try to follow to its declaration rather than giving up on.
const BARE_IDENTIFIER_RE = /^[A-Za-z_$][\w$]*$/;

interface PropSpan {
	valueStart: number;
	valueEnd: number;
}

interface ParsedSyncCall {
	key: string;
	/** Index of the config object's `{`. */
	objStart: number;
	/** Index of the config object's matching `}`. */
	objEnd: number;
	/** Span of the `schedule:` value, absent when the property isn't declared. */
	schedule: PropSpan | null;
}

/** Index just past a quoted string beginning at `i` (which holds the quote). */
function skipQuoted(src: string, i: number): number {
	const quote = src[i];
	let j = i + 1;
	while (j < src.length) {
		const c = src[j];
		if (c === "\\") {
			j += 2;
			continue;
		}
		// An unterminated literal can't span a newline — bail rather than
		// swallowing the rest of the file.
		if (c === quote || c === "\n") return j + 1;
		j++;
	}
	return src.length;
}

/** Index just past a template literal beginning at `i` (which holds the backtick). */
function skipTemplate(src: string, i: number): number {
	let j = i + 1;
	while (j < src.length) {
		const c = src[j];
		if (c === "\\") {
			j += 2;
			continue;
		}
		if (c === "`") return j + 1;
		if (c === "$" && src[j + 1] === "{") {
			// Interpolation holds arbitrary expressions, including nested
			// strings and templates — walk it with its own brace depth so its
			// braces never leak into the caller's count.
			let depth = 1;
			j += 2;
			while (j < src.length && depth > 0) {
				const k = src[j];
				if (k === "\\") {
					j += 2;
					continue;
				}
				if (k === '"' || k === "'") {
					j = skipQuoted(src, j);
					continue;
				}
				if (k === "`") {
					j = skipTemplate(src, j);
					continue;
				}
				if (k === "{") depth++;
				else if (k === "}") depth--;
				j++;
			}
			continue;
		}
		j++;
	}
	return src.length;
}

/**
 * Walks the object literal whose `{` sits at `openIndex`, returning that
 * object's closing brace and the spans of its top-level property values.
 *
 * Strings, template literals and comments are skipped wholesale, so braces,
 * commas and colons inside them can't disturb depth or property tracking.
 * Returns null when the object doesn't close — the caller treats that as
 * "unparseable" and leaves the file alone.
 */
function scanObjectLiteral(
	src: string,
	openIndex: number,
): { end: number; props: Map<string, PropSpan> } | null {
	if (src[openIndex] !== "{") return null;
	const props = new Map<string, PropSpan>();
	// Nesting depth inside the object; 1 means "directly in it".
	let depth = 1;
	let i = openIndex + 1;
	// A property name seen but not yet followed by its `:`.
	let pendingName: string | null = null;
	// The property whose value we're currently inside of.
	let current: { name: string; valueStart: number } | null = null;

	function closeCurrent(end: number): void {
		if (!current) return;
		let e = end;
		while (e > current.valueStart && /\s/.test(src[e - 1]!)) e--;
		// First declaration wins, matching how a duplicate key would be
		// overwritten — we only ever rewrite what we found first.
		if (!props.has(current.name)) props.set(current.name, { valueStart: current.valueStart, valueEnd: e });
		current = null;
	}

	while (i < src.length) {
		const c = src[i]!;
		if (c === "/" && src[i + 1] === "/") {
			const nl = src.indexOf("\n", i);
			i = nl < 0 ? src.length : nl;
			continue;
		}
		if (c === "/" && src[i + 1] === "*") {
			const close = src.indexOf("*/", i + 2);
			i = close < 0 ? src.length : close + 2;
			continue;
		}
		if (c === '"' || c === "'") {
			const end = skipQuoted(src, i);
			// A quoted key: `"schedule": "5m"`.
			if (depth === 1 && !current && pendingName === null) {
				pendingName = src.slice(i + 1, end - 1);
			}
			i = end;
			continue;
		}
		if (c === "`") {
			i = skipTemplate(src, i);
			continue;
		}
		if (c === "{" || c === "[" || c === "(") {
			depth++;
			i++;
			continue;
		}
		if (c === "}" || c === "]" || c === ")") {
			depth--;
			if (depth === 0) {
				closeCurrent(i);
				return { end: i, props };
			}
			i++;
			continue;
		}
		if (depth === 1) {
			if (c === "," && current) {
				closeCurrent(i);
				pendingName = null;
				i++;
				continue;
			}
			if (c === ":" && pendingName !== null && !current) {
				let v = i + 1;
				while (v < src.length && /\s/.test(src[v]!)) v++;
				current = { name: pendingName, valueStart: v };
				pendingName = null;
				i = v;
				continue;
			}
			if (c === "," && !current) {
				pendingName = null;
				i++;
				continue;
			}
			if (!current && pendingName === null && /[A-Za-z_$]/.test(c)) {
				let e = i;
				while (e < src.length && /[\w$]/.test(src[e]!)) e++;
				pendingName = src.slice(i, e);
				i = e;
				continue;
			}
		}
		i++;
	}
	return null; // never closed
}

/** Every `worker.sync()` declaration in `src`, plus keys that couldn't be read. */
function parseSyncCalls(src: string): { calls: ParsedSyncCall[]; unparsed: boolean } {
	const calls: ParsedSyncCall[] = [];
	let unparsed = false;
	SYNC_CALL_RE.lastIndex = 0;
	let m: RegExpExecArray | null;
	while ((m = SYNC_CALL_RE.exec(src)) !== null) {
		const objStart = m.index + m[0].length - 1; // the `{`
		const scanned = scanObjectLiteral(src, objStart);
		if (!scanned) {
			unparsed = true;
			continue;
		}
		const schedule = scanned.props.get("schedule") ?? null;
		calls.push({ key: m[2]!, objStart, objEnd: scanned.end, schedule });
		// Resume after the config object so a nested `.sync(` in a handler
		// body can't be picked up as a second top-level declaration.
		SYNC_CALL_RE.lastIndex = scanned.end;
	}
	return { calls, unparsed };
}

/**
 * Span of the string literal a module-level `const NAME = "..."` assigns, or
 * null if there's no such declaration. Anchored to column 0 so a same-named
 * local inside a function body can't be mistaken for the module constant.
 */
function findConstLiteral(src: string, name: string): PropSpan | null {
	const re = new RegExp(
		String.raw`^(?:export\s+)?(?:const|let|var)\s+${name}\s*(?::[^=\n]+)?=\s*(['"])((?:[^'"\\\n]|\\.)*)\1`,
		"m",
	);
	const m = re.exec(src);
	if (!m) return null;
	// The literal closes the match, so its span is measurable from the end.
	const valueEnd = m.index + m[0].length;
	return { valueStart: valueEnd - (m[2]!.length + 2), valueEnd };
}

/**
 * Where a sync's schedule is actually written, following one level of
 * indirection. A `schedule: "5m"` resolves to its own span; a
 * `schedule: SCHEDULE` resolves to the span of that constant's literal, so
 * editing the row rewrites the declaration the author wrote.
 */
function resolveScheduleSpan(
	src: string,
	span: PropSpan,
): { span: PropSpan; value: string; via: string | null } | null {
	const literal = readScheduleLiteral(src, span);
	if (literal !== null) return { span, value: literal, via: null };
	const raw = src.slice(span.valueStart, span.valueEnd).trim();
	if (!BARE_IDENTIFIER_RE.test(raw)) return null;
	const constSpan = findConstLiteral(src, raw);
	if (!constSpan) return null;
	const constValue = readScheduleLiteral(src, constSpan);
	if (constValue === null) return null;
	return { span: constSpan, value: constValue, via: raw };
}

/** The string a `schedule:` span holds, or null when it isn't a plain literal. */
function readScheduleLiteral(src: string, span: PropSpan): string | null {
	const raw = src.slice(span.valueStart, span.valueEnd).trim();
	const m = STRING_LITERAL_RE.exec(raw);
	return m ? m[2]! : null;
}

function lineOf(src: string, index: number): number {
	let line = 1;
	for (let i = 0; i < index && i < src.length; i++) if (src[i] === "\n") line++;
	return line;
}

/** Recursively collects .ts/.tsx source files under `dir`. */
async function collectSourceFiles(dir: string, out: string[]): Promise<void> {
	let dirents;
	try {
		dirents = await readdir(dir, { withFileTypes: true });
	} catch {
		return;
	}
	for (const d of dirents) {
		if (d.name.startsWith(".") || SCAN_IGNORED_DIR_NAMES.has(d.name)) continue;
		const full = join(dir, d.name);
		if (d.isDirectory()) {
			await collectSourceFiles(full, out);
		} else if (d.isFile() && /\.tsx?$/.test(d.name) && !d.name.endsWith(".d.ts")) {
			out.push(full);
		}
	}
}

/** Posix-separated path relative to the worker folder, for stable display. */
function relPath(root: string, full: string): string {
	return relative(root, full).split(sep).join("/");
}

export async function findSyncSchedules(
	root: string,
): Promise<{ entries: SyncScheduleEntry[]; unparsed: string[] }> {
	const files: string[] = [];
	await collectSourceFiles(root, files);
	const entries: SyncScheduleEntry[] = [];
	const unparsed: string[] = [];
	for (const file of files.sort()) {
		let src: string;
		try {
			src = await readFile(file, "utf8");
		} catch {
			continue;
		}
		if (!src.includes(".sync(")) continue; // cheap pre-filter
		const parsed = parseSyncCalls(src);
		if (parsed.unparsed) unparsed.push(relPath(root, file));
		for (const call of parsed.calls) {
			const resolved = call.schedule ? resolveScheduleSpan(src, call.schedule) : null;
			entries.push({
				key: call.key,
				file: relPath(root, file),
				line: lineOf(src, call.objStart),
				schedule: resolved?.value ?? null,
				via: resolved?.via ?? null,
				// Declared but unresolvable (an imported constant, a ternary) —
				// surfaced so the dialog shows it as read-only rather than as an
				// absent, and therefore default, value.
				expression:
					call.schedule && !resolved
						? src.slice(call.schedule.valueStart, call.schedule.valueEnd).trim()
						: null,
			});
		}
	}
	return { entries, unparsed };
}

/** The indentation of the line `index` sits on, so an inserted property lines up. */
function indentOfLine(src: string, index: number): string {
	const lineStart = src.lastIndexOf("\n", index - 1) + 1;
	const m = /^[ \t]*/.exec(src.slice(lineStart, index));
	return m ? m[0] : "\t";
}

/**
 * Rewrites `schedule:` for each requested sync, one file at a time. Edits
 * within a file are applied back-to-front so earlier offsets stay valid, and a
 * file is only written once every one of its edits has been located — a
 * request naming a sync that can't be found changes nothing on disk.
 */
export async function applySyncScheduleUpdates(
	root: string,
	updates: SyncScheduleUpdate[],
): Promise<{
	applied: Array<{ key: string; file: string; from: string | null; to: string }>;
	missing: SyncScheduleUpdate[];
}> {
	const byFile = new Map<string, SyncScheduleUpdate[]>();
	for (const u of updates) {
		const list = byFile.get(u.file) ?? [];
		list.push(u);
		byFile.set(u.file, list);
	}

	const applied: Array<{ key: string; file: string; from: string | null; to: string }> = [];
	const missing: SyncScheduleUpdate[] = [];

	for (const [file, fileUpdates] of byFile) {
		const full = join(root, ...file.split("/"));
		// Keep the rewrite inside the registered worker folder even if the
		// client sends a traversal-shaped relative path.
		const rel = relative(root, full);
		if (rel.startsWith("..") || rel === "") {
			missing.push(...fileUpdates);
			continue;
		}
		let src: string;
		try {
			const s = await stat(full);
			if (!s.isFile()) throw new Error("not a file");
			src = await readFile(full, "utf8");
		} catch {
			missing.push(...fileUpdates);
			continue;
		}

		const { calls } = parseSyncCalls(src);
		// { start, end, text } replacements, collected before any is applied.
		const edits: Array<{ start: number; end: number; text: string }> = [];
		const pending: Array<{ key: string; from: string | null; to: string }> = [];

		for (const u of fileUpdates) {
			const call = calls.find((c) => c.key === u.key);
			if (!call) {
				missing.push(u);
				continue;
			}
			if (call.schedule) {
				// Writes to wherever the value really lives: the property itself,
				// or the declaration of the constant it names.
				const resolved = resolveScheduleSpan(src, call.schedule);
				if (!resolved) {
					// Genuinely unresolvable (an imported constant, a ternary) —
					// replacing it would discard the author's indirection, so
					// leave it alone and report it untouched.
					missing.push(u);
					continue;
				}
				const quote = src[resolved.span.valueStart] === "'" ? "'" : '"';
				const text = `${quote}${u.schedule}${quote}`;
				// Several syncs can share one constant. Writing its span once per
				// sync would corrupt the file, so collapse duplicates — and refuse
				// the whole set if they disagree about the new value.
				const clash = edits.find((e) => e.start === resolved.span.valueStart);
				if (clash && clash.text !== text) {
					missing.push(u);
					continue;
				}
				if (!clash) {
					edits.push({
						start: resolved.span.valueStart,
						end: resolved.span.valueEnd,
						text,
					});
				}
				pending.push({ key: u.key, from: resolved.value, to: u.schedule });
			} else {
				// No `schedule:` at all — insert one as the config object's
				// first property, indented to match the object's own line.
				const indent = indentOfLine(src, call.objStart) + "\t";
				edits.push({
					start: call.objStart + 1,
					end: call.objStart + 1,
					text: `\n${indent}schedule: "${u.schedule}",`,
				});
				pending.push({ key: u.key, from: null, to: u.schedule });
			}
		}

		if (edits.length === 0) continue;
		edits.sort((a, b) => b.start - a.start);
		let next = src;
		for (const e of edits) next = next.slice(0, e.start) + e.text + next.slice(e.end);
		await writeFile(full, next, "utf8");
		for (const p of pending) applied.push({ ...p, file });
	}

	return { applied, missing };
}
