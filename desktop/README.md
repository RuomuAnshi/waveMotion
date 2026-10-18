# WaveMotion Desktop

Electron 窗口复用 React/Remotion 界面；Fastify 后台运行在 Electron utility process 中，仅绑定 127.0.0.1 的随机端口。界面关闭不会终止 macOS 后台导出，退出整个应用时取消排队/运行任务并停止应用启动的分析和 FFmpeg 子进程。

## 本地开发与构建

```sh
npm ci
npm run setup:python
.venv/bin/python -m pip install -r python/requirements-build.txt
npm run desktop
npm run desktop:package
```

Windows 对应的 Python 路径是 `.venv\Scripts\python.exe`。各平台安装包应在对应系统和架构上构建。可用 `WAVEMOTION_PYTHON` 指定构建用 Python；普通网页开发仍使用 `npm run dev`。

`build:desktop -- --skip-runtime` 只编译界面、后台及 Remotion Composition，供 CI 验证。完整构建还会冻结 Python 分析器并缓存渲染浏览器、FFmpeg、原生 compositor；这些文件不进入 Git。安装后不依赖系统 Python、Node 或 Chrome。示例音频由构建脚本合成，不会把项目的原始音视频打进安装包。

macOS 的构建缓存和 `.app` 位于 `~/Library/Caches/WaveMotion/build/darwin-<架构>/`，以保证 Electron Framework 所需的符号链接能在 APFS 上创建；最终 DMG/ZIP 会复制到项目的 `desktop-release/`。可通过 `WAVEMOTION_BUILD_CACHE` 指定另一处支持符号链接的构建目录。

## 数据与诊断

用户数据由 Electron `app.getPath('userData')/data` 管理。菜单“文件”可打开数据与日志目录，下载成片或项目 JSON 时使用原生保存对话框。应用不开放 Node 到页面，不允许窗口导航到外部来源；后台拒绝外部 Origin 和非本机 Host。

开发安装包文件名带 `-dev`，不自动升级项目版本，也不会发布到 GitHub Release。正式发版遵循根目录 CONTRIBUTING.md，集中在 dev 更新版本、验收后再合入 main；`npm run desktop:package -- --release` 可生成不带开发标记的候选安装包。当前本机测试包未使用 Developer ID 签名和 Apple 公证；对外正式发行需配置签名/公证凭据。

## Windows CI

GitHub Actions 的 `Windows Desktop` 工作流在 Windows x64 runner 上冻结分析器并生成 NSIS 安装器；推送 `dev` / `codex/**`、发起到 `dev` / `main` 的 PR，或手动运行均会触发。成功后从该次运行的 `WaveMotion-windows-x64-dev-*` artifact 下载 `.exe`，运行后选择安装目录。CI 会检查类型、独立后台、进程退出、包内分析器和媒体工具。安装包目前没有 Windows 代码签名，也不会自动发布 Release。
