-- 为 ai_provider_profiles 添加 credential_ref 列，用于 Keychain 凭据引用。
-- 迁移后：API Key 不再以明文存储在数据库，而是存入 macOS Keychain，
-- 数据库只保存 credential_ref（即 provider id），Rust 端按 ref 从 Keychain 读取实际 key。
-- 已有明文 api_key 由启动时 keystore::migrate_api_keys_to_keychain 迁移到 Keychain 后清空。
ALTER TABLE ai_provider_profiles ADD COLUMN credential_ref TEXT NOT NULL DEFAULT '';
