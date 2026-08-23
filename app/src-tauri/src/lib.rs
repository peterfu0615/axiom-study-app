mod ai;
mod commands;
mod db;
mod diagram;
mod horizon;
mod keystore;
#[cfg(test)]
mod migration_integrity;
mod models;
mod practice_capture;
mod practice_pdf;
mod practice_preview;
mod practice_typst;
mod typst_math;
mod updater;

use tauri::Manager;
use tauri_plugin_log::{RotationStrategy, Target, TargetKind, TimezoneStrategy};
use tauri_plugin_sql::{Migration, MigrationKind};

/// 计算显式日志目录，确保与 app_data_dir 对齐而非使用 OS 默认 Logs 目录。
///
/// 约束：不接受 tauri-plugin-log 的默认 LogDir（~/Library/Logs/com.axiom.study/），
/// 因为它与数据库路径（~/Library/Application Support/com.axiom.study/）分离，
/// 会导致用户排查问题时在错误位置查找日志。
///
/// 此函数使用 `dirs` crate 显式构建 `~/Library/Application Support/com.axiom.study/logs/`，
/// 与 Rust sqlx 的 `app_data_dir` 解析结果完全一致。
fn compute_log_dir() -> std::path::PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("com.axiom.study")
        .join("logs")
}

/// 全部 SQLite 迁移（版本号只增不复用：跨分支共享同一版本号空间，
/// 复用已被占用的版本号会与既有库的 checksum 冲突）。
///
/// 24–27 来自 codex/horizon-quality-upgrade 分支，用户真实库已在其下应用过
/// 这四个版本；必须逐字节原样保留（启动时按原文 SHA-384 与 _sqlx_migrations
/// 记录比对，任何改动都会触发校验失败），也不得从列表中移除。
/// 24/25/26 含裸 BEGIN IMMEDIATE/COMMIT，只能由 db::migrate_embedded_schema
/// 剥离最外层事务后执行；绝不能交给 sqlx Migrator/tauri-plugin-sql 直接跑。
///
/// 独立成函数以便集成测试在同一份迁移列表上验证全新数据库的完整升级路径。
pub fn axiom_migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "create_initial_schema",
            sql: include_str!("../migrations/0001_initial.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "add_document_processing",
            sql: include_str!("../migrations/0002_document_processing.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "add_problem_persistence",
            sql: include_str!("../migrations/0003_problem_persistence.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "add_problem_user_edits",
            sql: include_str!("../migrations/0004_problem_user_edits.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "add_basic_ai_pipeline",
            sql: include_str!("../migrations/0005_basic_ai_pipeline.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "add_ai_title_and_provider_settings",
            sql: include_str!("../migrations/0006_ai_title_and_provider_settings.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 7,
            description: "add_ai_provider_profiles",
            sql: include_str!("../migrations/0007_ai_provider_profiles.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 8,
            description: "add_ai_sub_questions",
            sql: include_str!("../migrations/0008_ai_sub_questions.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 9,
            description: "add_model_run_raw_output",
            sql: include_str!("../migrations/0009_model_run_raw_output.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 10,
            description: "add_ai_diagram_extraction",
            sql: include_str!("../migrations/0010_ai_diagram_extraction.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 11,
            description: "add_antigravity_cli_provider",
            sql: include_str!("../migrations/0011_antigravity_cli_provider.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 12,
            description: "add_solution_engine",
            sql: include_str!("../migrations/0012_solution_engine.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 13,
            description: "add_intelligence_pipeline",
            sql: include_str!("../migrations/0013_intelligence_pipeline.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 14,
            description: "add_model_run_provider_attempts",
            sql: include_str!("../migrations/0014_model_run_provider_attempts.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 15,
            description: "add_api_key_credential_ref",
            sql: include_str!("../migrations/0015_api_key_credential_ref.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 16,
            description: "add_horizon_tag_foundation",
            sql: include_str!("../migrations/0016_horizon_tag_foundation.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 17,
            description: "add_curriculum_import_jobs",
            sql: include_str!("../migrations/0017_curriculum_import_jobs.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 18,
            description: "curriculum_single_resume_slot",
            sql: include_str!("../migrations/0018_curriculum_single_resume_slot.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 19,
            description: "curriculum_tag_origins",
            sql: include_str!("../migrations/0019_curriculum_tag_origins.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 20,
            description: "curriculum_attempt_serialization",
            sql: include_str!("../migrations/0020_curriculum_attempt_serialization.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 21,
            description: "restore_sqlite_api_keys",
            sql: include_str!("../migrations/0021_restore_sqlite_api_keys.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 22,
            description: "curriculum_analysis_progress",
            sql: include_str!("../migrations/0022_curriculum_analysis_progress.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 23,
            description: "problem_textbook_match",
            sql: include_str!("../migrations/0023_problem_textbook_match.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 24,
            description: "flatten_curriculum_tree",
            sql: include_str!("../migrations/0024_flatten_curriculum_tree.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 25,
            description: "relabel_claims",
            sql: include_str!("../migrations/0025_relabel_claims.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 26,
            description: "curriculum_audit_and_constraints",
            sql: include_str!("../migrations/0026_curriculum_audit_and_constraints.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 27,
            description: "axiom_050_learning_loop",
            sql: include_str!("../migrations/0027_axiom_050_learning_loop.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 28,
            description: "knowledge_sibling_unique_guard",
            sql: include_str!("../migrations/0028_knowledge_sibling_unique_guard.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 29,
            description: "failed_textbook_pages",
            sql: include_str!("../migrations/0029_failed_textbook_pages.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 30,
            description: "structured_ai_errors",
            sql: include_str!("../migrations/0030_structured_ai_errors.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 31,
            description: "textbook_resolution_audit",
            sql: include_str!("../migrations/0031_textbook_resolution_audit.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 32,
            description: "curriculum_structured_errors",
            sql: include_str!("../migrations/0032_curriculum_structured_errors.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 33,
            description: "today_engine_integrity",
            sql: include_str!("../migrations/0033_today_engine_integrity.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 34,
            description: "review_observability_indexes",
            sql: include_str!("../migrations/0034_review_observability_indexes.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 35,
            description: "review_history_join_indexes",
            sql: include_str!("../migrations/0035_review_history_join_indexes.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 36,
            description: "subject_and_region_provenance",
            sql: include_str!("../migrations/0036_subject_and_region_provenance.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 37,
            description: "stable_subject_identity",
            sql: include_str!("../migrations/0037_stable_subject_identity.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 38,
            description: "diagram_rendering_foundation",
            sql: include_str!("../migrations/0038_diagram_rendering_foundation.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 39,
            description: "practice_domain",
            sql: include_str!("../migrations/0039_practice_domain.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 40,
            description: "practice_documents",
            sql: include_str!("../migrations/0040_practice_documents.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 41,
            description: "practice_document_identity",
            sql: include_str!("../migrations/0041_practice_document_identity.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 42,
            description: "practice_attempts",
            sql: include_str!("../migrations/0042_practice_attempts.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 43,
            description: "practice_loop",
            sql: include_str!("../migrations/0043_practice_loop.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 44,
            description: "unified_practice_documents",
            sql: include_str!("../migrations/0044_unified_practice_documents.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 45,
            description: "validated_diagram_assets",
            sql: include_str!("../migrations/0045_validated_diagram_assets.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 46,
            description: "practice_grading_revisions",
            sql: include_str!("../migrations/0046_practice_grading_revisions.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 47,
            description: "practice_effective_answer_chain",
            sql: include_str!("../migrations/0047_practice_effective_answer_chain.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 48,
            description: "variant_practice",
            sql: include_str!("../migrations/0048_variant_practice.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 49,
            description: "review_session_lifecycle",
            sql: include_str!("../migrations/0049_review_session_lifecycle.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 50,
            description: "practice_grading_evidence",
            sql: include_str!("../migrations/0050_practice_grading_evidence.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 51,
            description: "review_preferences",
            sql: include_str!("../migrations/0051_review_preferences.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 52,
            description: "ai_provider_task_routing",
            sql: include_str!("../migrations/0052_ai_provider_task_routing.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 53,
            description: "problem_library_enhancements",
            sql: include_str!("../migrations/0053_problem_library_enhancements.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 54,
            description: "model_run_usage_cost",
            sql: include_str!("../migrations/0054_model_run_usage_cost.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 55,
            description: "geometry_scenes",
            sql: include_str!("../migrations/0055_geometry_scenes.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 56,
            description: "planner",
            sql: include_str!("../migrations/0056_planner.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 57,
            description: "advanced_practice_submission",
            sql: include_str!("../migrations/0057_advanced_practice_submission.sql"),
            kind: MigrationKind::Up,
        },
    ]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 显式计算日志目录，确保与 app_data_dir 对齐。
    // 约束：不接受 tauri-plugin-log 的默认 LogDir 路径。
    let log_dir = compute_log_dir();
    std::fs::create_dir_all(&log_dir).ok();

    let log_level = if cfg!(debug_assertions) {
        log::LevelFilter::Trace
    } else {
        log::LevelFilter::Info
    };

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log_level)
                .targets([
                    Target::new(TargetKind::Folder {
                        path: log_dir.clone(),
                        file_name: Some("axiom".into()),
                    })
                    .filter(move |m| m.level() <= log_level),
                    Target::new(TargetKind::Stdout).filter(|_m| cfg!(debug_assertions)),
                ])
                // rotation/max_file_size/timezone 是 Builder 级全局配置（v2 API），
                // 不能挂在单个 Target 上。
                .rotation_strategy(RotationStrategy::KeepAll)
                .max_file_size(5_000_000)
                .timezone_strategy(TimezoneStrategy::UseLocal)
                .build(),
        )
        .plugin(
            // 不向 tauri-plugin-sql 注册任何迁移：历史迁移（24–26）含裸
            // BEGIN IMMEDIATE/COMMIT，plugin 的 sqlx Migrator 会用外层事务
            // 包裹导致 "cannot start a transaction within a transaction"。
            // 全部迁移改由 db::init_db 里的 migrate_embedded_schema 在 setup
            // 阶段（早于前端 Database.load）执行，见 db.rs 说明。
            tauri_plugin_sql::Builder::default().build(),
        )
        .manage(commands::CameraOrientationWatcher::default())
        .invoke_handler(tauri::generate_handler![
            commands::platform_capabilities,
            commands::import_image,
            commands::import_textbook_source,
            commands::cancel_textbook_import,
            commands::verify_textbook_source,
            commands::cleanup_textbook_import_temp,
            commands::promote_textbook_source,
            commands::remove_textbook_source,
            commands::persist_camera_frame,
            commands::start_camera_orientation_watch,
            commands::stop_camera_orientation_watch,
            commands::warm_up_document_processor,
            commands::process_document,
            commands::crop_problem_image,
            commands::crop_problem_diagram,
            commands::remove_problem_image,
            commands::remove_problem_diagram,
            commands::list_media_directory,
            commands::delete_media_file,
            diagram::render_tikz,
            practice_pdf::render_practice_pdf,
            practice_preview::render_practice_pdf_page,
            practice_typst::render_complete_practice_pdf,
            practice_pdf::open_practice_pdf,
            practice_pdf::practice_pdf_exists,
            practice_pdf::save_practice_pdf,
            practice_pdf::print_practice_pdf,
            practice_capture::process_practice_scan,
            practice_capture::process_practice_scan_for_page,
            practice_capture::preview_practice_scan,
            practice_capture::prepare_practice_submission,
            practice_capture::open_practice_submission,
            ai::analyze_problem_with_openai_compatible,
            ai::analyze_problem_with_antigravity_cli,
            ai::persist_ai_provider_profiles,
            ai::delete_ai_provider_api_key,
            db::db_execute,
            db::db_select,
            db::get_database_path,
            db::canonicalize_path,
            db::migrate_database,
            keystore::recover_legacy_api_keys,
            horizon::merge_tag_definitions,
            horizon::merge_knowledge_nodes,
            horizon::claim_relabel_batch_item,
            horizon::bind_relabel_batch_item_model_run,
            horizon::recover_relabel_batch_items,
            horizon::bulk_review_curriculum_tags,
            horizon::create_curriculum_import_attempt,
            horizon::update_curriculum_import_progress,
            horizon::complete_curriculum_import_attempt,
            horizon::fail_curriculum_import_attempt,
            updater::get_app_version,
            updater::check_for_updates,
            updater::download_and_install_update,
        ])
        .setup(move |app| {
            // tauri-plugin-log 在 Builder::run 阶段完成初始化，setup 是其后第一个
            // 可记录日志的时机。Release 构建下 statement 日志被关闭，若不在此处
            // 主动写入一条启动日志，正常启动不会在 axiom.log 留下任何条目，
            // 用户无法确认进程是否真的以新版本启动过。
            log::info!(
                "Axiom {} 启动（日志目录：{}）",
                env!("CARGO_PKG_VERSION"),
                log_dir.display()
            );
            // 初始化单连接 SQLite 事务池，确保所有数据操作走同一连接，
            // 避免 tauri-plugin-sql 多连接池导致的事务嵌套与锁竞争。
            let handle = app.handle().clone();
            let ready_or_update_scheduled = tauri::async_runtime::block_on(async move {
                match db::init_db(&handle, axiom_migrations()).await {
                    Ok(()) => {
                        log::info!("数据库连接初始化成功");
                        true
                    }
                    Err(e) => {
                        if db::is_database_schema_ahead_error(&e) {
                            log::error!(
                                "{e} 当前应用版本：{}。学习数据没有被修改；尝试自动恢复到最新版本。",
                                env!("CARGO_PKG_VERSION")
                            );
                            match updater::check_for_updates().await {
                                Ok(Some(update)) => match updater::download_and_install_update(
                                    handle.clone(),
                                    update.download_url,
                                    update.sha256_url,
                                    update.version,
                                )
                                .await
                                {
                                    Ok(()) => {
                                        log::info!("已安排数据库版本恢复所需的应用更新。");
                                        return true;
                                    }
                                    Err(update_error) => {
                                        log::error!("自动恢复更新失败：{update_error}");
                                    }
                                },
                                Ok(None) => {
                                    log::error!("更新源没有比当前应用更新的版本，无法自动恢复。");
                                }
                                Err(update_error) => {
                                    log::error!("检查恢复更新失败：{update_error}");
                                }
                            }
                            // 自动恢复失败时才引导用户到下载页，保留手动恢复通道。
                            let _ = std::process::Command::new("open")
                                .arg(updater::latest_release_page_url())
                                .spawn();
                        }
                        // 数据库是全部命令的前置依赖，初始化失败属于启动期致命错误：
                        // 记录日志后直接退出，避免应用以半残状态继续运行产生大面积报错。
                        log::error!("初始化数据库连接失败：{e}");
                        eprintln!("致命错误：初始化数据库连接失败：{e}");
                        eprintln!(
                            "详情见日志：~/Library/Application Support/com.axiom.study/logs/axiom.log"
                        );
                        false
                    }
                }
            });
            if !ready_or_update_scheduled {
                std::process::exit(1);
            }
            // 让原生窗口跟随系统主题，由前端 ThemeProvider 同步控制
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_theme(None);
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if matches!(
            event,
            tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
        ) {
            app_handle
                .state::<commands::CameraOrientationWatcher>()
                .stop();
        }
    });
}
