export function Panel({
	title,
	titleAfter,
	headerRight,
	children,
}: {
	title: string;
	// Rendered immediately after the title text, inside the header's left
	// group (headerRight stays pinned to the far edge).
	titleAfter?: React.ReactNode;
	headerRight?: React.ReactNode;
	children: React.ReactNode;
}) {
	return (
		<section className="flex h-full min-h-0 flex-col rounded border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
			<div className="flex items-center justify-between border-b border-neutral-200 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:border-neutral-800">
				<div className="flex items-center gap-1.5">
					<span>{title}</span>
					{titleAfter}
				</div>
				{headerRight}
			</div>
			<div className="min-h-0 flex-1 overflow-auto">{children}</div>
		</section>
	);
}

export function Empty({ children }: { children: React.ReactNode }) {
	return <div className="p-3 text-sm text-neutral-500">{children}</div>;
}
