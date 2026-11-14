# macOS 本机开发（Apple Silicon）

此路径复用现有 React 界面、Bun 后端和 Tauri 桌面壳，面向 macOS 13+ 的 arm64 Mac 本机开发与本机 `.app`。最低版本与实际 Bun sidecar 的 Mach-O 要求一致。不包含 App Store、公开分发、公证或自动更新配置。

## 工具与安装范围

- Xcode Command Line Tools：提供 Apple SDK 和链接器。
- Bun **1.4.2**：与当前 CI 一致，用于安装依赖、运行后端和编译 sidecar。
- Node.js **22.19.0 或兼容的较新版本**：运行 React Router/Vite 构建工具。纯 Bun 执行前端生产构建时，可能因 React DOM 的 `server.bun.js` 缺少 `renderToPipeableStream` 而失败。
- Rust stable：安装 `minimal` profile 即可；只需要本机 `aarch64-apple-darwin` 目标。

这条路径不需要 Docker、Android SDK 或本地模型。工具只需进入当前终端的 `PATH`，不要求修改 shell 配置：

```sh
export PATH="$HOME/.bun/bin:$HOME/.cargo/bin:$HOME/.local/bin:$PATH"
bun --version
node --version
cargo --version
xcode-select -p
```

## 首次准备

在仓库根目录执行。`pi/` 是构建必需的外部源码，必须与现有 CI 的固定版本及仓库补丁匹配。下面使用固定提交的源码压缩包，避免多克隆一份完整 Git 历史；已有 `pi/` 时不要覆盖它，应先核对版本和本地修改。

```sh
test ! -e pi || { echo "pi/ 已存在，请先核对，未覆盖"; exit 1; }
curl -fL https://codeload.github.com/earendil-works/pi/tar.gz/d981de1229ef899957bbe968bc8dcda02a21f477 \
  -o /tmp/rikkahub-pi-d981de1.tar.gz
mkdir pi
tar -xzf /tmp/rikkahub-pi-d981de1.tar.gz --strip-components=1 -C pi
git apply --check --directory=pi pi-patches/*.patch
git apply --directory=pi pi-patches/*.patch
mkdir -p pi/packages/ai/src/providers/data
cp pi-model-data/*.json pi-model-data/.manifest.json pi/packages/ai/src/providers/data/
HUSKY=0 bun install --cwd pi
bun install --frozen-lockfile --cwd pc-server
bun install --frozen-lockfile --cwd web-ui
```

模型目录使用仓库的 `pi-model-data/` 快照，不运行依赖第三方实时数据的模型生成脚本。

如需代理，在当前终端设置即可，无需修改全局 Git 配置：

```sh
export HTTPS_PROXY=http://127.0.0.1:7897
export HTTP_PROXY=http://127.0.0.1:7897
export ALL_PROXY=http://127.0.0.1:7897
# 某些代理与 Cargo 的 HTTP/2 多路复用组合会超时，可仅为当前终端关闭：
export CARGO_HTTP_MULTIPLEXING=false
```

## 桌面开发运行

在仓库根目录执行：

```sh
bun run --cwd web-ui macos:dev
```

命令会先编译 arm64 后端 sidecar、构建现有前端，再启动 Tauri 开发窗口。由于后端由 Rust 壳启动，命令会跳过 Tauri 对后端 URL 的预先等待，避免双方互相等待。后端就绪后，macOS 使用原生 WebView 导航打开服务端指定的入口；首次加载在后端启动前失败时，WKWebView 可能一直挂起 JavaScript，因此不能依赖注入脚本跳转。

这条桌面开发路径使用构建后的前端，修改前端后需退出并重新运行命令；Rust 代码仍由 Tauri 开发模式监听。需要前端热更新时，可用现有浏览器开发流程，分别在两个终端运行：

```sh
# 终端 1，仓库根目录
bun run --cwd pc-server dev

# 终端 2，仓库根目录
bun run --cwd web-ui dev --host 127.0.0.1 --strictPort
# 浏览器访问 http://127.0.0.1:5173
```

桌面壳支持关闭后留在菜单栏、从菜单栏退出，以及点击 Dock 图标恢复窗口。实际是否关闭后留在后台仍由现有设置控制。后端会检测桌面父进程退出并走原有刷盘、释放数据锁流程，避免开发重启或壳意外退出后留下孤儿后端。

本机直接运行 `target/debug/rikkahub` 时，台前调度曾显示通用文件图标，系统读取到的应用包标识为空。验证应用图标时应通过下面的 `open ...app` 启动应用包；本机已确认该方式能识别 `com.rikkahub.pc` 和项目的兔子图标。

## 本机 .app

退出开发实例后，在仓库根目录执行：

```sh
bun run --cwd web-ui macos:build
open web-ui/src-tauri/target/release/bundle/macos/Rikkahub.app
```

默认产物位于 `web-ui/src-tauri/target/release/bundle/macos/Rikkahub.app`；如果自行设置了 `CARGO_TARGET_DIR`，则随之变化。

使用 macOS 专属配置生成 `.app`，保留其他平台原有配置。应用使用本机 ad-hoc 签名，不依赖 Apple Developer 证书；这不代表具备公开分发、公证或其他机器上的运行保证。

设置 → 网络 → 代理中的“跟随系统”会通过 macOS 自带的 `scutil --proxy` 读取当前有效的 HTTP/HTTPS 代理，无需从终端启动应用或修改 shell 环境变量。优先读取已启用的 HTTPS 目标代理，再回退到 HTTP 代理；检测结果沿用现有异步缓存，系统设置变更后随后续请求刷新。仅配置 SOCKS 时仍需在代理软件中启用 HTTP 或混合端口；PAC/WPAD 只作诊断提示，不执行脚本，需要改用手动 HTTP 代理。本实现不导入系统例外列表，绕过地址仍由应用内的“代理绕过规则”设置控制。

sidecar 使用 `bun-darwin-arm64` 编译，并在编译时固定平台以排除 Windows 内嵌 Bash 路径，无需下载或伪造 Windows Bash 资产。`.app` 中的前端、图标与字体从 Tauri 的实际资源目录定位，不依赖源码目录或 Finder 启动时的工作目录。

## 数据与空间

- 桌面模式默认数据目录：`~/Library/Application Support/com.rikkahub.pc/pc-data/`。
- 现有的自定义数据目录设置和 `RIKKAHUB_PC_DATA_DIR` 环境变量仍优先。
- 浏览器源码开发仍默认使用仓库的 `pc-data/`。
- 资源与数据分离；不要把聊天数据写入 `.app`，覆盖应用时也不应覆盖数据目录。
- `macos:dev` 默认关闭 Rust debug symbols 和 incremental cache，并将编译并发设为 2。这些默认值均可用同名 Cargo 环境变量覆盖。
- 当前锁定的 `tauri-build 2.6.2` 依赖旧版 Cargo 输出目录布局；启动脚本为其设置 Cargo 官方提供的 `__CARGO_TEMPORARY_BUILD_DIR_NEW_LAYOUT_OPT_OUT=1`，避免 Cargo 1.100 将 sidecar 与资源复制到错误目录。该设置只影响本次子进程，待 Tauri 构建依赖兼容新布局后可移除。
- Rust 构建目录为 `web-ui/src-tauri/target/`，sidecar 位于 `web-ui/src-tauri/binaries/`。若需仅在本地忽略 macOS sidecar，可在 `.git/info/exclude` 中加入 `/web-ui/src-tauri/binaries/`，无需修改或提交 `.gitignore`。不使用时可执行 `cargo clean --manifest-path web-ui/src-tauri/Cargo.toml` 清理 Rust 产物，之后需重新编译。

## 当前范围

本路径面向本机窗口、聊天请求链路和 `.app`。后端系统剪贴板工具使用 macOS 自带的 `pbcopy`/`pbpaste`，系统朗读及 WAV 合成使用 `say`，系统字体通过 AppKit 枚举，无需安装 Linux 的剪贴板或语音工具。真实供应商调用需用户在应用内配置自己的接口，模拟供应商烟雾测试不能替代真实账号验证。

Finder 启动时，工作区 Bash 与外部引擎子进程会保留继承的 `PATH` 顺序，并追加已存在的 Homebrew、`~/.local/bin`、`~/.bun/bin` 和 `~/.cargo/bin` 等常用目录；不会读取 shell 启动脚本或修改全局环境。自定义子进程 `PATH` 仍优先。非标准安装位置仍需显式配置，应用也不会安装可选外部 CLI。

语音输入的麦克风用途声明由 `Info.macos.plist` 合入应用包；`Entitlements.macos.plist` 为启用 Hardened Runtime 的本机签名添加音频输入权限。实际使用仍需系统授权和可用的录音设备。应用内自动更新暂不支持 macOS，不能使用 Windows 安装器或 Linux 原地更新流程；本机更新继续退出应用后手动替换 `.app`。快捷键沿用已有可自定义配置，目前不会把保存的 Ctrl 绑定自动改为 Command。

本机已验证开发启动、Rust 文件变更后的自动重启及旧后端退出，以及 arm64 `.app` 构建与签名校验。开发版原生 WebView 已回报页面加载完成、聊天界面挂载、1280×840 视口及桌面窗口控制条加载。应用包已通过系统 `open` 从项目目录之外启动：后端就绪，抽查的前端资源与字体和包内文件一致，默认数据目录位于 Application Support；正常退出后，后端、数据锁和监听端口均释放。路径/资源相关的 13 项测试、前后端类型检查与模拟请求链路烟雾测试通过。

用户截图曾确认开发窗口为白屏；随后改用 macOS 原生导航，冷启动后 WebView 已回报页面加载完成、界面布局和可见样式正常，用户随后提供的台前调度缩略图也已显示聊天界面。包含导航修复的 `.app` 已重新构建、通过签名校验并经系统 `open` 启动，系统识别到正确的应用包标识与兔子图标。完整窗口画面及交互仍需在本机确认，本次运行环境未授予屏幕录制权限；窗口按钮及实际供应商对话仍待验证。安装依赖时使用的终端代理也不代表 Finder 启动的应用已经配置网络代理；如接口需要代理，请在应用现有的网络设置中配置。

待复核：自动最小化检查未观察到系统返回最小化状态；临时启用原生窗饰后结果相同，原因尚未定位，因此不把最小化与恢复按钮列为已通过的功能。临时界面诊断及窗饰试验代码已移除，保留现有界面样式。

2026-11-15 代理补验：修复前安装版在系统 HTTP/HTTPS 代理已开启时仍返回 `source=none`；补齐 macOS 检测后，29 项代理与路径相关测试、代理运行时烟雾测试和前端类型检查通过，后端项目代码无类型错误（既有脚本过滤 46 条 pi 内部诊断）。重建并更新到 `/Applications` 后，从安装版诊断接口确认 `mode=auto`、`source=system`，系统代理检测和代理连通性测试均通过，公开轻量测试地址返回 HTTP 204。本轮未使用真实供应商密钥测试模型调用。

## Windows → macOS 迁移复查

本次复查覆盖平台条件分支、系统命令、资源与数据路径、文件面板、备份、工作区进程、快捷键、语音权限和更新流程，未在 Windows 机器上重新运行。

已修复的遗漏：

- Mac 后端剪贴板原先没有有效分支，写入会静默返回；新增原生命令调用，保留 Unicode 与首尾空白，并向调用方报告命令失败。
- 系统 TTS 原先误走 `espeak-ng`；新增 `say` 的播放、WAV 合成、进程取消与临时文件清理，日志按平台标记。
- 系统字体原先没有 Mac 枚举分支；新增 AppKit 枚举，同时修复空数组导致兜底字体清单无法生效的问题。
- 备份导出的 Windows 保留设备名限制现在只对 Windows 生效。
- 工作区根目录保护原先拿解析后的真实路径与未解析的根路径比较，软链接别名可能绕过删除/重命名保护；现在两边使用相同的规范路径。
- Finder 精简 `PATH` 下 Bash 与外部引擎不能找到常用安装位置的工具；现在只对子进程追加这些目录。
- 增加麦克风用途声明及 Hardened Runtime 的音频输入权限，禁止 Mac 误入 Windows/Linux 自动更新安装流程。
- Windows 内嵌 Bash 测试现在只在 Windows 加载归档，Mac 测试无需下载或伪造 Windows 资产。

验证结果：

- 后端全量测试：1472 通过、20 跳过、0 失败。跳过包括 Windows 专属测试，以及需要另一份 Android 源码的契约核对。
- 前端全量测试：424 通过、0 失败；前后端类型检查通过当前项目检查入口，后端脚本仍过滤 46 条既有 pi 内部诊断。
- 聊天请求链路、备份往返烟雾测试通过，使用模拟服务和专用测试数据。
- 原生 `say` 实际生成有效 WAV；AppKit 实际枚举到本机系统字体。剪贴板的调用、Unicode、错误传播通过隔离命令替身测试，未读取或覆盖用户剪贴板。
- 重新构建 arm64 `.app` 并通过严格签名校验；检查最终包内存在麦克风用途声明，签名嵌入 `com.apple.security.device.audio-input=true`，保留 Hardened Runtime。
- 直接运行包内 sidecar，以全新临时数据、源码目录外的工作目录和精简 `PATH` 验证：前端 HTTP 200、系统字体枚举、系统 TTS WAV、`nul.zip` 备份导出与系统代理识别均通过，测试后端已退出。
- 正常退出并更新 `/Applications` 中的安装版后，从源码目录外重新打开：后端健康检查通过、前端 HTTP 200、枚举到 204 个系统字体、代理为 `mode=auto` / `source=system`。安装版二进制与本次构建哈希一致，签名和麦克风配置复核通过；用户数据目录保留，构建目录中的重复 `.app` 已删除。

在 Mac 上跑全量后端测试时，可为当前命令使用独立的 `/private/tmp` 子目录作为 `TMPDIR`。系统默认 `/var/folders/...` 会命中项目既有的系统目录工作区准入限制，使使用 `os.tmpdir()` 创建 folder 工作区的测试失败；无需为测试放宽产品的系统目录限制或修改 shell 配置。

尚未完成实际交互验证：麦克风授权与录音、最小化/恢复和菜单栏完整交互、桌面通知，以及真实供应商对话。编译成功、模拟服务通过或包内声明存在，均不能替代这些验证；本机运行也不能替代 Windows 回归、其他 Mac/系统版本和公开分发验证。
