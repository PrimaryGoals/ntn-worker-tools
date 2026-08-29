export function RefreshButton({
	title,
	spinning,
	onClick,
}: {
	title: string;
	// Spins the icon while a refresh is in flight.
	spinning?: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			title={title}
			aria-label={title}
			className="shrink-0 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
		>
			<svg
				viewBox="0 0 16 16"
				className={`h-3.5 w-3.5 ${spinning ? "animate-spin" : ""}`}
				fill="none"
				stroke="currentColor"
				strokeWidth="1.5"
				aria-hidden="true"
			>
				<path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" strokeLinecap="round" />
				<path d="M13.5 2v3h-3" strokeLinecap="round" strokeLinejoin="round" />
			</svg>
		</button>
	);
}
