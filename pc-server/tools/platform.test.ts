import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

// Replace OS commands only in a child process. Never read/write the real
// clipboard or play audio, and don't leak mocks into other test modules.
function isolated(platform: string, script: string): Record<string, any> {
  const result = Bun.spawnSync([process.execPath, "-e", `
    import { writeFileSync, existsSync } from "node:fs";
    Object.defineProperty(process, "platform", { value: ${JSON.stringify(platform)} });
    const calls = [];
    let exitCode = 0;
    let stdout = "";
    Bun.spawn = (args, options) => {
      const call = { args, input: "", locale: options?.env?.LC_CTYPE };
      calls.push(call);
      return {
        stdin: {
          write(text) { call.input += text; },
          end() {
            const outputIndex = args.indexOf("-o");
            if (outputIndex >= 0 && exitCode === 0)
              writeFileSync(args[outputIndex + 1], Buffer.from("RIFFtestWAVE"));
          },
        },
        stdout: new Blob([stdout]).stream(),
        stderr: new Blob([exitCode ? "OS command failed" : ""]).stream(),
        exited: Promise.resolve(exitCode),
        kill() {},
      };
    };
    const tools = await import(${JSON.stringify(resolve(import.meta.dir, "platform.ts"))});
    ${script}
  `], { stdout: "pipe", stderr: "pipe", timeout: 15000 });
  expect(result.exitCode, result.stderr.toString()).toBe(0);
  return JSON.parse(result.stdout.toString().trim());
}

describe("native platform tools", () => {
  test("macOS clipboard preserves Unicode, whitespace and sends input through stdin", () => {
    const result = isolated("darwin", `
      const text = "  中文 👋\\n\\n";
      stdout = text;
      const read = await tools.readSystemClipboardText();
      await tools.writeSystemClipboardText(text);
      console.log(JSON.stringify({ read, text, calls }));
    `);
    expect(result.read).toBe(result.text);
    expect(result.calls.map((call: any) => call.args)).toEqual([
      ["/usr/bin/pbpaste", "-Prefer", "txt"], ["/usr/bin/pbcopy"],
    ]);
    expect(result.calls[1].input).toBe(result.text);
    expect(result.calls[1].locale).toBe("UTF-8");
  });

  test("macOS clipboard failures propagate instead of reporting false success", () => {
    const result = isolated("darwin", `
      exitCode = 1;
      const errors = [];
      for (const op of [() => tools.readSystemClipboardText(), () => tools.writeSystemClipboardText("test")]) {
        try { await op(); } catch (err) { errors.push(err.message); }
      }
      console.log(JSON.stringify({ errors }));
    `);
    expect(result.errors).toEqual(["OS command failed", "OS command failed"]);
  });

  test("macOS TTS uses say, generates WAV and removes its temporary file", () => {
    const result = isolated("darwin", `
      const text = "-n $(do-not-execute) 中文";
      await tools.speakSystemText(text, 100);
      const audio = await tools.synthesizeSystemTtsToWav(text, NaN);
      const file = calls[1].args[calls[1].args.indexOf("-o") + 1];
      console.log(JSON.stringify({ calls, audio: audio.toString(), fileExists: existsSync(file) }));
    `);
    expect(result.calls[0].args).toEqual(["/usr/bin/say", "-f", "-", "-r", "450"]);
    expect(result.calls[1].args).toEqual([
      "/usr/bin/say", "-f", "-", "-r", "175", "-o", expect.any(String),
      "--file-format=WAVE", "--data-format=LEI16@22050",
    ]);
    expect(result.calls[1].input).toBe("-n $(do-not-execute) 中文");
    expect(result.audio).toBe("RIFFtestWAVE");
    expect(result.fileExists).toBe(false);
  });

  test("a failed macOS synthesis rejects and releases the serialization lock", () => {
    const result = isolated("darwin", `
      exitCode = 1;
      let error;
      try { await tools.synthesizeSystemTtsToWav("test"); } catch (err) { error = err.message; }
      exitCode = 0;
      await tools.speakSystemText("next");
      console.log(JSON.stringify({ error, calls: calls.length }));
    `);
    expect(result).toEqual({ error: "OS command failed", calls: 2 });
  });

  test("Windows still uses PowerShell and System.Speech", () => {
    const result = isolated("win32", `
      await tools.writeSystemClipboardText("test");
      await tools.speakSystemText("test");
      console.log(JSON.stringify({ calls }));
    `);
    expect(result.calls.map((call: any) => call.args[0])).toEqual(["powershell.exe", "powershell.exe"]);
    expect(result.calls[0].args.at(-1)).toContain("Set-Clipboard");
    expect(result.calls[1].args.at(-1)).toContain("System.Speech");
  });

  test("macOS cancel terminates the active say process and releases its handle", () => {
    const result = isolated("darwin", `
      let finish;
      let killed = 0;
      let started;
      const spawned = new Promise(resolve => { started = resolve; });
      Bun.spawn = () => {
        started();
        return {
        stdin: { write() {}, end() {} },
        stdout: new Blob([]).stream(),
        stderr: new Blob([]).stream(),
        exited: new Promise(resolve => { finish = resolve; }),
        kill() { killed++; finish(143); },
        };
      };
      const speech = tools.speakSystemText("test").catch(err => err.message);
      await spawned;
      tools.cancelAllSystemTts();
      const error = await speech;
      tools.cancelAllSystemTts();
      console.log(JSON.stringify({ killed, error }));
    `);
    expect(result.killed).toBe(1);
    expect(result.error).toContain("exited with code 143");
  });

  test("Linux system TTS still uses espeak-ng", () => {
    const result = isolated("linux", `
      await tools.speakSystemText("test");
      console.log(JSON.stringify({ calls }));
    `);
    expect(result.calls[0].args).toEqual(["espeak-ng", "--stdin", "-s", "175"]);
  });
});
