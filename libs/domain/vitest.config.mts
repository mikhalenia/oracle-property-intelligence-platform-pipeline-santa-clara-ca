import { defineConfig } from "vitest/config";
import { nxViteTsPaths } from "@nx/vite/plugins/nx-tsconfig-paths.plugin";
import { nxCopyAssetsPlugin } from "@nx/vite/plugins/nx-copy-assets.plugin";

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: "../../node_modules/.vite/libs/domain",
  plugins: [nxViteTsPaths(), nxCopyAssetsPlugin(["*.md"])],
  test: {
    name: "domain",
    watch: false,
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    passWithNoTests: true,
    reporters: ["default"],
    coverage: {
      reportsDirectory: "../../coverage/libs/domain",
      provider: "v8" as const,
    },
  },
}));
