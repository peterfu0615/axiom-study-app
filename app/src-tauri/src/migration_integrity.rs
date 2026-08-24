//! 迁移完整性常设测试。
//!
//! 背景：sqlx Migrator（tauri-plugin-sql 内部路径）会把每个迁移包进外层
//! 事务，而历史版本号 24–27（来自 codex/horizon-quality-upgrade 分支，
//! 用户真实库已应用）自带裸 BEGIN IMMEDIATE/COMMIT，直接交给 Migrator 会
//! 触发 "cannot start a transaction within a transaction"。因此生产路径由
//! db::migrate_embedded_schema 在启动期执行：剥离最外层事务后运行，并按
//! 原文 SHA-384 写入/校验 _sqlx_migrations。本测试全部走同一 runner：
//!   1. 全新库一路跑到 57，且与 sqlx Migrator 校验兼容（幂等重跑）；
//!   2. 27 状态的库可以升级到 57；
//!   3. 用户真实库副本（/tmp/axiom-verify.db，人工预置）能通过 checksum
//!      校验并推进到 51；
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

    /// 全新库必须能一路跑到 58（含 codex 原文的 24–27 与后续迁移的衔接）。
    /// 随后用与 sqlx Migrator 完全一致的校验逻辑重跑两遍：
    ///   - embedded runner 幂等（全部已应用，不再执行任何脚本）；
    ///   - sqlx Migrator（plugin 的同款路径）校验 checksum 全部通过且不应用。
    #[test]
    fn fresh_database_reaches_58_and_stays_sqlx_compatible() {
        tauri::async_runtime::block_on(async {
            let temp = TempDb::new("fresh");
            let mut conn = connect(&temp).await;
            let migrations = migrations_up_to(58);
            migrate_embedded_schema(&mut conn, &migrations)
                .await
                .expect("全新库必须能完整迁移到 58（裸 BEGIN 由 runner 剥离）");
            assert_eq!(max_applied_version(&mut conn).await, 58);

            // 幂等重跑：不得重复执行、不得报错。
            migrate_embedded_schema(&mut conn, &migrations)
                .await
                .expect("embedded runner 必须幂等");
            assert_eq!(max_applied_version(&mut conn).await, 58);

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

    /// 迁移列表完整性：版本必须恰好为 1..=58 且严格递增。
    /// 用户真实库已应用 codex 分支的 24–27，列表缺号会让任何校验拒绝启动。
    #[test]
    fn migration_list_covers_versions_1_through_58_exactly() {
        let versions: Vec<i64> = axiom_migrations()
            .iter()
            .map(|migration| migration.version)
            .collect();
        let expected: Vec<i64> = (1..=58).collect();
        assert_eq!(versions, expected, "迁移列表必须严格等于 1..=58");
    }

    #[test]
    fn generated_variant_requires_verified_immutable_plan() {
        tauri::async_runtime::block_on(async {
            let temp = TempDb::new("variant-practice");
            let mut conn = connect(&temp).await;
            migrate_embedded_schema(&mut conn, &migrations_up_to(48))
                .await
                .expect("变式题 schema 必须迁移成功");
            conn.execute("INSERT INTO source_documents(id, original_image_path, content_hash, source_type, processing_status, captured_at, created_at) VALUES ('doc-variant', '/tmp/variant.png', 'variant-hash', 'import', 'captured', 1, 1)").await.expect("source");
            conn.execute("INSERT INTO problems(id, source_document_id, subject, stem_markdown, status, created_at, updated_at) VALUES ('problem-variant', 'doc-variant', '数学', '解方程', 'saved', 1, 1)").await.expect("problem");
            conn.execute("INSERT INTO skill_bundles(id, subject, canonical_key, primary_knowledge_tag_id, difficulty_context, created_at) VALUES ('bundle-variant', '数学', 'variant-key', 'legacy:problem-variant', 'basic', 1)").await.expect("bundle");
            conn.execute("INSERT INTO practice_sets(id, subject, source_type, source_ref, strategy, status, target_skills_json, generation_metadata_json, created_at, updated_at) VALUES ('set-variant', '数学', 'review_unit', 'module-variant', 'variant-v1', 'ready', '[]', '{}', 1, 1)").await.expect("set");
            conn.execute("INSERT INTO variant_plans(id,subject,source_problem_id,skill_bundle_id,target_tags_json,target_difficulty,invariants_json,allowed_changes_json,forbidden_changes_json,source_input_hash,prompt_version,schema_version,status,created_at,updated_at) VALUES ('plan-variant','数学','problem-variant','bundle-variant','[]','basic','{}','[]','[]','hash','v1','v1','planned',1,1)").await.expect("plan");
            let unverified = conn.execute("INSERT INTO practice_items(id,practice_set_id,order_index,source_type,source_problem_id,variant_plan_id,subject,target_skill_bundle_id,target_tags_json,difficulty,statement_markdown,canonical_answer,solution_json,grading_rubric_json,generation_metadata_json,validation_status,created_at) VALUES ('item-unverified','set-variant',0,'generated_variant','problem-variant','plan-variant','数学','bundle-variant','[]','basic','新题','x=3','{\"contentMarkdown\":\"解\"}','{}','{}','valid',2)").await;
            assert!(unverified.is_err(), "未审校 VariantPlan 不得进入正式练习");
            conn.execute("INSERT INTO variant_model_runs(id,variant_plan_id,stage,provider,model,prompt_version,schema_version,input_hash,output_json,raw_output,status,created_at,finished_at) VALUES ('run-generation','plan-variant','generation','provider','model','v1','v1','hash:generation','{}','','completed',2,3)").await.expect("generation run");
            conn.execute("INSERT INTO variant_model_runs(id,variant_plan_id,stage,provider,model,prompt_version,schema_version,input_hash,output_json,raw_output,status,created_at,finished_at) VALUES ('run-verification','plan-variant','verification','provider','model','v1','v1','hash:verification','{}','','completed',3,4)").await.expect("verification run");
            conn.execute("INSERT INTO variant_candidates(id,variant_plan_id,generation_model_run_id,verification_model_run_id,candidate_json,verification_json,validation_errors_json,status,created_at) VALUES ('candidate-variant','plan-variant','run-generation','run-verification','{}','{}','[]','verified',4)").await.expect("verified candidate");
            conn.execute("UPDATE variant_plans SET status='verified',selected_candidate_id='candidate-variant',updated_at=4 WHERE id='plan-variant'").await.expect("verify plan");
            conn.execute("INSERT INTO practice_items(id,practice_set_id,order_index,source_type,source_problem_id,variant_plan_id,subject,target_skill_bundle_id,target_tags_json,difficulty,statement_markdown,canonical_answer,solution_json,grading_rubric_json,generation_metadata_json,validation_status,created_at) VALUES ('item-verified','set-variant',0,'generated_variant','problem-variant','plan-variant','数学','bundle-variant','[]','basic','新题','x=3','{\"contentMarkdown\":\"解\"}','{}','{}','valid',5)").await.expect("verified variant item");
            assert!(
                conn.execute(
                    "UPDATE variant_plans SET failure_code='tamper' WHERE id='plan-variant'"
                )
                .await
                .is_err(),
                "已验证计划必须不可变"
            );
            assert!(conn.execute("UPDATE variant_candidates SET candidate_json='{\"tampered\":true}' WHERE id='candidate-variant'").await.is_err(), "已验证候选必须不可变");
        });
    }

    #[test]
    fn practice_sessions_are_independent_from_the_daily_plan_and_events_are_immutable() {
        tauri::async_runtime::block_on(async {
            let temp = TempDb::new("review-session-lifecycle");
            let mut conn = connect(&temp).await;
            migrate_embedded_schema(&mut conn, &migrations_up_to(49))
                .await
                .expect("ReviewSession 生命周期 schema 必须迁移成功");
            conn.execute("INSERT INTO review_sessions(id,session_date,status,mode,planned_problem_count,estimated_duration_seconds,session_kind,settings_json,created_at,updated_at) VALUES ('today-session','2026-08-20','generated','standard',2,600,'today','{}',1,1)").await.expect("today session");
            conn.execute("INSERT INTO review_sessions(id,session_date,status,mode,planned_problem_count,estimated_duration_seconds,session_kind,settings_json,created_at,updated_at) VALUES ('practice-standard','2026-08-20','draft','standard',3,900,'practice','{}',2,2)").await.expect("standard practice session");
            conn.execute("INSERT INTO review_sessions(id,session_date,status,mode,planned_problem_count,estimated_duration_seconds,session_kind,settings_json,created_at,updated_at) VALUES ('practice-mock','2026-08-20','draft','mock_test',6,3600,'practice','{}',3,3)").await.expect("mock practice session");
            assert!(conn.execute("INSERT INTO review_sessions(id,session_date,status,mode,planned_problem_count,estimated_duration_seconds,session_kind,settings_json,created_at,updated_at) VALUES ('today-duplicate','2026-08-20','generated','standard',2,600,'today','{}',4,4)").await.is_err(), "同一天只能有一个 Today 调度容器");
            conn.execute("INSERT INTO review_session_events(id,review_session_id,from_status,to_status,safe_code,metadata_json,created_at) VALUES ('event-session','practice-standard','draft','generated','practice_set_ready','{}',5)").await.expect("session event");
            assert!(conn.execute("UPDATE review_session_events SET safe_code='tampered' WHERE id='event-session'").await.is_err(), "会话事件必须不可变");
            assert!(
                conn.execute("DELETE FROM review_session_events WHERE id='event-session'")
                    .await
                    .is_err(),
                "会话事件不得删除"
            );
        });
    }

    #[test]
    fn practice_grading_runs_and_evidence_fields_are_persisted_and_terminal() {
        tauri::async_runtime::block_on(async {
            let temp = TempDb::new("practice-grading-evidence");
            let mut conn = connect(&temp).await;
            migrate_embedded_schema(&mut conn, &migrations_up_to(50))
                .await
                .expect("0.7 批改证据 schema 必须迁移成功");
            let columns: Vec<String> = sqlx::query("PRAGMA table_info(review_attempts)")
                .fetch_all(&mut conn)
                .await
                .expect("review_attempts schema")
                .into_iter()
                .map(|row| row.get::<String, _>("name"))
                .collect();
            for required in [
                "overall_result",
                "process_complete",
                "error_reason",
                "correct_alternative_step",
                "used_target_method",
                "applied_target_knowledge",
                "matched_target_model",
                "independent_completion",
                "bundle_evidence_json",
                "grading_model_run_id",
            ] {
                assert!(
                    columns.iter().any(|column| column == required),
                    "缺少 {required}"
                );
            }

            conn.execute("PRAGMA foreign_keys=OFF")
                .await
                .expect("fixture may omit response graph");
            conn.execute("INSERT INTO practice_grading_model_runs(id,practice_response_id,provider,model,prompt_version,schema_version,input_hash,status,result_json,started_at,completed_at) VALUES ('grading-run','response-fixture','provider','model','prompt-v2','schema-v2','hash','succeeded','{}',1,2)")
                .await
                .expect("terminal grading run fixture");
            assert!(
                conn.execute("UPDATE practice_grading_model_runs SET result_json='{\"tampered\":true}' WHERE id='grading-run'")
                    .await
                    .is_err(),
                "完成的批改模型运行必须不可变"
            );
        });
    }

    #[test]
    fn review_preferences_have_safe_defaults_and_database_bounds() {
        tauri::async_runtime::block_on(async {
            let temp = TempDb::new("review-preferences");
            let mut conn = connect(&temp).await;
            migrate_embedded_schema(&mut conn, &migrations_up_to(51))
                .await
                .expect("复习偏好 schema 必须迁移成功");
            let row: (i64, i64, String) = sqlx::query_as(
                "SELECT max_daily_minutes,max_modules,preferred_mode FROM review_preferences WHERE id='default'",
            )
            .fetch_one(&mut conn)
            .await
            .expect("默认复习偏好必须存在");
            assert_eq!(row, (25, 2, "standard".into()));
            assert!(conn
                .execute("UPDATE review_preferences SET max_daily_minutes=0 WHERE id='default'")
                .await
                .is_err());
            assert!(conn
                .execute(
                    "UPDATE review_preferences SET preferred_mode='unknown' WHERE id='default'"
                )
                .await
                .is_err());
        });
    }

    #[test]
    fn planner_schema_enforces_capacity_deadlines_and_segment_history() {
        tauri::async_runtime::block_on(async {
            let temp = TempDb::new("planner");
            let mut conn = connect(&temp).await;
            migrate_embedded_schema(&mut conn, &migrations_up_to(56))
                .await
                .expect("Planner schema 必须迁移成功");
            let defaults: (i64, i64, i64) = sqlx::query_as(
                "SELECT default_daily_capacity_minutes,review_reserve_minutes,horizon_days FROM planner_preferences WHERE id='default'",
            )
            .fetch_one(&mut conn)
            .await
            .expect("Planner 默认配置");
            assert_eq!(defaults, (90, 25, 14));
            assert!(conn.execute("UPDATE planner_preferences SET default_daily_capacity_minutes=0 WHERE id='default'").await.is_err());
            assert!(conn.execute("INSERT INTO planner_tasks(id,title,task_type,subject,due_date,estimated_minutes,priority,splittable,earliest_date,status,source_type,created_at,updated_at) VALUES('invalid','作业','homework','数学','2026-08-20',30,3,1,'2026-08-21','pending','user',1,1)").await.is_err());
            conn.execute("INSERT INTO planner_tasks(id,title,task_type,subject,due_date,estimated_minutes,priority,splittable,earliest_date,status,source_type,created_at,updated_at) VALUES('task','作业','homework','数学','2026-08-22',30,3,1,'2026-08-21','pending','user',1,1)").await.expect("valid task");
            conn.execute("INSERT INTO planner_schedule_runs(id,start_date,horizon_days,scheduler_version,input_hash,summary_json,created_at) VALUES('run','2026-08-21',14,'planner-v1','hash','{}',1)").await.expect("schedule run");
            conn.execute("INSERT INTO planner_task_segments(id,task_id,schedule_run_id,planned_date,planned_minutes,order_index,status,created_at,updated_at) VALUES('segment','task','run','2026-08-21',30,0,'scheduled',1,1)").await.expect("schedule segment");
        });
    }

    #[test]
    fn unified_scheduler_adds_preferences_due_time_and_audit_log() {
        tauri::async_runtime::block_on(async {
            let temp = TempDb::new("unified-scheduler");
            let mut conn = connect(&temp).await;
            migrate_embedded_schema(&mut conn, &migrations_up_to(58))
                .await
                .expect("统一计划器 schema 必须迁移成功");
            let preferences: (f64, String) = sqlx::query_as(
                "SELECT target_retention,variant_mode FROM review_preferences WHERE id='default'",
            )
            .fetch_one(&mut conn)
            .await
            .expect("统一计划器偏好默认值");
            assert_eq!(preferences, (0.85, "variant_preferred".into()));
            assert!(conn
                .execute("UPDATE review_preferences SET target_retention=0.5 WHERE id='default'")
                .await
                .is_err());
            let planner_columns: Vec<String> = sqlx::query("PRAGMA table_info(planner_tasks)")
                .fetch_all(&mut conn)
                .await
                .expect("Planner 精确到期时间 schema")
                .into_iter()
                .map(|row| row.get::<String, _>("name"))
                .collect();
            assert!(planner_columns.iter().any(|column| column == "due_at"));
            conn.execute("INSERT INTO review_scheduler_migrations(id,state_kind,subject,entity_id,from_version,to_version,previous_state_json,new_state_json,migrated_at) VALUES('audit','skill','数学','tag','horizon-v1','ebbinghaus-v2','{}','{}',1)")
                .await
                .expect("调度器迁移审计可写入");
            assert!(conn.execute("INSERT INTO review_scheduler_migrations(id,state_kind,subject,entity_id,from_version,to_version,previous_state_json,new_state_json,migrated_at) VALUES('duplicate','skill','数学','tag','horizon-v1','ebbinghaus-v2','{}','{}',2)").await.is_err());
        });
    }

    #[test]
    fn advanced_submission_schema_preserves_source_provenance() {
        tauri::async_runtime::block_on(async {
            let temp = TempDb::new("advanced-submission");
            let mut conn = connect(&temp).await;
            migrate_embedded_schema(&mut conn, &migrations_up_to(57))
                .await
                .expect("高级作业回传 schema 必须迁移成功");
            conn.execute("PRAGMA foreign_keys=OFF")
                .await
                .expect("fixture graph disabled");
            conn.execute("INSERT INTO practice_submission_assets(id,practice_attempt_id,source_kind,original_asset_path,page_count,annotations_preserved,metadata_json,status,created_at,updated_at) VALUES('asset','attempt','annotated_pdf','/managed/original.pdf',3,1,'{}','completed',1,1)").await.expect("annotated source");
            let row: (i64, i64, String) = sqlx::query_as("SELECT page_count,annotations_preserved,original_asset_path FROM practice_submission_assets WHERE id='asset'")
                .fetch_one(&mut conn).await.expect("source provenance");
            assert_eq!(row, (3, 1, "/managed/original.pdf".into()));
            assert!(conn.execute("INSERT INTO practice_submission_assets(id,practice_attempt_id,source_kind,original_asset_path,page_count,metadata_json,status,created_at,updated_at) VALUES('empty','attempt','image','/x',0,'{}','imported',1,1)").await.is_err());
            let page_columns: Vec<String> =
                sqlx::query("PRAGMA table_info(practice_attempt_pages)")
                    .fetch_all(&mut conn)
                    .await
                    .expect("attempt page schema")
                    .into_iter()
                    .map(|row| row.get::<String, _>("name"))
                    .collect();
            for required in [
                "submission_asset_id",
                "source_page_index",
                "live_detection_confidence",
            ] {
                assert!(
                    page_columns.iter().any(|column| column == required),
                    "缺少 {required}"
                );
            }
        });
    }

    #[test]
    fn review_session_lifecycle_preserves_same_day_legacy_sessions() {
        tauri::async_runtime::block_on(async {
            let temp = TempDb::new("review-session-legacy-duplicates");
            let mut conn = connect(&temp).await;
            migrate_embedded_schema(&mut conn, &migrations_up_to(48))
                .await
                .expect("version 48 fixture must migrate");
            conn.execute("INSERT INTO review_sessions(id,session_date,status,mode,planned_problem_count,estimated_duration_seconds,created_at) VALUES ('today','2026-08-20','generated','standard',2,600,10)")
                .await
                .expect("canonical Today session");
            conn.execute("INSERT INTO review_sessions(id,session_date,status,mode,planned_problem_count,estimated_duration_seconds,created_at) VALUES ('legacy','2026-08-20','completed','legacy',2,600,20)")
                .await
                .expect("legacy duplicate remains legal before migration 49");

            migrate_embedded_schema(&mut conn, &migrations_up_to(49))
                .await
                .expect("migration 49 must preserve and classify duplicate sessions");
            let rows: Vec<(String, String)> =
                sqlx::query_as("SELECT id,session_kind FROM review_sessions ORDER BY id")
                    .fetch_all(&mut conn)
                    .await
                    .expect("sessions must remain readable");
            assert_eq!(
                rows,
                vec![
                    ("legacy".into(), "practice".into()),
                    ("today".into(), "today".into()),
                ]
            );
        });
    }

    #[test]
    fn provider_task_routes_are_backward_compatible_and_json_bounded() {
        tauri::async_runtime::block_on(async {
            let temp = TempDb::new("provider-task-routing");
            let mut conn = connect(&temp).await;
            migrate_embedded_schema(&mut conn, &migrations_up_to(52))
                .await
                .expect("Provider task route schema must migrate");
            let routes: String = sqlx::query_scalar(
                "SELECT task_types_json FROM ai_provider_profiles WHERE id='mock-default'",
            )
            .fetch_one(&mut conn)
            .await
            .expect("existing provider must receive the all-tasks default");
            assert_eq!(routes, "[]");
            conn.execute("UPDATE ai_provider_profiles SET task_types_json='[\"solution_generation\"]' WHERE id='mock-default'")
                .await
                .expect("valid route arrays must persist");
            assert!(conn
                .execute(
                    "UPDATE ai_provider_profiles SET task_types_json='{}' WHERE id='mock-default'"
                )
                .await
                .is_err());
        });
    }

    #[test]
    fn problem_library_profiles_and_duplicate_decisions_are_bounded() {
        tauri::async_runtime::block_on(async {
            let temp = TempDb::new("problem-library-enhancements");
            let mut conn = connect(&temp).await;
            migrate_embedded_schema(&mut conn, &migrations_up_to(57))
                .await
                .expect("problem library schema must migrate");
            conn.execute("INSERT INTO source_documents(id,original_image_path,content_hash,source_type,captured_at,created_at) VALUES ('source','/tmp/source.png','hash','import',1,1)")
                .await
                .expect("source fixture");
            for id in ["problem-a", "problem-b"] {
                sqlx::query("INSERT INTO problems(id,source_document_id,status,subject,stem_markdown,created_at,updated_at) VALUES ($1,'source','saved','数学','一次函数求交点',1,1)")
                    .bind(id)
                    .execute(&mut conn)
                    .await
                    .expect("problem fixture");
            }
            conn.execute("INSERT INTO problem_library_profiles(problem_id,is_favorite,note,updated_at) VALUES ('problem-a',1,'易漏条件',2)")
                .await
                .expect("favorite and note must persist");
            let indexed: String = sqlx::query_scalar(
                "SELECT problem_id FROM problem_library_fts WHERE problem_library_fts MATCH '\"易漏条件\"'",
            )
            .fetch_one(&mut conn)
            .await
            .expect("note trigger must update the full-text index");
            assert_eq!(indexed, "problem-a");
            conn.execute("INSERT INTO problem_duplicate_decisions(first_problem_id,second_problem_id,decision,canonical_problem_id,similarity_score,signals_json,created_at,updated_at) VALUES ('problem-a','problem-b','keep_both',NULL,0.8,'[\"stem\"]',2,2)")
                .await
                .expect("same-subject decision shape must persist");
            assert!(conn.execute("UPDATE problem_library_profiles SET is_favorite=2 WHERE problem_id='problem-a'").await.is_err());
            assert!(conn.execute("UPDATE problem_duplicate_decisions SET similarity_score=2 WHERE first_problem_id='problem-a'").await.is_err());
            assert!(conn.execute("UPDATE problem_duplicate_decisions SET decision='merged',canonical_problem_id=NULL WHERE first_problem_id='problem-a'").await.is_err());
        });
    }

    #[test]
    fn diagram_source_and_rendered_asset_constraints_survive_restart() {
        tauri::async_runtime::block_on(async {
            let temp = TempDb::new("diagram");
            let mut conn = connect(&temp).await;
            migrate_embedded_schema(&mut conn, &migrations_up_to(45))
                .await
                .expect("Diagram schema must migrate");
            conn.execute("INSERT INTO diagrams (id, owner_type, owner_id, source_type, source, render_status, rendered_asset_path, rendered_mime_type, render_hash, renderer_version, validation_status, validation_json, contract_json, width_units, height_units, created_at, updated_at) VALUES ('diagram-1', 'practice_item', 'future-item-1', 'tikz', '\\draw (0,0)--(1,1);', 'rendered', '/tmp/cache.svg', 'image/svg+xml', 'hash-1', 'renderer-v2', 'validated', '{\"aspectRatio\":1}', '{}', 1, 1, 1, 1)")
                .await.expect("source and rendered representation should persist together");
            let snapshot: (String, String, String, String) = sqlx::query_as(
                "SELECT source, rendered_asset_path, render_hash, validation_status FROM diagrams WHERE id='diagram-1'",
            )
            .fetch_one(&mut conn)
            .await
            .expect("diagram snapshot should be readable");
            assert_eq!(snapshot.0, "\\draw (0,0)--(1,1);");
            assert_eq!(snapshot.1, "/tmp/cache.svg");
            assert_eq!(snapshot.2, "hash-1");
            assert_eq!(snapshot.3, "validated");

            let invalid_owner = conn.execute("INSERT INTO diagrams (id, owner_type, owner_id, source_type, source, render_status, render_hash, renderer_version, created_at, updated_at) VALUES ('diagram-bad-owner', 'pdf', 'x', 'tikz', 'x', 'failed', 'hash', 'v1', 1, 1)").await;
            assert!(
                invalid_owner.is_err(),
                "unknown owner types must be rejected"
            );
            let missing_asset = conn.execute("INSERT INTO diagrams (id, owner_type, owner_id, source_type, source, render_status, render_hash, renderer_version, created_at, updated_at) VALUES ('diagram-missing-asset', 'problem', 'x', 'tikz', 'x', 'rendered', 'hash', 'v1', 1, 1)").await;
            assert!(missing_asset.is_err(), "rendered diagrams require an asset");

            drop(conn);
            let mut reopened = connect(&temp).await;
            migrate_embedded_schema(&mut reopened, &migrations_up_to(45))
                .await
                .expect("diagram migration must be restart-safe");
            assert_eq!(max_applied_version(&mut reopened).await, 45);
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
            conn.execute("INSERT INTO practice_attempts(id, practice_set_id, status, started_at, created_at, updated_at) VALUES ('attempt-practice', 'set-practice', 'captured', 4, 4, 4)").await.expect("practice attempt fixture");
            conn.execute("INSERT INTO practice_attempt_pages(id, practice_attempt_id, practice_document_page_id, source_asset_path, corrected_asset_path, qr_payload, orientation_degrees, geometry_json, status, created_at) VALUES ('attempt-page-practice', 'attempt-practice', 'page-practice', '/tmp/scan.jpg', '/tmp/corrected.jpg', 'AXIOM|set=set-practice|attempt=attempt-practice|page=0', 90, '{\"pageDetected\":true}', 'captured', 4)").await.expect("practice attempt page fixture");

            drop(conn);
            let mut reopened = connect(&temp).await;
            migrate_embedded_schema(&mut reopened, &migrations_up_to(44))
                .await
                .expect("Practice 数据库必须保留机器答题数据并升级为统一文档");
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
            reopened.execute("INSERT INTO practice_documents(id, practice_set_id, attempt_id, document_type, layout_version, content_hash, status, file_path, page_count, metadata_json, created_at, updated_at) VALUES ('pdf-complete', 'set-practice', 'attempt-complete', 'complete', 'practice-a4-v1', 'complete-hash', 'ready', '/tmp/complete.pdf', 6, '{\"sectionPageRanges\":{\"exercise\":{\"startPage\":1,\"endPage\":2},\"answerSheet\":{\"startPage\":3,\"endPage\":4},\"solution\":{\"startPage\":5,\"endPage\":6}}}', 5, 5)").await.expect("统一 PracticeDocument 必须可持久化");
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
    fn grading_revisions_are_append_only_and_latest_effective() {
        tauri::async_runtime::block_on(async {
            let temp = TempDb::new("grading-revisions");
            let mut conn = connect(&temp).await;
            migrate_embedded_schema(&mut conn, &migrations_up_to(47))
                .await
                .expect("批改修正迁移必须成功");
            conn.execute("INSERT INTO source_documents(id, original_image_path, content_hash, source_type, processing_status, captured_at, created_at) VALUES ('doc-revision', '/tmp/revision.png', 'revision-hash', 'import', 'captured', 1, 1)").await.expect("source");
            conn.execute("INSERT INTO problems(id, source_document_id, subject, stem_markdown, status, created_at, updated_at) VALUES ('problem-revision', 'doc-revision', '数学', '求 x', 'saved', 1, 1)").await.expect("problem");
            conn.execute("INSERT INTO skill_bundles(id, subject, canonical_key, primary_knowledge_tag_id, difficulty_context, created_at) VALUES ('bundle-revision', '数学', 'revision-key', 'legacy:problem-revision', 'basic', 1)").await.expect("bundle");
            conn.execute("INSERT INTO practice_sets(id, subject, source_type, source_ref, strategy, status, target_skills_json, generation_metadata_json, created_at, updated_at) VALUES ('set-revision', '数学', 'review_unit', 'module-revision', 'deterministic-v1', 'ready', '[]', '{}', 1, 1)").await.expect("set");
            conn.execute("INSERT INTO practice_items(id, practice_set_id, order_index, source_type, source_problem_id, subject, target_skill_bundle_id, difficulty, statement_markdown, canonical_answer, solution_json, grading_rubric_json, validation_status, created_at) VALUES ('item-revision', 'set-revision', 0, 'existing_problem', 'problem-revision', '数学', 'bundle-revision', 'basic', '求 x', 'x=2', '{\"contentMarkdown\":\"解\"}', '{\"criteria\":[\"答案正确\"]}', 'valid', 1)").await.expect("item");
            conn.execute("INSERT INTO practice_attempts(id, practice_set_id, status, started_at, created_at, updated_at) VALUES ('attempt-revision', 'set-revision', 'completed', 1, 1, 1)").await.expect("attempt");
            conn.execute("INSERT INTO practice_responses(id, practice_attempt_id, practice_item_id, answer_asset_path, extracted_answer_json, grading_result_json, status, created_at, updated_at) VALUES ('response-revision', 'attempt-revision', 'item-revision', '/tmp/answer.png', '{\"rawMarkdown\":\"x=1\"}', '{\"correctness\":\"incorrect\",\"score\":0}', 'graded', 1, 1)").await.expect("response");
            conn.execute("INSERT INTO practice_grading_revisions(id, practice_attempt_id, practice_response_id, revision_index, revision_type, previous_grading_json, new_grading_json, corrected_answer_json, operation_key, created_at) VALUES ('revision-1', 'attempt-revision', 'response-revision', 1, 'manual_override', '{\"correctness\":\"incorrect\"}', '{\"correctness\":\"correct\",\"score\":100}', '{\"rawMarkdown\":\"x=2\"}', 'manual:correct', 2)").await.expect("revision");
            let effective: (String, String) = sqlx::query_as("SELECT effective_answer_json, effective_grading_json FROM practice_effective_responses WHERE response_id='response-revision'").fetch_one(&mut conn).await.expect("effective view");
            assert!(effective.0.contains("x=2"));
            assert!(effective.1.contains("correct"));
            assert!(conn.execute("UPDATE practice_grading_revisions SET operation_key='changed' WHERE id='revision-1'").await.is_err());
            assert!(conn
                .execute("DELETE FROM practice_grading_revisions WHERE id='revision-1'")
                .await
                .is_err());
            conn.execute("INSERT INTO practice_grading_revisions(id, practice_attempt_id, practice_response_id, revision_index, revision_type, previous_grading_json, new_grading_json, corrected_answer_json, operation_key, created_at) VALUES ('revision-2', 'attempt-revision', 'response-revision', 2, 'manual_override', '{\"correctness\":\"correct\"}', '{\"correctness\":\"incorrect\",\"score\":0}', NULL, 'manual:incorrect', 3)").await.expect("second revision");
            let latest: String = sqlx::query_scalar("SELECT effective_grading_json FROM practice_effective_responses WHERE response_id='response-revision'").fetch_one(&mut conn).await.expect("latest effective grading");
            assert!(latest.contains("incorrect"));
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
