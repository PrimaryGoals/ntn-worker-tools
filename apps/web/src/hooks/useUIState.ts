import { useState } from "react";

// Navigation selection, verbosity, and modal-visibility state shared across
// the whole app. Kept separate from query/mutation hooks since those depend
// on selectedWorkerId/verboseLogs but don't own them.
export function useUIState() {
	const [selectedWorkerId, setSelectedWorkerId] = useState<string | null>(null);
	const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
	const [verboseLogs, setVerboseLogs] = useState(false);
	const [gitCheckinOpen, setGitCheckinOpen] = useState(false);
	const [folderPickerOpen, setFolderPickerOpen] = useState(false);
	const [tokenPushOpen, setTokenPushOpen] = useState(false);
	const [renameWorkerOpen, setRenameWorkerOpen] = useState(false);
	const [adjustTimeMarkerOpen, setAdjustTimeMarkerOpen] = useState(false);

	return {
		selectedWorkerId,
		setSelectedWorkerId,
		selectedRunId,
		setSelectedRunId,
		verboseLogs,
		setVerboseLogs,
		gitCheckinOpen,
		setGitCheckinOpen,
		folderPickerOpen,
		setFolderPickerOpen,
		tokenPushOpen,
		setTokenPushOpen,
		renameWorkerOpen,
		setRenameWorkerOpen,
		adjustTimeMarkerOpen,
		setAdjustTimeMarkerOpen,
	};
}
