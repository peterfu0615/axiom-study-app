# 真实用户 Acceptance Test 清单

> 本文档对应执行约束 #5：发布前必须执行真实用户 Acceptance Test。
> 任何 Beta Release 上架前，必须由**非开发者的真实用户**在**干净 macOS 环境**中按本清单完整走查，并填写结论。
> 开发者自测仅用于 Phase 1 验证（见 [PHASE1_STABILITY_REPORT.md](./PHASE1_STABILITY_REPORT.md) §4），不能替代本清单。

## 0. 测试前置条件

### 0.1 测试人员要求
- 熟悉 macOS 基本操作，但**不参与 Axiom 开发**。
- 持有一台符合最低系统要求的 Mac（见下）。
- 持有至少一个 OpenAI 兼容 API Key（用于 AI 分析验收）。
- 同意将测试中发现的问题反馈给开发者（含截图、日志路径）。

### 0.2 测试机要求
| 项 | 要求 |
| --- | --- |
| 机型 | Apple Silicon（M1/M2/M3/M4）或 Intel Mac |
| macOS 版本 | 13.0 或更高 |
| 磁盘空间 | ≥ 500 MB 可用 |
| 网络 | 可访问 OpenAI 兼容 endpoint |
| 数据状态 | **未安装过 Axiom**（或已通过卸载脚本完全清理） |

### 0.3 测试版本信息（每次测试填写）
| 项 | 值 |
| --- | --- |
| Axiom 版本 | （例：0.1.0-beta.1）|
| DMG SHA-256 | |
| 测试机型 | （例：MacBook Pro M2, macOS 14.5）|
| 测试人 | |
| 测试日期 | |
| 总耗时 | |

---

## 1. 测试分组

| 组 | 范围 | 关联约束 / 文档 |
| --- | --- | --- |
| A | 安装与首次启动 | 约束 #6（Beta Release 边界）|
| B | 数据目录与日志策略 | 约束 #3（Logger 日志目录策略）|
| C | AI Provider 与 Keychain | 约束 #2（Keychain 优先 Rust 直读）|
| D | 题目采集与页面校正 | [ARCHITECTURE.md](./ARCHITECTURE.md) §图片生命周期 |
| E | AI 分析与结果展示 | [AIJOB_STATE_MACHINE.md](./AIJOB_STATE_MACHINE.md) |
| F | 题库管理与解题面板 | 现有功能 |
| G | 媒体垃圾回收 | Phase 1 §1.2 |
| H | 异常恢复与崩溃容错 | Phase 1 §1.6 |
| I | 卸载与数据清理 | Beta 用户回退路径 |

每个测试用例的结论：`✅ 通过` / `❌ 失败` / `⚠️ 部分通过`。失败时必须附截图与日志。

---

## A. 安装与首次启动

### A.1 DMG 安装（Beta Gatekeeper 路径）
**步骤**：
1. 获取 DMG 文件并双击挂载。
2. 将 Axiom 拖入「应用程序」文件夹。
3. 在 Launchpad / 应用程序中**右键** Axiom → 「打开」 → 在弹出的 Gatekeeper 警告中再次点击「打开」。

**预期**：
- Gatekeeper 提示「无法验证开发者」属于 Beta 预期行为（见 [RELEASE_CHECKLIST.md](./RELEASE_CHECKLIST.md) §2）。
- 应用主窗口在 5 秒内打开，标题栏显示「Axiom」。

**实际**：

### A.2 首次启动数据目录创建
**步骤**：首次启动后立即打开终端执行：
```sh
ls -la "$HOME/Library/Application Support/com.axiom.study/"
```

**预期**：目录存在，且包含：
- `axiom.db` / `axiom.db-wal` / `axiom.db-shm`（SQLite WAL 模式）
- `logs/axiom.log`
- `media/original/` `media/corrected/` `media/problems/` `media/diagrams/`（首次使用前可能为空）

**实际**：

### A.3 数据库路径一致性校验
**步骤**：在终端执行：
```sh
sqlite3 "$HOME/Library/Application Support/com.axiom.study/axiom.db" "PRAGMA journal_mode;"
```

**预期**：
- 返回 `wal`。
- 应用启动时**不应**弹出 `DatabaseLocationErrorDialog`（Phase 1 §1.1 修复后的预期行为）。
- 若弹出对话框，说明 tauri-plugin-sql 与 sqlx 路径不一致，需立即停止测试并记录。

**实际**：

---

## B. 数据目录与日志策略

### B.1 日志文件位置正确
**步骤**：终端执行：
```sh
ls -la "$HOME/Library/Application Support/com.axiom.study/logs/"
ls -la "$HOME/Library/Logs/com.axiom.study/" 2>/dev/null || echo "OS 默认 Logs 目录应为空或不存在"
```

**预期**：
- `Application Support/com.axiom.study/logs/axiom.log` 存在且非空。
- `~/Library/Logs/com.axiom.study/` 目录**不应**存在 Axiom 日志（Phase 1 §1.3 修复目标，约束 #3）。

**实际**：

### B.2 日志内容可读
**步骤**：打开 `axiom.log`，检查最近 20 行。

**预期**：
- 每行格式为 `[日期][时间][级别][target] 消息`，时间为**本地时区**。
- 包含 `INFO` 级别的启动日志（数据库迁移完成、Keychain 迁移完成等）。
- **不应**出现完整 API Key 明文（约束 #2）。

**实际**：

### B.3 Release 日志级别
**步骤**：在日志文件中搜索 `TRACE` 或 `DEBUG` 级别条目。

**预期**：Release 构建下不应出现 `TRACE` SQL 日志（Phase 1 §1.5，避免 SQL 序列化开销与日志膨胀）。

**实际**：

---

## C. AI Provider 与 Keychain

### C.1 添加 OpenAI 兼容 Provider
**步骤**：
1. 进入「设置」 → AI Provider。
2. 新增一个 `openai_compatible` Provider，填写名称、Base URL、Model、API Key。
3. 保存。

**预期**：
- 保存后 UI 显示「API Key 已保存到 Keychain」。
- API Key 输入框被清空，placeholder 变为「输入新值以替换 Keychain 中的密钥（留空保持不变）」。

**实际**：

### C.2 API Key 不回传前端（约束 #2 核心）
**步骤**：终端执行：
```sh
# 查询数据库中的 ai_provider_profiles 表
sqlite3 "$HOME/Library/Application Support/com.axiom.study/axiom.db" \
  "SELECT id, name, credential_ref, api_key FROM ai_provider_profiles;"
```

**预期**：
- `credential_ref` 列等于 Provider id（非空）。
- `api_key` 列为空字符串（**不应**包含明文 key）。

**实际**：

### C.3 Keychain 条目存在
**步骤**：打开「钥匙串访问」App，搜索 `axiom`（或 service name `com.axiom.study.keystore`）。

**预期**：能看到一条名为 `axiom.<provider_id>` 的密码条目。

**实际**：

### C.4 AI 调用从 Keychain 直读
**步骤**：
1. 在题库中触发一次 AI 解题。
2. 查看日志 `axiom.log`。

**预期**：
- 日志中**不应**出现 `load_api_key` 的 IPC 调用记录（说明是 Rust 内部直读，约束 #2）。
- 不应在任何前端日志 / 网络请求面板中看到完整 API Key。

**实际**：

### C.5 删除 Provider 清理 Keychain
**步骤**：在设置中删除上一步创建的 Provider。

**预期**：
- 钥匙串中对应条目被删除（幂等，再次删除不报错）。
- 数据库中该行已删除。

**实际**：

---

## D. 题目采集与页面校正

### D.1 导入本地图片
**步骤**：导入一张清晰的题目照片（JPG/PNG，≥ 1MB）。

**预期**：
- 原图被复制到 `media/original/`。
- `media/problems/` 生成一道候选题目，状态为 `candidate`。
- 题库页面能看到该题。

**实际**：

### D.2 页面校正（Vision sidecar）
**步骤**：对一张倾斜拍摄的题目照片执行「页面校正」。

**预期**：
- `media/corrected/` 生成校正后的图片（原图保留）。
- 校正结果可框出题目块（normalized rect 0–1 坐标）。
- 日志显示 vision sidecar 被调用，无崩溃。

**实际**：

### D.3 OCR 文字识别
**步骤**：在校正后的页面上触发 OCR。

**预期**：
- 题目块中的文字被识别并填入题干。
- `media/diagrams/` 如有图形被识别则生成结构化数据。

**实际**：

---

## E. AI 分析与结果展示

### E.1 AI 解题（OpenAI 兼容）
**步骤**：选择一道题目，点击「AI 解题」。

**预期**：
- AIJob 状态机流转：`not_started → pending → processing → completed`。
- 解题结果（步骤、关键方法、公式、知识点）正确展示在解题面板。
- 结果内容符合 schema（无字段缺失）。

**实际**：

### E.2 AI 失败可重试
**步骤**：临时关闭网络或填错 Base URL，触发 AI 解题。

**预期**：
- AIJob 状态变为 `failed`，UI 显示错误信息。
- 修复后可重新触发，状态从 `failed → pending → processing → completed`。

**实际**：

### E.3 崩溃恢复（约束 #5 关键）
**步骤**：
1. 触发 AI 解题后立即 ⌘Q 强退应用（模拟崩溃）。
2. 重新启动 Axiom。

**预期**：
- 启动恢复机制将 `processing` 状态的 AIJob 重新置为 `pending` 或 `failed`（不应停留在 `processing`，见 [AIJOB_STATE_MACHINE.md](./AIJOB_STATE_MACHINE.md)）。
- 题库数据无损坏。
- 用户可手动重试该题。

**实际**：

---

## F. 题库管理与解题面板

### F.1 题目保存与归档
**步骤**：
1. 将一道候选题目状态改为「已保存」。
2. 归档一道题目。

**预期**：
- 状态变更后立即持久化。
- 题库视图按状态过滤正确。

**实际**：

### F.2 解题面板公式渲染
**步骤**：打开一道 AI 解题完成、含 LaTeX 公式的题目。

**预期**：
- KaTeX 正确渲染行内与块级公式。
- 暗色 / 亮色模式下公式均清晰可见。

**实际**：

---

## G. 媒体垃圾回收

### G.1 扫描孤立文件
**步骤**：在题库中删除几道题目（不删除对应原图），触发「扫描孤立媒体」。

**预期**：
- `scanOrphanedMedia` 返回 `original/` `corrected/` `problems/` `diagrams/` 四类目录下未被任何题目引用的文件列表（Phase 1 §1.2）。

**实际**：

### G.2 删除孤立文件
**步骤**：选择上一步扫描到的孤立文件，点击「删除」。

**预期**：
- `delete_media_file` 删除选中的文件。
- 再次扫描返回空列表。

**实际**：

---

## H. 异常恢复与崩溃容错

### H.1 数据库路径变更后启动
**步骤**：
1. 退出 Axiom。
2. 将 `axiom.db` 移动到一个新位置（模拟路径变更）。
3. 重新启动 Axiom。

**预期**：
- 启动时弹出 `DatabaseLocationErrorDialog`，告知路径不一致。
- 用户按对话框引导操作后可恢复数据（Phase 1 §1.1）。

**实际**：

### H.2 Keychain 条目丢失容错
**步骤**：
1. 在「钥匙串访问」中删除 `axiom.<provider_id>` 条目。
2. 触发该 Provider 的 AI 解题。

**预期**：
- Rust 命令返回明确错误：「Keychain 中未找到 API Key，请重新保存」。
- 应用不崩溃，用户可在设置中重新保存 Key。

**实际**：

---

## I. 卸载与数据清理（Beta 用户回退路径）

### I.1 标准卸载
**步骤**：
1. 将 Axiom.app 移到废纸篓。
2. 清空废纸篓。

**预期**：应用本身被删除。

### I.2 用户数据保留
**步骤**：检查 `~/Library/Application Support/com.axiom.study/`。

**预期**：
- 数据目录与 Keychain 条目**保留**（允许用户重新安装后继续使用）。
- 文档中明确说明卸载不会自动清理用户数据，用户可手动删除整个目录。

**实际**：

### I.3 完全清理（可选）
**步骤**：终端执行：
```sh
rm -rf "$HOME/Library/Application Support/com.axiom.study"
# 在「钥匙串访问」中手动删除所有 axiom.* 条目
```

**预期**：再次安装 Axiom 时表现为全新机器。

**实际**：

---

## 2. 测试结论与签字

### 2.1 通过标准
- **必须通过**：A.1 / A.2 / A.3 / B.1 / B.2 / C.1 / C.2 / C.3 / C.4 / E.1 / E.3 / H.2。
- **允许部分通过**：D.2 / D.3 / G.1 / G.2（如测试机无相机或不便构造孤立文件，可记为 N/A）。
- 任何「必须通过」项失败 → **不允许发布该版本为 Beta Release**。

### 2.2 已知限制（Beta Release 必须披露给用户）
| 限制 | 说明 |
| --- | --- |
| 未签名 / 未公证 | Gatekeeper 会拦截，需右键「打开」或 `xattr -dr com.apple.quarantine` |
| 仅 arm64 | Intel Mac 无法运行此 Beta 版本 |
| CSP 暂未收紧 | `csp: null`，未来版本将收紧 |
| API Key 不在数据库 | 已存入 Keychain，删除 Provider 时同步清理 |

### 2.3 缺陷清单
| 编号 | 关联用例 | 严重度 | 描述 | 复现步骤 | 截图 / 日志路径 |
| --- | --- | --- | --- | --- | --- |
| 1 | | | | | |

### 2.4 签字
| 角色 | 姓名 | 日期 | 结论 |
| --- | --- | --- | --- |
| 测试人 | | | □ 全部通过，可发布 Beta<br>□ 存在缺陷，需修复后回归 |
| 开发者 | | | □ 已确认结论，接受发布决策 |

---

## 3. 测试结果归档

测试完成后，将本文件签字版本（含截图、日志摘录）保存为：
```
app/docs/acceptance_results/ACCEPTANCE_TEST_<version>_<date>.md
```

并同步更新 [RELEASE_CHECKLIST.md](./RELEASE_CHECKLIST.md) §2「Beta Release 接受标准」中的复选框与 [CHANGELOG.md](../CHANGELOG.md) 对应版本的「Known Limitations」段落。
