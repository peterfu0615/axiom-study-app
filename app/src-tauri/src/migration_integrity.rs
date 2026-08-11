//! 迁移完整性常设测试。
//!
//! 背景：sqlx Migrator（tauri-plugin-sql 内部路径）会把每个迁移包进外层
//! 事务，而历史版本号 24–27（来自 codex/horizon-quality-upgrade 分支，
//! 用户真实库已应用）自带裸 BEGIN IMMEDIATE/COMMIT，直接交给 Migrator 会
//! 触发 "cannot start a transaction within a transaction"。因此生产路径由
//! db::migrate_embedded_schema 在启动期执行：剥离最外层事务后运行，并按
//! 原文 SHA-384 写入/校验 _sqlx_migrations。本测试全部走同一 runner：
//!   1. 全新库一路跑到 43，且与 sqlx Migrator 校验兼容（幂等重跑）；
//!   2. 27 状态的库可以升级到 43；
//!   3. 用户真实库副本（/tmp/axiom-verify.db，人工预置）能通过 checksum
//!      校验并推进到 43；
//!   4. 0028 对同层重复节点完成清理、子节点重指与幂等重放；
//!   5. 0029 表重建后既有 textbook_pages 数据完整且接受 'failed'。
//!
//! 所有验证只使用临时文件，绝不触碰用户真实数据库。

#[cfg(test)]
mod tests {
    use crate::axiom_migrations;
    use crate::db::migrate_embedded_schema;
    use sha2::{Digest, Sha384};
    use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode};
    use sqlx::{ConnectOptions, Executor, Row, SqliteConnection};
    use tauri_plugin_sql::Migration;

    /// 临时库守卫：测试结束（含 panic）时删除 db 文件及其 WAL 伴生文件。
    struct TempDb {
        path: std::path::PathBuf,
    }

    impl TempDb {
        fn new(tag: &str) -> Self {
            let unique = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|duration| duration.as_nanos())
                .unwrap_or_default();
            let path = std::env::temp_dir().join(format!(
                "axiom-migration-test-{tag}-{}-{}.db",
                std::process::id(),
                unique
            ));
            Self { path }
        }
    }

    impl Drop for TempDb {
        fn drop(&mut self) {
            for suffix in ["", "-wal", "-shm"] {
                let mut file = self.path.clone().into_os_string();
                file.push(suffix);
                let _ = std::fs::remove_file(std::path::PathBuf::from(file));
            }
        }
    }

    /// 与生产完全一致的迁移列表（同一份 include_str 原文），截断到指定版本。
    fn migrations_up_to(max_version: i64) -> Vec<Migration> {
        axiom_migrations()
            .into_iter()
            .filter(|migration| migration.version <= max_version)
            .collect()
    }

    async fn connect(temp: &TempDb) -> SqliteConnection {
        let options = SqliteConnectOptions::new()
            .filename(&temp.path)
            .create_if_missing(true)
            .journal_mode(SqliteJournalMode::Wal);
        options.connect().await.expect("临时测试库连接必须成功")
    }

    async fn max_applied_version(conn: &mut SqliteConnection) -> i64 {
        sqlx::query_scalar("SELECT COALESCE(MAX(version), 0) FROM _sqlx_migrations")
            .fetch_one(&mut *conn)
            .await
            .expect("迁移记录表必须可读")
    }

    /// 全新库必须能一路跑到 43（含 codex 原文的 24–27 与后续迁移的衔接）。
    /// 随后用与 sqlx Migrator 完全一致的校验逻辑重跑两遍：
    ///   - embedded runner 幂等（全部已应用，不再执行任何脚本）；
    ///   - sqlx Migrator（plugin 的同款路径）校验 checksum 全部通过且不应用。
    #[test]
    fn fresh_database_reaches_43_and_stays_sqlx_compatible() {
        tauri::async_runtime::block_on(async {
            let temp = TempDb::new("fresh");
            let mut conn = connect(&temp).await;
            let migrations = migrations_up_to(43);
            migrate_embedded_schema(&mut conn, &migrations)
                .await
                .expect("全新库必须能完整迁移到 43（裸 BEGIN 由 runner 剥离）");
            assert_eq!(max_applied_version(&mut conn).await, 43);

            // 幂等重跑：不得重复执行、不得报错。
            migrate_embedded_schema(&mut conn, &migrations)
                .await
                .expect("embedded runner 必须幂等");
            assert_eq!(max_applied_version(&mut conn).await, 43);

            // plugin 闭环：即使用 sqlx Migrator 的原文校验路径再走一遍，
            // 也应全部通过（checksum 一致、无缺号），不执行任何迁移。
            let plugin_migrator = sqlx::migrate::Migrator {
                migrations: std::borrow::Cow::Owned(
                    migrations
                        .iter()
                        .map(|migration| {
                            sqlx::migrate::Migration::new(
                                migration.version,
                                migration.description.into(),
                                sqlx::migrate::MigrationType::ReversibleUp,
                                migration.sql.into(),
                                false,
                            )
                        })
                        .collect(),
                ),
                ..sqlx::migrate::Migrator::DEFAULT
            };
            plugin_migrator
                .run(&mut conn)
                .await
                .expect("sqlx Migrator 校验必须通过（checksum 与版本列表一致）");
        });
    }

    /// 迁移列表完整性：版本必须恰好为 1..=43 且严格递增。
    /// 用户真实库已应用 codex 分支的 24–27，列表缺号会让任何校验拒绝启动。
    #[test]
    fn migration_list_covers_versions_1_through_43_exactly() {
        let versions: Vec<i64> = axiom_migrations()
            .iter()
            .map(|migration| migration.version)
            .collect();
        let expected: Vec<i64> = (1..=43).collect();
        assert_eq!(versions, expected, "迁移列表必须严格等于 1..=43");
    }

    #[test]
    fn diagram_source_and_rendered_asset_constraints_survive_restart() {
        tauri::async_runtime::block_on(async {
            let temp = TempDb::new("diagram");
            let mut conn = connect(&temp).await;
            migrate_embedded_schema(&mut conn, &migrations_up_to(42))
                .await
                .expect("Diagram schema must migrate");
            conn.execute("INSERT INTO diagrams (id, owner_type, owner_id, source_type, source, render_status, rendered_asset_path, rendered_mime_type, render_hash, renderer_version, created_at, updated_at) VALUES ('diagram-1', 'practice_item', 'future-item-1', 'tikz', '\\draw (0,0)--(1,1);', 'rendered', '/tmp/cache.svg', 'image/svg+xml', 'hash-1', 'renderer-v1', 1, 1)")
                .await.expect("source and rendered representation should persist together");
            let snapshot: (String, String, String) = sqlx::query_as(
                "SELECT source, rendered_asset_path, render_hash FROM diagrams WHERE id='diagram-1'",
            )
            .fetch_one(&mut conn)
            .await
            .expect("diagram snapshot should be readable");
            assert_eq!(snapshot.0, "\\draw (0,0)--(1,1);");
            assert_eq!(snapshot.1, "/tmp/cache.svg");
            assert_eq!(snapshot.2, "hash-1");

            let invalid_owner = conn.execute("INSERT INTO diagrams (id, owner_type, owner_id, source_type, source, render_status, render_hash, renderer_version, created_at, updated_at) VALUES ('diagram-bad-owner', 'pdf', 'x', 'tikz', 'x', 'failed', 'hash', 'v1', 1, 1)").await;
            assert!(
                invalid_owner.is_err(),
                "unknown owner types must be rejected"
            );
            let missing_asset = conn.execute("INSERT INTO diagrams (id, owner_type, owner_id, source_type, source, render_status, render_hash, renderer_version, created_at, updated_at) VALUES ('diagram-missing-asset', 'problem', 'x', 'tikz', 'x', 'rendered', 'hash', 'v1', 1, 1)").await;
            assert!(missing_asset.is_err(), "rendered diagrams require an asset");

            drop(conn);
            let mut reopened = connect(&temp).await;
            migrate_embedded_schema(&mut reopened, &migrations_up_to(42))
                .await
                .expect("diagram migration must be restart-safe");
            assert_eq!(max_applied_version(&mut reopened).await, 42);
        });
    }

    #[test]
    fn practice_set_snapshot_survives_restart_and_rejects_invalid_items() {
        tauri::async_runtime::block_on(async {
            let temp = TempDb::new("practice");
            let mut conn = connect(&temp).await;
            migrate_embedded_schema(&mut conn, &migrations_up_to(43))
                .await
                .expect("Practice 测试库必须迁移成功");
            conn.execute("INSERT INTO source_documents(id, original_image_path, content_hash, source_type, processing_status, captured_at, created_at) VALUES ('doc-practice', '/tmp/practice.png', 'practice-hash', 'import', 'captured', 1, 1)").await.expect("source fixture");
            conn.execute("INSERT INTO problems(id, source_document_id, subject, stem_markdown, status, created_at, updated_at) VALUES ('problem-practice', 'doc-practice', '数学', '求 x', 'saved', 1, 1)").await.expect("problem fixture");
            conn.execute("INSERT INTO skill_bundles(id, subject, canonical_key, primary_knowledge_tag_id, difficulty_context, created_at) VALUES ('bundle-practice', '数学', 'practice-key', 'legacy:problem-practice', 'basic', 1)").await.expect("bundle fixture");
            conn.execute("INSERT INTO practice_sets(id, subject, source_type, source_ref, strategy, status, target_skills_json, generation_metadata_json, created_at, updated_at) VALUES ('set-practice', '数学', 'review_unit', 'module-practice', 'deterministic-v1', 'ready', '[{\"id\":\"bundle-practice\"}]', '{\"budget\":1}', 2, 2)").await.expect("practice set fixture");
            conn.execute("INSERT INTO practice_items(id, practice_set_id, order_index, source_type, source_problem_id, subject, target_skill_bundle_id, difficulty, statement_markdown, canonical_answer, solution_json, grading_rubric_json, validation_status, created_at) VALUES ('item-practice', 'set-practice', 0, 'existing_problem', 'problem-practice', '数学', 'bundle-practice', 'basic', '求 x', 'x=2', '{\"steps\":[]}', '{\"criteria\":[\"答案正确\"]}', 'valid', 2)").await.expect("practice item fixture");
            conn.execute("INSERT INTO practice_documents(id, practice_set_id, attempt_id, document_type, layout_version, content_hash, status, file_path, page_count, metadata_json, created_at, updated_at) VALUES ('pdf-practice', 'set-practice', 'attempt-practice', 'answer_sheet', 'practice-a4-v1', 'pdf-hash', 'ready', '/tmp/practice.pdf', 1, '{}', 3, 3)").await.expect("practice document fixture");
            conn.execute("INSERT INTO practice_document_pages(id, practice_document_id, page_index, page_identity, qr_payload, width_points, height_points, created_at) VALUES ('page-practice', 'pdf-practice', 0, 'page-identity-practice', 'AXIOM|set=set-practice|attempt=attempt-practice|page=0', 595.28, 841.89, 3)").await.expect("practice page fixture");
            conn.execute("INSERT INTO practice_answer_regions(id, practice_document_page_id, practice_item_id, region_index, x, y, width, height, created_at) VALUES ('region-practice', 'page-practice', 'item-practice', 0, .1, .2, .8, .2, 3)").await.expect("practice answer region fixture");

            drop(conn);
            let mut reopened = connect(&temp).await;
            migrate_embedded_schema(&mut reopened, &migrations_up_to(43))
                .await
                .expect("Practice 数据库重启后迁移必须幂等");
            let snapshot: (String, String, String, String) = sqlx::query_as("SELECT set_row.source_type, set_row.strategy, item.statement_markdown, item.canonical_answer FROM practice_sets set_row JOIN practice_items item ON item.practice_set_id=set_row.id WHERE set_row.id='set-practice'")
                .fetch_one(&mut reopened).await.expect("读取 Practice 快照");
            assert_eq!(
                snapshot,
                (
                    "review_unit".into(),
                    "deterministic-v1".into(),
                    "求 x".into(),
                    "x=2".into()
                )
            );
            let identity: (String, String, String) = sqlx::query_as("SELECT document.attempt_id, page.qr_payload, region.practice_item_id FROM practice_documents document JOIN practice_document_pages page ON page.practice_document_id=document.id JOIN practice_answer_regions region ON region.practice_document_page_id=page.id WHERE document.id='pdf-practice'")
                .fetch_one(&mut reopened).await.expect("读取 PDF 页面身份与答题区域");
            assert_eq!(identity.0, "attempt-practice");
            assert!(identity.1.contains("set=set-practice"));
            assert_eq!(identity.2, "item-practice");
            reopened.execute("INSERT INTO practice_attempts(id, practice_set_id, status, started_at, created_at, updated_at) VALUES ('attempt-practice', 'set-practice', 'captured', 4, 4, 4)").await.expect("practice attempt fixture");
            reopened.execute("INSERT INTO practice_attempt_pages(id, practice_attempt_id, practice_document_page_id, source_asset_path, corrected_asset_path, qr_payload, orientation_degrees, geometry_json, status, created_at) VALUES ('attempt-page-practice', 'attempt-practice', 'page-practice', '/tmp/scan.jpg', '/tmp/corrected.jpg', 'AXIOM|set=set-practice|attempt=attempt-practice|page=0', 90, '{\"pageDetected\":true}', 'captured', 4)").await.expect("practice attempt page fixture");
            reopened.execute("INSERT INTO practice_responses(id, practice_attempt_id, practice_item_id, answer_asset_path, status, created_at, updated_at) VALUES ('response-practice', 'attempt-practice', 'item-practice', '/tmp/answer.jpg', 'captured', 4, 4)").await.expect("practice response fixture");
            let capture: (String, String, i64) = sqlx::query_as("SELECT response.practice_item_id, page.corrected_asset_path, page.orientation_degrees FROM practice_responses response JOIN practice_attempt_pages page ON page.practice_attempt_id=response.practice_attempt_id WHERE response.id='response-practice'")
                .fetch_one(&mut reopened).await.expect("读取 PracticeAttempt 回传链路");
            assert_eq!(
                capture,
                ("item-practice".into(), "/tmp/corrected.jpg".into(), 90)
            );
            reopened.execute("INSERT INTO review_sessions(id, session_date, status, mode, planned_problem_count, estimated_duration_seconds, created_at) VALUES ('session-practice', '2026-08-11', 'generated', 'legacy', 1, 60, 4)").await.expect("practice evidence session fixture");
            reopened.execute("INSERT INTO review_modules(id, subject, session_id, skill_bundle_id, priority_score, selection_reason, target_difficulty, source_mode, estimated_duration_seconds, order_index, status) VALUES ('module-practice', '数学', 'session-practice', 'bundle-practice', 1, 'practice fixture', 'basic', 'original', 60, 0, 'pending')").await.expect("practice evidence module fixture");
            reopened.execute("INSERT INTO question_instances(id, subject, review_module_id, source_problem_id, stem_markdown, solution_json, target_tags_json, difficulty, created_at) VALUES ('question-practice', '数学', 'module-practice', 'problem-practice', '求 x', '{}', '{}', 'basic', 4)").await.expect("practice evidence question fixture");
            reopened.execute("INSERT INTO review_attempts(id, subject, question_instance_id, is_correct, created_at, rating, result_key, evidence_source) VALUES ('review-practice', '数学', 'question-practice', 0, 5, 'again', 'practice:response-practice', 'practice_attempt')").await.expect("practice review evidence fixture");
            reopened.execute("INSERT INTO practice_loops(id, root_practice_set_id, current_practice_set_id, status, round_index, item_budget, consumed_items, created_at, updated_at) VALUES ('loop-practice', 'set-practice', 'set-practice', 'needs_reinforcement', 1, 3, 1, 5, 5)").await.expect("practice loop fixture");
            reopened.execute("INSERT INTO practice_loop_rounds(id, practice_loop_id, practice_set_id, round_index, source_attempt_id, status, created_at, completed_at) VALUES ('round-practice', 'loop-practice', 'set-practice', 1, 'attempt-practice', 'completed', 5, 5)").await.expect("practice round fixture");
            reopened.execute("INSERT INTO practice_evidences(id, practice_loop_id, practice_attempt_id, practice_response_id, review_attempt_id, grading_snapshot_json, created_at) VALUES ('evidence-practice', 'loop-practice', 'attempt-practice', 'response-practice', 'review-practice', '{\"correctness\":\"incorrect\"}', 5)").await.expect("immutable practice evidence fixture");
            let repeated_evidence = reopened.execute("INSERT INTO practice_evidences(id, practice_loop_id, practice_attempt_id, practice_response_id, review_attempt_id, grading_snapshot_json, created_at) VALUES ('evidence-duplicate', 'loop-practice', 'attempt-practice', 'response-practice', 'review-practice', '{}', 6)").await;
            assert!(
                repeated_evidence.is_err(),
                "同一 response 必须只写入一次 Skill evidence"
            );
            let rewritten_response = reopened.execute("UPDATE practice_responses SET grading_result_json='{}' WHERE id='response-practice'").await;
            assert!(
                rewritten_response.is_err(),
                "已提交证据的 grading snapshot 不得被重写"
            );
            let invalid_region = reopened.execute("INSERT INTO practice_answer_regions(id, practice_document_page_id, practice_item_id, region_index, x, y, width, height, created_at) VALUES ('region-invalid', 'page-practice', 'item-practice', 1, .8, .2, .4, .2, 3)").await;
            assert!(invalid_region.is_err(), "答题区域不得越过标准化页面边界");
            let duplicate_document = reopened.execute("INSERT INTO practice_documents(id, practice_set_id, attempt_id, document_type, layout_version, content_hash, status, page_count, created_at, updated_at) VALUES ('pdf-practice-duplicate', 'set-practice', 'attempt-practice', 'answer_sheet', 'practice-a4-v1', 'new-renderer-hash', 'ready', 1, 4, 4)").await;
            assert!(
                duplicate_document.is_err(),
                "渲染器升级必须更新同一逻辑文档，不得复制页面身份"
            );
            let invalid = reopened.execute("INSERT INTO practice_items(id, practice_set_id, order_index, source_type, source_problem_id, subject, difficulty, statement_markdown, canonical_answer, solution_json, grading_rubric_json, validation_status, created_at) VALUES ('bad-practice', 'set-practice', 1, 'existing_problem', NULL, '数学', 'impossible', '', '', '{}', '{}', 'valid', 2)").await;
            assert!(
                invalid.is_err(),
                "非法难度、空题干和缺失来源不得进入正式练习集"
            );
        });
    }

    #[test]
    fn stable_subject_identity_backfills_legacy_horizon_relations() {
        tauri::async_runtime::block_on(async {
            let temp = TempDb::new("subject-id");
            let mut conn = connect(&temp).await;
            migrate_embedded_schema(&mut conn, &migrations_up_to(36))
                .await
                .expect("先建立 0036 名称关联结构");
            conn.execute("INSERT INTO subjects(name, archived_at, created_at, updated_at) VALUES ('数学', NULL, 1, 1)").await.expect("legacy subject");
            conn.execute("INSERT INTO textbooks(id, subject, title, source_type, extraction_status, created_at, updated_at) VALUES ('book-subject', '数学', '数学教材', 'manual', 'needs_review', 1, 1)").await.expect("legacy textbook");
            conn.execute("INSERT INTO knowledge_nodes(id, textbook_id, subject, canonical_name, node_type, path, created_at, updated_at) VALUES ('chapter-subject', 'book-subject', '数学', '第一章', 'chapter', '第一章', 1, 1)").await.expect("legacy chapter");
            conn.execute("INSERT INTO knowledge_nodes(id, textbook_id, subject, canonical_name, node_type, parent_id, path, created_at, updated_at) VALUES ('node-subject', 'book-subject', '数学', '一次函数', 'knowledge', 'chapter-subject', '第一章/一次函数', 1, 1)").await.expect("legacy knowledge");
            conn.execute("INSERT INTO tag_definitions(id, subject, tag_type, canonical_name, knowledge_node_id, lifecycle_status, created_at, updated_at) VALUES ('tag-subject', '数学', 'knowledge', '一次函数', 'node-subject', 'active', 1, 1)").await.expect("legacy tag");
            conn.execute("INSERT INTO source_documents(id, original_image_path, content_hash, source_type, processing_status, captured_at, created_at) VALUES ('doc-subject', '/tmp/subject.png', 'subject-hash', 'import', 'captured', 1, 1)").await.expect("legacy source");
            conn.execute("INSERT INTO problems(id, source_document_id, subject, status, created_at, updated_at) VALUES ('problem-subject', 'doc-subject', '数学', 'saved', 1, 1)").await.expect("legacy problem");

            migrate_embedded_schema(&mut conn, &migrations_up_to(42))
                .await
                .expect("0037 必须为旧名称关系建立稳定 ID");
            let ids: (String, String, String, String) = sqlx::query_as(
                "SELECT subject.id, textbook.subject_id, tag.subject_id, problem.subject_id FROM subjects subject JOIN textbooks textbook ON textbook.id='book-subject' JOIN tag_definitions tag ON tag.id='tag-subject' JOIN problems problem ON problem.id='problem-subject' WHERE subject.display_name='数学'",
            )
            .fetch_one(&mut conn)
            .await
            .expect("读取稳定 Subject 关联");
            assert_eq!(ids.0, ids.1);
            assert_eq!(ids.0, ids.2);
            assert_eq!(ids.0, ids.3);
            assert!(ids.0.starts_with("subject-"));
        });
    }

    /// Today 的稳定身份、结果幂等和 SkillState 写回由 0033 的数据库约束
    /// 托底；这里使用完整 fresh schema 验证，不依赖前端 mock。
    #[test]
    fn today_engine_persistence_is_idempotent_and_survives_soft_delete() {
        tauri::async_runtime::block_on(async {
            let temp = TempDb::new("today");
            let mut conn = connect(&temp).await;
            migrate_embedded_schema(&mut conn, &migrations_up_to(37))
                .await
                .expect("Today 测试库必须迁移成功");

            conn.execute("INSERT INTO source_documents (id, original_image_path, content_hash, source_type, processing_status, captured_at, created_at) VALUES ('doc-today', '/tmp/today.png', 'today-hash', 'import', 'captured', 1, 1)")
                .await.expect("source fixture");
            conn.execute("INSERT INTO problems (id, source_document_id, subject, stem_markdown, status, created_at, updated_at) VALUES ('problem-today', 'doc-today', '数学', '求 x', 'saved', 1, 1)")
                .await.expect("problem fixture");
            conn.execute("INSERT INTO tag_definitions (id, subject, tag_type, canonical_name, source, taxonomy_version, verification_status, lifecycle_status, created_at, updated_at) VALUES ('tag-today', '数学', 'method', '换元法', 'user', 1, 'user_verified', 'active', 1, 1)")
                .await.expect("tag fixture");
            conn.execute("INSERT INTO skill_states (id, subject, tag_id, mastery_estimate, stability, retrievability, uncertainty, scheduler_version, created_at, updated_at) VALUES ('state-today', '数学', 'tag-today', .45, 1, .65, 1, 'horizon-v1', 1, 1)")
                .await.expect("skill state fixture");
            conn.execute("INSERT INTO skill_bundles (id, subject, canonical_key, primary_knowledge_tag_id, method_tag_ids_json, model_tag_ids_json, difficulty_context, created_at) VALUES ('bundle-today', '数学', 'math|method:tag-today|intermediate', 'legacy:problem-today', '[\"tag-today\"]', '[]', 'intermediate', 1)")
                .await.expect("bundle fixture");
            conn.execute("INSERT INTO skill_bundle_states (subject, skill_bundle_id, mastery_estimate, stability, retrievability, uncertainty, updated_at) VALUES ('数学', 'bundle-today', .45, 1, .65, 1, 1)")
                .await.expect("bundle state fixture");
            conn.execute("INSERT INTO review_sessions (id, session_date, status, mode, planned_problem_count, estimated_duration_seconds, created_at) VALUES ('session-today', '2026-08-10', 'generated', 'standard', 1, 300, 1)")
                .await.expect("session fixture");
            conn.execute("INSERT INTO review_modules (id, subject, session_id, skill_bundle_id, priority_score, selection_reason, target_difficulty, source_mode, estimated_duration_seconds, order_index, status) VALUES ('module-today', '数学', 'session-today', 'bundle-today', 80, '首次复习', 'intermediate', 'original', 300, 0, 'pending')")
                .await.expect("module fixture");
            conn.execute("INSERT INTO question_instances (id, subject, review_module_id, source_problem_id, stem_markdown, target_tags_json, difficulty, created_at) VALUES ('question-today', '数学', 'module-today', 'problem-today', '求 x', '{\"tags\":[]}', 'intermediate', 1)")
                .await.expect("question fixture");
            conn.execute("INSERT INTO review_attempts (id, subject, question_instance_id, is_correct, created_at, rating, result_key) VALUES ('attempt-today', '数学', 'question-today', 1, 2, 'good', 'today:question-today')")
                .await.expect("attempt fixture");
            conn.execute("INSERT INTO horizon_review_logs (id, review_attempt_id, subject, skill_bundle_id, rating, previous_state_json, evidence_json, new_state_json, reviewed_at) VALUES ('log-today', 'attempt-today', '数学', 'bundle-today', 'good', '{}', '{}', '{}', 2)")
                .await.expect("review log fixture");

            let duplicate_session = conn.execute("INSERT INTO review_sessions (id, session_date, status, mode, planned_problem_count, estimated_duration_seconds, created_at) VALUES ('session-duplicate', '2026-08-10', 'generated', 'standard', 1, 300, 2)").await;
            assert!(
                duplicate_session.is_err(),
                "同一天不得重复生成 standard plan"
            );
            conn.execute("INSERT INTO review_sessions (id, session_date, status, mode, planned_problem_count, estimated_duration_seconds, created_at) VALUES ('session-next-day', '2026-08-11', 'generated', 'standard', 1, 300, 2)")
                .await
                .expect("跨天必须允许生成新的稳定计划");
            let duplicate_result = conn.execute("INSERT INTO review_attempts (id, subject, question_instance_id, is_correct, created_at, rating, result_key) VALUES ('attempt-duplicate', '数学', 'question-today', 1, 3, 'good', 'today:question-today')").await;
            assert!(duplicate_result.is_err(), "重复点击不得重复记账");

            conn.execute("UPDATE skill_states SET mastery_estimate=.57, evidence_count=1, success_count=1, last_practiced_at=2, next_review_at=86410002 WHERE id='state-today'")
                .await.expect("SkillState 必须可原子写回");
            conn.execute("UPDATE problems SET deleted_at=3 WHERE id='problem-today'")
                .await
                .expect("应用删除题目为软删除");
            let question_count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM question_instances WHERE id='question-today'",
            )
            .fetch_one(&mut conn)
            .await
            .expect("读取问题快照");
            let log_count: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM horizon_review_logs WHERE id='log-today'")
                    .fetch_one(&mut conn)
                    .await
                    .expect("读取 ReviewLog");
            let evidence_count: i64 = sqlx::query_scalar(
                "SELECT evidence_count FROM skill_states WHERE id='state-today'",
            )
            .fetch_one(&mut conn)
            .await
            .expect("读取 SkillState");
            assert_eq!(question_count, 1, "软删除原题后当天快照必须仍可执行");
            assert_eq!(log_count, 1, "ReviewLog 必须保留");
            assert_eq!(evidence_count, 1, "SkillState 必须只记账一次");
        });
    }

    /// 0032 只扩展错误诊断，不得丢失旧客户端已经写入的可读错误文本。
    #[test]
    fn structured_curriculum_errors_upgrade_preserves_legacy_messages() {
        tauri::async_runtime::block_on(async {
            let temp = TempDb::new("curriculum-errors");
            let mut conn = connect(&temp).await;
            migrate_embedded_schema(&mut conn, &migrations_up_to(31))
                .await
                .expect("先迁移到 0031 状态");

            sqlx::query(
                "INSERT INTO curriculum_import_jobs (
                   id, original_source_path, source_path, source_name, source_type,
                   content_hash, status, resume_stage, page_count, extraction_method,
                   extraction_json, provider, model, prompt_version, schema_version,
                   input_hash, error_message, created_at, updated_at
                 ) VALUES (
                   'job-legacy', '/tmp/old.pdf', '/tmp/old.pdf', 'old.pdf', 'pdf',
                   'hash', 'ai_failed_recoverable', 'ai_analyzing_structure', 1,
                   'pdf_text', '{}', 'legacy-provider', 'legacy-model', 'v1', 'v1',
                   'input', '旧版失败文本', 1, 1
                 )",
            )
            .execute(&mut conn)
            .await
            .expect("0031 教材任务必须可写");
            sqlx::query(
                "INSERT INTO curriculum_import_attempts (
                   id, job_id, stage, attempt_number, status, error_message, started_at
                 ) VALUES (
                   'attempt-legacy', 'job-legacy', 'ai_analyzing_structure', 1,
                   'failed', '旧版 attempt 失败文本', 1
                 )",
            )
            .execute(&mut conn)
            .await
            .expect("0031 教材 attempt 必须可写");

            migrate_embedded_schema(&mut conn, &migrations_up_to(32))
                .await
                .expect("0032 必须安全升级旧教材错误记录");

            let job: (String, Option<String>, Option<String>) = sqlx::query_as(
                "SELECT error_message, error_code, error_json
                 FROM curriculum_import_jobs WHERE id = 'job-legacy'",
            )
            .fetch_one(&mut conn)
            .await
            .expect("升级后的教材任务必须存在");
            assert_eq!(job.0, "旧版失败文本");
            assert_eq!(job.1, None);
            assert_eq!(job.2, None);

            let attempt: (String, Option<String>, Option<String>) = sqlx::query_as(
                "SELECT error_message, error_code, error_json
                 FROM curriculum_import_attempts WHERE id = 'attempt-legacy'",
            )
            .fetch_one(&mut conn)
            .await
            .expect("升级后的教材 attempt 必须存在");
            assert_eq!(attempt.0, "旧版 attempt 失败文本");
            assert_eq!(attempt.1, None);
            assert_eq!(attempt.2, None);
        });
    }

    /// 在 0025 状态上插入「旧唯一索引放行、新守卫索引视为重复」的脏数据。
    /// 旧索引比较未 trim 的原始名称，因此首尾空白变体可以穿过旧守卫，
    /// 正是 0028 要治理的形态。
    async fn seed_dirty_sibling_data(conn: &mut SqliteConnection) {
        sqlx::query(
            "INSERT INTO textbooks (id, subject, title, source_type, created_at, updated_at)
             VALUES ('tb-1', '数学', '测试教材', 'manual', 1, 1)",
        )
        .execute(&mut *conn)
        .await
        .expect("教材插入必须成功");
        for (id, name, parent, node_type, created) in [
            ("k-1", "第一章", "", "chapter", 100_i64),
            ("k-2", " 第一章 ", "", "chapter", 200),
            ("k-3", "平方根", "k-2", "knowledge", 300),
            ("k-4", "立方根", "k-1", "knowledge", 410),
            // 与 k-3 同名：k-2 被归档重指后两者会成为同父同名兄弟，
            // 0028 的步骤 1b 必须先把较晚创建的一方折叠掉。
            ("k-5", "平方根", "k-1", "knowledge", 500),
        ] {
            sqlx::query(
                "INSERT INTO knowledge_nodes (
                   id, textbook_id, subject, canonical_name, node_type, parent_id,
                   path, created_at, updated_at
                 ) VALUES ($1, 'tb-1', '数学', $2, $3, NULLIF($4, ''), $2, $5, $5)",
            )
            .bind(id)
            .bind(name)
            .bind(node_type)
            .bind(parent)
            .bind(created)
            .execute(&mut *conn)
            .await
            .expect("脏数据插入必须通过 0025 状态下的旧守卫");
        }
    }

    #[test]
    fn sibling_guard_cleans_duplicates_reparents_children_and_replays() {
        tauri::async_runtime::block_on(async {
            let temp = TempDb::new("dirty");
            let mut conn = connect(&temp).await;
            migrate_embedded_schema(&mut conn, &migrations_up_to(25))
                .await
                .expect("先迁移到 0025 状态");
            seed_dirty_sibling_data(&mut conn).await;

            migrate_embedded_schema(&mut conn, &migrations_up_to(32))
                .await
                .expect("0026–0032 必须能在含脏数据的库上成功应用");

            let nodes = sqlx::query(
                "SELECT id, parent_id, merged_into_id, archived_at
                 FROM knowledge_nodes ORDER BY id",
            )
            .fetch_all(&mut conn)
            .await
            .expect("节点必须可读");
            let find = |id: &str| {
                nodes
                    .iter()
                    .find(|row| row.get::<String, _>("id") == id)
                    .expect("节点必须存在")
            };

            // 较早创建的 keeper 存活，重复章节被软归档并记录归并目标。
            let keeper = find("k-1");
            assert!(keeper.get::<Option<i64>, _>("archived_at").is_none());
            let duplicate = find("k-2");
            assert!(duplicate.get::<Option<i64>, _>("archived_at").is_some());
            assert_eq!(
                duplicate
                    .get::<Option<String>, _>("merged_into_id")
                    .as_deref(),
                Some("k-1")
            );

            // 挂在被归档重复节点下的活跃子节点重指到 keeper。
            let repointed = find("k-3");
            assert!(repointed.get::<Option<i64>, _>("archived_at").is_none());
            assert_eq!(
                repointed.get::<Option<String>, _>("parent_id").as_deref(),
                Some("k-1")
            );

            // 重指后与 keeper 既有子节点同名的冲突方（较晚创建）被折叠归档，
            // 保证新唯一索引不会被违反。
            let collision = find("k-5");
            assert!(collision.get::<Option<i64>, _>("archived_at").is_some());
            assert_eq!(
                collision
                    .get::<Option<String>, _>("merged_into_id")
                    .as_deref(),
                Some("k-3")
            );

            // 新守卫索引生效：再次插入同父同名活跃节点必须失败。
            let violation = sqlx::query(
                "INSERT INTO knowledge_nodes (
                   id, textbook_id, subject, canonical_name, node_type, parent_id,
                   path, created_at, updated_at
                 ) VALUES ('k-9', 'tb-1', '数学', '平方根', 'knowledge', 'k-1', '平方根', 900, 900)",
            )
            .execute(&mut conn)
            .await;
            assert!(violation.is_err(), "唯一守卫必须拦截新的同层重复");

            // 幂等重放：再次运行全部迁移不产生任何变化也不报错。
            migrate_embedded_schema(&mut conn, &migrations_up_to(32))
                .await
                .expect("0028 必须幂等，重放不得失败");
            assert_eq!(max_applied_version(&mut conn).await, 32);
        });
    }

    /// 升级路径模拟：库已在 codex 风格的 27 状态（含 0026 的触发器与
    /// sibling 索引），0028/0029 必须能在其上成功应用。
    #[test]
    fn database_at_version_27_upgrades_to_42() {
        tauri::async_runtime::block_on(async {
            let temp = TempDb::new("upgrade27");
            let mut conn = connect(&temp).await;
            migrate_embedded_schema(&mut conn, &migrations_up_to(27))
                .await
                .expect("先迁移到 0027 状态");
            migrate_embedded_schema(&mut conn, &migrations_up_to(42))
                .await
                .expect("0028–0042 必须能在 0027 状态库上成功应用");
            assert_eq!(max_applied_version(&mut conn).await, 42);

            let guard: Option<String> = sqlx::query_scalar(
                "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_knowledge_nodes_sibling_name_v2'",
            )
            .fetch_one(&mut conn)
            .await
            .expect("0028 的守卫索引必须存在");
            assert_eq!(
                guard.as_deref(),
                Some("idx_knowledge_nodes_sibling_name_v2")
            );

            let page_methods: (String,) = sqlx::query_as(
                "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'textbook_pages'",
            )
            .fetch_one(&mut conn)
            .await
            .expect("0029 重建后的 textbook_pages 必须存在");
            assert!(
                page_methods.0.contains("'failed'"),
                "0029 重建后的 CHECK 必须接受 'failed'"
            );
        });
    }

    /// 真实用户库副本升级验证（仅当 /tmp/axiom-verify.db 存在时执行）：
    /// 24–27 的 checksum 必须与库中记录一致（不再报 VersionMismatch），
    /// 28/29 成功推进。副本由人工预置（cp 真实 axiom.db），测试绝不触碰原始库。
    #[test]
    fn real_user_database_copy_upgrades_to_version_42() {
        let fixture = std::path::Path::new("/tmp/axiom-verify.db");
        if !fixture.exists() {
            eprintln!("跳过：/tmp/axiom-verify.db 不存在（需先 cp 用户真实库副本）");
            return;
        }
        tauri::async_runtime::block_on(async {
            let temp = TempDb::new("usercopy");
            std::fs::copy(fixture, &temp.path).expect("复制用户库副本必须成功");
            // WAL 伴生文件存在时一并复制，保证副本与真实库状态一致。
            for suffix in ["-wal", "-shm"] {
                let mut source = fixture.to_path_buf().into_os_string();
                source.push(suffix);
                let source = std::path::PathBuf::from(source);
                if source.exists() {
                    let mut target = temp.path.clone().into_os_string();
                    target.push(suffix);
                    std::fs::copy(&source, std::path::PathBuf::from(target))
                        .expect("复制 WAL 伴生文件必须成功");
                }
            }
            let mut conn = connect(&temp).await;
            // runner 内部会逐条比对已应用迁移的 SHA-384，任何不匹配都会
            // 返回错误；因此执行成功即证明 24–27 checksum 与库记录一致。
            migrate_embedded_schema(&mut conn, &migrations_up_to(42))
                .await
                .expect("用户库副本必须通过 checksum 校验并成功升级到 42");
            assert_eq!(max_applied_version(&mut conn).await, 42);

            // 显式实证：库中 24–27 记录的 checksum 与磁盘迁移原文 SHA-384 完全一致。
            for migration in axiom_migrations() {
                if !(24..=27).contains(&migration.version) {
                    continue;
                }
                let recorded: Vec<u8> =
                    sqlx::query_scalar("SELECT checksum FROM _sqlx_migrations WHERE version = $1")
                        .bind(migration.version)
                        .fetch_one(&mut conn)
                        .await
                        .expect("24–27 的迁移记录必须存在");
                let expected = Sha384::digest(migration.sql.as_bytes());
                assert_eq!(
                    recorded.as_slice(),
                    expected.as_slice(),
                    "版本 {} 的 checksum 必须与迁移原文一致",
                    migration.version
                );
            }

            // 0028/0029 的 schema 效果必须落在升级后的库上。
            let guard: Option<String> = sqlx::query_scalar(
                "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_knowledge_nodes_sibling_name_v2'",
            )
            .fetch_one(&mut conn)
            .await
            .expect("0028 的守卫索引必须可查询");
            assert_eq!(
                guard.as_deref(),
                Some("idx_knowledge_nodes_sibling_name_v2")
            );
        });
    }

    #[test]
    fn failed_textbook_pages_rebuild_preserves_rows_and_accepts_failed() {
        tauri::async_runtime::block_on(async {
            let temp = TempDb::new("pages");
            let mut conn = connect(&temp).await;
            migrate_embedded_schema(&mut conn, &migrations_up_to(25))
                .await
                .expect("先迁移到 0025 状态");
            sqlx::query(
                "INSERT INTO textbooks (id, subject, title, source_type, created_at, updated_at)
                 VALUES ('tb-1', '数学', '测试教材', 'manual', 1, 1)",
            )
            .execute(&mut conn)
            .await
            .expect("教材插入必须成功");
            sqlx::query(
                "INSERT INTO textbook_pages (
                   id, textbook_id, subject, page_number, evidence_text,
                   extraction_method, confidence, verification_status, created_at, updated_at
                 ) VALUES ('page-1', 'tb-1', '数学', 12, '旧页面内容', 'pdf_text', 0.9, 'unverified', 5, 5)",
            )
            .execute(&mut conn)
            .await
            .expect("旧 CHECK 约束必须允许 pdf_text");

            migrate_embedded_schema(&mut conn, &migrations_up_to(32))
                .await
                .expect("0026–0032 必须成功应用（含 0029 表重建）");

            let preserved: (String, String) = sqlx::query_as(
                "SELECT evidence_text, extraction_method FROM textbook_pages WHERE id = 'page-1'",
            )
            .fetch_one(&mut conn)
            .await
            .expect("表重建后既有页面必须完整保留");
            assert_eq!(preserved.0, "旧页面内容");
            assert_eq!(preserved.1, "pdf_text");

            sqlx::query(
                "INSERT INTO textbook_pages (
                   id, textbook_id, subject, page_number, evidence_text,
                   extraction_method, confidence, verification_status, created_at, updated_at
                 ) VALUES ('page-2', 'tb-1', '数学', 13, '', 'failed', 0, 'unverified', 6, 6)",
            )
            .execute(&mut conn)
            .await
            .expect("重建后的 CHECK 必须接受 'failed'");
        });
    }
}
