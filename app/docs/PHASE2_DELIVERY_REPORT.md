# Phase 2 交付报告：Production Distributable

> 本报告总结 Phase 2「产品化与发布体系」的交付成果，对照六项执行约束逐条给出落地证据。
> Phase 1 稳定性成果见 [PHASE1_STABILITY_REPORT.md](./PHASE1_STABILITY_REPORT.md)。

## 0. 阶段目标

将 Axiom 从「Phase 1 稳定但仅本地可运行」推进到「Production Distributable」：
具备 CI/CD、版本管理、Beta 发布流程、签名公证路线、真实用户验收机制与公开仓库文档。

## 1. 执行约束对照（六项全部满足）

| # | 约束 | 落地证据 | 状态 |
| --- | --- | --- | --- |
| 1 | Phase 1 至少拆为两个稳定性 commit | `5efedb0`（数据库路径 + 媒体 GC）、`5e9e3b5`（生产日志 + Keychain） | ✅ |
| 2 | Keychain 优先 Rust 直接读取，避免 API Key 回传前端 | `keystore::load_api_key_internal` 在 Rust 内部直读；AI 命令只接受 `credential_ref`；`AIProviderProfile.apiKey` 读取后为空 | ✅ |
| 3 | Logger 明确日志目录策略 | 显式 `~/Library/Application Support/com.axiom.study/logs/axiom.log`，非 OS 默认 `~/Library/Logs/` | ✅ |
| 4 | GitHub Actions 不假设 runner 架构，必须检测 arm64 | `ci.yml` 与 `release.yml` 均含 `Detect runner architecture` 步骤，按 `uname -m` 输出 triple | ✅ |
| 5 | 发布前必须执行真实用户 Acceptance Test | [ACCEPTANCE_TEST.md](./ACCEPTANCE_TEST.md) 9 组用例 + 签字模板；RELEASE_CHECKLIST 明确「AT 通过」为 Beta 接受标准 | ✅ |
| 6 | 未签名 DMG 只能作为 Beta Release，必须明确未来签名公证路线 | [RELEASE_CHECKLIST.md](./RELEASE_CHECKLIST.md) §2 Beta 定义、§4 签名公证完整路线（Developer ID + notarytool + stapler + Secrets 清单） | ✅ |

## 2. Phase 2 交付物清单

### 2.1 CI/CD
| 文件 | 用途 |
| --- | --- |
| [.github/workflows/ci.yml](../../.github/workflows/ci.yml) | push/PR 触发：前端 lint + typecheck + test，Rust fmt + clippy + check + test |
| [.github/workflows/release.yml](../../.github/workflows/release.yml) | tag 触发：构建 DMG + .app.zip，按 secrets 自动签名公证或产出未签名 Beta |

两条 workflow 均在第一步检测 runner 架构（约束 #4），不假设 arm64；并校验对应 vision sidecar 二进制存在，缺失时提前 fail。

### 2.2 版本管理
| 文件 | 用途 |
| --- | --- |
| [scripts/bump-version.mjs](../scripts/bump-version.mjs) | 在 `package.json` / `Cargo.toml` / `tauri.conf.json` 三处同步版本号，支持 semver 与 `-beta.N` 后缀 |

### 2.3 文档体系
| 文件 | 用途 |
| --- | --- |
| [README.md](../README.md) | 重写为生产就绪版本：产品定位、功能、环境、Beta 安装、已知限制 |
| [CHANGELOG.md](../CHANGELOG.md) | Keep a Changelog 风格，记录 0.1.0 Beta 的 Added/Changed/Fixed/Known Limitations |
| [CONTRIBUTING.md](./CONTRIBUTING.md) | 开发环境、代码风格、Conventional Commits、测试要求、PR 流程 |
| [RELEASE_CHECKLIST.md](./RELEASE_CHECKLIST.md) | 发布流程、Beta 接受标准、签名公证路线、架构覆盖路线（约束 #6） |
| [ACCEPTANCE_TEST.md](./ACCEPTANCE_TEST.md) | 真实用户验收清单 9 组用例 + 签字模板（约束 #5） |

### 2.4 仓库卫生
| 改动 | 说明 |
| --- | --- |
| 新增根级 `.gitignore` | 覆盖 `.DS_Store` / `.trae/` / `app_snapshot/` / `export_snapshot.py` / `target/` / `dist/` |
| `git rm --cached` 3 个 `.DS_Store` | 从跟踪中移除（保留磁盘文件） |
| `cargo fmt` 统一格式 | ai.rs / commands.rs / db.rs / keystore.rs / lib.rs |

## 3. Phase 2 commit 列表

| commit | 类型 | 说明 |
| --- | --- | --- |
| `ee7c19c` | chore | 根级 .gitignore + 移除 .DS_Store 跟踪 |
| `569350e` | ci | GitHub Actions workflows（约束 #4） |
| `a7f0c6a` | chore(release) | 版本同步脚本 + 发布清单（约束 #6） |
| `d11aacc` | docs | CHANGELOG + CONTRIBUTING + ACCEPTANCE_TEST（约束 #5） |
| `b6da763` | docs | README 重写 |
| `27f3e57` | style | cargo fmt 格式统一 |

## 4. 验证结果

| 套件 | 结果 |
| --- | --- |
| `npm run lint` | ✅ 0 errors（10 warnings，均为预存非本次引入） |
| `npm run typecheck` | ✅ 通过 |
| `npm test` | ✅ 106 passed (17 files) |
| `cargo fmt -- --check` | ✅ 无 diff |
| `cargo clippy -- -D warnings` | ✅ 0 warnings |
| `cargo test --lib` | ✅ 12 passed |

## 5. 发布路线（Beta → Stable）

### 5.1 Beta Release（当前可达）
1. 本地或 CI 执行 `npm run tauri -- build`（arm64 runner）。
2. 产物：`Axiom_<version>_aarch64.dmg`（adhoc 签名，未公证）。
3. 按 [ACCEPTANCE_TEST.md](./ACCEPTANCE_TEST.md) 执行真实用户验收。
4. 验收通过后：
   - `node scripts/bump-version.mjs 0.1.0`（或对应版本）
   - `git tag v0.1.0 && git push origin v0.1.0`
   - GitHub Actions `release.yml` 自动构建并创建 GitHub Release（标记为 prerelease）。
5. 用户安装需右键「打开」或 `xattr -dr com.apple.quarantine` 解除 Gatekeeper。

### 5.2 Stable Release（前置条件）
- [ ] 获得 Apple Developer Program（$99/年）
- [ ] 申请 Developer ID Application 证书
- [ ] 生成 App-specific password
- [ ] 在 GitHub 仓库 Secrets 配置 7 项 `APPLE_*` 凭据
- [ ] 验证 `codesign -dv` 显示 `Signature=valid` + 正确 Team ID
- [ ] 验证 `spctl -a -vv --assess Axiom.app` 通过
- [ ] 全新 Mac 双击 DMG 可直接安装

详见 [RELEASE_CHECKLIST.md](./RELEASE_CHECKLIST.md) §4。

## 6. 遗留事项（非阻塞 Beta）

| 事项 | 严重度 | 计划 |
| --- | --- | --- |
| 真实用户 Acceptance Test 尚未执行 | 高 | Beta 发布前必须按 [ACCEPTANCE_TEST.md](./ACCEPTANCE_TEST.md) 走查并签字 |
| 代码签名 / 公证未启用 | 高 | Stable Release 前置条件，路线已明确 |
| 仅 arm64 | 中 | 视用户需求补 x86_64 vision 二进制或交叉编译 Universal |
| CSP 关闭（`csp: null`） | 中 | 评估收紧 CSP，需回归测试白屏问题 |
| GitHub 仓库 remote 未配置 | 中 | 发布前需配置 origin remote 并 push |
| 前端 JS bundle 920KB | 低 | 可后续 code-split，非阻塞 |

## 7. 结论

Phase 2「Production Distributable」目标已达成：

- **CI/CD**：lint + typecheck + test + clippy + fmt 全套自动化，release workflow 含架构检测与可选签名公证。
- **版本管理**：三处版本号同步脚本，semver + 预发布后缀支持。
- **文档体系**：README + CHANGELOG + CONTRIBUTING + RELEASE_CHECKLIST + ACCEPTANCE_TEST 五件齐全。
- **Beta 边界**：明确未签名 DMG = Beta Release，签名公证路线完整（约束 #6）。
- **真实用户验收机制**：9 组用例 + 签字模板就绪（约束 #5），等待执行。

**下一步行动**：按 [RELEASE_CHECKLIST.md](./RELEASE_CHECKLIST.md) §3 流程执行 Beta 构建 + 真实用户 Acceptance Test，通过后打 tag 触发 GitHub Actions 发布。
