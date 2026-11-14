import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { parseMacosProxySettings } from "./macos-proxy";

function settings(body: string): string {
  return `<dictionary> {\n${body}\n}`;
}

describe("macOS system proxy settings", () => {
  test("reads the enabled HTTP proxy", () => {
    expect(parseMacosProxySettings(settings(`
      HTTPEnable : 1
      HTTPProxy : 127.0.0.1
      HTTPPort : 7897
    `))).toEqual({ proxy: "http://127.0.0.1:7897", pacUrl: undefined });
  });

  test("prefers the HTTPS destination proxy and uses HTTP CONNECT", () => {
    expect(parseMacosProxySettings(settings(`
      HTTPEnable : 1
      HTTPProxy : 127.0.0.1
      HTTPPort : 7897
      HTTPSEnable : 1
      HTTPSProxy : localhost
      HTTPSPort : 7898
    `)).proxy).toBe("http://localhost:7898");
  });

  test("ignores disabled proxy entries and SOCKS-only configurations", () => {
    expect(parseMacosProxySettings(settings(`
      HTTPEnable : 0
      HTTPProxy : 127.0.0.1
      HTTPPort : 7897
      SOCKSEnable : 1
      SOCKSProxy : 127.0.0.1
      SOCKSPort : 7897
    `)).proxy).toBeUndefined();
  });

  test("falls back to HTTP if the HTTPS entry is invalid", () => {
    expect(parseMacosProxySettings(settings(`
      HTTPEnable : 1
      HTTPProxy : 127.0.0.1
      HTTPPort : 7897
      HTTPSEnable : 1
      HTTPSProxy : localhost
      HTTPSPort : 0
    `)).proxy).toBe("http://127.0.0.1:7897");
  });

  for (const port of ["0", "-1", "65536", "7897.5", "invalid", ""]) {
    test(`rejects an invalid port: ${JSON.stringify(port)}`, () => {
      expect(parseMacosProxySettings(settings(`
        HTTPEnable : 1
        HTTPProxy : 127.0.0.1
        HTTPPort : ${port}
      `)).proxy).toBeUndefined();
    });
  }

  for (const host of ["", "host/path", "user@host", "host with spaces", "host:7897"]) {
    test(`rejects an invalid host: ${JSON.stringify(host)}`, () => {
      expect(parseMacosProxySettings(settings(`
        HTTPEnable : 1
        HTTPProxy : ${host}
        HTTPPort : 7897
      `)).proxy).toBeUndefined();
    });
  }

  test("supports IPv6 proxy endpoints", () => {
    expect(parseMacosProxySettings(settings(`
      HTTPEnable : 1
      HTTPProxy : ::1
      HTTPPort : 7897
    `)).proxy).toBe("http://[::1]:7897");
  });

  test("does not use a proxy belonging only to a scoped interface", () => {
    expect(parseMacosProxySettings(settings(`
      __SCOPED__ : <dictionary> {
        en0 : <dictionary> {
          HTTPEnable : 1
          HTTPProxy : 127.0.0.1
          HTTPPort : 7897
        }
      }
    `)).proxy).toBeUndefined();
  });

  test("preserves the global entry across nested arrays and dictionaries", () => {
    expect(parseMacosProxySettings(settings(`
      ExceptionsList : <array> {
        0 : *.local
      }
      HTTPEnable : 1
      HTTPProxy : 127.0.0.1
      HTTPPort : 7897
      __SCOPED__ : <dictionary> {
        en0 : <dictionary> {
          HTTPEnable : 1
          HTTPProxy : other.invalid
          HTTPPort : 8080
        }
      }
    `)).proxy).toBe("http://127.0.0.1:7897");
  });

  test("reports an enabled PAC for the existing diagnostic UI", () => {
    expect(parseMacosProxySettings(settings(`
      ProxyAutoConfigEnable : 1
      ProxyAutoConfigURLString : http://127.0.0.1:7897/proxy.pac
    `))).toEqual({ proxy: undefined, pacUrl: "http://127.0.0.1:7897/proxy.pac" });
  });

  test("ignores disabled PAC and reports automatic discovery", () => {
    expect(parseMacosProxySettings(settings(`
      ProxyAutoConfigEnable : 0
      ProxyAutoConfigURLString : http://127.0.0.1:7897/proxy.pac
    `)).pacUrl).toBeUndefined();
    expect(parseMacosProxySettings(settings("ProxyAutoDiscoveryEnable : 1")).pacUrl).toBe("wpad");
  });

  test("handles empty and malformed command output", () => {
    expect(parseMacosProxySettings("")).toEqual({ proxy: undefined, pacUrl: undefined });
    expect(parseMacosProxySettings("HTTPEnable : 1\nHTTPProxy : host\nHTTPPort : 7897").proxy)
      .toBeUndefined();
  });
});

// 模块替身只装在子进程内，不污染其他测试的运行平台或真实系统代理。
function isolated(script: string) {
  const platformPath = resolve(import.meta.dir, "platform.ts");
  const macosPath = resolve(import.meta.dir, "macos-proxy.ts");
  const result = Bun.spawnSync([process.execPath, "-e", `
    import { mock } from "bun:test";
    const platform = await import(${JSON.stringify(platformPath)});
    const macos = await import(${JSON.stringify(macosPath)});
    mock.module(${JSON.stringify(platformPath)}, () => ({
      ...platform, RUNTIME_PLATFORM: "mac", RUNNING_IN_CONTAINER: false,
    }));
    ${script}
  `], {
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 15000,
  });
  expect(result.exitCode, result.stderr.toString()).toBe(0);
  return JSON.parse(result.stdout.toString().trim()) as Record<string, unknown>;
}

test("macOS detection, PAC diagnostics and auto mode use the same system reader", () => {
  const result = isolated(`
    mock.module(${JSON.stringify(resolve(import.meta.dir, "macos-proxy.ts"))}, () => ({
      ...macos,
      readMacosProxySettings: async () => ({
        proxy: "http://127.0.0.1:7897",
        pacUrl: "http://127.0.0.1:7897/proxy.pac",
      }),
    }));
    const net = await import(${JSON.stringify(resolve(import.meta.dir, "net.ts"))});
    await net.primeSystemProxyCache();
    console.log(JSON.stringify({
      detected: await net.detectSystemProxy() ?? null,
      pac: await net.detectSystemPacUrl() ?? null,
      active: net.resolveEffectiveProxy(net.normalizeProxyConfig({ mode: "auto" })),
    }));
  `);
  expect(result).toEqual({
    detected: "http://127.0.0.1:7897",
    pac: "http://127.0.0.1:7897/proxy.pac",
    active: { url: "http://127.0.0.1:7897", source: "system" },
  });
});

test("auto mode sends requests through the detected proxy and direct mode still bypasses it", () => {
  const result = isolated(`
    const seen = [];
    const proxy = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) { seen.push(request.url); return new Response("via-system-proxy"); },
    });
    const origin = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch() { return new Response("direct"); },
    });
    try {
      mock.module(${JSON.stringify(resolve(import.meta.dir, "macos-proxy.ts"))}, () => ({
        ...macos,
        readMacosProxySettings: async () => ({
          proxy: "http://127.0.0.1:" + proxy.port, pacUrl: undefined,
        }),
      }));
      const net = await import(${JSON.stringify(resolve(import.meta.dir, "net.ts"))});
      let config = net.normalizeProxyConfig({ mode: "auto" });
      net.installProxyFetchInterceptor(() => config);
      await net.primeSystemProxyCache();
      const proxied = await fetch("http://macos-proxy-probe.invalid/probe", {
        signal: AbortSignal.timeout(3000),
      });
      const proxiedBody = await proxied.text();
      const local = await fetch("http://127.0.0.1:" + origin.port);
      config = net.normalizeProxyConfig({ mode: "direct" });
      const direct = await fetch("http://127.0.0.1:" + origin.port);
      console.log(JSON.stringify({
        proxiedBody, seen, localBody: await local.text(), directBody: await direct.text(),
      }));
    } finally {
      proxy.stop(true);
      origin.stop(true);
    }
  `);
  expect(result).toEqual({
    proxiedBody: "via-system-proxy",
    seen: ["http://macos-proxy-probe.invalid/probe"],
    localBody: "direct",
    directBody: "direct",
  });
}, 15000);
