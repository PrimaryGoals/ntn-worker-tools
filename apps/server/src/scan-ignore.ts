// Directories skipped when walking a worker's local folder — dependency/build
// output churns constantly (installs, rebuilds) and never holds the source we
// care about, whether we're looking for the latest mtime or for a
// `worker.sync()` declaration.
export const SCAN_IGNORED_DIR_NAMES = new Set(["node_modules", "dist", "build", "coverage", "out"]);
