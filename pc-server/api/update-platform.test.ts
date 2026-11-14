import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

test("macOS update checks cannot enter the Windows/Linux installer flow", () => {
  const dir = mkdtempSync(resolve(tmpdir(), "rkh-mac-update-"));
  try {
    const result = Bun.spawnSync([process.execPath, "-e", `
      import { mock } from "bun:test";
      const platformPath = ${JSON.stringify(resolve(import.meta.dir, "../foundation/platform.ts"))};
      const updatesPath = ${JSON.stringify(resolve(import.meta.dir, "../updates/index.ts"))};
      const platform = await import(platformPath);
      const updates = await import(updatesPath);
      mock.module(platformPath, () => ({ ...platform, RUNTIME_PLATFORM: "mac", RUNNING_IN_CONTAINER: false }));
      mock.module(updatesPath, () => ({
        ...updates,
        fetchLatestReleaseFromHtmlRedirect: async () => ({ tag: "99.0.0", htmlUrl: "https://github.com/example/releases" }),
        fetchGithubLatestRelease: async () => ({
          tag_name: "v99.0.0", assets: [
            { name: "app.dmg", browser_download_url: "https://github.com/example/app.dmg" },
            { name: "app.exe", browser_download_url: "https://github.com/example/app.exe" },
            { name: "app_linux_x64.tar.gz", browser_download_url: "https://github.com/example/app_linux_x64.tar.gz" },
          ],
        }),
      }));
      const { handleUpdateRoutes } = await import(${JSON.stringify(resolve(import.meta.dir, "handlers/update.ts"))});
      const url = new URL("http://localhost/api/update/check");
      const check = await handleUpdateRoutes(new Request(url), url, "update/check");
      const download = await handleUpdateRoutes(new Request(url, { method: "POST" }), url, "update/download");
      const apply = await handleUpdateRoutes(new Request(url, { method: "POST" }), url, "update/apply");
      console.log(JSON.stringify({ check: await check.json(), download: download.status, apply: apply.status }));
    `], {
      env: { ...process.env, RIKKAHUB_PC_DATA_DIR: dir, RIKKAHUB_ANALYTICS: "0" },
      stdout: "pipe", stderr: "pipe", timeout: 15000,
    });
    expect(result.exitCode, result.stderr.toString()).toBe(0);
    const parsed = JSON.parse(result.stdout.toString());
    expect(parsed.check.platform).toBe("mac");
    expect(parsed.check.downloadUrl).toBe("");
    expect(parsed.check.fileName).toBe("");
    expect(parsed.download).toBe(400);
    expect(parsed.apply).toBe(400);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
