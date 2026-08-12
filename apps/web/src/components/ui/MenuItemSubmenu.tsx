import { useState } from "react";
import { MenuItem } from "./MenuItem";

export function MenuItemSubmenu({
	label,
	children,
	disabled,
	disabledReason,
}: {
	label: string;
	children: React.ReactNode;
	disabled?: boolean;
	disabledReason?: string;
}) {
	const [open, setOpen] = useState(false);

	return (
		<div
			className="relative"
			onMouseEnter={() => !disabled && setOpen(true)}
			onMouseLeave={() => setOpen(false)}
		>
			<button
				type="button"
				disabled={disabled}
				title={disabled ? disabledReason : undefined}
				className={
					"block w-full px-3 py-1.5 text-left text-sm flex items-center justify-between " +
					(disabled
						? "cursor-not-allowed text-neutral-400 dark:text-neutral-600"
						: "hover:bg-neutral-100 dark:hover:bg-neutral-900")
				}
			>
				<span className="text-xs">◂</span>
				<span>{label}</span>
			</button>
			{open && !disabled && (
				<div className="absolute right-full top-0 mr-0 w-56 rounded border border-neutral-200 bg-white shadow-lg dark:border-neutral-800 dark:bg-neutral-950">
					{children}
				</div>
			)}
		</div>
	);
}
