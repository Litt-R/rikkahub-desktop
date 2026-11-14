import { expect, test } from "bun:test";
import { resolve } from "node:path";

function macosFamilies(stdout: string, exitCode = 0) {
  const result = Bun.spawnSync([process.execPath, "-e", `
    Object.defineProperty(process, "platform", { value: "darwin" });
    const calls = [];
    Bun.spawnSync = (args) => {
      calls.push(args);
      return { exitCode: ${exitCode}, stdout: Buffer.from(${JSON.stringify(stdout)}) };
    };
    const fonts = await import(${JSON.stringify(resolve(import.meta.dir, "fonts.ts"))});
    const entries = fonts.listSystemFonts(new Set(["arial"]));
    const cached = fonts.listSystemFonts(new Set());
    console.log(JSON.stringify({ names: entries.map(f => f.cssName), calls }));
  `], { stdout: "pipe", stderr: "pipe", timeout: 15000 });
  expect(result.exitCode, result.stderr.toString()).toBe(0);
  return JSON.parse(result.stdout.toString()) as { names: string[]; calls: string[][] };
}

test("macOS enumerates AppKit families, caches and excludes hidden/duplicate/bundled names", () => {
  const result = macosFamilies(JSON.stringify(["Menlo", "Arial", "Menlo", ".Hidden", "苹方", ""]));
  expect(result.names).toEqual(["Menlo", "苹方"]);
  expect(result.calls).toHaveLength(1);
  expect(result.calls[0].slice(0, 4)).toEqual(["/usr/bin/osascript", "-l", "JavaScript", "-e"]);
});

for (const [output, code] of [["[]", 0], ["not JSON", 0], ['["Ignored"]', 1]] as const) {
  test(`font enumeration failure returns macOS fallbacks (${output}, ${code})`, () => {
    const result = macosFamilies(output, code);
    expect(result.names).toContain("PingFang SC");
    expect(result.names).toContain("Menlo");
    expect(result.names).not.toContain("Arial");
    expect(result.names).not.toContain("Microsoft YaHei");
    expect(result.names).not.toContain("Ignored");
    expect(result.calls).toHaveLength(2); // failed enumeration is retryable
  });
}
