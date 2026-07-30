# Axiom macOS

Axiom 的 macOS 客户端，使用 Tauri 2、React、TypeScript、Rust 和 SQLite 构建。

## 当前实现

当前已完成阶段 0 基座和阶段 1 的页面处理模块：

- Tauri macOS 应用壳和模块导航；
- 摄像头权限请求、设备枚举、实时预览和静态帧保存；
- 图片选择、格式/大小校验及导入；
- 原图复制到应用数据目录并计算 SHA-256 去重；
- SQLite 初始数据模型及迁移；
- 采集队列和最近导入记录；
- Apple Vision 文档边界检测与 Core Image 透视矫正；
- 保留色彩、文档灰度两种色彩优化模式；
- 本地中英文 OCR、题号/分栏/留白版面分析；
- 自动生成题目块；
- 题目块拖动、四角缩放、重命名、拆分、合并、添加与删除；
- 处理版本、OCR 结果和人工调整结果持久化。

当前相机预览使用 WKWebView 的 MediaDevices。阶段 1 会增加 macOS
AVFoundation 捕获适配器，以获得更可靠的连续互通相机识别、高分辨率照片和系统首选相机响应。

首次使用 Vision 精确 OCR 时，macOS 可能需要加载本地识别模型，首张图片会比后续图片慢。

## 开发环境

- macOS 13 或更高版本；
- Node.js 22 或更高版本；
- Rust 1.77.2 或更高版本；
- 完整 Xcode（原生相机、签名和发布需要）。

## 命令

```sh
npm install
npm run tauri dev
npm run check
cd src-tauri && cargo check
```

## 目录

```text
src/
  components/       应用外壳与共用组件
  domain/           与具体框架无关的领域类型
  features/         按产品模块组织的界面与用例
  platform/         相机、Tauri 命令和 SQLite 适配器
src-tauri/
  native/           Apple Vision/Core Image 本地处理器
  binaries/         构建时生成并随 App 签名的 sidecar
  migrations/       追加式数据库迁移
  src/commands.rs   受控的原生文件操作
  Info.plist        macOS 隐私声明
  Entitlements.plist
```

产品范围与验收口径见仓库根目录的 `PRD.md`。
