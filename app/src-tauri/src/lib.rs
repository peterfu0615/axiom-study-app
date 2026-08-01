mod ai;
mod commands;
mod db;
mod horizon;
mod keystore;
mod models;
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![
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
    ];

    // 显式计算日志目录，确保与 app_data_dir 对齐。
    // 约束：不接受 tauri-plugin-log 的默认 LogDir 路径。
    let log_dir = compute_log_dir();
    std::fs::create_dir_all(&log_dir).ok();

    let log_level = if cfg!(debug_assertions) {
        log::LevelFilter::Trace
    } else {
        log::LevelFilter::Info
    };

    tauri::Builder::default()
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
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:axiom.db", migrations)
                .build(),
        )
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
            commands::camera_orientation,
            commands::process_document,
            commands::crop_problem_image,
            commands::crop_problem_diagram,
            commands::remove_problem_image,
            commands::remove_problem_diagram,
            commands::list_media_directory,
            commands::delete_media_file,
            ai::analyze_problem_with_openai_compatible,
            ai::analyze_problem_with_antigravity_cli,
            db::db_execute,
            db::db_select,
            db::get_database_path,
            db::canonicalize_path,
            db::migrate_database,
            keystore::store_api_key,
            keystore::has_api_key,
            keystore::delete_api_key,
            horizon::merge_tag_definitions,
            horizon::merge_knowledge_nodes,
            horizon::create_curriculum_import_attempt,
            horizon::complete_curriculum_import_attempt,
            horizon::fail_curriculum_import_attempt,
            updater::get_app_version,
            updater::check_for_updates,
            updater::download_and_install_update,
        ])
        .setup(|app| {
            // 初始化单连接 SQLite 事务池，确保所有数据操作走同一连接，
            // 避免 tauri-plugin-sql 多连接池导致的事务嵌套与锁竞争。
            let handle = app.handle().clone();
            tauri::async_runtime::block_on(async move {
                if let Err(e) = db::init_db(&handle).await {
                    log::error!("初始化数据库连接失败：{e}");
                }
                if let Err(e) = keystore::migrate_api_keys_to_keychain(&handle).await {
                    log::warn!("数据库明文 API Key → Keychain 迁移失败（不阻塞启动）：{e}");
                }
            });
            // 让原生窗口跟随系统主题，由前端 ThemeProvider 同步控制
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_theme(None);
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
