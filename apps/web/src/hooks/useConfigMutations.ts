import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { api } from "../api";

export function useConfigMutations(
	setFolderPickerOpen: (open: boolean) => void,
	persistedPanelSizes: Record<string, number>,
) {
	const qc = useQueryClient();

	// Recording which workspace a branch belongs to. Config-only: the banner
	// derives from it, and nothing needs rescanning because the folders on disk
	// have not changed.
	const setBranchWorkspace = useMutation({
		mutationFn: ({
			repoRoot,
			branch,
			workspaceId,
		}: {
			repoRoot: string;
			branch: string;
			workspaceId: string;
		}) => api.setBranchWorkspace(repoRoot, branch, workspaceId),
		onSuccess: (config) => qc.setQueryData(["config"], config),
	});
	const clearBranchWorkspace = useMutation({
		mutationFn: ({ repoRoot, branch }: { repoRoot: string; branch: string }) =>
			api.clearBranchWorkspace(repoRoot, branch),
		onSuccess: (config) => qc.setQueryData(["config"], config),
	});
	// Hiding a folder the scan finds but that is not a worker to act on. The
	// scan reads ignoredFolders, so invalidating it is what makes the row go.
	const ignoreFolder = useMutation({
		mutationFn: (path: string) => api.ignoreFolder(path),
		onSuccess: (config) => {
			qc.setQueryData(["config"], config);
			qc.invalidateQueries({ queryKey: ["scan"] });
		},
	});
	const unignoreFolder = useMutation({
		mutationFn: (path: string) => api.unignoreFolder(path),
		onSuccess: (config) => {
			qc.setQueryData(["config"], config);
			qc.invalidateQueries({ queryKey: ["scan"] });
		},
	});
	// Choosing the scan root is what "Set local folder…" now does. It needs no
	// selected worker, so unlike setLocalPath there is no id to check against,
	// and there is one root, so this replaces rather than appends.
	const setScanRoot = useMutation({
		mutationFn: (path: string) => api.setScanRoot(path),
		onSuccess: (config) => {
			qc.setQueryData(["config"], config);
			qc.invalidateQueries({ queryKey: ["scan"] });
			setFolderPickerOpen(false);
		},
	});
	const removeExtraWorkerFolder = useMutation({
		mutationFn: (path: string) => api.removeExtraWorkerFolder(path),
		onSuccess: (config) => {
			qc.setQueryData(["config"], config);
			qc.invalidateQueries({ queryKey: ["scan"] });
		},
	});
	// Reveals any directory, not just a registered worker folder - the header
	// uses it to open the repository a worker lives in.
	const revealPath = useMutation({
		mutationFn: (path: string) => api.revealPath(path),
		onError: (err) => window.alert(`Reveal failed: ${(err as Error).message}`),
	});
	const revealWorker = useMutation({
		mutationFn: api.revealWorker,
		onError: (err) => window.alert(`Reveal failed: ${(err as Error).message}`),
	});
	const markTime = useMutation({
		mutationFn: (time?: string) => api.markTime(time),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["config"] });
			// Marker is global — refresh runs for every worker, not just the selected one.
			qc.invalidateQueries({ queryKey: ["runs"] });
		},
	});
	const clearTimeMarker = useMutation({
		mutationFn: () => api.clearTimeMarker(),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["config"] });
			qc.invalidateQueries({ queryKey: ["runs"] });
		},
	});
	const renameWorker = useMutation({
		mutationFn: ({ workerId, newName }: { workerId: string; newName: string }) =>
			api.renameWorker(workerId, newName),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["config"] });
			qc.invalidateQueries({ queryKey: ["workers"] });
		},
	});
	const savePanelSize = useMutation({
		mutationFn: (patch: Record<string, number>) =>
			api.updateUiConfig({ panelSizes: { ...persistedPanelSizes, ...patch } }),
		onSuccess: (config) => qc.setQueryData(["config"], config),
	});
	// Debounce onLayout — the library fires it many times per drag frame,
	// and each fire round-trips through the config-file writer on the server.
	const schedulePanelSave = useMemo(() => {
		let timer: ReturnType<typeof setTimeout> | null = null;
		let pending: Record<string, number> = {};
		return (patch: Record<string, number>) => {
			pending = { ...pending, ...patch };
			if (timer) clearTimeout(timer);
			timer = setTimeout(() => {
				savePanelSize.mutate(pending);
				pending = {};
			}, 250);
		};
		// savePanelSize.mutate is a stable reference from useMutation, so we can
		// safely close over the outer savePanelSize handle without a dep.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	return {
		setBranchWorkspace,
		clearBranchWorkspace,
		ignoreFolder,
		unignoreFolder,
		setScanRoot,
		removeExtraWorkerFolder,
		revealWorker,
		revealPath,
		renameWorker,
		markTime,
		clearTimeMarker,
		savePanelSize,
		schedulePanelSave,
	};
}
