# Gemini（Antigravity CLI）Provider

## 配置

设置页新增 `Gemini (Antigravity CLI)`：

- CLI 路径：可填 PATH 中的命令名 `agy`，或绝对可执行文件路径。
- Model：例如 `gemini-3.6-flash-high`，实际可用值以本机 `agy models` 为准。
- VLM：题目图片任务必须开启。
- 不需要 Base URL 或 API Key；认证沿用本机 Antigravity CLI 会话。

## 调用协议

原生层使用参数数组直接启动 CLI，不经过 shell：

```text
agy
  --print-timeout 100s
  --model <configured-model>
  --output-format json
  --json-schema <antigravity-compatible-schema>
  --add-dir <problem-image-directory>
  --print "<prompt> ... @<absolute-image-path>"
```

CLI 的 JSON 传输封套由原生层解析：

- `status=SUCCESS`：优先读取 `structured_output`，否则读取 `response`。
- 非零退出码、`status=ERROR`、超时、空响应：返回可见错误状态。
- 成功或失败的原始模型输出继续进入 `model_runs.raw_output`。

## 双层 Schema

当前 Antigravity CLI 的 `--json-schema` 不接受 `type: ["string", "null"]`，也不接受含 `null` 的 enum。Provider 因此使用一个 CLI 兼容 Schema，约束字段容器、choices/sub_questions 对象结构和图形类型枚举。

应用收到输出后仍使用完整 `problem-analysis-v4` Ajv Schema 作为权威校验，并执行既有 JSON 修复流程。CLI 兼容 Schema 不是完整 Schema 的替代品。

## 本机验证

已用本机 `agy` 与 `gemini-3.6-flash-low` 验证：

- `--print` 必须直接接收 Prompt。
- 图片路径必须以 `@绝对路径` 放入 Prompt，并通过 `--add-dir` 授权读取目录。
- `--json-schema` 要求 `--output-format json` 或 `stream-json`。
- 字符串图形类型 enum 可正常返回 `structured_output`。

