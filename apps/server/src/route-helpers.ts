export function isVerbose(v?: string): boolean {
	return v === "1" || v === "true";
}

export function attachTrace<T extends object>(data: T, stderr: string): T {
	return stderr ? ({ ...data, _trace: stderr } as T) : data;
}
