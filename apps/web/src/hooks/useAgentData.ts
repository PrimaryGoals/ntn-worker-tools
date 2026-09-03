import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import type { AgentsViewMode } from "./useUIState";

// Queries backing the Agents tab. Kept separate from useWorkerData because
// the two tabs are mutually exclusive contexts — nothing here depends on a
// selected worker, and each query is disabled until its own id is set.
export function useAgentData(
	selectedAgentId: string | null,
	selectedSessionId: string | null,
	agentsViewMode: AgentsViewMode,
	markerTime: string | null,
	agentsTabVisited: boolean,
) {
	const agentsQ = useQuery({
		queryKey: ["agents"],
		queryFn: () => api.getAgents(),
	});

	// Gated on the tab having been opened at least once — see agentsTabVisited.
	// Once latched it stays enabled, so the dots survive tab switches without
	// refetching.
	const agentHealthQ = useQuery({
		queryKey: ["agentHealth"],
		queryFn: () => api.getAgentHealth(),
		enabled: agentsTabVisited,
	});

	const agentInsightsQ = useQuery({
		queryKey: ["agentInsights", selectedAgentId],
		queryFn: () => api.getAgentInsights(selectedAgentId as string),
		enabled: !!selectedAgentId,
	});

	const agentSessionsQ = useQuery({
		queryKey: ["agentSessions", selectedAgentId],
		queryFn: () => api.getAgentSessions(selectedAgentId as string),
		enabled: !!selectedAgentId,
	});

	const sessionEventsQ = useQuery({
		queryKey: ["sessionEvents", selectedSessionId],
		queryFn: () => api.getSessionEvents(selectedSessionId as string),
		enabled: !!selectedSessionId,
	});

	// Cross-agent sessions need a marker to filter on; agent usage doesn't,
	// and with no window the API reports the current billing period.
	const crossAgentSessionsQ = useQuery({
		queryKey: ["crossAgentSessions", markerTime],
		queryFn: () => api.getCrossAgentSessions(markerTime as string),
		enabled: agentsViewMode === "crossAgent" && !!markerTime,
	});

	const agentUsageQ = useQuery({
		queryKey: ["agentUsage"],
		queryFn: () => api.getAgentUsage(),
		enabled: agentsViewMode === "usage",
	});

	return {
		agentsQ,
		agentHealthQ,
		agentInsightsQ,
		agentSessionsQ,
		sessionEventsQ,
		crossAgentSessionsQ,
		agentUsageQ,
	};
}
