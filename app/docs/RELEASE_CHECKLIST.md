# 发布检查清单与 Beta Release 路线

> 本文档定义 Axiom 的发布流程、Beta Release 边界，以及未来签名公证的完整路线。
> 对应执行约束 #6：未签名 DMG 只能作为 Beta Release，必须明确未来签名公证路线。

## 1. 版本号约定

采用 [Semantic Versioning](https://semver.org/)：

| 版本格式 | 含义 | 发布类型 |
| --- | --- | --- |
| `0.1.0` | 初始 Beta | Beta Release（未签名） |
| `0.1.x` | Bug 修复 | Beta Release（未签名） |
| `0.x.0-beta.N` | 预发布 | Beta Release（未签名） |
| `1.0.0` | 首个正式版 | **Stable Release（签名 + 公证）** |

> **原则**：在获得 Apple Developer ID 签名 + 公证能力之前，所有版本均为 Beta Release。

## 2. Beta Release 定义（当前状态）

当前构建状态：
- **签名类型**：adhoc（链接器临时签名），非 Apple Developer ID
- **公证状态**：未公证
- **Gatekeeper 行为**：用户首次打开会看到「无法验证开发者」拦截

### 用户安装步骤（Beta）
1. 下载 `.dmg`
2. 打开 DMG，拖动 Axiom 到「应用程序」
3. 右键 Axiom →「打开」→「打开」确认（绕过 Gatekeeper）
4. 或终端执行：`xattr -dr com.apple.quarantine /Applications/Axiom.app`

### Beta Release 接受标准
- [x] Release Build 成功（`npm run tauri -- build`）
- [x] 应用可启动、可创建数据目录
- [x] 日志写入正确目录
- [x] API Key 持久化于本地 SQLite（不回传前端、日志不落密钥）
- [x] 全部测试通过（`npm test` + `cargo test --lib`）
- [x] Clippy / Fmt / Typecheck 无错误
- [ ] **真实用户 Acceptance Test 通过**（见 [ACCEPTANCE_TEST.md](./ACCEPTANCE_TEST.md)）
- [x] 发布说明已写明「Beta / 未签名 / Gatekeeper 提示」

## 3. 发布流程（Beta）

```bash
# 1. 确认工作区干净
cd /path/to/Axiom
git status

# 2. 运行完整检查
cd app && npm run lint && npm run typecheck && npm test
cd src-tauri && cargo fmt -- --check && cargo clippy -- -D warnings && cargo test --lib

# 3. 构建 Release（arm64）
cd /path/to/Axiom/app
# Beta 本地构建也必须在打包阶段写入完整 ad-hoc bundle 签名。
APPLE_SIGNING_IDENTITY=- npm run tauri -- build
# Tauri 会把主 App 权限误用于 externalBin；必须补签沙盒继承权限并重建 DMG。
bash scripts/finalize-macos-bundle.sh \
  "$PWD/src-tauri/target/release/bundle/macos/Axiom.app" \
  "$PWD/src-tauri/target/release/bundle/dmg/Axiom_<version>_aarch64.dmg"

# 4. 验证产物
ls -la src-tauri/target/release/bundle/dmg/
codesign --verify --deep --strict src-tauri/target/release/bundle/macos/Axiom.app
codesign -dv src-tauri/target/release/bundle/macos/Axiom.app  # 确认签名身份

# 5. 同步版本号（如需更新）
node scripts/bump-version.mjs <new-version>

# 6. 提交并打 tag
cd /path/to/Axiom
git add -A && git commit -m "chore: bump version to <new-version>"
git tag v<new-version>
git push origin main --tags
# → GitHub Actions release.yml 自动构建并创建 GitHub Release

# 7. 真实用户 Acceptance Test（见 ACCEPTANCE_TEST.md）
```

> **注意**：GitHub Actions 需先配置仓库 remote。本地构建产物可直接分发给 Beta 用户。

## 4. 签名公证路线（Stable Release 前置条件）

### 4.1 所需资源
| 资源 | 说明 | 获取方式 |
| --- | --- | --- |
| Apple Developer Program | 年费 $99 | https://developer.apple.com/programs/ |
| Developer ID Application 证书 | 用于签名 .app | Keychain Access → 证书助理 → 申请 |
| App-specific password | 用于 notarytool | Apple ID 账户 → App 专用密码 |
| Team ID | 开发者团队 ID | Developer Portal |

### 4.2 GitHub Secrets 配置
在仓库 Settings → Secrets and variables → Actions 中配置：

| Secret | 说明 |
| --- | --- |
| `APPLE_CERTIFICATE` | Developer ID Application 证书（.p12，base64 编码） |
| `APPLE_CERTIFICATE_PASSWORD` | .p12 导出密码 |
| `APPLE_SIGNING_IDENTITY` | 签名身份名，如 `Developer ID Application: Your Name (TeamID)` |
| `APPLE_ID` | Apple ID 邮箱 |
| `APPLE_PASSWORD` | App 专用密码 |
| `APPLE_TEAM_ID` | Team ID |
| `RUNNER_TEMP_PASSWORD` | CI 临时钥匙串密码（任意强密码） |

### 4.3 启用签名后的流程
1. 配置上述 Secrets。
2. `.github/workflows/release.yml` 中的「Setup signing」步骤自动激活。
3. 构建产物自动使用 Developer ID 签名。
4. `notarytool submit --wait` 提交公证并等待通过。
5. `stapler staple` 给 DMG 打上公证票据。
6. 用户双击 DMG 即可安装，无 Gatekeeper 拦截。

### 4.4 本地签名（开发验证）
```bash
# 签名
codesign --deep --force --options runtime \
  --sign "Developer ID Application: Your Name (TeamID)" \
  --entitlements src-tauri/Entitlements.plist \
  src-tauri/target/release/bundle/macos/Axiom.app

# 公证
xcrun notarytool submit Axiom.dmg \
  --apple-id you@example.com \
  --password <app-specific-password> \
  --team-id <TeamID> --wait

# Staple
xcrun stapler staple Axiom.dmg
```

### 4.5 签名后验证清单
- [ ] `codesign -dv` 显示 `Signature=adhoc` → `Signature=valid`
- [ ] `test -x Axiom.app/Contents/MacOS/axiom-vision` 通过，且 `file` 显示与发布架构一致
- [ ] `codesign --verify --strict Axiom.app/Contents/MacOS/axiom-vision` 通过
- [ ] helper 的签名标识为 `com.axiom.study.vision`，权限仅包含 App Sandbox 与 Inherit
- [ ] `TeamIdentifier` 显示正确的 Team ID
- [ ] `spctl -a -vv --assess Axiom.app` 通过（notarized）
- [ ] 全新 Mac 双击 DMG 可直接安装，无 Gatekeeper 拦截
- [ ] API Key 读写正常（SQLite 本地存储；旧 Keychain 数据一次性回迁为 best-effort）

## 5. 架构覆盖路线

当前仅 arm64（Apple Silicon）。扩展计划：

| 目标 | 所需动作 | 优先级 |
| --- | --- | --- |
| arm64（当前） | ✅ 已支持 | — |
| Universal Binary | 编译 `axiom-vision-x86_64-apple-darwin`；`cargo build --target universal-apple-darwin` | Beta 后 |
| x86_64 独立 | 提供 x86_64 vision 二进制；CI 在 x86_64 runner 构建 | 视用户需求 |

> GitHub Actions `release.yml` 已内置架构检测（约束 #4），不假设 runner 为 arm64。

## 6. 发布后监控
- 收集 Beta 用户反馈（Gatekeeper、API Key 存储与回迁、数据库路径、AI 调用）
- 关注日志路径 `~/Library/Application Support/com.axiom.study/logs/axiom.log`
- 数据库路径不一致问题已在 Phase 1 修复，但仍需关注迁移用户
