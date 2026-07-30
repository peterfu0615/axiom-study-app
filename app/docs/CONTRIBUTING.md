# 贡献指南

感谢参与 Axiom 开发。本文档说明本地开发环境、代码风格、提交规范与 PR 流程。详细架构与设计请先阅读 [ARCHITECTURE.md](./ARCHITECTURE.md) 与 [PHASE1_STABILITY_REPORT.md](./PHASE1_STABILITY_REPORT.md)。

## 1. 开发环境

要求：

- macOS 13.0+（Apple Silicon）
- Node.js 22+
- Rust stable（edition 2021，最低 1.77.2）
- 完整 Xcode（Vision / Core Image Swift sidecar 编译需要）

初始化：

```sh
git clone <repo-url> && cd Axiom/app
npm install
npm run tauri dev
```

首次启动 Vision OCR 时，macOS 可能需要加载本地识别模型，首张图片处理会略慢。

## 2. 代码风格

### TypeScript / React

- 使用 [oxlint](https://oxc.rs/docs/guide/usage/linter)：`cd app && npm run lint`
- 类型检查：`cd app && npm run typecheck`（`tsc -b --noEmit`）
- 不允许 `any`、`@ts-ignore`；如确需绕过，请在 PR 中说明理由。
- 测试使用 vitest，文件命名 `*.test.ts(x)`，与被测文件同目录。

### Rust

- 使用 `cargo fmt` 统一格式。
- 使用 `cargo clippy -- -D warnings`，零告警。
- SQLite 迁移只追加，不修改已发布迁移文件。
- API Key 等敏感数据严禁入库或写入数据库，必须存 Keychain（参见 [PHASE1_STABILITY_REPORT.md](./PHASE1_STABILITY_REPORT.md) §1.4）。
- 受控文件操作必须走 Rust 命令，前端不直接读写文件系统。

## 3. 提交信息规范

采用 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/v1.0.0/)：

```text
<type>(<scope>): <subject>

<body>
```

常用 `type`：

- `feat`：新功能
- `fix`：缺陷修复
- `docs`：文档变更
- `refactor`：重构（不改变行为）
- `perf`：性能优化
- `test`：测试补充
- `chore`：构建、依赖、CI 等杂项
- `revert`：回滚提交

示例：

```text
feat(library): 支持题目块批量合并
fix(ai): 修复 Antigravity CLI 不可用时未回退 Mock 的问题
docs(sqlite): 补充 release 日志策略说明
```

## 4. 测试要求

PR 合并前以下命令必须全部通过：

```sh
# 前端
cd app
npm run lint
npm run typecheck
npm test

# Rust
cd src-tauri
cargo check
cargo clippy -- -D warnings
cargo test --lib
```

一键全量检查（前端 lint + test + build）：`cd app && npm run check`。

新增功能或缺陷修复必须附带测试；Rust 单元测试放在 `#[cfg(test)] mod tests` 内，与被测代码同文件。

## 5. 分支与 PR 流程

- 主分支：`main`（受保护，禁止直接推送）。
- 功能分支命名：`feat/<scope>`、`fix/<scope>`、`docs/<scope>`。
- 从最新 `main` 切出分支，开发过程中适时 `git rebase` 保持线性历史。
- PR 标题使用 conventional commit 格式，描述需包含：动机、改动概要、测试结论、是否影响数据迁移或 API Key 处理。
- 涉及 SQLite 迁移时，必须新增迁移文件（编号递增），并在 PR 中说明回滚策略。
- 涉及 AI Schema 变更时，必须同步更新 `src/ai/*.schema.json` 与 `scripts/generate-problem-analysis-validator.mjs` 生成的 validator。

## 6. PR Checklist

提交 PR 前自检：

- [ ] `npm run lint` / `npm run typecheck` / `npm test` 全部通过
- [ ] `cargo clippy -- -D warnings` / `cargo test --lib` 全部通过
- [ ] 新增/修改的功能已编写测试
- [ ] 未引入新的依赖（如必须，已在 PR 说明理由且通过许可证检查）
- [ ] 未硬编码任何 API Key、密钥或用户数据
- [ ] 提交信息符合 Conventional Commits
- [ ] 若涉及数据库迁移：迁移为追加式，且已验证在新库与旧库升级路径下均能执行
- [ ] 若涉及 UI 改动：在暗色与亮色模式下均验证通过
