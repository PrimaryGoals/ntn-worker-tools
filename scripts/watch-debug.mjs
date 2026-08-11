#!/usr/bin/env node
// Log every raw fs.watch event for a directory, with a timestamp, so a
// phantom `node --watch` restart in dev:server can be cross-referenced
// against what Windows actually reported at that moment. Standalone —
// doesn't touch dev:server or its flags. Run in a second terminal alongside
// `pnpm dev`.
//
// Usage: node scripts/watch-debug.mjs [dir] [logFile]
//   dir     defaults to apps/server/src
//   logFile defaults to watch-debug.log

import fs from "node:fs";
import path from "node:path";

const target = process.argv[2] || "apps/server/src";
const logFile = process.argv[3] || "watch-debug.log";

function log(line) {
	const stamped = `[${new Date().toISOString()}] ${line}`;
	console.log(stamped);
	fs.appendFileSync(logFile, `${stamped}\n`);
}

log(`watching ${path.resolve(target)} (recursive) -> ${path.resolve(logFile)}`);

fs.watch(target, { recursive: true }, (eventType, filename) => {
	log(`event=${eventType} filename=${filename ?? "(null)"}`);
});
