import { expect, test } from "bun:test";
import { resolve } from "node:path";

function readPaths(extraEnv: Record<string, string | undefined>) {
  const result = Bun.spawnSync([
    process.execPath,
    "-e",
    `import { rootDir, dataDir } from ${JSON.stringify(resolve(import.meta.dir, "paths.ts"))}; console.log(JSON.stringify({ rootDir, dataDir }));`,
  ], {
    env: { ...process.env, ...extraEnv },
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(result.exitCode).toBe(0);
  return JSON.parse(new TextDecoder().decode(result.stdout)) as { rootDir: string; dataDir: string };
}

test("packaged resources and writable user data can live outside the executable directory", () => {
  const resources = "/tmp/RikkaHub Test.app/Contents/Resources";
  const data = "/tmp/RikkaHub User Data/pc-data";
  expect(readPaths({
    RIKKAHUB_RESOURCE_DIR: resources,
    RIKKAHUB_PC_DATA_DIR: data,
  })).toEqual({ rootDir: resources, dataDir: data });
});

test("source development keeps the repository-root fallback", () => {
  expect(readPaths({
    RIKKAHUB_RESOURCE_DIR: undefined,
    RIKKAHUB_PC_DATA_DIR: undefined,
  })).toEqual({
    rootDir: resolve(import.meta.dir, "../.."),
    dataDir: resolve(import.meta.dir, "../../pc-data"),
  });
});
