//! 迁移完整性常设测试。
//!
//! 背景：sqlx Migrator（tauri-plugin-sql 内部路径）会把每个迁移包进外层
//! 事务，而历史版本号 24–27（来自 codex/horizon-quality-upgrade 分支，
//! 用户真实库已应用）自带裸 BEGIN IMMEDIATE/COMMIT，直接交给 Migrator 会
//! 触发 "cannot start a transaction within a transaction"。因此生产路径由
//! db::migrate_embedded_schema 在启动期执行：剥离最外层事务后运行，并按
//! 原文 SHA-384 写入/校验 _sqlx_migrations。本测试全部走同一 runner：
//!   1. 全新库一路跑到 29，且与 sqlx Migrator 校验兼容（幂等重跑）；
//!   2. 27 状态的库可以升级到 29；
//!   3. 用户真实库副本（/tmp/axiom-verify.db，人工预置）能通过 checksum
//!      校验并推进到 29；
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
    use sqlx::{ConnectOptions, Row, SqliteConnection};
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

    /// 全新库必须能一路跑到 29（含 codex 原文的 24–27 与 0028/0029 的衔接）。
    /// 随后用与 sqlx Migrator 完全一致的校验逻辑重跑两遍：
    ///   - embedded runner 幂等（全部已应用，不再执行任何脚本）；
    ///   - sqlx Migrator（plugin 的同款路径）校验 checksum 全部通过且不应用。
    #[test]
    fn fresh_database_reaches_29_and_stays_sqlx_compatible() {
        tauri::async_runtime::block_on(async {
            let temp = TempDb::new("fresh");
            let mut conn = connect(&temp).await;
            let migrations = migrations_up_to(29);
            migrate_embedded_schema(&mut conn, &migrations)
                .await
                .expect("全新库必须能完整迁移到 29（裸 BEGIN 由 runner 剥离）");
            assert_eq!(max_applied_version(&mut conn).await, 29);

            // 幂等重跑：不得重复执行、不得报错。
            migrate_embedded_schema(&mut conn, &migrations)
                .await
                .expect("embedded runner 必须幂等");
            assert_eq!(max_applied_version(&mut conn).await, 29);

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

    /// 迁移列表完整性：版本必须恰好为 1..=29 且严格递增。
    /// 用户真实库已应用 codex 分支的 24–27，列表缺号会让任何校验拒绝启动。
    #[test]
    fn migration_list_covers_versions_1_through_29_exactly() {
        let versions: Vec<i64> = axiom_migrations()
            .iter()
            .map(|migration| migration.version)
            .collect();
        let expected: Vec<i64> = (1..=29).collect();
        assert_eq!(versions, expected, "迁移列表必须严格等于 1..=29");
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
            ("k-4", "立方根", "k-1", "knowledge", 400),
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

            migrate_embedded_schema(&mut conn, &migrations_up_to(29))
                .await
                .expect("0026–0029 必须能在含脏数据的库上成功应用");

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
            migrate_embedded_schema(&mut conn, &migrations_up_to(29))
                .await
                .expect("0028 必须幂等，重放不得失败");
            assert_eq!(max_applied_version(&mut conn).await, 29);
        });
    }

    /// 升级路径模拟：库已在 codex 风格的 27 状态（含 0026 的触发器与
    /// sibling 索引），0028/0029 必须能在其上成功应用。
    #[test]
    fn database_at_version_27_upgrades_to_29() {
        tauri::async_runtime::block_on(async {
            let temp = TempDb::new("upgrade27");
            let mut conn = connect(&temp).await;
            migrate_embedded_schema(&mut conn, &migrations_up_to(27))
                .await
                .expect("先迁移到 0027 状态");
            migrate_embedded_schema(&mut conn, &migrations_up_to(29))
                .await
                .expect("0028/0029 必须能在 0027 状态库上成功应用");
            assert_eq!(max_applied_version(&mut conn).await, 29);

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
    fn real_user_database_copy_upgrades_to_version_29() {
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
            migrate_embedded_schema(&mut conn, &migrations_up_to(29))
                .await
                .expect("用户库副本必须通过 checksum 校验并成功升级到 29");
            assert_eq!(max_applied_version(&mut conn).await, 29);

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

            migrate_embedded_schema(&mut conn, &migrations_up_to(29))
                .await
                .expect("0026–0029 必须成功应用（含 0029 表重建）");

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
