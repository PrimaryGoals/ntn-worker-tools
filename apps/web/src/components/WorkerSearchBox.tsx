export function WorkerSearchBox({
	value,
	onChange,
}: {
	value: string;
	onChange: (value: string) => void;
}) {
	return (
		<div className="flex items-center gap-1 rounded border border-neutral-300 bg-white px-1.5 py-0.5 normal-case focus-within:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:focus-within:border-neutral-600">
			<svg
				viewBox="0 0 16 16"
				className="h-3 w-3 shrink-0 text-neutral-400"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.5"
				aria-hidden="true"
			>
				<circle cx="7" cy="7" r="5" />
				<path d="M11 11 L15 15" strokeLinecap="round" />
			</svg>
			<input
				type="text"
				value={value}
				onChange={(e) => onChange(e.target.value)}
				placeholder="Filter workers…"
				aria-label="Filter workers"
				className="w-56 border-0 bg-transparent p-0 text-xs font-normal normal-case tracking-normal text-neutral-900 placeholder:text-neutral-400 focus:outline-none dark:text-neutral-100 dark:placeholder:text-neutral-500"
			/>
			{value ? (
				<button
					type="button"
					onClick={() => onChange("")}
					aria-label="Clear filter"
					className="shrink-0 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
				>
					<svg
						viewBox="0 0 16 16"
						className="h-3 w-3"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.5"
						aria-hidden="true"
					>
						<path d="M4 4 L12 12 M12 4 L4 12" strokeLinecap="round" />
					</svg>
				</button>
			) : null}
		</div>
	);
}
