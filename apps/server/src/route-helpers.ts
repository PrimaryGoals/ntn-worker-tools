export function isVerbose(v?: string): boolean {
	return v === "1" || v === "true";
}

export function attachTrace<T extends object>(data: T, stderr: string): T {
	return stderr ? ({ ...data, _trace: stderr } as T) : data;
}

// Values that end up as positional arguments to `ntn`. A leading "-" would be
// read as a flag, so every accepted value must start with a letter or digit.
const SAFE_ARG_RE = /^[A-Za-z0-9][A-Za-z0-9_.:=-]*$/;

export function isSafeArg(v: unknown): v is string {
	return typeof v === "string" && v.length <= 256 && SAFE_ARG_RE.test(v);
}
