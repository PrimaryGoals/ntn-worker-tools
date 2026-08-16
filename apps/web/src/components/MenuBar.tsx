import { useState } from "react";
import { MenuItem } from "./ui/MenuItem";
import { MenuItemSubmenu } from "./ui/MenuItemSubmenu";

export function MenuBar({
	loading,
	error,
	workerId,
	workerName,
	localPath,
	hasDeployScript,
	hasEnvFile,
	gitAvailable,
	isGitRepo,
	onSetLocalPath,
	onClearLocalPath,
	onReveal,
	onRenameWorker,
	onNtnDeploy,
	onPnpmDeploy,
	onDeployUpdatedWorkers,
	onDeployToNewWorkspace,
	onPushSecrets,
	oauthCapabilityKey,
	onOauthShowRedirectUrl,
	onOauthStart,
	onOauthToken,
	onOpenGitCheckin,
	onMarkTime,
	hasTimeMarker,
	onClearTimeMarker,
	onAdjustTimeMarker,
	onOpenTokenPush,
	setLocalPathError,
	isSyncWorker,
	onSyncPause,
	onSyncResume,
	onSyncStateReset,
}: {
	loading: boolean;
	error: Error | null;
	workerId: string | null;
	workerName: string | null;
	localPath: string | null;
	hasDeployScript: boolean;
	hasEnvFile: boolean;
	gitAvailable: boolean;
	isGitRepo: boolean;
	onSetLocalPath: () => void;
	onClearLocalPath: () => void;
	onReveal: () => void;
	onRenameWorker: () => void;
	onNtnDeploy: () => void;
	onPnpmDeploy: () => void;
	onDeployUpdatedWorkers: () => void;
	onDeployToNewWorkspace: () => void;
	onPushSecrets: () => void;
	// The worker's oauth capability key (e.g. "googleDrive"), or null if it
	// has no oauth capability — drives whether the OAuth submenu is enabled.
	oauthCapabilityKey: string | null;
	onOauthShowRedirectUrl: () => void;
	onOauthStart: () => void;
	onOauthToken: () => void;
	onOpenGitCheckin: () => void;
	onMarkTime: () => void;
	hasTimeMarker: boolean;
	onClearTimeMarker: () => void;
	onAdjustTimeMarker: () => void;
	onOpenTokenPush: () => void;
	setLocalPathError: Error | null;
	isSyncWorker: boolean;
	onSyncPause: () => void;
	onSyncResume: () => void;
	onSyncStateReset: () => void;
}) {
	const [open, setOpen] = useState(false);
	return (
		<header className="flex items-center justify-between border-b border-neutral-200 bg-white px-4 py-2 dark:border-neutral-800 dark:bg-neutral-950">
			<div className="relative">
				<button
					type="button"
					onClick={() => setOpen((v) => !v)}
					className="rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900"
				>
					Worker{workerName ? `: ${workerName}` : ""} ▾
				</button>
				{open ? (
					<div
						className="absolute left-0 top-full z-10 mt-1 w-64 rounded border border-neutral-200 bg-white shadow-lg dark:border-neutral-800 dark:bg-neutral-950"
						onMouseLeave={() => setOpen(false)}
					>
						<MenuItem
							label={localPath ? "Change local folder…" : "Set local folder…"}
							onClick={() => {
								setOpen(false);
								onSetLocalPath();
							}}
						/>
						<MenuItem
							label="Reveal in Explorer"
							disabled={!localPath}
							disabledReason="No local folder registered — use Set local folder… first."
							onClick={() => {
								setOpen(false);
								onReveal();
							}}
						/>
						<MenuItem
							label="Rename worker"
							disabled={!localPath}
							disabledReason="No local folder registered — use Set local folder… first."
							onClick={() => {
								setOpen(false);
								onRenameWorker();
							}}
						/>
						<MenuItemSubmenu label="Deploy workers">
							<MenuItem
								label="ntn workers deploy"
								disabled={!localPath || hasDeployScript}
								disabledReason={
									!localPath
										? "Requires a registered local folder."
										: "This project defines scripts.deploy in package.json — use pnpm run deploy."
								}
								onClick={() => {
									setOpen(false);
									onNtnDeploy();
								}}
							/>
							<MenuItem
								label="pnpm run deploy"
								disabled={!localPath || !hasDeployScript}
								disabledReason={
									!localPath
										? "Requires a registered local folder."
										: "This project has no scripts.deploy in package.json — use ntn workers deploy."
								}
								onClick={() => {
									setOpen(false);
									onPnpmDeploy();
								}}
							/>
							<MenuItem
								label="deploy updated workers"
								onClick={() => {
									setOpen(false);
									onDeployUpdatedWorkers();
								}}
							/>
							<MenuItem
								label="Deploy to new workspace"
								onClick={() => {
									setOpen(false);
									onDeployToNewWorkspace();
								}}
							/>
						</MenuItemSubmenu>
						<MenuItemSubmenu label="Secrets">
							<MenuItem
								label="push secrets to Notion"
								disabled={!localPath || !hasEnvFile}
								disabledReason={
									!localPath
										? "Requires a registered local folder."
										: "No .env file found in the registered local folder."
								}
								onClick={() => {
									setOpen(false);
									onPushSecrets();
								}}
							/>
							<MenuItem
								label="push NOTION_API_TOKEN"
								disabled={!workerId || !!localPath}
								disabledReason={
									!workerId
										? "Select a worker first."
										: "You have a local folder — use 'push secrets to Notion' to push all env vars from your .env file."
								}
								onClick={() => {
									setOpen(false);
									onOpenTokenPush();
								}}
							/>
						</MenuItemSubmenu>
						<MenuItemSubmenu
							label="OAuth"
							disabled={!workerId || !oauthCapabilityKey}
							disabledReason={
								!workerId
									? "Select a worker first."
									: "This worker has no oauth capability."
							}
						>
							<MenuItem
								label="show redirect url"
								onClick={() => {
									setOpen(false);
									onOauthShowRedirectUrl();
								}}
							/>
							<MenuItem
								label="start (authorize)"
								onClick={() => {
									setOpen(false);
									onOauthStart();
								}}
							/>
							<MenuItem
								label="token"
								onClick={() => {
									setOpen(false);
									onOauthToken();
								}}
							/>
						</MenuItemSubmenu>
						<MenuItem
							label="local check-in"
							disabled={!localPath || !gitAvailable || !isGitRepo}
							disabledReason={
								!localPath
									? "Requires a registered local folder."
									: !gitAvailable
										? "git is not installed on this machine — install git to enable this."
										: "The registered local folder is not a git repository."
							}
							onClick={() => {
								setOpen(false);
								onOpenGitCheckin();
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
						{isSyncWorker ? (
							<>
								<div className="border-t border-neutral-200 dark:border-neutral-800" />
								<MenuItemSubmenu label="Sync Options">
									<MenuItem
										label="sync pause"
										onClick={() => {
											setOpen(false);
											onSyncPause();
										}}
									/>
									<MenuItem
										label="sync resume"
										onClick={() => {
											setOpen(false);
											onSyncResume();
										}}
									/>
									<MenuItem
										label="sync reset"
										onClick={() => {
											setOpen(false);
											onSyncStateReset();
										}}
									/>
								</MenuItemSubmenu>
							</>
						) : null}
						{localPath ? (
							<>
								<div className="border-t border-neutral-200 dark:border-neutral-800" />
								<div
									className="px-3 py-1 font-mono text-[10px] text-neutral-500"
									title={localPath}
								>
									{localPath}
								</div>
								<MenuItem
									label="Forget local folder"
									onClick={() => {
										setOpen(false);
										onClearLocalPath();
									}}
								/>
							</>
						) : null}
						{setLocalPathError ? (
							<div className="border-t border-red-200 px-3 py-1 text-[11px] text-red-600 dark:border-red-900/40 dark:text-red-400">
								{setLocalPathError.message}
							</div>
						) : null}
					</div>
				) : null}
			</div>
			<div className="flex items-center gap-3">
				<h1 className="text-sm font-semibold">NTN Worker Tools</h1>
				<span
					className={
						"text-xs " +
						(error ? "text-red-600 dark:text-red-400" : "text-neutral-500")
					}
				>
					{loading
						? "checking auth…"
						: error
							? "not signed in — run `ntn login` in a terminal"
							: <a
									href="https://PrimaryGoals.com/ntn/"
									target="_blank"
									rel="noopener noreferrer"
									className="text-blue-600 underline hover:no-underline dark:text-blue-400"
								>
									PrimaryGoals.com
								</a>}
				</span>
			</div>
		</header>
	);
}
