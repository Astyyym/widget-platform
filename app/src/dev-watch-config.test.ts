import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createServer } from "vite";
import { expect, it } from "vitest";

it("watches source and fixtures without watching generated evidence or Rust output", async () => {
  // The synthetic project itself must not live beneath an ignored evidence tree.
  const scratch = process.env.TMPDIR ?? resolve("tests/fixtures/.dev-watch-tests");
  await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(join(scratch, "widget-dev-watch-"));
  const directories = ["src", "tests/fixtures", "src-tauri/src", "evidence/run/dist", "src-tauri/target/debug"];
  for (const directory of directories) {
    await mkdir(join(root, directory), { recursive: true });
    await writeFile(join(root, directory, "synthetic.txt"), "dev-watch fixture");
  }
  const server = await createServer({
    configFile: resolve("vite.config.ts"),
    root,
    envDir: false,
    cacheDir: join(root, "node_modules/.vite"),
    optimizeDeps: { entries: [] },
    server: { middlewareMode: true },
  });
  try {
    const watched = () => Object.keys(server.watcher.getWatched()).map((directory) => directory.replaceAll("\\", "/"));
    const normalized = root.replaceAll("\\", "/");
    await expect.poll(() => watched(), { timeout: 3000 }).toContain(`${normalized}/src-tauri/src`);
    expect(watched()).toContain(`${normalized}/src`);
    expect(watched()).toContain(`${normalized}/tests/fixtures`);
    expect(watched().some((directory) => directory.startsWith(`${normalized}/evidence`))).toBe(false);
    expect(watched().some((directory) => directory.startsWith(`${normalized}/src-tauri/target`))).toBe(false);
  } finally {
    await server.close();
    // Windows can retire Vite optimizer output asynchronously after close.
    // Retry only removal of this test-owned fixture; retain every assertion.
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}, 10000);
