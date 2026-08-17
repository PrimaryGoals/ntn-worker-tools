import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { DeployResult, Whoami, Worker } from "@ntn-worker-tools/shared";
import { api } from "../../api";
import { isValidWorkerName, normalizeWorkerName } from "../../format";
import { FolderPickerModal } from "./FolderPickerModal";

// Deploys a folder (a copy of an existing worker, or a brand-new project) as
// a worker the current `ntn` login has never deployed before — either a fresh
// worker in the current workspace (testing) or the first worker in a new
// client workspace (production). Two phases: pick a directory, then confirm
// workspace/name/cleanup before the actual `ntn workers deploy --name` call.
export function DeployNewWorkerModal({
	startPath,
	whoami,
	existingWorkers,
	onClose,
	onDeployed,
}: {
	startPath: string | null;
	whoami: Whoami | null;
	existingWorkers: Worker[];
	onClose: () => void;
	onDeployed: (result: DeployResult) => void;
}) {
	const qc = useQueryClient();
	const [path, setPath] = useState<string | null>(null);
	const [workspaceConfirmed, setWorkspaceConfirmed] = useState(false);
	const [name, setName] = useState("");
	const [nameEdited, setNameEdited] = useState(false);
	const [scriptAcknowledged, setScriptAcknowledged] = useState(false);

	const inspectQ = useQuery({
		queryKey: ["deployNewInspect", path],
		queryFn: () => api.inspectDeployNewPath(path!),
		enabled: !!path,
	});

	// Default the name from the folder once, the first time inspection data
	// arrives — don't stomp on it if the user has already typed something.
	useEffect(() => {
		if (inspectQ.data && !nameEdited) {
			setName(normalizeWorkerName(inspectQ.data.folderName));
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [inspectQ.data?.folderName]);

	const cleanFiles = useMutation({
		mutationFn: (files: Array<"workers.json" | ".env">) => api.cleanDeployNewFiles(path!, files),
		onSuccess: () => qc.invalidateQueries({ queryKey: ["deployNewInspect", path] }),
	});

	const deploy = useMutation({
		mutationFn: () => api.deployNewWorker(path!, normalizeWorkerName(name)),
		onSuccess: (result) => {
			qc.invalidateQueries({ queryKey: ["workers"] });
			qc.invalidateQueries({ queryKey: ["config"] });
			qc.invalidateQueries({ queryKey: ["localMtimes"] });
			onDeployed(result);
		},
	});

	// For projects with their own scripts.deploy (see the warning panel below)
	// — runs that script instead of a plain `ntn workers deploy`. When the
	// name field differs from what's currently in package.json, passes it
	// along so the server can sync package.json (and scripts.deploy, if it
	// finds the old name there) before running the script.
	const pnpmDeploy = useMutation({
		mutationFn: (newName: string | undefined) => api.pnpmDeployNewWorker(path!, newName),
		onSuccess: (result) => {
			qc.invalidateQueries({ queryKey: ["workers"] });
			qc.invalidateQueries({ queryKey: ["config"] });
			qc.invalidateQueries({ queryKey: ["localMtimes"] });
			onDeployed(result);
		},
	});

	useEffect(() => {
		const h = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		window.addEventListener("keydown", h);
		return () => window.removeEventListener("keydown", h);
	}, [onClose]);

	function changeFolder() {
		setPath(null);
		setWorkspaceConfirmed(false);
		setName("");
		setNameEdited(false);
		setScriptAcknowledged(false);
		cleanFiles.reset();
		deploy.reset();
		pnpmDeploy.reset();
	}

	if (!path) {
		return (
			<FolderPickerModal
				workerName={null}
				title="Choose a directory to deploy as a new worker"
				selectLabel="Use this folder"
				requireWorkerProject={false}
				startPath={startPath}
				submitting={false}
				error={null}
				onClose={onClose}
				onResetError={() => {}}
				onSelect={(p) => setPath(p)}
			/>
		);
	}

	const normalized = normalizeWorkerName(name);
	const nameValid = isValidWorkerName(normalized);
	const matchedOldWorker = inspectQ.data?.workersJson
		? existingWorkers.find((w) => w.workerId === inspectQ.data!.workersJson!.workerId)
		: undefined;
	const nameCollision = existingWorkers.find(
		(w) => w.name.toLowerCase() === normalized.toLowerCase(),
	);

	// A project with its own scripts.deploy gets routed through that instead
	// of a plain `ntn workers deploy` (which would fail the same way it did
	// last time for anything depending on workspace:* packages). Bare
	// workspace:* deps with no deploy script have no known-good path here.
	const usePnpmDeploy = !!inspectQ.data?.hasDeployScript;
	const blockedByWorkspaceDeps = !usePnpmDeploy && !!inspectQ.data?.hasWorkspaceProtocolDeps;
	const submitting = deploy.isPending || pnpmDeploy.isPending;

	// Whether deploying will rewrite package.json's name (and scripts.deploy's
	// embedded argument, if it's found there) to match what's typed above.
	const packageNameBare = inspectQ.data?.packageName ?? null;
	const willRename = usePnpmDeploy && !!packageNameBare && packageNameBare !== normalized;
	const scriptContainsOldName =
		willRename && !!packageNameBare && !!inspectQ.data?.deployScript?.includes(packageNameBare);

	let blockedReason: string | null = null;
	if (!workspaceConfirmed) blockedReason = "Confirm the target workspace first.";
	else if (inspectQ.isLoading) blockedReason = "Checking this folder…";
	else if (inspectQ.data?.hasWorkersJson) blockedReason = "Delete workers.json first — see above.";
	else if (blockedByWorkspaceDeps) blockedReason = "This project needs a custom build — see above.";
	else if (usePnpmDeploy && !scriptAcknowledged) {
		blockedReason = "Review the deploy script above and confirm it targets the right folder.";
	} else if (!nameValid) {
		blockedReason = "Enter a valid name (lowercase letters, numbers, hyphens).";
	} else if (nameCollision) {
		blockedReason = matchedOldWorker && matchedOldWorker.workerId === nameCollision.workerId
			? `"${normalized}" is the worker this folder was copied from — choose a different name.`
			: `A worker named "${normalized}" already exists in this workspace — choose a different name.`;
	}
	const canDeploy = !blockedReason && !submitting;

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
			onClick={onClose}
			role="presentation"
		>
			<div
				className="flex w-full max-w-xl flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-2xl dark:border-neutral-800 dark:bg-neutral-950"
				onClick={(e) => e.stopPropagation()}
				role="dialog"
				aria-modal="true"
				aria-label="Deploy to new workspace"
			>
				<div className="flex items-center justify-between border-b border-neutral-200 px-4 py-2 dark:border-neutral-800">
					<h2 className="text-sm font-semibold">Deploy to new workspace</h2>
					<button
						type="button"
						onClick={onClose}
						className="rounded px-2 py-1 text-sm text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-900"
					>
						✕
					</button>
				</div>

				<div className="flex flex-col gap-3 p-4">
					<div className="flex items-center justify-between">
						<div className="font-mono text-[10px] text-neutral-500">{path}</div>
						<button
							type="button"
							onClick={changeFolder}
							disabled={submitting}
							className="text-xs text-blue-600 underline hover:no-underline disabled:opacity-50 dark:text-blue-400"
						>
							Change folder…
						</button>
					</div>

					<div className="rounded border border-neutral-200 p-3 dark:border-neutral-800">
						<h3 className="text-xs font-semibold">1. Target workspace</h3>
						{!whoami ? (
							<p className="mt-1 text-sm text-neutral-500">Checking current workspace…</p>
						) : (
							<>
								<p className="mt-1 text-sm">
									You are logged in to <span className="font-medium">{whoami.spaceName}</span> as{" "}
									{whoami.userName}.
								</p>
								{workspaceConfirmed ? (
									<p className="mt-1 text-xs text-emerald-700 dark:text-emerald-400">
										✓ Confirmed — deploying here.
									</p>
								) : (
									<button
										type="button"
										onClick={() => setWorkspaceConfirmed(true)}
										className="mt-2 rounded border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900"
									>
										This is correct — continue
									</button>
								)}
							</>
						)}
					</div>

					{workspaceConfirmed ? (
						inspectQ.isLoading ? (
							<p className="text-sm text-neutral-500">Checking folder…</p>
						) : inspectQ.error ? (
							<p className="text-sm text-red-600 dark:text-red-400">
								{(inspectQ.error as Error).message}
							</p>
						) : inspectQ.data ? (
							<>
								{inspectQ.data.hasWorkersJson ? (
									<div className="rounded border border-amber-300 bg-amber-50 p-3 dark:border-amber-900/50 dark:bg-amber-950/30">
										<h3 className="text-xs font-semibold">Previously deployed</h3>
										<p className="mt-1 text-sm">
											This folder already has a <code>workers.json</code>
											{matchedOldWorker
												? <>
														{" "}— it's still deployed here as{" "}
														<span className="font-medium">{matchedOldWorker.name}</span>.
													</>
												: ", pointing at a worker not found in this workspace."}
										</p>
										{inspectQ.data.workersJson ? (
											<p className="mt-1 font-mono text-[10px] text-neutral-500">
												workerId: {inspectQ.data.workersJson.workerId}
											</p>
										) : null}
										<button
											type="button"
											onClick={() => cleanFiles.mutate(["workers.json"])}
											disabled={cleanFiles.isPending}
											className="mt-2 rounded border border-amber-400 px-3 py-1 text-sm hover:bg-amber-100 disabled:opacity-50 dark:border-amber-800 dark:hover:bg-amber-900/40"
										>
											{cleanFiles.isPending ? "Deleting…" : "Delete workers.json"}
										</button>
										<p className="mt-1 text-xs text-neutral-500">
											Required — a fresh deploy needs to create a new worker, not update this one.
										</p>
									</div>
								) : null}

								{blockedByWorkspaceDeps ? (
									<div className="rounded border border-red-300 bg-red-50 p-3 dark:border-red-900/50 dark:bg-red-950/30">
										<h3 className="text-xs font-semibold">This project needs a custom build</h3>
										<p className="mt-1 text-sm">
											<code>package.json</code> depends on <code>workspace:*</code> packages —
											the remote build sandbox runs plain <code>npm install</code>, which can't
											resolve those and will fail (this is what happened last time).
										</p>
										<p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">
											There's no <code>scripts.deploy</code> here to fall back to. Bundle and
											deploy this one outside this tool, then come back and use "Set local
											folder" to register the result here.
										</p>
									</div>
								) : null}

								{usePnpmDeploy ? (
									<div className="rounded border border-blue-300 bg-blue-50 p-3 dark:border-blue-900/50 dark:bg-blue-950/30">
										<h3 className="text-xs font-semibold">Will deploy with pnpm run deploy</h3>
										<p className="mt-1 text-sm">
											<code>package.json</code> defines its own <code>scripts.deploy</code> —
											probably because plain <code>ntn workers deploy</code> can't handle this
											project (e.g. <code>workspace:*</code> deps). This tool will run that
											script instead of a plain deploy.
										</p>
										<pre className="mt-2 overflow-x-auto rounded bg-neutral-900 p-2 font-mono text-[11px] text-neutral-100">
											{inspectQ.data.deployScript}
										</pre>
										<p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">
											If this folder was copied on disk rather than created through your
											package manager, its <code>node_modules</code> may be stale — a "Cannot
											find module" error means you likely need to run your package manager's
											install step (e.g. <code>pnpm install</code>) from the repo root first.
										</p>
										<p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">
											If this was copied from another worker, that script may have a worker
											name hardcoded in it — check it targets{" "}
											<span className="font-mono">{inspectQ.data.folderName}</span>, not the
											folder it was copied from, before continuing.
										</p>
										{packageNameBare ? (
											<p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">
												Detected current name in <code>package.json</code>:{" "}
												<span className="font-mono">{packageNameBare}</span>. The name field
												below will rename it (and update the argument in{" "}
												<code>scripts.deploy</code>, if found there) before running the script.
											</p>
										) : null}
										{willRename && !scriptContainsOldName ? (
											<p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
												⚠ "{packageNameBare}" doesn't appear in <code>scripts.deploy</code> —
												that part can't be auto-renamed. package.json's name will still be
												updated, but double-check the script itself targets the right project
												before continuing.
											</p>
										) : null}
										<label className="mt-2 flex items-center gap-2 text-xs">
											<input
												type="checkbox"
												checked={scriptAcknowledged}
												onChange={(e) => setScriptAcknowledged(e.target.checked)}
											/>
											I've checked this script targets the right folder.
										</label>
									</div>
								) : null}

								{inspectQ.data.hasEnvFile ? (
									<div className="rounded border border-neutral-200 p-3 dark:border-neutral-800">
										<h3 className="text-xs font-semibold">.env file</h3>
										<p className="mt-1 text-sm">
											This folder has a <code>.env</code> — it may hold secrets scoped to a
											previous deployment.
										</p>
										<button
											type="button"
											onClick={() => cleanFiles.mutate([".env"])}
											disabled={cleanFiles.isPending}
											className="mt-2 rounded border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
										>
											{cleanFiles.isPending ? "Deleting…" : "Delete .env"}
										</button>
										<p className="mt-1 text-xs text-neutral-500">
											Recommended, not required — env vars are pushed separately and this deploy
											won't read it.
										</p>
									</div>
								) : null}

								<div className="rounded border border-neutral-200 p-3 dark:border-neutral-800">
									<h3 className="text-xs font-semibold">
										{usePnpmDeploy ? "Worker name" : "Name for the new worker"}
									</h3>
									<input
										type="text"
										value={name}
										onChange={(e) => {
											setNameEdited(true);
											setName(e.target.value);
										}}
										autoComplete="off"
										spellCheck={false}
										disabled={submitting}
										className="mt-2 w-full rounded border border-neutral-300 bg-white px-2 py-1 font-mono text-xs disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900"
									/>
									{name && !nameValid ? (
										<p className="mt-1 text-xs text-red-600 dark:text-red-400">
											Name must contain only lowercase letters, numbers, and hyphens.
										</p>
									) : usePnpmDeploy && willRename ? (
										<p className="mt-1 text-xs text-neutral-500">
											Will rename from "{packageNameBare}" to "{normalized}" before deploying.
										</p>
									) : usePnpmDeploy ? (
										<p className="mt-1 text-xs text-neutral-500">
											Matches package.json already — no rename needed.
										</p>
									) : name && normalized !== name ? (
										<p className="mt-1 text-xs text-neutral-500">Will deploy as: {normalized}</p>
									) : null}
								</div>

								{deploy.error ? (
									<p className="text-xs text-red-600 dark:text-red-400">
										{(deploy.error as Error).message}
									</p>
								) : null}
								{pnpmDeploy.error ? (
									<p className="text-xs text-red-600 dark:text-red-400">
										{(pnpmDeploy.error as Error).message}
									</p>
								) : null}

								<div className="flex flex-col items-end gap-1">
									<button
										type="button"
										disabled={!canDeploy}
										onClick={() => {
											const confirmMsg = usePnpmDeploy
												? `Run pnpm run deploy in ${path}?${willRename ? `\nThis will first rename "${packageNameBare}" to "${normalized}" in package.json${scriptContainsOldName ? " and scripts.deploy" : ""}.` : ""}\nThis is your project's own deploy script — see above.`
												: `Deploy ${path} as a brand-new worker named "${normalized}" in ${whoami?.spaceName}?`;
											if (window.confirm(confirmMsg)) {
												if (usePnpmDeploy) pnpmDeploy.mutate(willRename ? normalized : undefined);
												else deploy.mutate();
											}
										}}
										title={blockedReason ?? undefined}
										className="rounded bg-neutral-900 px-3 py-1 text-sm text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
									>
										{submitting
											? "Deploying…"
											: usePnpmDeploy
												? "Deploy with pnpm run deploy"
												: "Deploy as new worker"}
									</button>
									{blockedReason ? (
										<p className="text-xs text-neutral-500">{blockedReason}</p>
									) : null}
								</div>
							</>
						) : null
					) : null}
				</div>
			</div>
		</div>
	);
}
