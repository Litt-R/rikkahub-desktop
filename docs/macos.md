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

本路径面向本机窗口、聊天请求链路和 `.app`。不宣称所有平台工具均已适配：现有后端的系统剪贴板工具和系统 TTS 仍主要面向 Windows/Linux；macOS `pbcopy`、`pbpaste`、`say` 的集成不在此次改动中。真实供应商调用需用户在应用内配置自己的接口，模拟供应商烟雾测试不能替代真实账号验证。

本机已验证开发启动、Rust 文件变更后的自动重启及旧后端退出，以及 arm64 `.app` 构建与签名校验。开发版原生 WebView 已回报页面加载完成、聊天界面挂载、1280×840 视口及桌面窗口控制条加载。应用包已通过系统 `open` 从项目目录之外启动：后端就绪，抽查的前端资源与字体和包内文件一致，默认数据目录位于 Application Support；正常退出后，后端、数据锁和监听端口均释放。路径/资源相关的 13 项测试、前后端类型检查与模拟请求链路烟雾测试通过。

用户截图曾确认开发窗口为白屏；随后改用 macOS 原生导航，冷启动后 WebView 已回报页面加载完成、界面布局和可见样式正常，用户随后提供的台前调度缩略图也已显示聊天界面。包含导航修复的 `.app` 已重新构建、通过签名校验并经系统 `open` 启动，系统识别到正确的应用包标识与兔子图标。完整窗口画面及交互仍需在本机确认，本次运行环境未授予屏幕录制权限；窗口按钮及实际供应商对话仍待验证。安装依赖时使用的终端代理也不代表 Finder 启动的应用已经配置网络代理；如接口需要代理，请在应用现有的网络设置中配置。

待复核：自动最小化检查未观察到系统返回最小化状态；临时启用原生窗饰后结果相同，原因尚未定位，因此不把最小化与恢复按钮列为已通过的功能。临时界面诊断及窗饰试验代码已移除，保留现有界面样式。
