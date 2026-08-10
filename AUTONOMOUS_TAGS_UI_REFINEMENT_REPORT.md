# Axiom Autonomous Tags & UI Refinement Report

## 1. Scope and baseline

This implementation continued from `1a7aec3` on branch `codex/autonomous-tags-and-compact-ui`. The baseline workspace contained user-owned changes in `PRD.md`, `app/src/App.css`, `app/src/ai/solution.schema.json`, `.qa-shots/`, `icons/horizon-text-icon.png`, and the local textbook PDF under `test/`; none of them is part of this delivery.

The baseline debug application reproduced the reported product problems: Problem Detail exposed AI/manual provenance, confirmation and evidence metadata; tag actions were text buttons; tag items consumed one row each; the page offered a textbook picker; and the shared error disclosure was named “技术信息”. The repository migration maximum remained 0032. No migration was added or modified in this round.

## 2. User-visible concepts removed

Problem Detail no longer exposes AI recognition/addition, manual provenance, confirmation lifecycle, mapping outcome, evidence provenance, textbook match state, textbook reason, or textbook selection. A present tag is now simply rendered as a tag. Difficulty remains a lightweight single-value badge. The subject-change confirmation was rewritten in product language and no longer asks the user to understand textbook matching.

Curriculum review terminology was intentionally preserved where a human really is moderating textbook knowledge structure. Internal database/domain values such as `model`, `manual`, `locked`, `user_verified`, `canonical`, `unresolved`, resolver source, candidate count, and evidence remain for compatibility, integrity rules, diagnostics, relabel recovery, and historical ModelRun reads. They are not rendered in ordinary Problem Detail.

## 3. Add/remove icons and ErrorState

`Icon.tsx` now provides the shared `plus` glyph. Every ProblemTags section uses the existing Design System `IconButton` with a 16px `Icon`, token-sized control, hover/focus styling, and semantic labels such as `添加知识点` and `移除一次函数`. Remove actions are compact trailing close icons inside the chip, not text buttons or Unicode glyphs. The final QA adjustment also removed `tag.evidence` from the chip title so an incidental browser tooltip cannot reintroduce pipeline provenance.

The shared `ErrorState` disclosure now reads “详情”. Its existing semantic `<details>/<summary>` behavior, safe technical content, retry action, secondary action, centered bounded panel, and left-aligned copy remain shared by all consumers.

## 4. Compact tag layout

ProblemTags remains a container-query component. Category panels use `repeat(2, minmax(0, 1fr))` and collapse to one column from the component’s actual width at 640px. Each collection is a wrapping flex container; each chip is `inline-flex`, `width: fit-content`, `min-width: 0`, and `max-width: 100%`. Short tags pack left-to-right without a fixed per-row count. Long Chinese names wrap inside the badge and reserve one token-sized trailing remove target, preventing horizontal overflow.

All new layout values consume Design System spacing, radius, border, surface, typography, control-size, danger, and focus behavior. No hex color, arbitrary font size/radius, Unicode UI icon, JavaScript width measurement, or duplicate Select/Button was introduced.

## 5. Textbook Picker removal

ProblemTags no longer renders a textbook title, resolver status, missing-textbook prompt, picker, lock, clear, or change action. The knowledge-tag add dialog still uses the internally resolved textbook ID to constrain selectable knowledge definitions, but that routing is invisible and non-interactive. Historical `setProblemTextbookMatch` support and database lock columns remain readable for compatibility; no new UI can create or edit a lock.

## 6. Autonomous resolver architecture

The pre-analysis path is now:

`Problem → effective subject → eligible same-subject textbooks → deterministic resolution → constrained AI ID selection when ambiguous → stable fallback → ResolvedTextbookContext → bounded canonical knowledge candidates → analysis → validated transactional tags`

The effective subject and eligible extraction semantics are unchanged. Resolution order is:

1. A historical locked binding, when subject integrity is valid.
2. A previously persisted, still eligible binding, ensuring stable re-analysis.
3. The only eligible same-subject textbook.
4. A clear deterministic metadata winner using grade, volume, publisher, edition, and title evidence.
5. A lightweight structured AI stage restricted to server-supplied candidate IDs.
6. A stable fallback to the most recently updated eligible same-subject textbook, with ID as deterministic tie-breaker.

The AI stage receives only subject, problem text, candidate identity/metadata, and at most eight short knowledge-node path fingerprints per textbook. It does not receive whole textbooks. Its schema contains only `selected_textbook_id`; the service re-queries eligible same-subject textbooks and accepts the result only if the ID still belongs to that set. A fabricated, missing, archived, failed-extraction, or cross-subject ID cannot be persisted.

If the resolver provider fails or returns an illegal ID, the failure is stored as safe internal decision detail and resolution uses the stable fallback. Textbook ambiguity never becomes an ErrorState and never asks the user to intervene. With zero eligible textbooks, analysis proceeds without `ResolvedTextbookContext`; general method/type/error results remain available and the UI does not take over with a picker.

The decision audit retains resolver version `problem-textbook-resolver-v2-autonomous`, effective subject, candidate count, selected ID, source, reason, attempted AI ID, provider, model, ModelRun ID, acceptance flag, and safe failure summary. No provider response or credential is exposed in Problem Detail.

## 7. Scoped knowledge integrity and compatibility

Canonical candidate retrieval remains server-side and uses only the final selected textbook and effective subject. Knowledge definitions must be active, unarchived, backed by an unmerged KnowledgeNode, and match that textbook/subject. Ranking remains bounded to 30 prompt candidates. Existing controlled mapping revalidates canonical IDs and retains atomic ProblemTag/difficulty persistence; cross-textbook hallucinations remain rejected. Independent/unresolved model tags can be displayed as ordinary tags without a confirmation or mapping UI.

Historical model schemas, ModelRun error envelopes, ProviderAttempt JSON/storage, relabel claim/recovery, confirmed/locked ProblemTag protection, database subject constraints, and migrations 0001–0032 were not rewritten. Existing old lock data remains the highest-priority compatible binding.

## 8. Automated verification

| Check | Result |
| --- | --- |
| `npm run lint` | PASS — 0 errors; 11 pre-existing warnings, no new warning |
| `npm run typecheck` | PASS |
| `npm test -- --run` | PASS — 44 files, 357 tests before final QA adjustment |
| `npm run build` | PASS |
| `cargo fmt -- --check` | PASS |
| `cargo clippy -- -D warnings` | PASS |
| `cargo test --lib` | PASS — 49 tests |
| Fresh/upgrade migration tests | PASS — schema reaches 0032 |

Coverage includes zero/one/multiple textbooks, deterministic winner and metadata tie, historical lock, persisted re-analysis, constrained AI winner, illegal/cross-subject AI ID, resolver failure, stable fallback, selected-textbook-only knowledge retrieval, ModelRun correlation, prompt/schema parsing, canonical context bounds, responsive source contracts, icon actions, forbidden product wording, and shared ErrorState wording.

## 9. Computer Use QA

The workspace debug bundle at commits 10bccb8/796cd26 was operated directly (not `/Applications/Axiom.app`). At 1180×760, short method tags packed on one row and mixed/long knowledge tags wrapped naturally with compact plus/close actions. At 820×620, the component switched to one column without horizontal overflow, fixed row counts, textbook controls, provenance rows, or nested scrolling. The same session verified the current dark appearance and existing problem-detail navigation.

The final `cec4533` debug bundle was successfully rebuilt at `app/src-tauri/target/debug/bundle/macos/Axiom.app`. Final post-resolver Computer Use is pending because macOS is locked and automatic unlock is paused after physical input. The local database was inspected read-only: schema version 32, six saved problems, one active eligible mathematics textbook, 74 completed/27 failed/1 cancelled historical runs. This gives a real single-textbook zero-intervention scenario; multi-textbook, provider failure, illegal ID, and no-textbook behavior are covered by isolated tests without modifying user data.

## 10. Bugs discovered and fixed

| Finding | Fix |
| --- | --- |
| Provenance, confirmation and evidence rows dominated ProblemTags | Removed all default pipeline metadata and lifecycle actions |
| Text add/remove controls created noise | Replaced with shared accessible icon actions |
| Each tag behaved like a full row | Rebuilt collection/chip geometry as responsive flex flow |
| Long tags could own a whole row or overflow | Added bounded chip/badge sizing and anywhere wrapping |
| Textbook ambiguity required user intervention | Added constrained AI resolver plus safe stable fallback |
| Re-analysis could reconsider an already valid automatic binding | Added persisted eligible resolution priority |
| Resolver audit initially correlated with problem ID | Corrected it to the actual ModelRun ID |
| Subject-change dialog leaked textbook matching concepts | Reworded it as automatic tag reorganization |
| Tag title could expose raw evidence on hover | Removed the evidence tooltip in final QA adjustment |

## 11. Commits

| Commit | Purpose |
| --- | --- |
| `10bccb8 refactor(ui): remove AI provenance from problem tags` | Product concepts, icon actions, shared ErrorState wording |
| `796cd26 fix(ui): pack problem tags into responsive flows` | Compact chips and continuous responsive packing |
| `cec4533 feat(horizon): make textbook resolution autonomous` | Two-stage resolver, safe fallback, audit, compatibility and tests |
| Pending final QA commit | Final visual adjustment, report and post-lock Computer Use evidence |

## 12. Remaining issues and deferred work

The JavaScript production bundle remains above Vite’s 500kB advisory threshold, and frontend lint retains 11 unrelated baseline warnings. Neither was introduced here. Real multi-textbook and no-textbook scenarios were not fabricated in the user database; they are deterministically covered by service tests. A live external-provider AI resolver call can only occur with multiple active eligible same-subject textbooks, while the current user database contains one. Final unlocked Computer Use and the real single-textbook re-analysis remain required before closing this report.

## 13. Acceptance criteria

| Criterion | Status | Evidence |
| --- | --- | --- |
| No AI/provenance/matching/confirmation/confidence/taxonomy UI in ProblemTags | PASS | Source contract and real compact-flow QA |
| Add/remove use shared icons with accessible labels and focus behavior | PASS | `IconButton`, source contract, real QA |
| ErrorState uses “详情” | PASS | Shared primitive test |
| Tags pack continuously, wrap, and constrain long names | PASS | CSS contract and 820×620/1180×760 QA |
| Problem Detail has no textbook picker | PASS | Component removal and real QA |
| One eligible textbook resolves automatically | PASS | Domain/database tests; real DB contains eligible scenario |
| Multiple textbooks use deterministic then constrained AI | PASS | Service and pipeline tests |
| Illegal/cross-subject IDs are rejected; provider failure falls back | PASS | Database integration tests |
| Zero textbooks never requests user takeover | PASS | Resolver and pipeline behavior tests |
| Knowledge context is selected-textbook scoped and bounded | PASS | Query assertions and context tests |
| Historical locks/runs and controlled transactional persistence remain compatible | PASS | Regression/migration suite |
| Curriculum and problem flows have no automated regression | PASS | Frontend/Rust suites and earlier real navigation |
| Light/Dark, dialog Escape/focus, ErrorState disclosure in final bundle | BLOCKED | macOS locked; final Computer Use pending |
| Final real single-textbook zero-intervention re-analysis | BLOCKED | macOS locked; final Computer Use pending |
