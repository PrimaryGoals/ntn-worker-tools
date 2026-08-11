import type { FastifyInstance } from "fastify";
import { SESSION_COOKIE_NAME, tokenMatches } from "../session.js";

// The auth preHandler hook stays in index.ts's bootstrap sequence rather than
// here: Fastify hooks registered inside a plugin are encapsulated to that
// plugin's routes only, and this guard needs to apply globally across every
// route module.
export default async function sessionRoutes(app: FastifyInstance, opts: { sessionToken: string }) {
	const { sessionToken } = opts;

	app.get("/api/health", async () => ({ ok: true }));

	app.get("/api/session/status", async (req) => ({
		authenticated: tokenMatches(req.cookies[SESSION_COOKIE_NAME], sessionToken),
	}));

	app.post<{ Body: { token?: string } }>(
		"/api/session/login",
		async (req, reply): Promise<{ ok: true }> => {
			if (!tokenMatches(req.body?.token, sessionToken)) {
				return reply.code(401).send({ error: "invalid token" }) as unknown as { ok: true };
			}
			reply.setCookie(SESSION_COOKIE_NAME, sessionToken, {
				path: "/",
				httpOnly: true,
				sameSite: "lax",
				// One-year cookie; the token is stable across server restarts so
				// bookmarks stay valid indefinitely unless the user clears cookies
				// or rotates the token by deleting the session-token file.
				maxAge: 60 * 60 * 24 * 365,
			});
			return { ok: true };
		},
	);

	app.post("/api/session/logout", async (_req, reply) => {
		reply.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
		return { ok: true };
	});
}
