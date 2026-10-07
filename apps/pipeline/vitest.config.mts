import { defineConfig } from "vitest/config";
import { nxViteTsPaths } from "@nx/vite/plugins/nx-tsconfig-paths.plugin";
import { nxCopyAssetsPlugin } from "@nx/vite/plugins/nx-copy-assets.plugin";

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: "../../node_modules/.vite/apps/pipeline",
  plugins: [nxViteTsPaths(), nxCopyAssetsPlugin(["*.md"])],
  test: {
    name: "pipeline",
    watch: false,
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    passWithNoTests: true,
    reporters: ["default"],
    coverage: {
      reportsDirectory: "../../coverage/apps/pipeline",
      provider: "v8" as const,
    },
  },
}));
