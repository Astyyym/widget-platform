import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    // Only the two source HTML entrypoints are scanned. Tauri embeds hundreds of
    // generated HTML files under src-tauri/target and task evidence directories.
    entries: [
      "index.html",
      "tests/fixtures/ui-shell.html",
      "!src-tauri/target/**",
      "!evidence/**",
    ],
  },
  server: {
    host: "127.0.0.1",
    port: 1430,
    strictPort: true,
    watch: {
      // Dependency scan exclusions do not constrain the filesystem watcher.
      // Keep source HMR, but skip historical evidence and Rust build output.
      ignored: ["**/evidence/**", "**/src-tauri/target/**"],
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
