import { defineConfig } from "vitest/config";
import { nxViteTsPaths } from "@nx/vite/plugins/nx-tsconfig-paths.plugin";
import { nxCopyAssetsPlugin } from "@nx/vite/plugins/nx-copy-assets.plugin";

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: "../../node_modules/.vite/libs/sources",
  plugins: [nxViteTsPaths(), nxCopyAssetsPlugin(["*.md"])],
  test: {
    name: "sources",
    watch: false,
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    passWithNoTests: true,
    reporters: ["default"],
    coverage: {
      reportsDirectory: "../../coverage/libs/sources",
      provider: "v8" as const,
    },
  },
}));
