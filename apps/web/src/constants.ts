// Redirect page on primarygoals.com that all branding/help links point to.
export const PRIMARY_GOALS_URL = "https://PrimaryGoals.com/ntn/";

// Notion agent pages live at /agent/<id with the dashes stripped>, e.g.
// 3cda3753-9f7f-801e-bcd4-009246083b5e -> /agent/3cda37539f7f801ebcd4009246083b5e.
// The public API returns no URL for an agent (unlike the MCP surface, which
// returns a non-clickable `agent://<workspace>/<id>`), so this is built from
// the id.
//
// `wfv` selects which view of the agent opens. Without it Notion falls back to
// `wfv=chat`, which lands on the conversation rather than the definition;
// `wfv=settings` opens the agent and its settings, which is what we want here.
// Notion's own Settings link also appends `p=<same id>&pm=s`, but those are
// redundant — it re-adds them itself when the short form loads.
export function agentDefinitionUrl(agentId: string): string {
	return `https://app.notion.com/agent/${agentId.replace(/-/g, "")}?wfv=settings`;
}
