# 架构决策

## ADR-001：使用 Tauri 2

状态：已接受。

界面由 React/TypeScript 实现；Rust 负责受控文件操作、哈希、任务编排和本地基础设施；
Apple 专属能力通过独立适配器接入。这样可以保持产品界面迭代速度，同时不把连续互通相机、
Vision 和 Core Image 限制在浏览器 API 内。

## 模块边界

```text
features → domain
features → platform ports
platform → Tauri / WebKit / SQLite
Rust commands → filesystem
后续 macOS adapter → AVFoundation / Vision / Core Image
```

领域模型不能导入 React、Tauri 或模型供应商 SDK。所有云端模型返回先映射到版本化
Schema，再进入领域对象。

## 图片生命周期

1. 用户明确选择图片或授权相机；
2. 原图通过 Rust 命令校验大小和扩展名；
3. 文件复制到应用数据目录；
4. 计算 SHA-256，并按内容哈希检测重复；
5. SQLite 只保存路径、哈希、状态和结构化结果；
6. 后续页面校正生成新文件，不覆盖原图。

## 页面处理流水线

```text
原图
  → VNDetectDocumentSegmentationRequest
  → CIPerspectiveCorrection
  → 阴影/高光、饱和度、对比度、锐度优化
  → VNRecognizeTextRequest
  → 分栏 + 题号 + 垂直留白分析
  → 可编辑 NormalizedRect 题目块
```

Apple 专属处理器使用 Swift 编写，并由 Cargo build script 编译成 Tauri sidecar。处理只接收
应用数据目录内的原图路径，结果输出到 `media/corrected`；原图不会被覆盖。sidecar 进入
`.app/Contents/MacOS`，由 Tauri 的 macOS 打包流程统一处理签名。

题目块坐标统一使用左上角为原点的 0–1 归一化坐标，因此不依赖当前窗口尺寸或图片渲染尺寸。
自动块和人工块使用同一个领域模型，人工调整保存后替换未确认候选，不影响以后确认过的题目。

## 相机演进

- 阶段 0：MediaDevices 能力探针、预览和静态帧；
- 阶段 1：AVFoundation 设备枚举与 `systemPreferredCamera`；
- 阶段 1：`AVCapturePhotoOutput` 高分辨率照片；
- 阶段 1：Vision/Core Image 页面检测与透视校正；
- MediaDevices 保留为兼容后备。

## 数据迁移

SQLite 迁移只追加，不修改已发布迁移。复习日志采用追加写入；模型输出、提示词版本和
调度器版本必须可追溯。
