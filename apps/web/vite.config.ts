import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [react()],
	resolve: {
		alias: {
			"@": fileURLToPath(new URL("./src", import.meta.url)),
		},
	},
	server: {
		port: 5173,
		// Fail instead of silently moving to another port — the server prints
		// a sign-in URL hardcoded to :5173, which would be wrong if Vite drifted.
		strictPort: true,
		proxy: {
			"/api": "http://127.0.0.1:5174",
		},
	},
});
