import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@dominio": fileURLToPath(new URL("./supabase/functions/api/dominio", import.meta.url)) },
  },
  server: { port: 5173 },
  test: {
    environment: "node",
    include: ["testes/**/*.test.{ts,tsx}"],
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});
