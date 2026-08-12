import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { api } from "../api";

export function useConfigMutations(
	setFolderPickerOpen: (open: boolean) => void,
	persistedPanelSizes: Record<string, number>,
) {
	const qc = useQueryClient();

	const setLocalPath = useMutation({
		mutationFn: ({ workerId, path }: { workerId: string; path: string }) =>
			api.setWorkerLocalPath(workerId, path),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["config"] });
			// Only close the folder picker after the workerId-match check server-side
			// has accepted the path. On failure (e.g. worker mismatch) it stays open
			// so the user sees the inline error and can navigate somewhere else.
			setFolderPickerOpen(false);
		},
	});
	const clearLocalPath = useMutation({
		mutationFn: (workerId: string) => api.clearWorkerLocalPath(workerId),
		onSuccess: () => qc.invalidateQueries({ queryKey: ["config"] }),
	});
	const revealWorker = useMutation({
		mutationFn: api.revealWorker,
		onError: (err) => window.alert(`Reveal failed: ${(err as Error).message}`),
	});
	const markTime = useMutation({
		mutationFn: () => api.markTime(),
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
		setLocalPath,
		clearLocalPath,
		revealWorker,
		renameWorker,
		markTime,
		clearTimeMarker,
		savePanelSize,
		schedulePanelSave,
	};
}
