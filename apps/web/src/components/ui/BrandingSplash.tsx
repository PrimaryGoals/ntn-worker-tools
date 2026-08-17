export function BrandingSplash() {
	return (
		<div className="flex h-full min-h-0 flex-col items-center justify-center gap-6 overflow-auto p-6 text-center">
			<a
				href="https://PrimaryGoals.com/ntn/"
				target="_blank"
				rel="noopener noreferrer"
				className="group flex flex-col items-center gap-2 transition-opacity hover:opacity-80"
				title="PrimaryGoals.com"
			>
				<img
					src="/images/primarygoals-logo.gif"
					alt="Primary Goals Marketing Automation"
				/>
			</a>

			<div className="max-w-md">
				<h2 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">
					NTN Worker Tools for Notion
				</h2>

			</div>

			<div className="flex flex-wrap items-center justify-center gap-4">
				<img
					src="/images/Consulting%20Partner%20Badge.png"
					alt="Notion Consulting Partner"
					className="dark:rounded dark:bg-neutral-100 dark:p-1"
				/>
				<img
					src="/images/notion-certified-admin-204.png"
					alt="Notion Certified Admin"
					className="dark:rounded dark:bg-neutral-100 dark:p-1"
				/>
			</div>
		</div>
	);
}
