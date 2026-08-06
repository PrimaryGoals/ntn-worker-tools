export function ExitCodeBadge({ code }: { code: number | null }) {
	if (code == null) {
		return (
			<span className="inline-block rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
				running
			</span>
		);
	}
	const ok = code === 0;
	return (
		<span
			className={
				"inline-block rounded px-1.5 py-0.5 font-mono text-xs " +
				(ok
					? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
					: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200")
			}
		>
			{code}
		</span>
	);
}
