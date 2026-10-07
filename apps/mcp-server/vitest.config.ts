import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(import.meta.dirname, "migrations"));
  return {
    plugins: [
      cloudflareTest({
        main: "./src/index.ts",
        wrangler: { configPath: "./wrangler.test.jsonc" },
        miniflare: { d1Databases: ["DB"], bindings: { TEST_MIGRATIONS: migrations } },
      }),
    ],
    resolve: {
      alias: { "@scc/domain/geo": path.join(import.meta.dirname, "../../libs/domain/src/geo.ts") },
    },
    test: {
      name: "mcp-server",
      include: ["src/**/*.test.ts"],
      setupFiles: ["./src/test/apply-migrations.ts"],
    },
  };
});
