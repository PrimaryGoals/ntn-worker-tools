import { useState } from "react";
import { PRIMARY_GOALS_URL } from "../constants";
import { MenuItem } from "./ui/MenuItem";
import { MenuItemSubmenu } from "./ui/MenuItemSubmenu";

// Replaces the Worker menu while the Agents tab is active. Agent-scoped
// actions plus the two items that aren't tied to either context: Time Markers
// (the marker drives both tabs' "since" views) and Help.
export function AgentMenuBar({
	agentName,
	agentId,
	onSetCreditLimit,
	onSetStatus,
	onMarkTime,
	hasTimeMarker,
	onClearTimeMarker,
	onAdjustTimeMarker,
}: {
	agentName: string | null;
	agentId: string | null;
	onSetCreditLimit: () => void;
	onSetStatus: () => void;
	onMarkTime: () => void;
	hasTimeMarker: boolean;
	onClearTimeMarker: () => void;
	onAdjustTimeMarker: () => void;
}) {
	const [open, setOpen] = useState(false);
	const noAgent = !agentId;
	return (
		<div className="relative">
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				className="rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900"
			>
				Agent{agentName ? `: ${agentName}` : ""} ▾
			</button>
			{open ? (
				<div
					className="absolute left-0 top-full z-10 mt-1 w-64 rounded border border-neutral-200 bg-white shadow-lg dark:border-neutral-800 dark:bg-neutral-950"
					onMouseLeave={() => setOpen(false)}
				>
					<MenuItem
						label="Set credit limit…"
						disabled={noAgent}
						disabledReason="Select an agent first."
						onClick={() => {
							setOpen(false);
							onSetCreditLimit();
						}}
					/>
					<MenuItem
						label="Set status…"
						disabled={noAgent}
						disabledReason="Select an agent first."
						onClick={() => {
							setOpen(false);
							onSetStatus();
						}}
					/>
					<MenuItemSubmenu label="Time Markers">
						<MenuItem
							label="Mark current time"
							onClick={() => {
								setOpen(false);
								onMarkTime();
							}}
						/>
						{hasTimeMarker ? (
							<MenuItem
								label="Clear Time Marker"
								onClick={() => {
									setOpen(false);
									onClearTimeMarker();
								}}
							/>
						) : null}
						<MenuItem
							label="adjust time marker"
							onClick={() => {
								setOpen(false);
								onAdjustTimeMarker();
							}}
						/>
					</MenuItemSubmenu>
					<div className="border-t border-neutral-200 dark:border-neutral-800" />
					<MenuItem
						label="Help"
						onClick={() => {
							setOpen(false);
							window.open(PRIMARY_GOALS_URL, "_blank", "noopener,noreferrer");
						}}
					/>
				</div>
			) : null}
		</div>
	);
}
