// Local Apple Silicon builds; retain the Windows/Linux scripts unchanged.
import { mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin" || process.arch !== "arm64") {
  throw new Error("macos:dev / macos:build currently require an Apple Silicon Mac.");
}

const mode = process.argv[2];
if (mode !== "dev" && mode !== "build") {
  throw new Error("Usage: bun run scripts/macos.ts dev|build");
}

const webDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const serverDir = resolve(webDir, "../pc-server");
const binariesDir = join(webDir, "src-tauri/binaries");
const env = {
  ...process.env,
  // Support the minimal user-local installs without editing the user's shell.
  PATH: [dirname(process.execPath), process.env.PATH, join(homedir(), ".cargo/bin"), join(homedir(), ".local/bin")]
    .filter(Boolean)
    .join(delimiter),
  // Avoid several GB of debug symbols and incremental artifacts on small SSDs.
  CARGO_PROFILE_DEV_DEBUG: process.env.CARGO_PROFILE_DEV_DEBUG ?? "0",
  CARGO_INCREMENTAL: process.env.CARGO_INCREMENTAL ?? "0",
  CARGO_BUILD_JOBS: process.env.CARGO_BUILD_JOBS ?? "2",
  // tauri-build 2.6.2 derives the resource/sidecar directory from the legacy
  // OUT_DIR layout. Cargo 1.100's new default puts those files one level too deep.
  __CARGO_TEMPORARY_BUILD_DIR_NEW_LAYOUT_OPT_OUT: process.env.__CARGO_TEMPORARY_BUILD_DIR_NEW_LAYOUT_OPT_OUT ?? "1",
};

async function run(args: string[], cwd: string) {
  const child = spawn(args[0], args.slice(1), { cwd, env, stdio: "inherit", detached: true });
  const interrupt = () => {
    // Stop the whole Tauri/Cargo/app group, including a failed startup dialog.
    if (child.pid !== undefined) {
      try {
        process.kill(-child.pid, "SIGINT");
      } catch {
        // The child may already have exited.
      }
    }
  };
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  const code = await new Promise<number>((resolveCode, reject) => {
    child.once("error", reject);
    child.once("exit", (exitCode) => resolveCode(exitCode ?? 1));
  });
  process.off("SIGINT", interrupt);
  process.off("SIGTERM", interrupt);
  if (code !== 0) process.exit(code);
}

mkdirSync(binariesDir, { recursive: true });
await run(
  [
    process.execPath,
    "build",
    "--compile",
    "--target=bun-darwin-arm64",
    "--define",
    'process.platform="darwin"',
    "server.ts",
    "--outfile",
    join(binariesDir, "rikkahub-server-aarch64-apple-darwin"),
  ],
  serverDir,
);

await run(
  [
    process.execPath,
    "run",
    "tauri",
    mode,
    // The backend is started by the Rust shell. Waiting for its URL before
    // starting that shell would deadlock a clean development launch.
    ...(mode === "build" ? ["--bundles", "app"] : ["--no-dev-server-wait"]),
  ],
  webDir,
);
