// macOS 的有效系统代理来自 SystemConfiguration；Finder 启动不继承 shell 代理环境变量。
export interface MacosProxySettings {
  proxy: string | undefined;
  pacUrl: string | undefined;
}

/** 只读取 scutil --proxy 的顶层有效设置，不把 __SCOPED__ 中其他接口的代理当成全局代理。 */
export function parseMacosProxySettings(output: string): MacosProxySettings {
  const values = new Map<string, string>();
  let depth = 0;
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "}") {
      depth--;
      continue;
    }
    if (/(?:^|:\s*)<(?:dictionary|array)>\s*\{$/.test(trimmed)) {
      depth++;
      continue;
    }
    if (depth !== 1) continue;
    const match = trimmed.match(/^(\w+)\s*:\s*(.*)$/);
    if (match) values.set(match[1]!, match[2]!.trim());
  }

  const endpoint = (protocol: "HTTP" | "HTTPS"): string | undefined => {
    if (values.get(`${protocol}Enable`) !== "1") return undefined;
    const host = values.get(`${protocol}Proxy`);
    const rawPort = values.get(`${protocol}Port`) ?? "";
    const port = Number(rawPort);
    if (!host || /[\s/@?#\\]/.test(host) || !/^\d+$/.test(rawPort) || port < 1 || port > 65535) {
      return undefined;
    }
    const hostname = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
    try {
      // HTTPSProxy 是 HTTPS 目标的 CONNECT 代理，并不表示连接代理本身时使用 TLS。
      return new URL(`http://${hostname}:${port}`).origin;
    } catch {
      return undefined;
    }
  };

  const pacUrl = values.get("ProxyAutoConfigEnable") === "1"
    ? values.get("ProxyAutoConfigURLString") || undefined
    : undefined;
  return {
    proxy: endpoint("HTTPS") ?? endpoint("HTTP"),
    // 与其他平台一致：仅识别并提示 PAC/WPAD，不执行自动配置脚本。
    pacUrl: pacUrl ?? (values.get("ProxyAutoDiscoveryEnable") === "1" ? "wpad" : undefined),
  };
}

export async function readMacosProxySettings(): Promise<MacosProxySettings> {
  const empty = { proxy: undefined, pacUrl: undefined };
  if (process.platform !== "darwin") return empty;
  try {
    // 使用系统命令的绝对路径；不依赖 Finder 应用的 PATH，不安装额外依赖。
    const proc = Bun.spawn(["/usr/sbin/scutil", "--proxy"], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "ignore",
      timeout: 2000,
    });
    const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    return exitCode === 0 ? parseMacosProxySettings(stdout) : empty;
  } catch {
    return empty;
  }
}
