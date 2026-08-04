#!/usr/bin/env node
// Walk `ntn help` recursively and print a command tree.
// Skips `help` (auto-generated everywhere) and `tui` (interactive).
// Only invokes `ntn help <path...>` — never explores commands with other flags.
//
// Usage: node scripts/walk-ntn-help.mjs
//   Prints the tree to stdout. Paste into docs/ntn-command-tree.md between the
//   ``` fences, and bump the "Captured against …" date in that file.

import { execFileSync } from "node:child_process";

const SKIP = new Set(["help", "tui"]);

function help(pathParts) {
	const args = ["help", ...pathParts];
	try {
		return execFileSync("ntn", args, {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
			shell: process.platform === "win32",
		});
	} catch (err) {
		process.stderr.write(`FAILED: ntn ${args.join(" ")}\n`);
		throw err;
	}
}

function parse(output) {
	const lines = output.split(/\r?\n/);
	let usage = "";
	const commands = [];
	let mode = null;
	for (const line of lines) {
		if (line.startsWith("Usage:")) {
			usage = line.replace(/^Usage:\s*/, "").trim();
			continue;
		}
		if (/^Commands:\s*$/.test(line)) {
			mode = "cmds";
			continue;
		}
		if (/^[A-Z][a-zA-Z ]+:\s*$/.test(line)) {
			mode = null;
			continue;
		}
		if (mode === "cmds") {
			const m = line.match(/^\s\s([a-z][a-z0-9-]*)\b/i);
			if (m) commands.push(m[1]);
		}
	}
	return { usage, commands };
}

function walk(pathParts) {
	const raw = help(pathParts);
	const { usage, commands } = parse(raw);
	const filtered = commands.filter((c) => !SKIP.has(c));
	return {
		name: pathParts.length === 0 ? "ntn" : pathParts[pathParts.length - 1],
		usage,
		children: filtered.map((c) => walk([...pathParts, c])),
	};
}

function render(node, depth = 0) {
	const dashes = "-".repeat(depth * 2);
	const prefix = depth === 0 ? "" : `${dashes} `;
	if (node.children.length === 0) {
		return `${prefix}${node.name} : ${node.usage}\n`;
	}
	let out = `${prefix}${node.name}\n`;
	for (const c of node.children) out += render(c, depth + 1);
	return out;
}

const tree = walk([]);
process.stdout.write(render(tree));
