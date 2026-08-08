# 下一轮实施计划

本计划只推进“教材约束的错题 AI 分析”和“可靠可诊断 AI”，并让该路径成为 Design System 首批消费者。不开展 Today、调度、变式题或大规模 UI 重写。

| Phase | 目标与依赖 | 涉及模块 | 验证与 DoD |
| --- | --- | --- | --- |
| 1. Error/Run contract | 无依赖；定义稳定错误 code、attempt、retry/fallback policy。 | `src-tauri/src/ai.rs`, `src/ai/provider.ts`, `src/platform/database.ts`, `domain/models.ts`, `ProblemLibrary`、ui ErrorState；新增 migration 0030（或更高）只加字段/attempt table。 | fixture 覆盖 401/429/5xx/network/timeout/malformed JSON/schema/SQLite；UI 显示明确标题与 action；不泄露 key。 |
| 2. Resolve route | 依赖 Phase 1；分析前解析 effective subject/textbook。 | `domain/problemTextbook.ts`, `horizonDatabase.ts`, `database.ts`, `ai/pipeline.ts`, `ProblemTags.tsx`；可新增 route audit migration。 | 单教材自动；多教材 locked/metadata；平分 unresolved；不会覆盖 user lock/跨科目。 |
| 3. Constrained context | 依赖 route；检索有限 active canonical tags/node evidence，升级 prompt/schema。 | `problemAnalysisContract.ts`, schema+generator, parser, `horizonDatabase.ts`, `pipeline.ts`。 | prompt 不含其他教材；canonical id 验证；unknown 进入 review candidate；历史 v3 run 仍可读。 |
| 4. Persist/present | 依赖 Phase 3；原子 ProblemTag/difficulty、结果说明和审核。 | `database.ts`, `horizonDatabase.ts`, `ProblemTags.tsx`, `ReviewCenter.tsx`。 | 成功 run 的 mapped/candidate/unmapped 可解释；锁定标签保留；mapping failure 令 run failed with `MAPPING_ERROR`。 |
| 5. UI foundation slice | 与 1–4 同步；tokens/primitives 落到错误、教材 picker、tag/status/task。 | `index.css`, `components/ui/*`, `Icon.tsx`, feature CSS。 | Listbox 无 Unicode icon；38px controls 对齐；820×620/normal/large、dark、keyboard/reduce-motion QA。 |
| 6. E2E/recovery | 最后；不改变 product scope。 | tests、test fixtures、optional local DB copy。 | 新装/升级 migration、restart pending run、fallback、manual match、failed page、AI success/failure 全通过。 |

执行纪律：每 phase 单独 commit；先新增/兼容读取再迁移写入；迁移编号只递增；不修改 0001–0029；每个 phase 跑 `npm run lint && npm run typecheck && npm test -- --run`、`cargo fmt -- --check && cargo clippy -- -D warnings && cargo test --lib`，并在真实 App 验证主路径。任何实际 provider E2E 要使用非生产密钥和可审计 test fixture。
