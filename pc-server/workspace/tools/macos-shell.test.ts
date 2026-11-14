import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("macOS GUI child processes find conventional tools without changing global PATH", () => {
  const result = Bun.spawnSync([process.execPath, "-e", `
    import { mock } from "bun:test";
    import { homedir } from "node:os";
    import { join } from "node:path";
    const fs = await import("node:fs");
    const bunBin = join(homedir(), ".bun/bin");
    const localBin = join(homedir(), ".local/bin");
    mock.module("node:fs", () => ({
      ...fs,
      existsSync: p => ["/opt/homebrew/bin", bunBin, localBin].includes(p),
    }));
    Object.defineProperty(process, "platform", { value: "darwin" });
    process.env.PATH = "/custom/tools:/usr/bin:/bin:/opt/homebrew/bin";
    const before = process.env.PATH;
    const { getShellEnv } = await import(${JSON.stringify(resolve(import.meta.dir, "shell.ts"))});
    const env = getShellEnv();
    console.log(JSON.stringify({ path: env.PATH, before, unchanged: process.env.PATH === before, bunBin, localBin }));
  `], { stdout: "pipe", stderr: "pipe", timeout: 15000 });
  expect(result.exitCode, result.stderr.toString()).toBe(0);
  const data = JSON.parse(result.stdout.toString());
  expect(data.unchanged).toBe(true);
  expect(data.path.split(":")).toEqual([
    "/custom/tools", "/usr/bin", "/bin", "/opt/homebrew/bin", data.localBin, data.bunBin,
  ]);
});
