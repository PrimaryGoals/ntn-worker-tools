import { PRIMARY_GOALS_URL } from "./constants";

// The single source for every worker action, shared by the header's Worker
// dropdown and the sidebar's right-click menu. Both surfaces render from the
// same array, so a label, a gate, or a disabled reason exists in exactly one
// place; the surfaces differ only in how they present what they are given:
//
//   dropdown      — groups become submenus, unavailable items show greyed
//                   with their `disabledReason` as a tooltip.
//   context menu  — groups become headings, unavailable items are left out,
//                   and the single-item groups collapse into one unheaded
//                   block at the bottom.
//
// Anything that ignores the selected worker (workspace- or app-scoped) is
// marked `dropdownOnly`: a right-click on one worker's row must not imply
// those act on that worker.

export interface WorkerMenuItem {
	id: string;
	label: string;
	onSelect: () => void;
	// Unavailable for this worker: greyed in the dropdown, absent from the
	// context menu. `disabledReason` becomes the dropdown's tooltip.
	disabled?: boolean;
	disabledReason?: string;
	// Not applicable to this worker at all — dropped from both surfaces.
	// Distinct from `disabled`, which the dropdown still shows as a hint.
	hidden?: boolean;
	dropdownOnly?: boolean;
}

export interface WorkerMenuGroup {
	id: string;
	// null renders the items at the menu's top level — no submenu in the
	// dropdown, no heading in the context menu.
	label: string | null;
	items: WorkerMenuItem[];
	// Applied to the whole group: the dropdown greys the submenu itself, the
	// context menu omits the group.
	disabled?: boolean;
	disabledReason?: string;
	hidden?: boolean;
	dropdownOnly?: boolean;
	separatorBefore?: boolean;
	// The either/or gates leave these groups with a single applicable item, so
	// in the context menu they shed their heading and collect at the bottom.
	contextMenuFooter?: boolean;
	// Rank within that footer block, lowest first; unranked groups sit at 0 and
	// keep their order relative to one another. Only the footer reads this, so
	// a group can lead it while staying put in the dropdown.
	contextMenuFooterOrder?: number;
}

// Everything the gates are computed from. All of it is already derived in
// useWorkerData for the selected worker.
export interface WorkerMenuState {
	workerId: string | null;
	localPath: string | null;
	hasDeployScript: boolean;
	hasEnvFile: boolean;
	oauthCapabilityKey: string | null;
	isSyncWorker: boolean;
	// Whether the sync that pause/resume act on (the worker's first sync
	// capability) is currently paused. null when that isn't known yet — no
	// status has been gathered for this worker — in which case neither item
	// is gated, since hiding the wrong one is worse than offering both.
	syncPaused: boolean | null;
	hasWebhook: boolean;
	hasTimeMarker: boolean;
}

// The callbacks stay App's business — confirms, modals and mutations all live
// there. This module owns only the menu's shape.
export interface WorkerMenuActions {
	setLocalPath: () => void;
	reveal: () => void;
	clearLocalPath: () => void;
	renameWorker: () => void;
	ntnDeploy: () => void;
	pnpmDeploy: () => void;
	deployUpdatedWorkers: () => void;
	deployToNewWorkspace: () => void;
	pushSecrets: () => void;
	openTokenPush: () => void;
	oauthShowRedirectUrl: () => void;
	oauthStart: () => void;
	oauthToken: () => void;
	markTime: () => void;
	clearTimeMarker: () => void;
	adjustTimeMarker: () => void;
	fireWebhook: () => void;
	syncTrigger: () => void;
	syncPause: () => void;
	syncResume: () => void;
	syncStateReset: () => void;
	updatePollingInterval: () => void;
}

const NO_FOLDER = "No local folder registered — use Set local folder… first.";
const NEEDS_FOLDER = "Requires a registered local folder.";

export function buildWorkerMenuGroups(
	state: WorkerMenuState,
	actions: WorkerMenuActions,
): WorkerMenuGroup[] {
	const {
		workerId,
		localPath,
		hasDeployScript,
		hasEnvFile,
		oauthCapabilityKey,
		isSyncWorker,
		syncPaused,
		hasWebhook,
		hasTimeMarker,
	} = state;
	const noFolder = !localPath;

	return [
		{
			id: "localFolder",
			label: "Local folder",
			items: [
				{
					id: "setLocalPath",
					label: localPath ? "Change local folder…" : "Set local folder…",
					onSelect: actions.setLocalPath,
				},
				{
					id: "reveal",
					label: "Reveal in Explorer",
					disabled: noFolder,
					disabledReason: NO_FOLDER,
					onSelect: actions.reveal,
				},
				{
					id: "clearLocalPath",
					label: "Forget local folder",
					disabled: noFolder,
					disabledReason: NO_FOLDER,
					onSelect: actions.clearLocalPath,
				},
			],
		},
		{
			id: "rename",
			contextMenuFooter: true,
			label: null,
			items: [
				{
					id: "renameWorker",
					label: "Rename worker",
					disabled: noFolder,
					disabledReason: NO_FOLDER,
					onSelect: actions.renameWorker,
				},
			],
		},
		{
			id: "deploy",
			contextMenuFooter: true,
			label: "Deploy workers",
			items: [
				{
					id: "ntnDeploy",
					label: "ntn workers deploy",
					disabled: noFolder || hasDeployScript,
					disabledReason: noFolder
						? NEEDS_FOLDER
						: "This project defines scripts.deploy in package.json — use pnpm run deploy.",
					onSelect: actions.ntnDeploy,
				},
				{
					id: "pnpmDeploy",
					label: "pnpm run deploy",
					disabled: noFolder || !hasDeployScript,
					disabledReason: noFolder
						? NEEDS_FOLDER
						: "This project has no scripts.deploy in package.json — use ntn workers deploy.",
					onSelect: actions.pnpmDeploy,
				},
				{
					id: "deployUpdatedWorkers",
					label: "Deploy updated workers",
					dropdownOnly: true,
					onSelect: actions.deployUpdatedWorkers,
				},
				{
					id: "deployToNewWorkspace",
					label: "Deploy to new workspace",
					dropdownOnly: true,
					onSelect: actions.deployToNewWorkspace,
				},
			],
		},
		{
			id: "secrets",
			contextMenuFooter: true,
			label: "Secrets",
			items: [
				{
					id: "pushSecrets",
					label: "push secrets to Notion",
					disabled: noFolder || !hasEnvFile,
					disabledReason: noFolder
						? NEEDS_FOLDER
						: "No .env file found in the registered local folder.",
					onSelect: actions.pushSecrets,
				},
				{
					id: "openTokenPush",
					label: "push NOTION_API_TOKEN",
					disabled: !workerId || !noFolder,
					disabledReason: !workerId
						? "Select a worker first."
						: "You have a local folder — use 'push secrets to Notion' to push all env vars from your .env file.",
					onSelect: actions.openTokenPush,
				},
			],
		},
		{
			id: "oauth",
			label: "OAuth",
			disabled: !workerId || !oauthCapabilityKey,
			disabledReason: !workerId ? "Select a worker first." : "This worker has no oauth capability.",
			items: [
				{
					id: "oauthShowRedirectUrl",
					label: "show redirect url",
					onSelect: actions.oauthShowRedirectUrl,
				},
				{ id: "oauthStart", label: "start (authorize)", onSelect: actions.oauthStart },
				{ id: "oauthToken", label: "token", onSelect: actions.oauthToken },
			],
		},
		{
			id: "timeMarkers",
			label: "Time Markers",
			dropdownOnly: true,
			items: [
				{ id: "markTime", label: "Mark current time", onSelect: actions.markTime },
				{
					id: "clearTimeMarker",
					label: "Clear Time Marker",
					hidden: !hasTimeMarker,
					onSelect: actions.clearTimeMarker,
				},
				{ id: "adjustTimeMarker", label: "adjust time marker", onSelect: actions.adjustTimeMarker },
			],
		},
		{
			id: "webhook",
			// Unheaded: the one webhook action has no siblings to be grouped with,
			// and it fires a real POST at the deployed worker, so it reads better
			// standing alone than buried under a heading. In the dropdown that
			// leaves it here, next to Sync Options; in the context menu it heads
			// the footer block instead, where the other single actions are.
			label: null,
			separatorBefore: true,
			contextMenuFooter: true,
			contextMenuFooterOrder: -1,
			items: [
				{
					id: "fireWebhook",
					label: "Fire Webhook",
					disabled: !workerId || !hasWebhook,
					disabledReason: !workerId
						? "Select a worker first."
						: "This worker has no webhook capability.",
					onSelect: actions.fireWebhook,
				},
			],
		},
		{
			id: "sync",
			label: "Sync Options",
			// Greyed rather than absent when the worker has no sync capability,
			// matching how OAuth behaves — the dropdown says what exists and why
			// you cannot reach it, instead of quietly varying its own shape.
			disabled: !workerId || !isSyncWorker,
			disabledReason: !workerId ? "Select a worker first." : "This worker has no sync capability.",
			separatorBefore: true,
			items: [
				{
					id: "syncPause",
					label: "sync pause",
					disabled: syncPaused === true,
					disabledReason: "This sync is already paused.",
					onSelect: actions.syncPause,
				},
				{
					id: "syncResume",
					label: "sync resume",
					disabled: syncPaused === false,
					disabledReason: "This sync is running — nothing to resume.",
					onSelect: actions.syncResume,
				},
				{ id: "syncStateReset", label: "sync reset", onSelect: actions.syncStateReset },
				{ id: "syncTrigger", label: "Trigger Sync", onSelect: actions.syncTrigger },
				{
					id: "updatePollingInterval",
					label: "Update polling interval…",
					disabled: noFolder,
					// The interval lives in the worker's source, not in anything ntn
					// can report — so this one needs the files.
					disabledReason: NO_FOLDER,
					onSelect: actions.updatePollingInterval,
				},
			],
		},
		{
			id: "help",
			label: null,
			dropdownOnly: true,
			separatorBefore: true,
			items: [
				{
					id: "help",
					label: "Help",
					onSelect: () => window.open(PRIMARY_GOALS_URL, "_blank", "noopener,noreferrer"),
				},
			],
		},
	];
}

// The dropdown's view: everything except what no worker can ever use, with
// unavailable items kept as greyed hints.
export function dropdownGroups(groups: WorkerMenuGroup[]): WorkerMenuGroup[] {
	return groups
		.filter((g) => !g.hidden)
		.map((g) => ({ ...g, items: g.items.filter((i) => !i.hidden) }))
		.filter((g) => g.items.length > 0);
}

// The context menu's view: worker-scoped groups only, and only the items that
// can actually fire right now — a right-click menu offers no greyed rows.
export function contextMenuGroups(groups: WorkerMenuGroup[]): WorkerMenuGroup[] {
	const usable = groups
		.filter((g) => !g.hidden && !g.dropdownOnly && !g.disabled)
		.map((g) => ({
			...g,
			items: g.items.filter((i) => !i.hidden && !i.dropdownOnly && !i.disabled),
		}))
		.filter((g) => g.items.length > 0);

	// Their either/or gates leave these groups showing one row apiece, and a
	// heading over a single row is noise — so they lose it and gather into one
	// block at the end, after the groups that genuinely list alternatives.
	const headed = usable.filter((g) => !g.contextMenuFooter);
	const footer = usable
		.filter((g) => g.contextMenuFooter)
		.sort((a, b) => (a.contextMenuFooterOrder ?? 0) - (b.contextMenuFooterOrder ?? 0))
		.flatMap((g) => g.items);
	return footer.length > 0
		? [...headed, { id: "footer", label: null, items: footer }]
		: headed;
}
