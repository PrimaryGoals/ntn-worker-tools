import { Fragment } from "react";

// Tab strip rendered in a Panel header, in place of its plain title. Styled to
// sit in the header's existing uppercase/tracking-wide type, so the selected
// tab reads exactly like the old static title did.
//
// A tab's `after` node renders beside its label but OUTSIDE the tab button —
// the controls that go there (e.g. RefreshButton) are themselves buttons, and
// nesting one button inside another is invalid HTML.
export function PanelTabs<T extends string>({
	tabs,
	active,
	onChange,
}: {
	tabs: Array<{ id: T; label: string; after?: React.ReactNode }>;
	active: T;
	onChange: (id: T) => void;
}) {
	return (
		<div className="flex items-center gap-2">
			{tabs.map((tab, i) => (
				<Fragment key={tab.id}>
					{i > 0 ? (
						<span className="select-none font-normal text-neutral-300 dark:text-neutral-700">
							|
						</span>
					) : null}
					<span className="flex items-center gap-1.5">
						<button
							type="button"
							onClick={() => onChange(tab.id)}
							className={
								"-mb-1.5 border-b-2 pb-1.5 uppercase tracking-wide transition-colors " +
								(tab.id === active
									? "border-blue-500 text-neutral-700 dark:text-neutral-200"
									: "border-transparent text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300")
							}
						>
							{tab.label}
						</button>
						{tab.after}
					</span>
				</Fragment>
			))}
		</div>
	);
}
