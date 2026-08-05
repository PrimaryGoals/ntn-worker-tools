export function MenuItem({
	label,
	onClick,
	disabled,
	disabledReason,
}: {
	label: string;
	onClick: () => void;
	disabled?: boolean;
	disabledReason?: string;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			title={disabled ? disabledReason : undefined}
			className={
				"block w-full px-3 py-1.5 text-left text-sm " +
				(disabled
					? "cursor-not-allowed text-neutral-400 dark:text-neutral-600"
					: "hover:bg-neutral-100 dark:hover:bg-neutral-900")
			}
		>
			{label}
		</button>
	);
}
