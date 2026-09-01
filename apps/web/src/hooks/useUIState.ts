import { useState } from "react";

// Which source the Runs panel displays: the selected worker's own runs, an
// aggregate across all workers since the time marker, or (not yet built)
// per-worker usage.
export type RunsViewMode = "worker" | "crossWorker" | "usage";

// Which tab the left-hand panel shows. Workers and Agents are mutually
// exclusive contexts: selecting in one clears the other, so worker-scoped
// chrome (the Worker menu, the webhook line) goes inert while an agent is
// selected.
export type BrowserTab = "workers" | "agents";

// The Agents tab's counterpart to RunsViewMode: the selected agent's own
// sessions, every agent's sessions since the time marker, or per-agent usage.
export type AgentsViewMode = "agent" | "crossAgent" | "usage";

// Navigation selection, verbosity, and modal-visibility state shared across
// the whole app. Kept separate from query/mutation hooks since those depend
// on selectedWorkerId/verboseLogs but don't own them.
export function useUIState() {
	const [selectedWorkerId, setSelectedWorkerId] = useState<string | null>(null);
	const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
	const [verboseLogs, setVerboseLogs] = useState(false);
	const [folderPickerOpen, setFolderPickerOpen] = useState(false);
	const [tokenPushOpen, setTokenPushOpen] = useState(false);
	const [renameWorkerOpen, setRenameWorkerOpen] = useState(false);
	const [adjustTimeMarkerOpen, setAdjustTimeMarkerOpen] = useState(false);
	const [deployNewWorkerOpen, setDeployNewWorkerOpen] = useState(false);
	const [deployUpdatedWorkersOpen, setDeployUpdatedWorkersOpen] = useState(false);
	const [runsViewMode, setRunsViewMode] = useState<RunsViewMode>("worker");
	const [workerFilter, setWorkerFilter] = useState("");
	const [browserTab, setBrowserTab] = useState<BrowserTab>("workers");
	// Latches true the first time the Agents tab is opened, and never resets.
	// Agent health costs one sessions query per agent, so it isn't fetched at
	// all for a session that never leaves the Workers tab.
	const [agentsTabVisited, setAgentsTabVisited] = useState(false);
	const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
	const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
	const [agentsViewMode, setAgentsViewMode] = useState<AgentsViewMode>("agent");

	return {
		selectedWorkerId,
		setSelectedWorkerId,
		selectedRunId,
		setSelectedRunId,
		verboseLogs,
		setVerboseLogs,
		folderPickerOpen,
		setFolderPickerOpen,
		tokenPushOpen,
		setTokenPushOpen,
		renameWorkerOpen,
		setRenameWorkerOpen,
		adjustTimeMarkerOpen,
		setAdjustTimeMarkerOpen,
		deployNewWorkerOpen,
		setDeployNewWorkerOpen,
		deployUpdatedWorkersOpen,
		setDeployUpdatedWorkersOpen,
		runsViewMode,
		setRunsViewMode,
		workerFilter,
		setWorkerFilter,
		browserTab,
		setBrowserTab,
		agentsTabVisited,
		setAgentsTabVisited,
		selectedAgentId,
		setSelectedAgentId,
		selectedSessionId,
		setSelectedSessionId,
		agentsViewMode,
		setAgentsViewMode,
	};
}
