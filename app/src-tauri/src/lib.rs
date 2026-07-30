mod ai;
mod commands;
mod db;
mod models;

use tauri::Manager;
use tauri_plugin_sql::{Migration, MigrationKind};

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
    ];

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:axiom.db", migrations)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            commands::platform_capabilities,
            commands::import_image,
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
            db::migrate_database
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            // 初始化单连接 SQLite 事务池，确保所有数据操作走同一连接，
            // 避免 tauri-plugin-sql 多连接池导致的事务嵌套与锁竞争。
            let handle = app.handle().clone();
            tauri::async_runtime::block_on(async move {
                if let Err(e) = db::init_db(&handle).await {
                    log::error!("初始化数据库连接失败：{e}");
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
