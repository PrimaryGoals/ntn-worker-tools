import type { WorkerMenuGroup } from "../workerMenu";
import { ContextMenu } from "./ui/ContextMenu";
import { MenuItem } from "./ui/MenuItem";

// The sidebar's right-click menu. Flat — every action is one click from the
// pointer — with the group each action belongs to shown as a heading, since
// labels like "token" and "sync reset" rely on that context to make sense.
//
// `groups` has already been narrowed by contextMenuGroups(), so every item
// here is applicable and enabled; empty groups never arrive.
export function WorkerContextMenu({
	groups,
	workerName,
	x,
	y,
	onClose,
}: {
	groups: WorkerMenuGroup[];
	workerName: string | null;
	x: number;
	y: number;
	onClose: () => void;
}) {
	return (
		<ContextMenu x={x} y={y} onClose={onClose}>
			{workerName ? (
				<div
					className="truncate border-b border-neutral-200 px-3 pb-1.5 pt-1 text-xs font-semibold dark:border-neutral-800"
					title={workerName}
				>
					{workerName}
				</div>
			) : null}
			{groups.map((group, idx) => (
				<div key={group.id}>
					{idx > 0 ? (
						<div className="my-1 border-t border-neutral-200 dark:border-neutral-800" />
					) : null}
					{group.label ? (
						<div className="px-3 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
							{group.label}
						</div>
					) : null}
					{group.items.map((item) => (
						<MenuItem
							key={item.id}
							label={item.label}
							onClick={() => {
								onClose();
								item.onSelect();
							}}
						/>
					))}
				</div>
			))}
		</ContextMenu>
	);
}
