> 分片 2/2

# 项目快照: Axiom

- 导出路径: `/Users/Peter/Coding/Axiom`
- 生成时间: 由脚本自动生成


## 目录结构

```
  .DS_Store
  BRAND_COLOR_GUIDE.md
  PRD.md
  export_snapshot.py
  app/
    .DS_Store
    .gitignore
    .oxlintrc.json
    README.md
    index.html
    package-lock.json
    package.json
    tsconfig.app.json
    tsconfig.json
    tsconfig.node.json
    vite.config.ts
    docs/
      .DS_Store
      A2_INTELLIGENCE_PIPELINE_DELIVERY.md
      AI_PROMPT_V4.md
      ANTIGRAVITY_PROVIDER.md
      ARCHITECTURE.md
      BASIC_AI_DELIVERY_REPORT.md
      DIAGRAM_EXTRACTION.md
      READING_TYPOGRAPHY.md
      screenshots/
        antigravity-provider-settings.jpeg
        problem-library-wide.jpeg
        responsive-820x620.png
    public/
      favicon.svg
      icons.svg
    scripts/
      generate-problem-analysis-validator.mjs
      test-document-fixtures.mjs
    src/
      .DS_Store
      App.css
      App.tsx
      index.css
      main.tsx
      ai/
        intelligenceContract.test.ts
        intelligenceContract.ts
        intelligenceParser.test.ts
        intelligenceParser.ts
        intelligencePipeline.ts
        pipeline.test.ts
        pipeline.ts
        problemAnalysis.schema.json
        problemAnalysisContract.ts
        problemAnalysisParser.test.ts
        problemAnalysisParser.ts
        provider.test.ts
        provider.ts
        solution.schema.json
        solutionContract.ts
        solutionParser.test.ts
        solutionParser.ts
        solutionPipeline.test.ts
        solutionPipeline.ts
        generated/
          problemAnalysisValidator.d.ts
          problemAnalysisValidator.js
          solutionValidator.d.ts
          solutionValidator.js
      assets/
        hero.png
        react.svg
        vite.svg
      components/
        CropSelectionCanvas.tsx
        Icon.tsx
        MathMarkdown.test.tsx
        MathMarkdown.tsx
        Sidebar.tsx
        Toast.tsx
      domain/
        ai.test.ts
        ai.ts
        mathMarkdown.test.ts
        mathMarkdown.ts
        models.ts
        problem.test.ts
        problem.ts
        problemRegions.ts
        problemSelection.test.ts
        problemSelection.ts
      features/
        capture/
          CaptureWorkspace.tsx
          DocumentEditor.tsx
        library/
          ProblemCropEditor.test.ts
          ProblemCropEditor.tsx
          ProblemLibrary.tsx
          SolutionComparison.test.tsx
          SolutionComparison.tsx
        placeholder/
          ModulePlaceholder.tsx
        settings/
          AISettings.tsx
      platform/
        camera.ts
        cameraGeometry.test.ts
        cameraGeometry.ts
        database.ts
        native.ts
        theme.tsx
        useToast.ts
    src-tauri/
      .DS_Store
      .gitignore
      Cargo.lock
      Cargo.toml
      Entitlements.plist
      Info.plist
      build.rs
      tauri.conf.json
      binaries/
        axiom-vision-aarch64-apple-darwin
      capabilities/
        default.json
      gen/
        schemas/
          acl-manifests.json
          capabilities.json
          desktop-schema.json
          macOS-schema.json
      icons/
        128x128.png
        128x128@2x.png
        32x32.png
        64x64.png
        Square107x107Logo.png
        Square142x142Logo.png
        Square150x150Logo.png
        Square284x284Logo.png
        Square30x30Logo.png
        Square310x310Logo.png
        Square44x44Logo.png
        Square71x71Logo.png
        Square89x89Logo.png
        StoreLogo.png
        icon.icns
        icon.ico
        icon.png
        android/
          mipmap-anydpi-v26/
            ic_launcher.xml
          mipmap-hdpi/
            ic_launcher.png
            ic_launcher_foreground.png
            ic_launcher_round.png
          mipmap-mdpi/
            ic_launcher.png
            ic_launcher_foreground.png
            ic_launcher_round.png
          mipmap-xhdpi/
            ic_launcher.png
            ic_launcher_foreground.png
            ic_launcher_round.png
          mipmap-xxhdpi/
            ic_launcher.png
            ic_launcher_foreground.png
            ic_launcher_round.png
          mipmap-xxxhdpi/
            ic_launcher.png
            ic_launcher_foreground.png
            ic_launcher_round.png
          values/
            ic_launcher_background.xml
        ios/
          AppIcon-20x20@1x.png
          AppIcon-20x20@2x-1.png
          AppIcon-20x20@2x.png
          AppIcon-20x20@3x.png
          AppIcon-29x29@1x.png
          AppIcon-29x29@2x-1.png
          AppIcon-29x29@2x.png
          AppIcon-29x29@3x.png
          AppIcon-40x40@1x.png
          AppIcon-40x40@2x-1.png
          AppIcon-40x40@2x.png
          AppIcon-40x40@3x.png
          AppIcon-512@2x.png
          AppIcon-60x60@2x.png
          AppIcon-60x60@3x.png
          AppIcon-76x76@1x.png
          AppIcon-76x76@2x.png
          AppIcon-83.5x83.5@2x.png
      migrations/
        0001_initial.sql
        0002_document_processing.sql
        0003_problem_persistence.sql
        0004_problem_user_edits.sql
        0005_basic_ai_pipeline.sql
        0006_ai_title_and_provider_settings.sql
        0007_ai_provider_profiles.sql
        0008_ai_sub_questions.sql
        0009_model_run_raw_output.sql
        0010_ai_diagram_extraction.sql
        0011_antigravity_cli_provider.sql
        0012_solution_engine.sql
        0013_intelligence_pipeline.sql
        0014_model_run_provider_attempts.sql
      native/
        AxiomVision.swift
      src/
        ai.rs
        commands.rs
        lib.rs
        main.rs
        models.rs
  icons/
    .DS_Store
    axiom-t-iOS-Default-1024@1x.png
    axiom_text.png
    axiom-t.icon/
      icon.json
      Assets/
        axiom_text.png
  snapshot_output/
  test/
    .DS_Store
    解答题_水印_几何图像处理.png
    解答题_水印_左页边缘判断和裁切_函数图像、表格的处理.png
    选择题_水印_试卷多余表头和文本描述裁切_不完整题目处理.png
```


## Git 提交记录

```
| Commit | Author | Date | Subject |
|---|---|---|---|
| `bba44d0` | PeterFu-m | 2026-07-30 10:58:35 +0800 | fix(types): 移除 StudentAttemptStep 不存在的 title 属性访问 |
| `fa29efd` | PeterFu-m | 2026-07-30 10:50:21 +0800 | feat(theme): 实现深色模式（ThemeProvider + 调色板 + 切换按钮） |
| `73d7047` | PeterFu-m | 2026-07-30 10:36:49 +0800 | fix(ui): 抽取 useToast hook，Toast 3.2 秒自动滑出消失 |
| `9472ea8` | PeterFu-m | 2026-07-30 10:29:36 +0800 | fix(ui): 修复正解"使用公式"视图文字过小且挤在一起 |
| `12b22b8` | PeterFu-m | 2026-07-30 10:28:16 +0800 | fix(ai): worker 自动重启 + 错误隔离，修复 AI 解析无返回 |
| `6860a1f` | PeterFu-m | 2026-07-30 10:25:50 +0800 | fix(db): 加事务互斥锁解决嵌套事务错误 |
| `5dfadd6` | PeterFu-m | 2026-07-30 10:23:05 +0800 | fix(rust): 放宽 crop_problem_image/diagram 的 problem_id 校验 |
| `749817c` | PeterFu-m | 2026-07-30 10:21:41 +0800 | fix(app): 修复 Debug bundle 黑白屏问题 |
| `23f9fbc` | PeterFu-m | 2026-07-30 10:20:06 +0800 | Jul 30 Final Codex |
| `cb0d5a1` | PeterFu-m | 2026-07-30 09:47:12 +0800 | Initial commit: Axiom app skeleton |
```


## Git 当前状态

```
M .DS_Store
 M app/src-tauri/tauri.conf.json
?? export_snapshot.py
```


## 文件内容

```

```


### `app/src-tauri/gen/schemas/desktop-schema.json`

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "CapabilityFile",
  "description": "Capability formats accepted in a capability file.",
  "anyOf": [
    {
      "description": "A single capability.",
      "allOf": [
        {
          "$ref": "#/definitions/Capability"
        }
      ]
    },
    {
      "description": "A list of capabilities.",
      "type": "array",
      "items": {
        "$ref": "#/definitions/Capability"
      }
    },
    {
      "description": "A list of capabilities.",
      "type": "object",
      "required": [
        "capabilities"
      ],
      "properties": {
        "capabilities": {
          "description": "The list of capabilities.",
          "type": "array",
          "items": {
            "$ref": "#/definitions/Capability"
          }
        }
      }
    }
  ],
  "definitions": {
    "Capability": {
      "description": "A grouping and boundary mechanism developers can use to isolate access to the IPC layer.\n\nIt controls application windows' and webviews' fine grained access to the Tauri core, application, or plugin commands. If a webview or its window is not matching any capability then it has no access to the IPC layer at all.\n\nThis can be done to create groups of windows, based on their required system access, which can reduce impact of frontend vulnerabilities in less privileged windows. Windows can be added to a capability by exact name (e.g. `main-window`) or glob patterns like `*` or `admin-*`. A Window can have none, one, or multiple associated capabilities.\n\n## Example\n\n```json { \"identifier\": \"main-user-files-write\", \"description\": \"This capability allows the `main` window on macOS and Windows access to `filesystem` write related commands and `dialog` commands to enable programmatic access to files selected by the user.\", \"windows\": [ \"main\" ], \"permissions\": [ \"core:default\", \"dialog:open\", { \"identifier\": \"fs:allow-write-text-file\", \"allow\": [{ \"path\": \"$HOME/test.txt\" }] }, ], \"platforms\": [\"macOS\",\"windows\"] } ```",
      "type": "object",
      "required": [
        "identifier",
        "permissions"
      ],
      "properties": {
        "identifier": {
          "description": "Identifier of the capability.\n\n## Example\n\n`main-user-files-write`",
          "type": "string"
        },
        "description": {
          "description": "Description of what the capability is intended to allow on associated windows.\n\nIt should contain a description of what the grouped permissions should allow.\n\n## Example\n\nThis capability allows the `main` window access to `filesystem` write related commands and `dialog` commands to enable programmatic access to files selected by the user.",
          "default": "",
          "type": "string"
        },
        "remote": {
          "description": "Configure remote URLs that can use the capability permissions.\n\nThis setting is optional and defaults to not being set, as our default use case is that the content is served from our local application.\n\n:::caution Make sure you understand the security implications of providing remote sources with local system access. :::\n\n## Example\n\n```json { \"urls\": [\"https://*.mydomain.dev\"] } ```",
          "anyOf": [
            {
              "$ref": "#/definitions/CapabilityRemote"
            },
            {
              "type": "null"
            }
          ]
        },
        "local": {
          "description": "Whether this capability is enabled for local app URLs or not. Defaults to `true`.",
          "default": true,
          "type": "boolean"
        },
        "windows": {
          "description": "List of windows that are affected by this capability. Can be a glob pattern.\n\nIf a window label matches any of the patterns in this list, the capability will be enabled on all the webviews of that window, regardless of the value of [`Self::webviews`].\n\nOn multiwebview windows, prefer specifying [`Self::webviews`] and omitting [`Self::windows`] for a fine grained access control.\n\n## Example\n\n`[\"main\"]`",
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "webviews": {
          "description": "List of webviews that are affected by this capability. Can be a glob pattern.\n\nThe capability will be enabled on all the webviews whose label matches any of the patterns in this list, regardless of whether the webview's window label matches a pattern in [`Self::windows`].\n\n## Example\n\n`[\"sub-webview-one\", \"sub-webview-two\"]`",
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "permissions": {
          "description": "List of permissions attached to this capability.\n\nMust include the plugin name as prefix in the form of `${plugin-name}:${permission-name}`. For commands directly implemented in the application itself only `${permission-name}` is required.\n\n## Example\n\n```json [ \"core:default\", \"shell:allow-open\", \"dialog:open\", { \"identifier\": \"fs:allow-write-text-file\", \"allow\": [{ \"path\": \"$HOME/test.txt\" }] } ] ```",
          "type": "array",
          "items": {
            "$ref": "#/definitions/PermissionEntry"
          },
          "uniqueItems": true
        },
        "platforms": {
          "description": "Limit which target platforms this capability applies to.\n\nBy default all platforms are targeted.\n\n## Example\n\n`[\"macOS\",\"windows\"]`",
          "type": [
            "array",
            "null"
          ],
          "items": {
            "$ref": "#/definitions/Target"
          }
        }
      }
    },
    "CapabilityRemote": {
      "description": "Configuration for remote URLs that are associated with the capability.",
      "type": "object",
      "required": [
        "urls"
      ],
      "properties": {
        "urls": {
          "description": "Remote domains this capability refers to using the [URLPattern standard](https://urlpattern.spec.whatwg.org/).\n\n## Examples\n\n- \"https://*.mydomain.dev\": allows subdomains of mydomain.dev - \"https://mydomain.dev/api/*\": allows any subpath of mydomain.dev/api",
          "type": "array",
          "items": {
            "type": "string"
          }
        }
      }
    },
    "PermissionEntry": {
      "description": "An entry for a permission value in a [`Capability`] can be either a raw permission [`Identifier`] or an object that references a permission and extends its scope.",
      "anyOf": [
        {
          "description": "Reference a permission or permission set by identifier.",
          "allOf": [
            {
              "$ref": "#/definitions/Identifier"
            }
          ]
        },
        {
          "description": "Reference a permission or permission set by identifier and extends its scope.",
          "type": "object",
          "allOf": [
            {
              "properties": {
                "identifier": {
                  "description": "Identifier of the permission or permission set.",
                  "allOf": [
                    {
                      "$ref": "#/definitions/Identifier"
                    }
                  ]
                },
                "allow": {
                  "description": "Data that defines what is allowed by the scope.",
                  "type": [
                    "array",
                    "null"
                  ],
                  "items": {
                    "$ref": "#/definitions/Value"
                  }
                },
                "deny": {
                  "description": "Data that defines what is denied by the scope. This should be prioritized by validation logic.",
                  "type": [
                    "array",
                    "null"
                  ],
                  "items": {
                    "$ref": "#/definitions/Value"
                  }
                }
              }
            }
          ],
          "required": [
            "identifier"
          ]
        }
      ]
    },
    "Identifier": {
      "description": "Permission identifier",
      "oneOf": [
        {
          "description": "Default core plugins set.\n#### This default permission set includes:\n\n- `core:path:default`\n- `core:event:default`\n- `core:window:default`\n- `core:webview:default`\n- `core:app:default`\n- `core:image:default`\n- `core:resources:default`\n- `core:menu:default`\n- `core:tray:default`",
          "type": "string",
          "const": "core:default",
          "markdownDescription": "Default core plugins set.\n#### This default permission set includes:\n\n- `core:path:default`\n- `core:event:default`\n- `core:window:default`\n- `core:webview:default`\n- `core:app:default`\n- `core:image:default`\n- `core:resources:default`\n- `core:menu:default`\n- `core:tray:default`"
        },
        {
          "description": "Default permissions for the plugin.\n#### This default permission set includes:\n\n- `allow-version`\n- `allow-name`\n- `allow-tauri-version`\n- `allow-identifier`\n- `allow-bundle-type`\n- `allow-register-listener`\n- `allow-remove-listener`\n- `allow-supports-multiple-windows`",
          "type": "string",
          "const": "core:app:default",
          "markdownDescription": "Default permissions for the plugin.\n#### This default permission set includes:\n\n- `allow-version`\n- `allow-name`\n- `allow-tauri-version`\n- `allow-identifier`\n- `allow-bundle-type`\n- `allow-register-listener`\n- `allow-remove-listener`\n- `allow-supports-multiple-windows`"
        },
        {
          "description": "Enables the app_hide command without any pre-configured scope.",
          "type": "string",
          "const": "core:app:allow-app-hide",
          "markdownDescription": "Enables the app_hide command without any pre-configured scope."
        },
        {
          "description": "Enables the app_show command without any pre-configured scope.",
          "type": "string",
          "const": "core:app:allow-app-show",
          "markdownDescription": "Enables the app_show command without any pre-configured scope."
        },
        {
          "description": "Enables the bundle_type command without any pre-configured scope.",
          "type": "string",
          "const": "core:app:allow-bundle-type",
          "markdownDescription": "Enables the bundle_type command without any pre-configured scope."
        },
        {
          "description": "Enables the default_window_icon command without any pre-configured scope.",
          "type": "string",
          "const": "core:app:allow-default-window-icon",
          "markdownDescription": "Enables the default_window_icon command without any pre-configured scope."
        },
        {
          "description": "Enables the fetch_data_store_identifiers command without any pre-configured scope.",
          "type": "string",
          "const": "core:app:allow-fetch-data-store-identifiers",
          "markdownDescription": "Enables the fetch_data_store_identifiers command without any pre-configured scope."
        },
        {
          "description": "Enables the identifier command without any pre-configured scope.",
          "type": "string",
          "const": "core:app:allow-identifier",
          "markdownDescription": "Enables the identifier command without any pre-configured scope."
        },
        {
          "description": "Enables the name command without any pre-configured scope.",
          "type": "string",
          "const": "core:app:allow-name",
          "markdownDescription": "Enables the name command without any pre-configured scope."
        },
        {
          "description": "Enables the register_listener command without any pre-configured scope.",
          "type": "string",
          "const": "core:app:allow-register-listener",
          "markdownDescription": "Enables the register_listener command without any pre-configured scope."
        },
        {
          "description": "Enables the remove_data_store command without any pre-configured scope.",
          "type": "string",
          "const": "core:app:allow-remove-data-store",
          "markdownDescription": "Enables the remove_data_store command without any pre-configured scope."
        },
        {
          "description": "Enables the remove_listener command without any pre-configured scope.",
          "type": "string",
          "const": "core:app:allow-remove-listener",
          "markdownDescription": "Enables the remove_listener command without any pre-configured scope."
        },
        {
          "description": "Enables the set_app_theme command without any pre-configured scope.",
          "type": "string",
          "const": "core:app:allow-set-app-theme",
          "markdownDescription": "Enables the set_app_theme command without any pre-configured scope."
        },
        {
          "description": "Enables the set_dock_visibility command without any pre-configured scope.",
          "type": "string",
          "const": "core:app:allow-set-dock-visibility",
          "markdownDescription": "Enables the set_dock_visibility command without any pre-configured scope."
        },
        {
          "description": "Enables the supports_multiple_windows command without any pre-configured scope.",
          "type": "string",
          "const": "core:app:allow-supports-multiple-windows",
          "markdownDescription": "Enables the supports_multiple_windows command without any pre-configured scope."
        },
        {
          "description": "Enables the tauri_version command without any pre-configured scope.",
          "type": "string",
          "const": "core:app:allow-tauri-version",
          "markdownDescription": "Enables the tauri_version command without any pre-configured scope."
        },
        {
          "description": "Enables the version command without any pre-configured scope.",
          "type": "string",
          "const": "core:app:allow-version",
          "markdownDescription": "Enables the version command without any pre-configured scope."
        },
        {
          "description": "Denies the app_hide command without any pre-configured scope.",
          "type": "string",
          "const": "core:app:deny-app-hide",
          "markdownDescription": "Denies the app_hide command without any pre-configured scope."
        },
        {
          "description": "Denies the app_show command without any pre-configured scope.",
          "type": "string",
          "const": "core:app:deny-app-show",
          "markdownDescription": "Denies the app_show command without any pre-configured scope."
        },
        {
          "description": "Denies the bundle_type command without any pre-configured scope.",
          "type": "string",
          "const": "core:app:deny-bundle-type",
          "markdownDescription": "Denies the bundle_type command without any pre-configured scope."
        },
        {
          "description": "Denies the default_window_icon command without any pre-configured scope.",
          "type": "string",
          "const": "core:app:deny-default-window-icon",
          "markdownDescription": "Denies the default_window_icon command without any pre-configured scope."
        },
        {
          "description": "Denies the fetch_data_store_identifiers command without any pre-configured scope.",
          "type": "string",
          "const": "core:app:deny-fetch-data-store-identifiers",
          "markdownDescription": "Denies the fetch_data_store_identifiers command without any pre-configured scope."
        },
        {
          "description": "Denies the identifier command without any pre-configured scope.",
          "type": "string",
          "const": "core:app:deny-identifier",
          "markdownDescription": "Denies the identifier command without any pre-configured scope."
        },
        {
          "description": "Denies the name command without any pre-configured scope.",
          "type": "string",
          "const": "core:app:deny-name",
          "markdownDescription": "Denies the name command without any pre-configured scope."
        },
        {
          "description": "Denies the register_listener command without any pre-configured scope.",
          "type": "string",
          "const": "core:app:deny-register-listener",
          "markdownDescription": "Denies the register_listener command without any pre-configured scope."
        },
        {
          "description": "Denies the remove_data_store command without any pre-configured scope.",
          "type": "string",
          "const": "core:app:deny-remove-data-store",
          "markdownDescription": "Denies the remove_data_store command without any pre-configured scope."
        },
        {
          "description": "Denies the remove_listener command without any pre-configured scope.",
          "type": "string",
          "const": "core:app:deny-remove-listener",
          "markdownDescription": "Denies the remove_listener command without any pre-configured scope."
        },
        {
          "description": "Denies the set_app_theme command without any pre-configured scope.",
          "type": "string",
          "const": "core:app:deny-set-app-theme",
          "markdownDescription": "Denies the set_app_theme command without any pre-configured scope."
        },
        {
          "description": "Denies the set_dock_visibility command without any pre-configured scope.",
          "type": "string",
          "const": "core:app:deny-set-dock-visibility",
          "markdownDescription": "Denies the set_dock_visibility command without any pre-configured scope."
        },
        {
          "description": "Denies the supports_multiple_windows command without any pre-configured scope.",
          "type": "string",
          "const": "core:app:deny-supports-multiple-windows",
          "markdownDescription": "Denies the supports_multiple_windows command without any pre-configured scope."
        },
        {
          "description": "Denies the tauri_version command without any pre-configured scope.",
          "type": "string",
          "const": "core:app:deny-tauri-version",
          "markdownDescription": "Denies the tauri_version command without any pre-configured scope."
        },
        {
          "description": "Denies the version command without any pre-configured scope.",
          "type": "string",
          "const": "core:app:deny-version",
          "markdownDescription": "Denies the version command without any pre-configured scope."
        },
        {
          "description": "Default permissions for the plugin, which enables all commands.\n#### This default permission set includes:\n\n- `allow-listen`\n- `allow-unlisten`\n- `allow-emit`\n- `allow-emit-to`",
          "type": "string",
          "const": "core:event:default",
          "markdownDescription": "Default permissions for the plugin, which enables all commands.\n#### This default permission set includes:\n\n- `allow-listen`\n- `allow-unlisten`\n- `allow-emit`\n- `allow-emit-to`"
        },
        {
          "description": "Enables the emit command without any pre-configured scope.",
          "type": "string",
          "const": "core:event:allow-emit",
          "markdownDescription": "Enables the emit command without any pre-configured scope."
        },
        {
          "description": "Enables the emit_to command without any pre-configured scope.",
          "type": "string",
          "const": "core:event:allow-emit-to",
          "markdownDescription": "Enables the emit_to command without any pre-configured scope."
        },
        {
          "description": "Enables the listen command without any pre-configured scope.",
          "type": "string",
          "const": "core:event:allow-listen",
          "markdownDescription": "Enables the listen command without any pre-configured scope."
        },
        {
          "description": "Enables the unlisten command without any pre-configured scope.",
          "type": "string",
          "const": "core:event:allow-unlisten",
          "markdownDescription": "Enables the unlisten command without any pre-configured scope."
        },
        {
          "description": "Denies the emit command without any pre-configured scope.",
          "type": "string",
          "const": "core:event:deny-emit",
          "markdownDescription": "Denies the emit command without any pre-configured scope."
        },
        {
          "description": "Denies the emit_to command without any pre-configured scope.",
          "type": "string",
          "const": "core:event:deny-emit-to",
          "markdownDescription": "Denies the emit_to command without any pre-configured scope."
        },
        {
          "description": "Denies the listen command without any pre-configured scope.",
          "type": "string",
          "const": "core:event:deny-listen",
          "markdownDescription": "Denies the listen command without any pre-configured scope."
        },
        {
          "description": "Denies the unlisten command without any pre-configured scope.",
          "type": "string",
          "const": "core:event:deny-unlisten",
          "markdownDescription": "Denies the unlisten command without any pre-configured scope."
        },
        {
          "description": "Default permissions for the plugin, which enables all commands.\n#### This default permission set includes:\n\n- `allow-new`\n- `allow-from-bytes`\n- `allow-from-path`\n- `allow-rgba`\n- `allow-size`",
          "type": "string",
          "const": "core:image:default",
          "markdownDescription": "Default permissions for the plugin, which enables all commands.\n#### This default permission set includes:\n\n- `allow-new`\n- `allow-from-bytes`\n- `allow-from-path`\n- `allow-rgba`\n- `allow-size`"
        },
        {
          "description": "Enables the from_bytes command without any pre-configured scope.",
          "type": "string",
          "const": "core:image:allow-from-bytes",
          "markdownDescription": "Enables the from_bytes command without any pre-configured scope."
        },
        {
          "description": "Enables the from_path command without any pre-configured scope.",
          "type": "string",
          "const": "core:image:allow-from-path",
          "markdownDescription": "Enables the from_path command without any pre-configured scope."
        },
        {
          "description": "Enables the new command without any pre-configured scope.",
          "type": "string",
          "const": "core:image:allow-new",
          "markdownDescription": "Enables the new command without any pre-configured scope."
        },
        {
          "description": "Enables the rgba command without any pre-configured scope.",
          "type": "string",
          "const": "core:image:allow-rgba",
          "markdownDescription": "Enables the rgba command without any pre-configured scope."
        },
        {
          "description": "Enables the size command without any pre-configured scope.",
          "type": "string",
          "const": "core:image:allow-size",
          "markdownDescription": "Enables the size command without any pre-configured scope."
        },
        {
          "description": "Denies the from_bytes command without any pre-configured scope.",
          "type": "string",
          "const": "core:image:deny-from-bytes",
          "markdownDescription": "Denies the from_bytes command without any pre-configured scope."
        },
        {
          "description": "Denies the from_path command without any pre-configured scope.",
          "type": "string",
          "const": "core:image:deny-from-path",
          "markdownDescription": "Denies the from_path command without any pre-configured scope."
        },
        {
          "description": "Denies the new command without any pre-configured scope.",
          "type": "string",
          "const": "core:image:deny-new",
          "markdownDescription": "Denies the new command without any pre-configured scope."
        },
        {
          "description": "Denies the rgba command without any pre-configured scope.",
          "type": "string",
          "const": "core:image:deny-rgba",
          "markdownDescription": "Denies the rgba command without any pre-configured scope."
        },
        {
          "description": "Denies the size command without any pre-configured scope.",
          "type": "string",
          "const": "core:image:deny-size",
          "markdownDescription": "Denies the size command without any pre-configured scope."
        },
        {
          "description": "Default permissions for the plugin, which enables all commands.\n#### This default permission set includes:\n\n- `allow-new`\n- `allow-append`\n- `allow-prepend`\n- `allow-insert`\n- `allow-remove`\n- `allow-remove-at`\n- `allow-items`\n- `allow-get`\n- `allow-popup`\n- `allow-create-default`\n- `allow-set-as-app-menu`\n- `allow-set-as-window-menu`\n- `allow-text`\n- `allow-set-text`\n- `allow-is-enabled`\n- `allow-set-enabled`\n- `allow-set-accelerator`\n- `allow-set-as-windows-menu-for-nsapp`\n- `allow-set-as-help-menu-for-nsapp`\n- `allow-is-checked`\n- `allow-set-checked`\n- `allow-set-icon`",
          "type": "string",
          "const": "core:menu:default",
          "markdownDescription": "Default permissions for the plugin, which enables all commands.\n#### This default permission set includes:\n\n- `allow-new`\n- `allow-append`\n- `allow-prepend`\n- `allow-insert`\n- `allow-remove`\n- `allow-remove-at`\n- `allow-items`\n- `allow-get`\n- `allow-popup`\n- `allow-create-default`\n- `allow-set-as-app-menu`\n- `allow-set-as-window-menu`\n- `allow-text`\n- `allow-set-text`\n- `allow-is-enabled`\n- `allow-set-enabled`\n- `allow-set-accelerator`\n- `allow-set-as-windows-menu-for-nsapp`\n- `allow-set-as-help-menu-for-nsapp`\n- `allow-is-checked`\n- `allow-set-checked`\n- `allow-set-icon`"
        },
        {
          "description": "Enables the append command without any pre-configured scope.",
          "type": "string",
          "const": "core:menu:allow-append",
          "markdownDescription": "Enables the append command without any pre-configured scope."
        },
        {
          "description": "Enables the create_default command without any pre-configured scope.",
          "type": "string",
          "const": "core:menu:allow-create-default",
          "markdownDescription": "Enables the create_default command without any pre-configured scope."
        },
        {
          "description": "Enables the get command without any pre-configured scope.",
          "type": "string",
          "const": "core:menu:allow-get",
          "markdownDescription": "Enables the get command without any pre-configured scope."
        },
        {
          "description": "Enables the insert command without any pre-configured scope.",
          "type": "string",
          "const": "core:menu:allow-insert",
          "markdownDescription": "Enables the insert command without any pre-configured scope."
        },
        {
          "description": "Enables the is_checked command without any pre-configured scope.",
          "type": "string",
          "const": "core:menu:allow-is-checked",
          "markdownDescription": "Enables the is_checked command without any pre-configured scope."
        },
        {
          "description": "Enables the is_enabled command without any pre-configured scope.",
          "type": "string",
          "const": "core:menu:allow-is-enabled",
          "markdownDescription": "Enables the is_enabled command without any pre-configured scope."
        },
        {
          "description": "Enables the items command without any pre-configured scope.",
          "type": "string",
          "const": "core:menu:allow-items",
          "markdownDescription": "Enables the items command without any pre-configured scope."
        },
        {
          "description": "Enables the new command without any pre-configured scope.",
          "type": "string",
          "const": "core:menu:allow-new",
          "markdownDescription": "Enables the new command without any pre-configured scope."
        },
        {
          "description": "Enables the popup command without any pre-configured scope.",
          "type": "string",
          "const": "core:menu:allow-popup",
          "markdownDescription": "Enables the popup command without any pre-configured scope."
        },
        {
          "description": "Enables the prepend command without any pre-configured scope.",
          "type": "string",
          "const": "core:menu:allow-prepend",
          "markdownDescription": "Enables the prepend command without any pre-configured scope."
        },
        {
          "description": "Enables the remove command without any pre-configured scope.",
          "type": "string",
          "const": "core:menu:allow-remove",
          "markdownDescription": "Enables the remove command without any pre-configured scope."
        },
        {
          "description": "Enables the remove_at command without any pre-configured scope.",
          "type": "string",
          "const": "core:menu:allow-remove-at",
          "markdownDescription": "Enables the remove_at command without any pre-configured scope."
        },
        {
          "description": "Enables the set_accelerator command without any pre-configured scope.",
          "type": "string",
          "const": "core:menu:allow-set-accelerator",
          "markdownDescription": "Enables the set_accelerator command without any pre-configured scope."
        },
        {
          "description": "Enables the set_as_app_menu command without any pre-configured scope.",
          "type": "string",
          "const": "core:menu:allow-set-as-app-menu",
          "markdownDescription": "Enables the set_as_app_menu command without any pre-configured scope."
        },
        {
          "description": "Enables the set_as_help_menu_for_nsapp command without any pre-configured scope.",
          "type": "string",
          "const": "core:menu:allow-set-as-help-menu-for-nsapp",
          "markdownDescription": "Enables the set_as_help_menu_for_nsapp command without any pre-configured scope."
        },
        {
          "description": "Enables the set_as_window_menu command without any pre-configured scope.",
          "type": "string",
          "const": "core:menu:allow-set-as-window-menu",
          "markdownDescription": "Enables the set_as_window_menu command without any pre-configured scope."
        },
        {
          "description": "Enables the set_as_windows_menu_for_nsapp command without any pre-configured scope.",
          "type": "string",
          "const": "core:menu:allow-set-as-windows-menu-for-nsapp",
          "markdownDescription": "Enables the set_as_windows_menu_for_nsapp command without any pre-configured scope."
        },
        {
          "description": "Enables the set_checked command without any pre-configured scope.",
          "type": "string",
          "const": "core:menu:allow-set-checked",
          "markdownDescription": "Enables the set_checked command without any pre-configured scope."
        },
        {
          "description": "Enables the set_enabled command without any pre-configured scope.",
          "type": "string",
          "const": "core:menu:allow-set-enabled",
          "markdownDescription": "Enables the set_enabled command without any pre-configured scope."
        },
        {
          "description": "Enables the set_icon command without any pre-configured scope.",
          "type": "string",
          "const": "core:menu:allow-set-icon",
          "markdownDescription": "Enables the set_icon command without any pre-configured scope."
        },
        {
          "description": "Enables the set_text command without any pre-configured scope.",
          "type": "string",
          "const": "core:menu:allow-set-text",
          "markdownDescription": "Enables the set_text command without any pre-configured scope."
        },
        {
          "description": "Enables the text command without any pre-configured scope.",
          "type": "string",
          "const": "core:menu:allow-text",
          "markdownDescription": "Enables the text command without any pre-configured scope."
        },
        {
          "description": "Denies the append command without any pre-configured scope.",
          "type": "string",
          "const": "core:menu:deny-append",
          "markdownDescription": "Denies the append command without any pre-configured scope."
        },
        {
          "description": "Denies the create_default command without any pre-configured scope.",
          "type": "string",
          "const": "core:menu:deny-create-default",
          "markdownDescription": "Denies the create_default command without any pre-configured scope."
        },
        {
          "description": "Denies the get command without any pre-configured scope.",
          "type": "string",
          "const": "core:menu:deny-get",
          "markdownDescription": "Denies the get command without any pre-configured scope."
        },
        {
          "description": "Denies the insert command without any pre-configured scope.",
          "type": "string",
          "const": "core:menu:deny-insert",
          "markdownDescription": "Denies the insert command without any pre-configured scope."
        },
        {
          "description": "Denies the is_checked command without any pre-configured scope.",
          "type": "string",
          "const": "core:menu:deny-is-checked",
          "markdownDescription": "Denies the is_checked command without any pre-configured scope."
        },
        {
          "description": "Denies the is_enabled command without any pre-configured scope.",
          "type": "string",
          "const": "core:menu:deny-is-enabled",
          "markdownDescription": "Denies the is_enabled command without any pre-configured scope."
        },
        {
          "description": "Denies the items command without any pre-configured scope.",
          "type": "string",
          "const": "core:menu:deny-items",
          "markdownDescription": "Denies the items command without any pre-configured scope."
        },
        {
          "description": "Denies the new command without any pre-configured scope.",
          "type": "string",
          "const": "core:menu:deny-new",
          "markdownDescription": "Denies the new command without any pre-configured scope."
        },
        {
          "description": "Denies the popup command without any pre-configured scope.",
          "type": "string",
          "const": "core:menu:deny-popup",
          "markdownDescription": "Denies the popup command without any pre-configured scope."
        },
        {
          "description": "Denies the prepend command without any pre-configured scope.",
          "type": "string",
          "const": "core:menu:deny-prepend",
          "markdownDescription": "Denies the prepend command without any pre-configured scope."
        },
        {
          "description": "Denies the remove command without any pre-configured scope.",
          "type": "string",
          "const": "core:menu:deny-remove",
          "markdownDescription": "Denies the remove command without any pre-configured scope."
        },
        {
          "description": "Denies the remove_at command without any pre-configured scope.",
          "type": "string",
          "const": "core:menu:deny-remove-at",
          "markdownDescription": "Denies the remove_at command without any pre-configured scope."
        },
        {
          "description": "Denies the set_accelerator command without any pre-configured scope.",
          "type": "string",
          "const": "core:menu:deny-set-accelerator",
          "markdownDescription": "Denies the set_accelerator command without any pre-configured scope."
        },
        {
          "description": "Denies the set_as_app_menu command without any pre-configured scope.",
          "type": "string",
          "const": "core:menu:deny-set-as-app-menu",
          "markdownDescription": "Denies the set_as_app_menu command without any pre-configured scope."
        },
        {
          "description": "Denies the set_as_help_menu_for_nsapp command without any pre-configured scope.",
          "type": "string",
          "const": "core:menu:deny-set-as-help-menu-for-nsapp",
          "markdownDescription": "Denies the set_as_help_menu_for_nsapp command without any pre-configured scope."
        },
        {
          "description": "Denies the set_as_window_menu command without any pre-configured scope.",
          "type": "string",
          "const": "core:menu:deny-set-as-window-menu",
          "markdownDescription": "Denies the set_as_window_menu command without any pre-configured scope."
        },
        {
          "description": "Denies the set_as_windows_menu_for_nsapp command without any pre-configured scope.",
          "type": "string",
          "const": "core:menu:deny-set-as-windows-menu-for-nsapp",
          "markdownDescription": "Denies the set_as_windows_menu_for_nsapp command without any pre-configured scope."
        },
        {
          "description": "Denies the set_checked command without any pre-configured scope.",
          "type": "string",
          "const": "core:menu:deny-set-checked",
          "markdownDescription": "Denies the set_checked command without any pre-configured scope."
        },
        {
          "description": "Denies the set_enabled command without any pre-configured scope.",
          "type": "string",
          "const": "core:menu:deny-set-enabled",
          "markdownDescription": "Denies the set_enabled command without any pre-configured scope."
        },
        {
          "description": "Denies the set_icon command without any pre-configured scope.",
          "type": "string",
          "const": "core:menu:deny-set-icon",
          "markdownDescription": "Denies the set_icon command without any pre-configured scope."
        },
        {
          "description": "Denies the set_text command without any pre-configured scope.",
          "type": "string",
          "const": "core:menu:deny-set-text",
          "markdownDescription": "Denies the set_text command without any pre-configured scope."
        },
        {
          "description": "Denies the text command without any pre-configured scope.",
          "type": "string",
          "const": "core:menu:deny-text",
          "markdownDescription": "Denies the text command without any pre-configured scope."
        },
        {
          "description": "Default permissions for the plugin, which enables all commands.\n#### This default permission set includes:\n\n- `allow-resolve-directory`\n- `allow-resolve`\n- `allow-normalize`\n- `allow-join`\n- `allow-dirname`\n- `allow-extname`\n- `allow-basename`\n- `allow-is-absolute`",
          "type": "string",
          "const": "core:path:default",
          "markdownDescription": "Default permissions for the plugin, which enables all commands.\n#### This default permission set includes:\n\n- `allow-resolve-directory`\n- `allow-resolve`\n- `allow-normalize`\n- `allow-join`\n- `allow-dirname`\n- `allow-extname`\n- `allow-basename`\n- `allow-is-absolute`"
        },
        {
          "description": "Enables the basename command without any pre-configured scope.",
          "type": "string",
          "const": "core:path:allow-basename",
          "markdownDescription": "Enables the basename command without any pre-configured scope."
        },
        {
          "description": "Enables the dirname command without any pre-configured scope.",
          "type": "string",
          "const": "core:path:allow-dirname",
          "markdownDescription": "Enables the dirname command without any pre-configured scope."
        },
        {
          "description": "Enables the extname command without any pre-configured scope.",
          "type": "string",
          "const": "core:path:allow-extname",
          "markdownDescription": "Enables the extname command without any pre-configured scope."
        },
        {
          "description": "Enables the is_absolute command without any pre-configured scope.",
          "type": "string",
          "const": "core:path:allow-is-absolute",
          "markdownDescription": "Enables the is_absolute command without any pre-configured scope."
        },
        {
          "description": "Enables the join command without any pre-configured scope.",
          "type": "string",
          "const": "core:path:allow-join",
          "markdownDescription": "Enables the join command without any pre-configured scope."
        },
        {
          "description": "Enables the normalize command without any pre-configured scope.",
          "type": "string",
          "const": "core:path:allow-normalize",
          "markdownDescription": "Enables the normalize command without any pre-configured scope."
        },
        {
          "description": "Enables the resolve command without any pre-configured scope.",
          "type": "string",
          "const": "core:path:allow-resolve",
          "markdownDescription": "Enables the resolve command without any pre-configured scope."
        },
        {
          "description": "Enables the resolve_directory command without any pre-configured scope.",
          "type": "string",
          "const": "core:path:allow-resolve-directory",
          "markdownDescription": "Enables the resolve_directory command without any pre-configured scope."
        },
        {
          "description": "Denies the basename command without any pre-configured scope.",
          "type": "string",
          "const": "core:path:deny-basename",
          "markdownDescription": "Denies the basename command without any pre-configured scope."
        },
        {
          "description": "Denies the dirname command without any pre-configured scope.",
          "type": "string",
          "const": "core:path:deny-dirname",
          "markdownDescription": "Denies the dirname command without any pre-configured scope."
        },
        {
          "description": "Denies the extname command without any pre-configured scope.",
          "type": "string",
          "const": "core:path:deny-extname",
          "markdownDescription": "Denies the extname command without any pre-configured scope."
        },
        {
          "description": "Denies the is_absolute command without any pre-configured scope.",
          "type": "string",
          "const": "core:path:deny-is-absolute",
          "markdownDescription": "Denies the is_absolute command without any pre-configured scope."
        },
        {
          "description": "Denies the join command without any pre-configured scope.",
          "type": "string",
          "const": "core:path:deny-join",
          "markdownDescription": "Denies the join command without any pre-configured scope."
        },
        {
          "description": "Denies the normalize command without any pre-configured scope.",
          "type": "string",
          "const": "core:path:deny-normalize",
          "markdownDescription": "Denies the normalize command without any pre-configured scope."
        },
        {
          "description": "Denies the resolve command without any pre-configured scope.",
          "type": "string",
          "const": "core:path:deny-resolve",
          "markdownDescription": "Denies the resolve command without any pre-configured scope."
        },
        {
          "description": "Denies the resolve_directory command without any pre-configured scope.",
          "type": "string",
          "const": "core:path:deny-resolve-directory",
          "markdownDescription": "Denies the resolve_directory command without any pre-configured scope."
        },
        {
          "description": "Default permissions for the plugin, which enables all commands.\n#### This default permission set includes:\n\n- `allow-close`",
          "type": "string",
          "const": "core:resources:default",
          "markdownDescription": "Default permissions for the plugin, which enables all commands.\n#### This default permission set includes:\n\n- `allow-close`"
        },
        {
          "description": "Enables the close command without any pre-configured scope.",
          "type": "string",
          "const": "core:resources:allow-close",
          "markdownDescription": "Enables the close command without any pre-configured scope."
        },
        {
          "description": "Denies the close command without any pre-configured scope.",
          "type": "string",
          "const": "core:resources:deny-close",
          "markdownDescription": "Denies the close command without any pre-configured scope."
        },
        {
          "description": "Default permissions for the plugin, which enables all commands.\n#### This default permission set includes:\n\n- `allow-new`\n- `allow-get-by-id`\n- `allow-remove-by-id`\n- `allow-set-icon`\n- `allow-set-menu`\n- `allow-set-tooltip`\n- `allow-set-title`\n- `allow-set-visible`\n- `allow-set-temp-dir-path`\n- `allow-set-icon-as-template`\n- `allow-set-icon-with-as-template`\n- `allow-set-show-menu-on-left-click`",
          "type": "string",
          "const": "core:tray:default",
          "markdownDescription": "Default permissions for the plugin, which enables all commands.\n#### This default permission set includes:\n\n- `allow-new`\n- `allow-get-by-id`\n- `allow-remove-by-id`\n- `allow-set-icon`\n- `allow-set-menu`\n- `allow-set-tooltip`\n- `allow-set-title`\n- `allow-set-visible`\n- `allow-set-temp-dir-path`\n- `allow-set-icon-as-template`\n- `allow-set-icon-with-as-template`\n- `allow-set-show-menu-on-left-click`"
        },
        {
          "description": "Enables the get_by_id command without any pre-configured scope.",
          "type": "string",
          "const": "core:tray:allow-get-by-id",
          "markdownDescription": "Enables the get_by_id command without any pre-configured scope."
        },
        {
          "description": "Enables the new command without any pre-configured scope.",
          "type": "string",
          "const": "core:tray:allow-new",
          "markdownDescription": "Enables the new command without any pre-configured scope."
        },
        {
          "description": "Enables the remove_by_id command without any pre-configured scope.",
          "type": "string",
          "const": "core:tray:allow-remove-by-id",
          "markdownDescription": "Enables the remove_by_id command without any pre-configured scope."
        },
        {
          "description": "Enables the set_icon command without any pre-configured scope.",
          "type": "string",
          "const": "core:tray:allow-set-icon",
          "markdownDescription": "Enables the set_icon command without any pre-configured scope."
        },
        {
          "description": "Enables the set_icon_as_template command without any pre-configured scope.",
          "type": "string",
          "const": "core:tray:allow-set-icon-as-template",
          "markdownDescription": "Enables the set_icon_as_template command without any pre-configured scope."
        },
        {
          "description": "Enables the set_icon_with_as_template command without any pre-configured scope.",
          "type": "string",
          "const": "core:tray:allow-set-icon-with-as-template",
          "markdownDescription": "Enables the set_icon_with_as_template command without any pre-configured scope."
        },
        {
          "description": "Enables the set_menu command without any pre-configured scope.",
          "type": "string",
          "const": "core:tray:allow-set-menu",
          "markdownDescription": "Enables the set_menu command without any pre-configured scope."
        },
        {
          "description": "Enables the set_show_menu_on_left_click command without any pre-configured scope.",
          "type": "string",
          "const": "core:tray:allow-set-show-menu-on-left-click",
          "markdownDescription": "Enables the set_show_menu_on_left_click command without any pre-configured scope."
        },
        {
          "description": "Enables the set_temp_dir_path command without any pre-configured scope.",
          "type": "string",
          "const": "core:tray:allow-set-temp-dir-path",
          "markdownDescription": "Enables the set_temp_dir_path command without any pre-configured scope."
        },
        {
          "description": "Enables the set_title command without any pre-configured scope.",
          "type": "string",
          "const": "core:tray:allow-set-title",
          "markdownDescription": "Enables the set_title command without any pre-configured scope."
        },
        {
          "description": "Enables the set_tooltip command without any pre-configured scope.",
          "type": "string",
          "const": "core:tray:allow-set-tooltip",
          "markdownDescription": "Enables the set_tooltip command without any pre-configured scope."
        },
        {
          "description": "Enables the set_visible command without any pre-configured scope.",
          "type": "string",
          "const": "core:tray:allow-set-visible",
          "markdownDescription": "Enables the set_visible command without any pre-configured scope."
        },
        {
          "description": "Denies the get_by_id command without any pre-configured scope.",
          "type": "string",
          "const": "core:tray:deny-get-by-id",
          "markdownDescription": "Denies the get_by_id command without any pre-configured scope."
        },
        {
          "description": "Denies the new command without any pre-configured scope.",
          "type": "string",
          "const": "core:tray:deny-new",
          "markdownDescription": "Denies the new command without any pre-configured scope."
        },
        {
          "description": "Denies the remove_by_id command without any pre-configured scope.",
          "type": "string",
          "const": "core:tray:deny-remove-by-id",
          "markdownDescription": "Denies the remove_by_id command without any pre-configured scope."
        },
        {
          "description": "Denies the set_icon command without any pre-configured scope.",
          "type": "string",
          "const": "core:tray:deny-set-icon",
          "markdownDescription": "Denies the set_icon command without any pre-configured scope."
        },
        {
          "description": "Denies the set_icon_as_template command without any pre-configured scope.",
          "type": "string",
          "const": "core:tray:deny-set-icon-as-template",
          "markdownDescription": "Denies the set_icon_as_template command without any pre-configured scope."
        },
        {
          "description": "Denies the set_icon_with_as_template command without any pre-configured scope.",
          "type": "string",
          "const": "core:tray:deny-set-icon-with-as-template",
          "markdownDescription": "Denies the set_icon_with_as_template command without any pre-configured scope."
        },
        {
          "description": "Denies the set_menu command without any pre-configured scope.",
          "type": "string",
          "const": "core:tray:deny-set-menu",
          "markdownDescription": "Denies the set_menu command without any pre-configured scope."
        },
        {
          "description": "Denies the set_show_menu_on_left_click command without any pre-configured scope.",
          "type": "string",
          "const": "core:tray:deny-set-show-menu-on-left-click",
          "markdownDescription": "Denies the set_show_menu_on_left_click command without any pre-configured scope."
        },
        {
          "description": "Denies the set_temp_dir_path command without any pre-configured scope.",
          "type": "string",
          "const": "core:tray:deny-set-temp-dir-path",
          "markdownDescription": "Denies the set_temp_dir_path command without any pre-configured scope."
        },
        {
          "description": "Denies the set_title command without any pre-configured scope.",
          "type": "string",
          "const": "core:tray:deny-set-title",
          "markdownDescription": "Denies the set_title command without any pre-configured scope."
        },
        {
          "description": "Denies the set_tooltip command without any pre-configured scope.",
          "type": "string",
          "const": "core:tray:deny-set-tooltip",
          "markdownDescription": "Denies the set_tooltip command without any pre-configured scope."
        },
        {
          "description": "Denies the set_visible command without any pre-configured scope.",
          "type": "string",
          "const": "core:tray:deny-set-visible",
          "markdownDescription": "Denies the set_visible command without any pre-configured scope."
        },
        {
          "description": "Default permissions for the plugin.\n#### This default permission set includes:\n\n- `allow-get-all-webviews`\n- `allow-webview-position`\n- `allow-webview-size`\n- `allow-internal-toggle-devtools`",
          "type": "string",
          "const": "core:webview:default",
          "markdownDescription": "Default permissions for the plugin.\n#### This default permission set includes:\n\n- `allow-get-all-webviews`\n- `allow-webview-position`\n- `allow-webview-size`\n- `allow-internal-toggle-devtools`"
        },
        {
          "description": "Enables the clear_all_browsing_data command without any pre-configured scope.",
          "type": "string",
          "const": "core:webview:allow-clear-all-browsing-data",
          "markdownDescription": "Enables the clear_all_browsing_data command without any pre-configured scope."
        },
        {
          "description": "Enables the create_webview command without any pre-configured scope.",
          "type": "string",
          "const": "core:webview:allow-create-webview",
          "markdownDescription": "Enables the create_webview command without any pre-configured scope."
        },
        {
          "description": "Enables the create_webview_window command without any pre-configured scope.",
          "type": "string",
          "const": "core:webview:allow-create-webview-window",
          "markdownDescription": "Enables the create_webview_window command without any pre-configured scope."
        },
        {
          "description": "Enables the get_all_webviews command without any pre-configured scope.",
          "type": "string",
          "const": "core:webview:allow-get-all-webviews",
          "markdownDescription": "Enables the get_all_webviews command without any pre-configured scope."
        },
        {
          "description": "Enables the internal_toggle_devtools command without any pre-configured scope.",
          "type": "string",
          "const": "core:webview:allow-internal-toggle-devtools",
          "markdownDescription": "Enables the internal_toggle_devtools command without any pre-configured scope."
        },
        {
          "description": "Enables the print command without any pre-configured scope.",
          "type": "string",
          "const": "core:webview:allow-print",
          "markdownDescription": "Enables the print command without any pre-configured scope."
        },
        {
          "description": "Enables the reparent command without any pre-configured scope.",
          "type": "string",
          "const": "core:webview:allow-reparent",
          "markdownDescription": "Enables the reparent command without any pre-configured scope."
        },
        {
          "description": "Enables the set_webview_auto_resize command without any pre-configured scope.",
          "type": "string",
          "const": "core:webview:allow-set-webview-auto-resize",
          "markdownDescription": "Enables the set_webview_auto_resize command without any pre-configured scope."
        },
        {
          "description": "Enables the set_webview_background_color command without any pre-configured scope.",
          "type": "string",
          "const": "core:webview:allow-set-webview-background-color",
          "markdownDescription": "Enables the set_webview_background_color command without any pre-configured scope."
        },
        {
          "description": "Enables the set_webview_focus command without any pre-configured scope.",
          "type": "string",
          "const": "core:webview:allow-set-webview-focus",
          "markdownDescription": "Enables the set_webview_focus command without any pre-configured scope."
        },
        {
          "description": "Enables the set_webview_position command without any pre-configured scope.",
          "type": "string",
          "const": "core:webview:allow-set-webview-position",
          "markdownDescription": "Enables the set_webview_position command without any pre-configured scope."
        },
        {
          "description": "Enables the set_webview_size command without any pre-configured scope.",
          "type": "string",
          "const": "core:webview:allow-set-webview-size",
          "markdownDescription": "Enables the set_webview_size command without any pre-configured scope."
        },
        {
          "description": "Enables the set_webview_zoom command without any pre-configured scope.",
          "type": "string",
          "const": "core:webview:allow-set-webview-zoom",
          "markdownDescription": "Enables the set_webview_zoom command without any pre-configured scope."
        },
        {
          "description": "Enables the webview_close command without any pre-configured scope.",
          "type": "string",
          "const": "core:webview:allow-webview-close",
          "markdownDescription": "Enables the webview_close command without any pre-configured scope."
        },
        {
          "description": "Enables the webview_hide command without any pre-configured scope.",
          "type": "string",
          "const": "core:webview:allow-webview-hide",
          "markdownDescription": "Enables the webview_hide command without any pre-configured scope."
        },
        {
          "description": "Enables the webview_position command without any pre-configured scope.",
          "type": "string",
          "const": "core:webview:allow-webview-position",
          "markdownDescription": "Enables the webview_position command without any pre-configured scope."
        },
        {
          "description": "Enables the webview_show command without any pre-configured scope.",
          "type": "string",
          "const": "core:webview:allow-webview-show",
          "markdownDescription": "Enables the webview_show command without any pre-configured scope."
        },
        {
          "description": "Enables the webview_size command without any pre-configured scope.",
          "type": "string",
          "const": "core:webview:allow-webview-size",
          "markdownDescription": "Enables the webview_size command without any pre-configured scope."
        },
        {
          "description": "Denies the clear_all_browsing_data command without any pre-configured scope.",
          "type": "string",
          "const": "core:webview:deny-clear-all-browsing-data",
          "markdownDescription": "Denies the clear_all_browsing_data command without any pre-configured scope."
        },
        {
          "description": "Denies the create_webview command without any pre-configured scope.",
          "type": "string",
          "const": "core:webview:deny-create-webview",
          "markdownDescription": "Denies the create_webview command without any pre-configured scope."
        },
        {
          "description": "Denies the create_webview_window command without any pre-configured scope.",
          "type": "string",
          "const": "core:webview:deny-create-webview-window",
          "markdownDescription": "Denies the create_webview_window command without any pre-configured scope."
        },
        {
          "description": "Denies the get_all_webviews command without any pre-configured scope.",
          "type": "string",
          "const": "core:webview:deny-get-all-webviews",
          "markdownDescription": "Denies the get_all_webviews command without any pre-configured scope."
        },
        {
          "description": "Denies the internal_toggle_devtools command without any pre-configured scope.",
          "type": "string",
          "const": "core:webview:deny-internal-toggle-devtools",
          "markdownDescription": "Denies the internal_toggle_devtools command without any pre-configured scope."
        },
        {
          "description": "Denies the print command without any pre-configured scope.",
          "type": "string",
          "const": "core:webview:deny-print",
          "markdownDescription": "Denies the print command without any pre-configured scope."
        },
        {
          "description": "Denies the reparent command without any pre-configured scope.",
          "type": "string",
          "const": "core:webview:deny-reparent",
          "markdownDescription": "Denies the reparent command without any pre-configured scope."
        },
        {
          "description": "Denies the set_webview_auto_resize command without any pre-configured scope.",
          "type": "string",
          "const": "core:webview:deny-set-webview-auto-resize",
          "markdownDescription": "Denies the set_webview_auto_resize command without any pre-configured scope."
        },
        {
          "description": "Denies the set_webview_background_color command without any pre-configured scope.",
          "type": "string",
          "const": "core:webview:deny-set-webview-background-color",
          "markdownDescription": "Denies the set_webview_background_color command without any pre-configured scope."
        },
        {
          "description": "Denies the set_webview_focus command without any pre-configured scope.",
          "type": "string",
          "const": "core:webview:deny-set-webview-focus",
          "markdownDescription": "Denies the set_webview_focus command without any pre-configured scope."
        },
        {
          "description": "Denies the set_webview_position command without any pre-configured scope.",
          "type": "string",
          "const": "core:webview:deny-set-webview-position",
          "markdownDescription": "Denies the set_webview_position command without any pre-configured scope."
        },
        {
          "description": "Denies the set_webview_size command without any pre-configured scope.",
          "type": "string",
          "const": "core:webview:deny-set-webview-size",
          "markdownDescription": "Denies the set_webview_size command without any pre-configured scope."
        },
        {
          "description": "Denies the set_webview_zoom command without any pre-configured scope.",
          "type": "string",
          "const": "core:webview:deny-set-webview-zoom",
          "markdownDescription": "Denies the set_webview_zoom command without any pre-configured scope."
        },
        {
          "description": "Denies the webview_close command without any pre-configured scope.",
          "type": "string",
          "const": "core:webview:deny-webview-close",
          "markdownDescription": "Denies the webview_close command without any pre-configured scope."
        },
        {
          "description": "Denies the webview_hide command without any pre-configured scope.",
          "type": "string",
          "const": "core:webview:deny-webview-hide",
          "markdownDescription": "Denies the webview_hide command without any pre-configured scope."
        },
        {
          "description": "Denies the webview_position command without any pre-configured scope.",
          "type": "string",
          "const": "core:webview:deny-webview-position",
          "markdownDescription": "Denies the webview_position command without any pre-configured scope."
        },
        {
          "description": "Denies the webview_show command without any pre-configured scope.",
          "type": "string",
          "const": "core:webview:deny-webview-show",
          "markdownDescription": "Denies the webview_show command without any pre-configured scope."
        },
        {
          "description": "Denies the webview_size command without any pre-configured scope.",
          "type": "string",
          "const": "core:webview:deny-webview-size",
          "markdownDescription": "Denies the webview_size command without any pre-configured scope."
        },
        {
          "description": "Default permissions for the plugin.\n#### This default permission set includes:\n\n- `allow-get-all-windows`\n- `allow-scale-factor`\n- `allow-inner-position`\n- `allow-outer-position`\n- `allow-inner-size`\n- `allow-outer-size`\n- `allow-is-fullscreen`\n- `allow-is-minimized`\n- `allow-is-maximized`\n- `allow-is-focused`\n- `allow-is-decorated`\n- `allow-is-resizable`\n- `allow-is-maximizable`\n- `allow-is-minimizable`\n- `allow-is-closable`\n- `allow-is-visible`\n- `allow-is-enabled`\n- `allow-title`\n- `allow-current-monitor`\n- `allow-primary-monitor`\n- `allow-monitor-from-point`\n- `allow-available-monitors`\n- `allow-cursor-position`\n- `allow-theme`\n- `allow-is-always-on-top`\n- `allow-activity-name`\n- `allow-scene-identifier`\n- `allow-internal-toggle-maximize`",
          "type": "string",
          "const": "core:window:default",
          "markdownDescription": "Default permissions for the plugin.\n#### This default permission set includes:\n\n- `allow-get-all-windows`\n- `allow-scale-factor`\n- `allow-inner-position`\n- `allow-outer-position`\n- `allow-inner-size`\n- `allow-outer-size`\n- `allow-is-fullscreen`\n- `allow-is-minimized`\n- `allow-is-maximized`\n- `allow-is-focused`\n- `allow-is-decorated`\n- `allow-is-resizable`\n- `allow-is-maximizable`\n- `allow-is-minimizable`\n- `allow-is-closable`\n- `allow-is-visible`\n- `allow-is-enabled`\n- `allow-title`\n- `allow-current-monitor`\n- `allow-primary-monitor`\n- `allow-monitor-from-point`\n- `allow-available-monitors`\n- `allow-cursor-position`\n- `allow-theme`\n- `allow-is-always-on-top`\n- `allow-activity-name`\n- `allow-scene-identifier`\n- `allow-internal-toggle-maximize`"
        },
        {
          "description": "Enables the activity_name command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-activity-name",
          "markdownDescription": "Enables the activity_name command without any pre-configured scope."
        },
        {
          "description": "Enables the available_monitors command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-available-monitors",
          "markdownDescription": "Enables the available_monitors command without any pre-configured scope."
        },
        {
          "description": "Enables the center command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-center",
          "markdownDescription": "Enables the center command without any pre-configured scope."
        },
        {
          "description": "Enables the close command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-close",
          "markdownDescription": "Enables the close command without any pre-configured scope."
        },
        {
          "description": "Enables the create command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-create",
          "markdownDescription": "Enables the create command without any pre-configured scope."
        },
        {
          "description": "Enables the current_monitor command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-current-monitor",
          "markdownDescription": "Enables the current_monitor command without any pre-configured scope."
        },
        {
          "description": "Enables the cursor_position command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-cursor-position",
          "markdownDescription": "Enables the cursor_position command without any pre-configured scope."
        },
        {
          "description": "Enables the destroy command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-destroy",
          "markdownDescription": "Enables the destroy command without any pre-configured scope."
        },
        {
          "description": "Enables the get_all_windows command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-get-all-windows",
          "markdownDescription": "Enables the get_all_windows command without any pre-configured scope."
        },
        {
          "description": "Enables the hide command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-hide",
          "markdownDescription": "Enables the hide command without any pre-configured scope."
        },
        {
          "description": "Enables the inner_position command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-inner-position",
          "markdownDescription": "Enables the inner_position command without any pre-configured scope."
        },
        {
          "description": "Enables the inner_size command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-inner-size",
          "markdownDescription": "Enables the inner_size command without any pre-configured scope."
        },
        {
          "description": "Enables the internal_toggle_maximize command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-internal-toggle-maximize",
          "markdownDescription": "Enables the internal_toggle_maximize command without any pre-configured scope."
        },
        {
          "description": "Enables the is_always_on_top command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-is-always-on-top",
          "markdownDescription": "Enables the is_always_on_top command without any pre-configured scope."
        },
        {
          "description": "Enables the is_closable command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-is-closable",
          "markdownDescription": "Enables the is_closable command without any pre-configured scope."
        },
        {
          "description": "Enables the is_decorated command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-is-decorated",
          "markdownDescription": "Enables the is_decorated command without any pre-configured scope."
        },
        {
          "description": "Enables the is_enabled command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-is-enabled",
          "markdownDescription": "Enables the is_enabled command without any pre-configured scope."
        },
        {
          "description": "Enables the is_focused command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-is-focused",
          "markdownDescription": "Enables the is_focused command without any pre-configured scope."
        },
        {
          "description": "Enables the is_fullscreen command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-is-fullscreen",
          "markdownDescription": "Enables the is_fullscreen command without any pre-configured scope."
        },
        {
          "description": "Enables the is_maximizable command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-is-maximizable",
          "markdownDescription": "Enables the is_maximizable command without any pre-configured scope."
        },
        {
          "description": "Enables the is_maximized command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-is-maximized",
          "markdownDescription": "Enables the is_maximized command without any pre-configured scope."
        },
        {
          "description": "Enables the is_minimizable command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-is-minimizable",
          "markdownDescription": "Enables the is_minimizable command without any pre-configured scope."
        },
        {
          "description": "Enables the is_minimized command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-is-minimized",
          "markdownDescription": "Enables the is_minimized command without any pre-configured scope."
        },
        {
          "description": "Enables the is_resizable command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-is-resizable",
          "markdownDescription": "Enables the is_resizable command without any pre-configured scope."
        },
        {
          "description": "Enables the is_visible command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-is-visible",
          "markdownDescription": "Enables the is_visible command without any pre-configured scope."
        },
        {
          "description": "Enables the maximize command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-maximize",
          "markdownDescription": "Enables the maximize command without any pre-configured scope."
        },
        {
          "description": "Enables the minimize command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-minimize",
          "markdownDescription": "Enables the minimize command without any pre-configured scope."
        },
        {
          "description": "Enables the monitor_from_point command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-monitor-from-point",
          "markdownDescription": "Enables the monitor_from_point command without any pre-configured scope."
        },
        {
          "description": "Enables the outer_position command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-outer-position",
          "markdownDescription": "Enables the outer_position command without any pre-configured scope."
        },
        {
          "description": "Enables the outer_size command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-outer-size",
          "markdownDescription": "Enables the outer_size command without any pre-configured scope."
        },
        {
          "description": "Enables the primary_monitor command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-primary-monitor",
          "markdownDescription": "Enables the primary_monitor command without any pre-configured scope."
        },
        {
          "description": "Enables the request_user_attention command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-request-user-attention",
          "markdownDescription": "Enables the request_user_attention command without any pre-configured scope."
        },
        {
          "description": "Enables the scale_factor command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-scale-factor",
          "markdownDescription": "Enables the scale_factor command without any pre-configured scope."
        },
        {
          "description": "Enables the scene_identifier command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-scene-identifier",
          "markdownDescription": "Enables the scene_identifier command without any pre-configured scope."
        },
        {
          "description": "Enables the set_always_on_bottom command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-set-always-on-bottom",
          "markdownDescription": "Enables the set_always_on_bottom command without any pre-configured scope."
        },
        {
          "description": "Enables the set_always_on_top command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-set-always-on-top",
          "markdownDescription": "Enables the set_always_on_top command without any pre-configured scope."
        },
        {
          "description": "Enables the set_background_color command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-set-background-color",
          "markdownDescription": "Enables the set_background_color command without any pre-configured scope."
        },
        {
          "description": "Enables the set_badge_count command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-set-badge-count",
          "markdownDescription": "Enables the set_badge_count command without any pre-configured scope."
        },
        {
          "description": "Enables the set_badge_label command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-set-badge-label",
          "markdownDescription": "Enables the set_badge_label command without any pre-configured scope."
        },
        {
          "description": "Enables the set_closable command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-set-closable",
          "markdownDescription": "Enables the set_closable command without any pre-configured scope."
        },
        {
          "description": "Enables the set_content_protected command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-set-content-protected",
          "markdownDescription": "Enables the set_content_protected command without any pre-configured scope."
        },
        {
          "description": "Enables the set_cursor_grab command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-set-cursor-grab",
          "markdownDescription": "Enables the set_cursor_grab command without any pre-configured scope."
        },
        {
          "description": "Enables the set_cursor_icon command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-set-cursor-icon",
          "markdownDescription": "Enables the set_cursor_icon command without any pre-configured scope."
        },
        {
          "description": "Enables the set_cursor_position command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-set-cursor-position",
          "markdownDescription": "Enables the set_cursor_position command without any pre-configured scope."
        },
        {
          "description": "Enables the set_cursor_visible command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-set-cursor-visible",
          "markdownDescription": "Enables the set_cursor_visible command without any pre-configured scope."
        },
        {
          "description": "Enables the set_decorations command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-set-decorations",
          "markdownDescription": "Enables the set_decorations command without any pre-configured scope."
        },
        {
          "description": "Enables the set_effects command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-set-effects",
          "markdownDescription": "Enables the set_effects command without any pre-configured scope."
        },
        {
          "description": "Enables the set_enabled command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-set-enabled",
          "markdownDescription": "Enables the set_enabled command without any pre-configured scope."
        },
        {
          "description": "Enables the set_focus command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-set-focus",
          "markdownDescription": "Enables the set_focus command without any pre-configured scope."
        },
        {
          "description": "Enables the set_focusable command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-set-focusable",
          "markdownDescription": "Enables the set_focusable command without any pre-configured scope."
        },
        {
          "description": "Enables the set_fullscreen command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-set-fullscreen",
          "markdownDescription": "Enables the set_fullscreen command without any pre-configured scope."
        },
        {
          "description": "Enables the set_icon command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-set-icon",
          "markdownDescription": "Enables the set_icon command without any pre-configured scope."
        },
        {
          "description": "Enables the set_ignore_cursor_events command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-set-ignore-cursor-events",
          "markdownDescription": "Enables the set_ignore_cursor_events command without any pre-configured scope."
        },
        {
          "description": "Enables the set_max_size command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-set-max-size",
          "markdownDescription": "Enables the set_max_size command without any pre-configured scope."
        },
        {
          "description": "Enables the set_maximizable command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-set-maximizable",
          "markdownDescription": "Enables the set_maximizable command without any pre-configured scope."
        },
        {
          "description": "Enables the set_min_size command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-set-min-size",
          "markdownDescription": "Enables the set_min_size command without any pre-configured scope."
        },
        {
          "description": "Enables the set_minimizable command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-set-minimizable",
          "markdownDescription": "Enables the set_minimizable command without any pre-configured scope."
        },
        {
          "description": "Enables the set_overlay_icon command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-set-overlay-icon",
          "markdownDescription": "Enables the set_overlay_icon command without any pre-configured scope."
        },
        {
          "description": "Enables the set_position command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-set-position",
          "markdownDescription": "Enables the set_position command without any pre-configured scope."
        },
        {
          "description": "Enables the set_progress_bar command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-set-progress-bar",
          "markdownDescription": "Enables the set_progress_bar command without any pre-configured scope."
        },
        {
          "description": "Enables the set_resizable command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-set-resizable",
          "markdownDescription": "Enables the set_resizable command without any pre-configured scope."
        },
        {
          "description": "Enables the set_shadow command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-set-shadow",
          "markdownDescription": "Enables the set_shadow command without any pre-configured scope."
        },
        {
          "description": "Enables the set_simple_fullscreen command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-set-simple-fullscreen",
          "markdownDescription": "Enables the set_simple_fullscreen command without any pre-configured scope."
        },
        {
          "description": "Enables the set_size command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-set-size",
          "markdownDescription": "Enables the set_size command without any pre-configured scope."
        },
        {
          "description": "Enables the set_size_constraints command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-set-size-constraints",
          "markdownDescription": "Enables the set_size_constraints command without any pre-configured scope."
        },
        {
          "description": "Enables the set_skip_taskbar command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-set-skip-taskbar",
          "markdownDescription": "Enables the set_skip_taskbar command without any pre-configured scope."
        },
        {
          "description": "Enables the set_theme command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-set-theme",
          "markdownDescription": "Enables the set_theme command without any pre-configured scope."
        },
        {
          "description": "Enables the set_title command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-set-title",
          "markdownDescription": "Enables the set_title command without any pre-configured scope."
        },
        {
          "description": "Enables the set_title_bar_style command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-set-title-bar-style",
          "markdownDescription": "Enables the set_title_bar_style command without any pre-configured scope."
        },
        {
          "description": "Enables the set_visible_on_all_workspaces command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-set-visible-on-all-workspaces",
          "markdownDescription": "Enables the set_visible_on_all_workspaces command without any pre-configured scope."
        },
        {
          "description": "Enables the show command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-show",
          "markdownDescription": "Enables the show command without any pre-configured scope."
        },
        {
          "description": "Enables the start_dragging command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-start-dragging",
          "markdownDescription": "Enables the start_dragging command without any pre-configured scope."
        },
        {
          "description": "Enables the start_resize_dragging command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-start-resize-dragging",
          "markdownDescription": "Enables the start_resize_dragging command without any pre-configured scope."
        },
        {
          "description": "Enables the theme command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-theme",
          "markdownDescription": "Enables the theme command without any pre-configured scope."
        },
        {
          "description": "Enables the title command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-title",
          "markdownDescription": "Enables the title command without any pre-configured scope."
        },
        {
          "description": "Enables the toggle_maximize command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-toggle-maximize",
          "markdownDescription": "Enables the toggle_maximize command without any pre-configured scope."
        },
        {
          "description": "Enables the unmaximize command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-unmaximize",
          "markdownDescription": "Enables the unmaximize command without any pre-configured scope."
        },
        {
          "description": "Enables the unminimize command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-unminimize",
          "markdownDescription": "Enables the unminimize command without any pre-configured scope."
        },
        {
          "description": "Denies the activity_name command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-activity-name",
          "markdownDescription": "Denies the activity_name command without any pre-configured scope."
        },
        {
          "description": "Denies the available_monitors command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-available-monitors",
          "markdownDescription": "Denies the available_monitors command without any pre-configured scope."
        },
        {
          "description": "Denies the center command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-center",
          "markdownDescription": "Denies the center command without any pre-configured scope."
        },
        {
          "description": "Denies the close command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-close",
          "markdownDescription": "Denies the close command without any pre-configured scope."
        },
        {
          "description": "Denies the create command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-create",
          "markdownDescription": "Denies the create command without any pre-configured scope."
        },
        {
          "description": "Denies the current_monitor command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-current-monitor",
          "markdownDescription": "Denies the current_monitor command without any pre-configured scope."
        },
        {
          "description": "Denies the cursor_position command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-cursor-position",
          "markdownDescription": "Denies the cursor_position command without any pre-configured scope."
        },
        {
          "description": "Denies the destroy command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-destroy",
          "markdownDescription": "Denies the destroy command without any pre-configured scope."
        },
        {
          "description": "Denies the get_all_windows command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-get-all-windows",
          "markdownDescription": "Denies the get_all_windows command without any pre-configured scope."
        },
        {
          "description": "Denies the hide command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-hide",
          "markdownDescription": "Denies the hide command without any pre-configured scope."
        },
        {
          "description": "Denies the inner_position command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-inner-position",
          "markdownDescription": "Denies the inner_position command without any pre-configured scope."
        },
        {
          "description": "Denies the inner_size command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-inner-size",
          "markdownDescription": "Denies the inner_size command without any pre-configured scope."
        },
        {
          "description": "Denies the internal_toggle_maximize command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-internal-toggle-maximize",
          "markdownDescription": "Denies the internal_toggle_maximize command without any pre-configured scope."
        },
        {
          "description": "Denies the is_always_on_top command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-is-always-on-top",
          "markdownDescription": "Denies the is_always_on_top command without any pre-configured scope."
        },
        {
          "description": "Denies the is_closable command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-is-closable",
          "markdownDescription": "Denies the is_closable command without any pre-configured scope."
        },
        {
          "description": "Denies the is_decorated command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-is-decorated",
          "markdownDescription": "Denies the is_decorated command without any pre-configured scope."
        },
        {
          "description": "Denies the is_enabled command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-is-enabled",
          "markdownDescription": "Denies the is_enabled command without any pre-configured scope."
        },
        {
          "description": "Denies the is_focused command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-is-focused",
          "markdownDescription": "Denies the is_focused command without any pre-configured scope."
        },
        {
          "description": "Denies the is_fullscreen command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-is-fullscreen",
          "markdownDescription": "Denies the is_fullscreen command without any pre-configured scope."
        },
        {
          "description": "Denies the is_maximizable command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-is-maximizable",
          "markdownDescription": "Denies the is_maximizable command without any pre-configured scope."
        },
        {
          "description": "Denies the is_maximized command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-is-maximized",
          "markdownDescription": "Denies the is_maximized command without any pre-configured scope."
        },
        {
          "description": "Denies the is_minimizable command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-is-minimizable",
          "markdownDescription": "Denies the is_minimizable command without any pre-configured scope."
        },
        {
          "description": "Denies the is_minimized command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-is-minimized",
          "markdownDescription": "Denies the is_minimized command without any pre-configured scope."
        },
        {
          "description": "Denies the is_resizable command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-is-resizable",
          "markdownDescription": "Denies the is_resizable command without any pre-configured scope."
        },
        {
          "description": "Denies the is_visible command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-is-visible",
          "markdownDescription": "Denies the is_visible command without any pre-configured scope."
        },
        {
          "description": "Denies the maximize command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-maximize",
          "markdownDescription": "Denies the maximize command without any pre-configured scope."
        },
        {
          "description": "Denies the minimize command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-minimize",
          "markdownDescription": "Denies the minimize command without any pre-configured scope."
        },
        {
          "description": "Denies the monitor_from_point command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-monitor-from-point",
          "markdownDescription": "Denies the monitor_from_point command without any pre-configured scope."
        },
        {
          "description": "Denies the outer_position command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-outer-position",
          "markdownDescription": "Denies the outer_position command without any pre-configured scope."
        },
        {
          "description": "Denies the outer_size command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-outer-size",
          "markdownDescription": "Denies the outer_size command without any pre-configured scope."
        },
        {
          "description": "Denies the primary_monitor command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-primary-monitor",
          "markdownDescription": "Denies the primary_monitor command without any pre-configured scope."
        },
        {
          "description": "Denies the request_user_attention command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-request-user-attention",
          "markdownDescription": "Denies the request_user_attention command without any pre-configured scope."
        },
        {
          "description": "Denies the scale_factor command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-scale-factor",
          "markdownDescription": "Denies the scale_factor command without any pre-configured scope."
        },
        {
          "description": "Denies the scene_identifier command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-scene-identifier",
          "markdownDescription": "Denies the scene_identifier command without any pre-configured scope."
        },
        {
          "description": "Denies the set_always_on_bottom command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-set-always-on-bottom",
          "markdownDescription": "Denies the set_always_on_bottom command without any pre-configured scope."
        },
        {
          "description": "Denies the set_always_on_top command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-set-always-on-top",
          "markdownDescription": "Denies the set_always_on_top command without any pre-configured scope."
        },
        {
          "description": "Denies the set_background_color command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-set-background-color",
          "markdownDescription": "Denies the set_background_color command without any pre-configured scope."
        },
        {
          "description": "Denies the set_badge_count command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-set-badge-count",
          "markdownDescription": "Denies the set_badge_count command without any pre-configured scope."
        },
        {
          "description": "Denies the set_badge_label command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-set-badge-label",
          "markdownDescription": "Denies the set_badge_label command without any pre-configured scope."
        },
        {
          "description": "Denies the set_closable command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-set-closable",
          "markdownDescription": "Denies the set_closable command without any pre-configured scope."
        },
        {
          "description": "Denies the set_content_protected command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-set-content-protected",
          "markdownDescription": "Denies the set_content_protected command without any pre-configured scope."
        },
        {
          "description": "Denies the set_cursor_grab command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-set-cursor-grab",
          "markdownDescription": "Denies the set_cursor_grab command without any pre-configured scope."
        },
        {
          "description": "Denies the set_cursor_icon command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-set-cursor-icon",
          "markdownDescription": "Denies the set_cursor_icon command without any pre-configured scope."
        },
        {
          "description": "Denies the set_cursor_position command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-set-cursor-position",
          "markdownDescription": "Denies the set_cursor_position command without any pre-configured scope."
        },
        {
          "description": "Denies the set_cursor_visible command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-set-cursor-visible",
          "markdownDescription": "Denies the set_cursor_visible command without any pre-configured scope."
        },
        {
          "description": "Denies the set_decorations command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-set-decorations",
          "markdownDescription": "Denies the set_decorations command without any pre-configured scope."
        },
        {
          "description": "Denies the set_effects command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-set-effects",
          "markdownDescription": "Denies the set_effects command without any pre-configured scope."
        },
        {
          "description": "Denies the set_enabled command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-set-enabled",
          "markdownDescription": "Denies the set_enabled command without any pre-configured scope."
        },
        {
          "description": "Denies the set_focus command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-set-focus",
          "markdownDescription": "Denies the set_focus command without any pre-configured scope."
        },
        {
          "description": "Denies the set_focusable command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-set-focusable",
          "markdownDescription": "Denies the set_focusable command without any pre-configured scope."
        },
        {
          "description": "Denies the set_fullscreen command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-set-fullscreen",
          "markdownDescription": "Denies the set_fullscreen command without any pre-configured scope."
        },
        {
          "description": "Denies the set_icon command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-set-icon",
          "markdownDescription": "Denies the set_icon command without any pre-configured scope."
        },
        {
          "description": "Denies the set_ignore_cursor_events command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-set-ignore-cursor-events",
          "markdownDescription": "Denies the set_ignore_cursor_events command without any pre-configured scope."
        },
        {
          "description": "Denies the set_max_size command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-set-max-size",
          "markdownDescription": "Denies the set_max_size command without any pre-configured scope."
        },
        {
          "description": "Denies the set_maximizable command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-set-maximizable",
          "markdownDescription": "Denies the set_maximizable command without any pre-configured scope."
        },
        {
          "description": "Denies the set_min_size command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-set-min-size",
          "markdownDescription": "Denies the set_min_size command without any pre-configured scope."
        },
        {
          "description": "Denies the set_minimizable command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-set-minimizable",
          "markdownDescription": "Denies the set_minimizable command without any pre-configured scope."
        },
        {
          "description": "Denies the set_overlay_icon command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-set-overlay-icon",
          "markdownDescription": "Denies the set_overlay_icon command without any pre-configured scope."
        },
        {
          "description": "Denies the set_position command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-set-position",
          "markdownDescription": "Denies the set_position command without any pre-configured scope."
        },
        {
          "description": "Denies the set_progress_bar command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-set-progress-bar",
          "markdownDescription": "Denies the set_progress_bar command without any pre-configured scope."
        },
        {
          "description": "Denies the set_resizable command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-set-resizable",
          "markdownDescription": "Denies the set_resizable command without any pre-configured scope."
        },
        {
          "description": "Denies the set_shadow command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-set-shadow",
          "markdownDescription": "Denies the set_shadow command without any pre-configured scope."
        },
        {
          "description": "Denies the set_simple_fullscreen command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-set-simple-fullscreen",
          "markdownDescription": "Denies the set_simple_fullscreen command without any pre-configured scope."
        },
        {
          "description": "Denies the set_size command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-set-size",
          "markdownDescription": "Denies the set_size command without any pre-configured scope."
        },
        {
          "description": "Denies the set_size_constraints command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-set-size-constraints",
          "markdownDescription": "Denies the set_size_constraints command without any pre-configured scope."
        },
        {
          "description": "Denies the set_skip_taskbar command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-set-skip-taskbar",
          "markdownDescription": "Denies the set_skip_taskbar command without any pre-configured scope."
        },
        {
          "description": "Denies the set_theme command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-set-theme",
          "markdownDescription": "Denies the set_theme command without any pre-configured scope."
        },
        {
          "description": "Denies the set_title command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-set-title",
          "markdownDescription": "Denies the set_title command without any pre-configured scope."
        },
        {
          "description": "Denies the set_title_bar_style command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-set-title-bar-style",
          "markdownDescription": "Denies the set_title_bar_style command without any pre-configured scope."
        },
        {
          "description": "Denies the set_visible_on_all_workspaces command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-set-visible-on-all-workspaces",
          "markdownDescription": "Denies the set_visible_on_all_workspaces command without any pre-configured scope."
        },
        {
          "description": "Denies the show command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-show",
          "markdownDescription": "Denies the show command without any pre-configured scope."
        },
        {
          "description": "Denies the start_dragging command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-start-dragging",
          "markdownDescription": "Denies the start_dragging command without any pre-configured scope."
        },
        {
          "description": "Denies the start_resize_dragging command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-start-resize-dragging",
          "markdownDescription": "Denies the start_resize_dragging command without any pre-configured scope."
        },
        {
          "description": "Denies the theme command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-theme",
          "markdownDescription": "Denies the theme command without any pre-configured scope."
        },
        {
          "description": "Denies the title command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-title",
          "markdownDescription": "Denies the title command without any pre-configured scope."
        },
        {
          "description": "Denies the toggle_maximize command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-toggle-maximize",
          "markdownDescription": "Denies the toggle_maximize command without any pre-configured scope."
        },
        {
          "description": "Denies the unmaximize command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-unmaximize",
          "markdownDescription": "Denies the unmaximize command without any pre-configured scope."
        },
        {
          "description": "Denies the unminimize command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-unminimize",
          "markdownDescription": "Denies the unminimize command without any pre-configured scope."
        },
        {
          "description": "This permission set configures the types of dialogs\navailable from the dialog plugin.\n\n#### Granted Permissions\n\nAll dialog types are enabled.\n\n\n\n#### This default permission set includes:\n\n- `allow-message`\n- `allow-save`\n- `allow-open`",
          "type": "string",
          "const": "dialog:default",
          "markdownDescription": "This permission set configures the types of dialogs\navailable from the dialog plugin.\n\n#### Granted Permissions\n\nAll dialog types are enabled.\n\n\n\n#### This default permission set includes:\n\n- `allow-message`\n- `allow-save`\n- `allow-open`"
        },
        {
          "description": "Enables the ask command without any pre-configured scope. (**DEPRECATED**: This is now an alias to `allow-message` and will be removed in v3)",
          "type": "string",
          "const": "dialog:allow-ask",
          "markdownDescription": "Enables the ask command without any pre-configured scope. (**DEPRECATED**: This is now an alias to `allow-message` and will be removed in v3)"
        },
        {
          "description": "Enables the confirm command without any pre-configured scope. (**DEPRECATED**: This is now an alias to `allow-message` and will be removed in v3)",
          "type": "string",
          "const": "dialog:allow-confirm",
          "markdownDescription": "Enables the confirm command without any pre-configured scope. (**DEPRECATED**: This is now an alias to `allow-message` and will be removed in v3)"
        },
        {
          "description": "Enables the message command without any pre-configured scope.",
          "type": "string",
          "const": "dialog:allow-message",
          "markdownDescription": "Enables the message command without any pre-configured scope."
        },
        {
          "description": "Enables the open command without any pre-configured scope.",
          "type": "string",
          "const": "dialog:allow-open",
          "markdownDescription": "Enables the open command without any pre-configured scope."
        },
        {
          "description": "Enables the save command without any pre-configured scope.",
          "type": "string",
          "const": "dialog:allow-save",
          "markdownDescription": "Enables the save command without any pre-configured scope."
        },
        {
          "description": "Denies the ask command without any pre-configured scope. (**DEPRECATED**: This is now an alias to `deny-message` and will be removed in v3)",
          "type": "string",
          "const": "dialog:deny-ask",
          "markdownDescription": "Denies the ask command without any pre-configured scope. (**DEPRECATED**: This is now an alias to `deny-message` and will be removed in v3)"
        },
        {
          "description": "Denies the confirm command without any pre-configured scope. (**DEPRECATED**: This is now an alias to `deny-message` and will be removed in v3)",
          "type": "string",
          "const": "dialog:deny-confirm",
          "markdownDescription": "Denies the confirm command without any pre-configured scope. (**DEPRECATED**: This is now an alias to `deny-message` and will be removed in v3)"
        },
        {
          "description": "Denies the message command without any pre-configured scope.",
          "type": "string",
          "const": "dialog:deny-message",
          "markdownDescription": "Denies the message command without any pre-configured scope."
        },
        {
          "description": "Denies the open command without any pre-configured scope.",
          "type": "string",
          "const": "dialog:deny-open",
          "markdownDescription": "Denies the open command without any pre-configured scope."
        },
        {
          "description": "Denies the save command without any pre-configured scope.",
          "type": "string",
          "const": "dialog:deny-save",
          "markdownDescription": "Denies the save command without any pre-configured scope."
        },
        {
          "description": "Allows the log command\n#### This default permission set includes:\n\n- `allow-log`",
          "type": "string",
          "const": "log:default",
          "markdownDescription": "Allows the log command\n#### This default permission set includes:\n\n- `allow-log`"
        },
        {
          "description": "Enables the log command without any pre-configured scope.",
          "type": "string",
          "const": "log:allow-log",
          "markdownDescription": "Enables the log command without any pre-configured scope."
        },
        {
          "description": "Denies the log command without any pre-configured scope.",
          "type": "string",
          "const": "log:deny-log",
          "markdownDescription": "Denies the log command without any pre-configured scope."
        },
        {
          "description": "### Default Permissions\n\nThis permission set configures what kind of\ndatabase operations are available from the sql plugin.\n\n### Granted Permissions\n\nAll reading related operations are enabled.\nAlso allows to load or close a connection.\n\n\n#### This default permission set includes:\n\n- `allow-close`\n- `allow-load`\n- `allow-select`",
          "type": "string",
          "const": "sql:default",
          "markdownDescription": "### Default Permissions\n\nThis permission set configures what kind of\ndatabase operations are available from the sql plugin.\n\n### Granted Permissions\n\nAll reading related operations are enabled.\nAlso allows to load or close a connection.\n\n\n#### This default permission set includes:\n\n- `allow-close`\n- `allow-load`\n- `allow-select`"
        },
        {
          "description": "Enables the close command without any pre-configured scope.",
          "type": "string",
          "const": "sql:allow-close",
          "markdownDescription": "Enables the close command without any pre-configured scope."
        },
        {
          "description": "Enables the execute command without any pre-configured scope.",
          "type": "string",
          "const": "sql:allow-execute",
          "markdownDescription": "Enables the execute command without any pre-configured scope."
        },
        {
          "description": "Enables the load command without any pre-configured scope.",
          "type": "string",
          "const": "sql:allow-load",
          "markdownDescription": "Enables the load command without any pre-configured scope."
        },
        {
          "description": "Enables the select command without any pre-configured scope.",
          "type": "string",
          "const": "sql:allow-select",
          "markdownDescription": "Enables the select command without any pre-configured scope."
        },
        {
          "description": "Denies the close command without any pre-configured scope.",
          "type": "string",
          "const": "sql:deny-close",
          "markdownDescription": "Denies the close command without any pre-configured scope."
        },
        {
          "description": "Denies the execute command without any pre-configured scope.",
          "type": "string",
          "const": "sql:deny-execute",
          "markdownDescription": "Denies the execute command without any pre-configured scope."
        },
        {
          "description": "Denies the load command without any pre-configured scope.",
          "type": "string",
          "const": "sql:deny-load",
          "markdownDescription": "Denies the load command without any pre-configured scope."
        },
        {
          "description": "Denies the select command without any pre-configured scope.",
          "type": "string",
          "const": "sql:deny-select",
          "markdownDescription": "Denies the select command without any pre-configured scope."
        }
      ]
    },
    "Value": {
      "description": "All supported ACL values.",
      "anyOf": [
        {
          "description": "Represents a null JSON value.",
          "type": "null"
        },
        {
          "description": "Represents a [`bool`].",
          "type": "boolean"
        },
        {
          "description": "Represents a valid ACL [`Number`].",
          "allOf": [
            {
              "$ref": "#/definitions/Number"
            }
          ]
        },
        {
          "description": "Represents a [`String`].",
          "type": "string"
        },
        {
          "description": "Represents a list of other [`Value`]s.",
          "type": "array",
          "items": {
            "$ref": "#/definitions/Value"
          }
        },
        {
          "description": "Represents a map of [`String`] keys to [`Value`]s.",
          "type": "object",
          "additionalProperties": {
            "$ref": "#/definitions/Value"
          }
        }
      ]
    },
    "Number": {
      "description": "A valid ACL number.",
      "anyOf": [
        {
          "description": "Represents an [`i64`].",
          "type": "integer",
          "format": "int64"
        },
        {
          "description": "Represents a [`f64`].",
          "type": "number",
          "format": "double"
        }
      ]
    },
    "Target": {
      "description": "Platform target.",
      "oneOf": [
        {
          "description": "MacOS.",
          "type": "string",
          "enum": [
            "macOS"
          ]
        },
        {
          "description": "Windows.",
          "type": "string",
          "enum": [
            "windows"
          ]
        },
        {
          "description": "Linux.",
          "type": "string",
          "enum": [
            "linux"
          ]
        },
        {
          "description": "Android.",
          "type": "string",
          "enum": [
            "android"
          ]
        },
        {
          "description": "iOS.",
          "type": "string",
          "enum": [
            "iOS"
          ]
        }
      ]
    }
  }
}
```


### `app/src-tauri/gen/schemas/macOS-schema.json`

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "CapabilityFile",
  "description": "Capability formats accepted in a capability file.",
  "anyOf": [
    {
      "description": "A single capability.",
      "allOf": [
        {
          "$ref": "#/definitions/Capability"
        }
      ]
    },
    {
      "description": "A list of capabilities.",
      "type": "array",
      "items": {
        "$ref": "#/definitions/Capability"
      }
    },
    {
      "description": "A list of capabilities.",
      "type": "object",
      "required": [
        "capabilities"
      ],
      "properties": {
        "capabilities": {
          "description": "The list of capabilities.",
          "type": "array",
          "items": {
            "$ref": "#/definitions/Capability"
          }
        }
      }
    }
  ],
  "definitions": {
    "Capability": {
      "description": "A grouping and boundary mechanism developers can use to isolate access to the IPC layer.\n\nIt controls application windows' and webviews' fine grained access to the Tauri core, application, or plugin commands. If a webview or its window is not matching any capability then it has no access to the IPC layer at all.\n\nThis can be done to create groups of windows, based on their required system access, which can reduce impact of frontend vulnerabilities in less privileged windows. Windows can be added to a capability by exact name (e.g. `main-window`) or glob patterns like `*` or `admin-*`. A Window can have none, one, or multiple associated capabilities.\n\n## Example\n\n```json { \"identifier\": \"main-user-files-write\", \"description\": \"This capability allows the `main` window on macOS and Windows access to `filesystem` write related commands and `dialog` commands to enable programmatic access to files selected by the user.\", \"windows\": [ \"main\" ], \"permissions\": [ \"core:default\", \"dialog:open\", { \"identifier\": \"fs:allow-write-text-file\", \"allow\": [{ \"path\": \"$HOME/test.txt\" }] }, ], \"platforms\": [\"macOS\",\"windows\"] } ```",
      "type": "object",
      "required": [
        "identifier",
        "permissions"
      ],
      "properties": {
        "identifier": {
          "description": "Identifier of the capability.\n\n## Example\n\n`main-user-files-write`",
          "type": "string"
        },
        "description": {
          "description": "Description of what the capability is intended to allow on associated windows.\n\nIt should contain a description of what the grouped permissions should allow.\n\n## Example\n\nThis capability allows the `main` window access to `filesystem` write related commands and `dialog` commands to enable programmatic access to files selected by the user.",
          "default": "",
          "type": "string"
        },
        "remote": {
          "description": "Configure remote URLs that can use the capability permissions.\n\nThis setting is optional and defaults to not being set, as our default use case is that the content is served from our local application.\n\n:::caution Make sure you understand the security implications of providing remote sources with local system access. :::\n\n## Example\n\n```json { \"urls\": [\"https://*.mydomain.dev\"] } ```",
          "anyOf": [
            {
              "$ref": "#/definitions/CapabilityRemote"
            },
            {
              "type": "null"
            }
          ]
        },
        "local": {
          "description": "Whether this capability is enabled for local app URLs or not. Defaults to `true`.",
          "default": true,
          "type": "boolean"
        },
        "windows": {
          "description": "List of windows that are affected by this capability. Can be a glob pattern.\n\nIf a window label matches any of the patterns in this list, the capability will be enabled on all the webviews of that window, regardless of the value of [`Self::webviews`].\n\nOn multiwebview windows, prefer specifying [`Self::webviews`] and omitting [`Self::windows`] for a fine grained access control.\n\n## Example\n\n`[\"main\"]`",
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "webviews": {
          "description": "List of webviews that are affected by this capability. Can be a glob pattern.\n\nThe capability will be enabled on all the webviews whose label matches any of the patterns in this list, regardless of whether the webview's window label matches a pattern in [`Self::windows`].\n\n## Example\n\n`[\"sub-webview-one\", \"sub-webview-two\"]`",
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "permissions": {
          "description": "List of permissions attached to this capability.\n\nMust include the plugin name as prefix in the form of `${plugin-name}:${permission-name}`. For commands directly implemented in the application itself only `${permission-name}` is required.\n\n## Example\n\n```json [ \"core:default\", \"shell:allow-open\", \"dialog:open\", { \"identifier\": \"fs:allow-write-text-file\", \"allow\": [{ \"path\": \"$HOME/test.txt\" }] } ] ```",
          "type": "array",
          "items": {
            "$ref": "#/definitions/PermissionEntry"
          },
          "uniqueItems": true
        },
        "platforms": {
          "description": "Limit which target platforms this capability applies to.\n\nBy default all platforms are targeted.\n\n## Example\n\n`[\"macOS\",\"windows\"]`",
          "type": [
            "array",
            "null"
          ],
          "items": {
            "$ref": "#/definitions/Target"
          }
        }
      }
    },
    "CapabilityRemote": {
      "description": "Configuration for remote URLs that are associated with the capability.",
      "type": "object",
      "required": [
        "urls"
      ],
      "properties": {
        "urls": {
          "description": "Remote domains this capability refers to using the [URLPattern standard](https://urlpattern.spec.whatwg.org/).\n\n## Examples\n\n- \"https://*.mydomain.dev\": allows subdomains of mydomain.dev - \"https://mydomain.dev/api/*\": allows any subpath of mydomain.dev/api",
          "type": "array",
          "items": {
            "type": "string"
          }
        }
      }
    },
    "PermissionEntry": {
      "description": "An entry for a permission value in a [`Capability`] can be either a raw permission [`Identifier`] or an object that references a permission and extends its scope.",
      "anyOf": [
        {
          "description": "Reference a permission or permission set by identifier.",
          "allOf": [
            {
              "$ref": "#/definitions/Identifier"
            }
          ]
        },
        {
          "description": "Reference a permission or permission set by identifier and extends its scope.",
          "type": "object",
          "allOf": [
            {
              "properties": {
                "identifier": {
                  "description": "Identifier of the permission or permission set.",
                  "allOf": [
                    {
                      "$ref": "#/definitions/Identifier"
                    }
                  ]
                },
                "allow": {
                  "description": "Data that defines what is allowed by the scope.",
                  "type": [
                    "array",
                    "null"
                  ],
                  "items": {
                    "$ref": "#/definitions/Value"
                  }
                },
                "deny": {
                  "description": "Data that defines what is denied by the scope. This should be prioritized by validation logic.",
                  "type": [
                    "array",
                    "null"
                  ],
                  "items": {
                    "$ref": "#/definitions/Value"
                  }
                }
              }
            }
          ],
          "required": [
            "identifier"
          ]
        }
      ]
    },
    "Identifier": {
      "description": "Permission identifier",
      "oneOf": [
        {
          "description": "Default core plugins set.\n#### This default permission set includes:\n\n- `core:path:default`\n- `core:event:default`\n- `core:window:default`\n- `core:webview:default`\n- `core:app:default`\n- `core:image:default`\n- `core:resources:default`\n- `core:menu:default`\n- `core:tray:default`",
          "type": "string",
          "const": "core:default",
          "markdownDescription": "Default core plugins set.\n#### This default permission set includes:\n\n- `core:path:default`\n- `core:event:default`\n- `core:window:default`\n- `core:webview:default`\n- `core:app:default`\n- `core:image:default`\n- `core:resources:default`\n- `core:menu:default`\n- `core:tray:default`"
        },
        {
          "description": "Default permissions for the plugin.\n#### This default permission set includes:\n\n- `allow-version`\n- `allow-name`\n- `allow-tauri-version`\n- `allow-identifier`\n- `allow-bundle-type`\n- `allow-register-listener`\n- `allow-remove-listener`\n- `allow-supports-multiple-windows`",
          "type": "string",
          "const": "core:app:default",
          "markdownDescription": "Default permissions for the plugin.\n#### This default permission set includes:\n\n- `allow-version`\n- `allow-name`\n- `allow-tauri-version`\n- `allow-identifier`\n- `allow-bundle-type`\n- `allow-register-listener`\n- `allow-remove-listener`\n- `allow-supports-multiple-windows`"
        },
        {
          "description": "Enables the app_hide command without any pre-configured scope.",
          "type": "string",
          "const": "core:app:allow-app-hide",
          "markdownDescription": "Enables the app_hide command without any pre-configured scope."
        },
        {
          "description": "Enables the app_show command without any pre-configured scope.",
          "type": "string",
          "const": "core:app:allow-app-show",
          "markdownDescription": "Enables the app_show command without any pre-configured scope."
        },
        {
          "description": "Enables the bundle_type command without any pre-configured scope.",
          "type": "string",
          "const": "core:app:allow-bundle-type",
          "markdownDescription": "Enables the bundle_type command without any pre-configured scope."
        },
        {
          "description": "Enables the default_window_icon command without any pre-configured scope.",
          "type": "string",
          "const": "core:app:allow-default-window-icon",
          "markdownDescription": "Enables the default_window_icon command without any pre-configured scope."
        },
        {
          "description": "Enables the fetch_data_store_identifiers command without any pre-configured scope.",
          "type": "string",
          "const": "core:app:allow-fetch-data-store-identifiers",
          "markdownDescription": "Enables the fetch_data_store_identifiers command without any pre-configured scope."
        },
        {
          "description": "Enables the identifier command without any pre-configured scope.",
          "type": "string",
          "const": "core:app:allow-identifier",
          "markdownDescription": "Enables the identifier command without any pre-configured scope."
        },
        {
          "description": "Enables the name command without any pre-configured scope.",
          "type": "string",
          "const": "core:app:allow-name",
          "markdownDescription": "Enables the name command without any pre-configured scope."
        },
        {
          "description": "Enables the register_listener command without any pre-configured scope.",
          "type": "string",
          "const": "core:app:allow-register-listener",
          "markdownDescription": "Enables the register_listener command without any pre-configured scope."
        },
        {
          "description": "Enables the remove_data_store command without any pre-configured scope.",
          "type": "string",
          "const": "core:app:allow-remove-data-store",
          "markdownDescription": "Enables the remove_data_store command without any pre-configured scope."
        },
        {
          "description": "Enables the remove_listener command without any pre-configured scope.",
          "type": "string",
          "const": "core:app:allow-remove-listener",
          "markdownDescription": "Enables the remove_listener command without any pre-configured scope."
        },
        {
          "description": "Enables the set_app_theme command without any pre-configured scope.",
          "type": "string",
          "const": "core:app:allow-set-app-theme",
          "markdownDescription": "Enables the set_app_theme command without any pre-configured scope."
        },
        {
          "description": "Enables the set_dock_visibility command without any pre-configured scope.",
          "type": "string",
          "const": "core:app:allow-set-dock-visibility",
          "markdownDescription": "Enables the set_dock_visibility command without any pre-configured scope."
        },
        {
          "description": "Enables the supports_multiple_windows command without any pre-configured scope.",
          "type": "string",
          "const": "core:app:allow-supports-multiple-windows",
          "markdownDescription": "Enables the supports_multiple_windows command without any pre-configured scope."
        },
        {
          "description": "Enables the tauri_version command without any pre-configured scope.",
          "type": "string",
          "const": "core:app:allow-tauri-version",
          "markdownDescription": "Enables the tauri_version command without any pre-configured scope."
        },
        {
          "description": "Enables the version command without any pre-configured scope.",
          "type": "string",
          "const": "core:app:allow-version",
          "markdownDescription": "Enables the version command without any pre-configured scope."
        },
        {
          "description": "Denies the app_hide command without any pre-configured scope.",
          "type": "string",
          "const": "core:app:deny-app-hide",
          "markdownDescription": "Denies the app_hide command without any pre-configured scope."
        },
        {
          "description": "Denies the app_show command without any pre-configured scope.",
          "type": "string",
          "const": "core:app:deny-app-show",
          "markdownDescription": "Denies the app_show command without any pre-configured scope."
        },
        {
          "description": "Denies the bundle_type command without any pre-configured scope.",
          "type": "string",
          "const": "core:app:deny-bundle-type",
          "markdownDescription": "Denies the bundle_type command without any pre-configured scope."
        },
        {
          "description": "Denies the default_window_icon command without any pre-configured scope.",
          "type": "string",
          "const": "core:app:deny-default-window-icon",
          "markdownDescription": "Denies the default_window_icon command without any pre-configured scope."
        },
        {
          "description": "Denies the fetch_data_store_identifiers command without any pre-configured scope.",
          "type": "string",
          "const": "core:app:deny-fetch-data-store-identifiers",
          "markdownDescription": "Denies the fetch_data_store_identifiers command without any pre-configured scope."
        },
        {
          "description": "Denies the identifier command without any pre-configured scope.",
          "type": "string",
          "const": "core:app:deny-identifier",
          "markdownDescription": "Denies the identifier command without any pre-configured scope."
        },
        {
          "description": "Denies the name command without any pre-configured scope.",
          "type": "string",
          "const": "core:app:deny-name",
          "markdownDescription": "Denies the name command without any pre-configured scope."
        },
        {
          "description": "Denies the register_listener command without any pre-configured scope.",
          "type": "string",
          "const": "core:app:deny-register-listener",
          "markdownDescription": "Denies the register_listener command without any pre-configured scope."
        },
        {
          "description": "Denies the remove_data_store command without any pre-configured scope.",
          "type": "string",
          "const": "core:app:deny-remove-data-store",
          "markdownDescription": "Denies the remove_data_store command without any pre-configured scope."
        },
        {
          "description": "Denies the remove_listener command without any pre-configured scope.",
          "type": "string",
          "const": "core:app:deny-remove-listener",
          "markdownDescription": "Denies the remove_listener command without any pre-configured scope."
        },
        {
          "description": "Denies the set_app_theme command without any pre-configured scope.",
          "type": "string",
          "const": "core:app:deny-set-app-theme",
          "markdownDescription": "Denies the set_app_theme command without any pre-configured scope."
        },
        {
          "description": "Denies the set_dock_visibility command without any pre-configured scope.",
          "type": "string",
          "const": "core:app:deny-set-dock-visibility",
          "markdownDescription": "Denies the set_dock_visibility command without any pre-configured scope."
        },
        {
          "description": "Denies the supports_multiple_windows command without any pre-configured scope.",
          "type": "string",
          "const": "core:app:deny-supports-multiple-windows",
          "markdownDescription": "Denies the supports_multiple_windows command without any pre-configured scope."
        },
        {
          "description": "Denies the tauri_version command without any pre-configured scope.",
          "type": "string",
          "const": "core:app:deny-tauri-version",
          "markdownDescription": "Denies the tauri_version command without any pre-configured scope."
        },
        {
          "description": "Denies the version command without any pre-configured scope.",
          "type": "string",
          "const": "core:app:deny-version",
          "markdownDescription": "Denies the version command without any pre-configured scope."
        },
        {
          "description": "Default permissions for the plugin, which enables all commands.\n#### This default permission set includes:\n\n- `allow-listen`\n- `allow-unlisten`\n- `allow-emit`\n- `allow-emit-to`",
          "type": "string",
          "const": "core:event:default",
          "markdownDescription": "Default permissions for the plugin, which enables all commands.\n#### This default permission set includes:\n\n- `allow-listen`\n- `allow-unlisten`\n- `allow-emit`\n- `allow-emit-to`"
        },
        {
          "description": "Enables the emit command without any pre-configured scope.",
          "type": "string",
          "const": "core:event:allow-emit",
          "markdownDescription": "Enables the emit command without any pre-configured scope."
        },
        {
          "description": "Enables the emit_to command without any pre-configured scope.",
          "type": "string",
          "const": "core:event:allow-emit-to",
          "markdownDescription": "Enables the emit_to command without any pre-configured scope."
        },
        {
          "description": "Enables the listen command without any pre-configured scope.",
          "type": "string",
          "const": "core:event:allow-listen",
          "markdownDescription": "Enables the listen command without any pre-configured scope."
        },
        {
          "description": "Enables the unlisten command without any pre-configured scope.",
          "type": "string",
          "const": "core:event:allow-unlisten",
          "markdownDescription": "Enables the unlisten command without any pre-configured scope."
        },
        {
          "description": "Denies the emit command without any pre-configured scope.",
          "type": "string",
          "const": "core:event:deny-emit",
          "markdownDescription": "Denies the emit command without any pre-configured scope."
        },
        {
          "description": "Denies the emit_to command without any pre-configured scope.",
          "type": "string",
          "const": "core:event:deny-emit-to",
          "markdownDescription": "Denies the emit_to command without any pre-configured scope."
        },
        {
          "description": "Denies the listen command without any pre-configured scope.",
          "type": "string",
          "const": "core:event:deny-listen",
          "markdownDescription": "Denies the listen command without any pre-configured scope."
        },
        {
          "description": "Denies the unlisten command without any pre-configured scope.",
          "type": "string",
          "const": "core:event:deny-unlisten",
          "markdownDescription": "Denies the unlisten command without any pre-configured scope."
        },
        {
          "description": "Default permissions for the plugin, which enables all commands.\n#### This default permission set includes:\n\n- `allow-new`\n- `allow-from-bytes`\n- `allow-from-path`\n- `allow-rgba`\n- `allow-size`",
          "type": "string",
          "const": "core:image:default",
          "markdownDescription": "Default permissions for the plugin, which enables all commands.\n#### This default permission set includes:\n\n- `allow-new`\n- `allow-from-bytes`\n- `allow-from-path`\n- `allow-rgba`\n- `allow-size`"
        },
        {
          "description": "Enables the from_bytes command without any pre-configured scope.",
          "type": "string",
          "const": "core:image:allow-from-bytes",
          "markdownDescription": "Enables the from_bytes command without any pre-configured scope."
        },
        {
          "description": "Enables the from_path command without any pre-configured scope.",
          "type": "string",
          "const": "core:image:allow-from-path",
          "markdownDescription": "Enables the from_path command without any pre-configured scope."
        },
        {
          "description": "Enables the new command without any pre-configured scope.",
          "type": "string",
          "const": "core:image:allow-new",
          "markdownDescription": "Enables the new command without any pre-configured scope."
        },
        {
          "description": "Enables the rgba command without any pre-configured scope.",
          "type": "string",
          "const": "core:image:allow-rgba",
          "markdownDescription": "Enables the rgba command without any pre-configured scope."
        },
        {
          "description": "Enables the size command without any pre-configured scope.",
          "type": "string",
          "const": "core:image:allow-size",
          "markdownDescription": "Enables the size command without any pre-configured scope."
        },
        {
          "description": "Denies the from_bytes command without any pre-configured scope.",
          "type": "string",
          "const": "core:image:deny-from-bytes",
          "markdownDescription": "Denies the from_bytes command without any pre-configured scope."
        },
        {
          "description": "Denies the from_path command without any pre-configured scope.",
          "type": "string",
          "const": "core:image:deny-from-path",
          "markdownDescription": "Denies the from_path command without any pre-configured scope."
        },
        {
          "description": "Denies the new command without any pre-configured scope.",
          "type": "string",
          "const": "core:image:deny-new",
          "markdownDescription": "Denies the new command without any pre-configured scope."
        },
        {
          "description": "Denies the rgba command without any pre-configured scope.",
          "type": "string",
          "const": "core:image:deny-rgba",
          "markdownDescription": "Denies the rgba command without any pre-configured scope."
        },
        {
          "description": "Denies the size command without any pre-configured scope.",
          "type": "string",
          "const": "core:image:deny-size",
          "markdownDescription": "Denies the size command without any pre-configured scope."
        },
        {
          "description": "Default permissions for the plugin, which enables all commands.\n#### This default permission set includes:\n\n- `allow-new`\n- `allow-append`\n- `allow-prepend`\n- `allow-insert`\n- `allow-remove`\n- `allow-remove-at`\n- `allow-items`\n- `allow-get`\n- `allow-popup`\n- `allow-create-default`\n- `allow-set-as-app-menu`\n- `allow-set-as-window-menu`\n- `allow-text`\n- `allow-set-text`\n- `allow-is-enabled`\n- `allow-set-enabled`\n- `allow-set-accelerator`\n- `allow-set-as-windows-menu-for-nsapp`\n- `allow-set-as-help-menu-for-nsapp`\n- `allow-is-checked`\n- `allow-set-checked`\n- `allow-set-icon`",
          "type": "string",
          "const": "core:menu:default",
          "markdownDescription": "Default permissions for the plugin, which enables all commands.\n#### This default permission set includes:\n\n- `allow-new`\n- `allow-append`\n- `allow-prepend`\n- `allow-insert`\n- `allow-remove`\n- `allow-remove-at`\n- `allow-items`\n- `allow-get`\n- `allow-popup`\n- `allow-create-default`\n- `allow-set-as-app-menu`\n- `allow-set-as-window-menu`\n- `allow-text`\n- `allow-set-text`\n- `allow-is-enabled`\n- `allow-set-enabled`\n- `allow-set-accelerator`\n- `allow-set-as-windows-menu-for-nsapp`\n- `allow-set-as-help-menu-for-nsapp`\n- `allow-is-checked`\n- `allow-set-checked`\n- `allow-set-icon`"
        },
        {
          "description": "Enables the append command without any pre-configured scope.",
          "type": "string",
          "const": "core:menu:allow-append",
          "markdownDescription": "Enables the append command without any pre-configured scope."
        },
        {
          "description": "Enables the create_default command without any pre-configured scope.",
          "type": "string",
          "const": "core:menu:allow-create-default",
          "markdownDescription": "Enables the create_default command without any pre-configured scope."
        },
        {
          "description": "Enables the get command without any pre-configured scope.",
          "type": "string",
          "const": "core:menu:allow-get",
          "markdownDescription": "Enables the get command without any pre-configured scope."
        },
        {
          "description": "Enables the insert command without any pre-configured scope.",
          "type": "string",
          "const": "core:menu:allow-insert",
          "markdownDescription": "Enables the insert command without any pre-configured scope."
        },
        {
          "description": "Enables the is_checked command without any pre-configured scope.",
          "type": "string",
          "const": "core:menu:allow-is-checked",
          "markdownDescription": "Enables the is_checked command without any pre-configured scope."
        },
        {
          "description": "Enables the is_enabled command without any pre-configured scope.",
          "type": "string",
          "const": "core:menu:allow-is-enabled",
          "markdownDescription": "Enables the is_enabled command without any pre-configured scope."
        },
        {
          "description": "Enables the items command without any pre-configured scope.",
          "type": "string",
          "const": "core:menu:allow-items",
          "markdownDescription": "Enables the items command without any pre-configured scope."
        },
        {
          "description": "Enables the new command without any pre-configured scope.",
          "type": "string",
          "const": "core:menu:allow-new",
          "markdownDescription": "Enables the new command without any pre-configured scope."
        },
        {
          "description": "Enables the popup command without any pre-configured scope.",
          "type": "string",
          "const": "core:menu:allow-popup",
          "markdownDescription": "Enables the popup command without any pre-configured scope."
        },
        {
          "description": "Enables the prepend command without any pre-configured scope.",
          "type": "string",
          "const": "core:menu:allow-prepend",
          "markdownDescription": "Enables the prepend command without any pre-configured scope."
        },
        {
          "description": "Enables the remove command without any pre-configured scope.",
          "type": "string",
          "const": "core:menu:allow-remove",
          "markdownDescription": "Enables the remove command without any pre-configured scope."
        },
        {
          "description": "Enables the remove_at command without any pre-configured scope.",
          "type": "string",
          "const": "core:menu:allow-remove-at",
          "markdownDescription": "Enables the remove_at command without any pre-configured scope."
        },
        {
          "description": "Enables the set_accelerator command without any pre-configured scope.",
          "type": "string",
          "const": "core:menu:allow-set-accelerator",
          "markdownDescription": "Enables the set_accelerator command without any pre-configured scope."
        },
        {
          "description": "Enables the set_as_app_menu command without any pre-configured scope.",
          "type": "string",
          "const": "core:menu:allow-set-as-app-menu",
          "markdownDescription": "Enables the set_as_app_menu command without any pre-configured scope."
        },
        {
          "description": "Enables the set_as_help_menu_for_nsapp command without any pre-configured scope.",
          "type": "string",
          "const": "core:menu:allow-set-as-help-menu-for-nsapp",
          "markdownDescription": "Enables the set_as_help_menu_for_nsapp command without any pre-configured scope."
        },
        {
          "description": "Enables the set_as_window_menu command without any pre-configured scope.",
          "type": "string",
          "const": "core:menu:allow-set-as-window-menu",
          "markdownDescription": "Enables the set_as_window_menu command without any pre-configured scope."
        },
        {
          "description": "Enables the set_as_windows_menu_for_nsapp command without any pre-configured scope.",
          "type": "string",
          "const": "core:menu:allow-set-as-windows-menu-for-nsapp",
          "markdownDescription": "Enables the set_as_windows_menu_for_nsapp command without any pre-configured scope."
        },
        {
          "description": "Enables the set_checked command without any pre-configured scope.",
          "type": "string",
          "const": "core:menu:allow-set-checked",
          "markdownDescription": "Enables the set_checked command without any pre-configured scope."
        },
        {
          "description": "Enables the set_enabled command without any pre-configured scope.",
          "type": "string",
          "const": "core:menu:allow-set-enabled",
          "markdownDescription": "Enables the set_enabled command without any pre-configured scope."
        },
        {
          "description": "Enables the set_icon command without any pre-configured scope.",
          "type": "string",
          "const": "core:menu:allow-set-icon",
          "markdownDescription": "Enables the set_icon command without any pre-configured scope."
        },
        {
          "description": "Enables the set_text command without any pre-configured scope.",
          "type": "string",
          "const": "core:menu:allow-set-text",
          "markdownDescription": "Enables the set_text command without any pre-configured scope."
        },
        {
          "description": "Enables the text command without any pre-configured scope.",
          "type": "string",
          "const": "core:menu:allow-text",
          "markdownDescription": "Enables the text command without any pre-configured scope."
        },
        {
          "description": "Denies the append command without any pre-configured scope.",
          "type": "string",
          "const": "core:menu:deny-append",
          "markdownDescription": "Denies the append command without any pre-configured scope."
        },
        {
          "description": "Denies the create_default command without any pre-configured scope.",
          "type": "string",
          "const": "core:menu:deny-create-default",
          "markdownDescription": "Denies the create_default command without any pre-configured scope."
        },
        {
          "description": "Denies the get command without any pre-configured scope.",
          "type": "string",
          "const": "core:menu:deny-get",
          "markdownDescription": "Denies the get command without any pre-configured scope."
        },
        {
          "description": "Denies the insert command without any pre-configured scope.",
          "type": "string",
          "const": "core:menu:deny-insert",
          "markdownDescription": "Denies the insert command without any pre-configured scope."
        },
        {
          "description": "Denies the is_checked command without any pre-configured scope.",
          "type": "string",
          "const": "core:menu:deny-is-checked",
          "markdownDescription": "Denies the is_checked command without any pre-configured scope."
        },
        {
          "description": "Denies the is_enabled command without any pre-configured scope.",
          "type": "string",
          "const": "core:menu:deny-is-enabled",
          "markdownDescription": "Denies the is_enabled command without any pre-configured scope."
        },
        {
          "description": "Denies the items command without any pre-configured scope.",
          "type": "string",
          "const": "core:menu:deny-items",
          "markdownDescription": "Denies the items command without any pre-configured scope."
        },
        {
          "description": "Denies the new command without any pre-configured scope.",
          "type": "string",
          "const": "core:menu:deny-new",
          "markdownDescription": "Denies the new command without any pre-configured scope."
        },
        {
          "description": "Denies the popup command without any pre-configured scope.",
          "type": "string",
          "const": "core:menu:deny-popup",
          "markdownDescription": "Denies the popup command without any pre-configured scope."
        },
        {
          "description": "Denies the prepend command without any pre-configured scope.",
          "type": "string",
          "const": "core:menu:deny-prepend",
          "markdownDescription": "Denies the prepend command without any pre-configured scope."
        },
        {
          "description": "Denies the remove command without any pre-configured scope.",
          "type": "string",
          "const": "core:menu:deny-remove",
          "markdownDescription": "Denies the remove command without any pre-configured scope."
        },
        {
          "description": "Denies the remove_at command without any pre-configured scope.",
          "type": "string",
          "const": "core:menu:deny-remove-at",
          "markdownDescription": "Denies the remove_at command without any pre-configured scope."
        },
        {
          "description": "Denies the set_accelerator command without any pre-configured scope.",
          "type": "string",
          "const": "core:menu:deny-set-accelerator",
          "markdownDescription": "Denies the set_accelerator command without any pre-configured scope."
        },
        {
          "description": "Denies the set_as_app_menu command without any pre-configured scope.",
          "type": "string",
          "const": "core:menu:deny-set-as-app-menu",
          "markdownDescription": "Denies the set_as_app_menu command without any pre-configured scope."
        },
        {
          "description": "Denies the set_as_help_menu_for_nsapp command without any pre-configured scope.",
          "type": "string",
          "const": "core:menu:deny-set-as-help-menu-for-nsapp",
          "markdownDescription": "Denies the set_as_help_menu_for_nsapp command without any pre-configured scope."
        },
        {
          "description": "Denies the set_as_window_menu command without any pre-configured scope.",
          "type": "string",
          "const": "core:menu:deny-set-as-window-menu",
          "markdownDescription": "Denies the set_as_window_menu command without any pre-configured scope."
        },
        {
          "description": "Denies the set_as_windows_menu_for_nsapp command without any pre-configured scope.",
          "type": "string",
          "const": "core:menu:deny-set-as-windows-menu-for-nsapp",
          "markdownDescription": "Denies the set_as_windows_menu_for_nsapp command without any pre-configured scope."
        },
        {
          "description": "Denies the set_checked command without any pre-configured scope.",
          "type": "string",
          "const": "core:menu:deny-set-checked",
          "markdownDescription": "Denies the set_checked command without any pre-configured scope."
        },
        {
          "description": "Denies the set_enabled command without any pre-configured scope.",
          "type": "string",
          "const": "core:menu:deny-set-enabled",
          "markdownDescription": "Denies the set_enabled command without any pre-configured scope."
        },
        {
          "description": "Denies the set_icon command without any pre-configured scope.",
          "type": "string",
          "const": "core:menu:deny-set-icon",
          "markdownDescription": "Denies the set_icon command without any pre-configured scope."
        },
        {
          "description": "Denies the set_text command without any pre-configured scope.",
          "type": "string",
          "const": "core:menu:deny-set-text",
          "markdownDescription": "Denies the set_text command without any pre-configured scope."
        },
        {
          "description": "Denies the text command without any pre-configured scope.",
          "type": "string",
          "const": "core:menu:deny-text",
          "markdownDescription": "Denies the text command without any pre-configured scope."
        },
        {
          "description": "Default permissions for the plugin, which enables all commands.\n#### This default permission set includes:\n\n- `allow-resolve-directory`\n- `allow-resolve`\n- `allow-normalize`\n- `allow-join`\n- `allow-dirname`\n- `allow-extname`\n- `allow-basename`\n- `allow-is-absolute`",
          "type": "string",
          "const": "core:path:default",
          "markdownDescription": "Default permissions for the plugin, which enables all commands.\n#### This default permission set includes:\n\n- `allow-resolve-directory`\n- `allow-resolve`\n- `allow-normalize`\n- `allow-join`\n- `allow-dirname`\n- `allow-extname`\n- `allow-basename`\n- `allow-is-absolute`"
        },
        {
          "description": "Enables the basename command without any pre-configured scope.",
          "type": "string",
          "const": "core:path:allow-basename",
          "markdownDescription": "Enables the basename command without any pre-configured scope."
        },
        {
          "description": "Enables the dirname command without any pre-configured scope.",
          "type": "string",
          "const": "core:path:allow-dirname",
          "markdownDescription": "Enables the dirname command without any pre-configured scope."
        },
        {
          "description": "Enables the extname command without any pre-configured scope.",
          "type": "string",
          "const": "core:path:allow-extname",
          "markdownDescription": "Enables the extname command without any pre-configured scope."
        },
        {
          "description": "Enables the is_absolute command without any pre-configured scope.",
          "type": "string",
          "const": "core:path:allow-is-absolute",
          "markdownDescription": "Enables the is_absolute command without any pre-configured scope."
        },
        {
          "description": "Enables the join command without any pre-configured scope.",
          "type": "string",
          "const": "core:path:allow-join",
          "markdownDescription": "Enables the join command without any pre-configured scope."
        },
        {
          "description": "Enables the normalize command without any pre-configured scope.",
          "type": "string",
          "const": "core:path:allow-normalize",
          "markdownDescription": "Enables the normalize command without any pre-configured scope."
        },
        {
          "description": "Enables the resolve command without any pre-configured scope.",
          "type": "string",
          "const": "core:path:allow-resolve",
          "markdownDescription": "Enables the resolve command without any pre-configured scope."
        },
        {
          "description": "Enables the resolve_directory command without any pre-configured scope.",
          "type": "string",
          "const": "core:path:allow-resolve-directory",
          "markdownDescription": "Enables the resolve_directory command without any pre-configured scope."
        },
        {
          "description": "Denies the basename command without any pre-configured scope.",
          "type": "string",
          "const": "core:path:deny-basename",
          "markdownDescription": "Denies the basename command without any pre-configured scope."
        },
        {
          "description": "Denies the dirname command without any pre-configured scope.",
          "type": "string",
          "const": "core:path:deny-dirname",
          "markdownDescription": "Denies the dirname command without any pre-configured scope."
        },
        {
          "description": "Denies the extname command without any pre-configured scope.",
          "type": "string",
          "const": "core:path:deny-extname",
          "markdownDescription": "Denies the extname command without any pre-configured scope."
        },
        {
          "description": "Denies the is_absolute command without any pre-configured scope.",
          "type": "string",
          "const": "core:path:deny-is-absolute",
          "markdownDescription": "Denies the is_absolute command without any pre-configured scope."
        },
        {
          "description": "Denies the join command without any pre-configured scope.",
          "type": "string",
          "const": "core:path:deny-join",
          "markdownDescription": "Denies the join command without any pre-configured scope."
        },
        {
          "description": "Denies the normalize command without any pre-configured scope.",
          "type": "string",
          "const": "core:path:deny-normalize",
          "markdownDescription": "Denies the normalize command without any pre-configured scope."
        },
        {
          "description": "Denies the resolve command without any pre-configured scope.",
          "type": "string",
          "const": "core:path:deny-resolve",
          "markdownDescription": "Denies the resolve command without any pre-configured scope."
        },
        {
          "description": "Denies the resolve_directory command without any pre-configured scope.",
          "type": "string",
          "const": "core:path:deny-resolve-directory",
          "markdownDescription": "Denies the resolve_directory command without any pre-configured scope."
        },
        {
          "description": "Default permissions for the plugin, which enables all commands.\n#### This default permission set includes:\n\n- `allow-close`",
          "type": "string",
          "const": "core:resources:default",
          "markdownDescription": "Default permissions for the plugin, which enables all commands.\n#### This default permission set includes:\n\n- `allow-close`"
        },
        {
          "description": "Enables the close command without any pre-configured scope.",
          "type": "string",
          "const": "core:resources:allow-close",
          "markdownDescription": "Enables the close command without any pre-configured scope."
        },
        {
          "description": "Denies the close command without any pre-configured scope.",
          "type": "string",
          "const": "core:resources:deny-close",
          "markdownDescription": "Denies the close command without any pre-configured scope."
        },
        {
          "description": "Default permissions for the plugin, which enables all commands.\n#### This default permission set includes:\n\n- `allow-new`\n- `allow-get-by-id`\n- `allow-remove-by-id`\n- `allow-set-icon`\n- `allow-set-menu`\n- `allow-set-tooltip`\n- `allow-set-title`\n- `allow-set-visible`\n- `allow-set-temp-dir-path`\n- `allow-set-icon-as-template`\n- `allow-set-icon-with-as-template`\n- `allow-set-show-menu-on-left-click`",
          "type": "string",
          "const": "core:tray:default",
          "markdownDescription": "Default permissions for the plugin, which enables all commands.\n#### This default permission set includes:\n\n- `allow-new`\n- `allow-get-by-id`\n- `allow-remove-by-id`\n- `allow-set-icon`\n- `allow-set-menu`\n- `allow-set-tooltip`\n- `allow-set-title`\n- `allow-set-visible`\n- `allow-set-temp-dir-path`\n- `allow-set-icon-as-template`\n- `allow-set-icon-with-as-template`\n- `allow-set-show-menu-on-left-click`"
        },
        {
          "description": "Enables the get_by_id command without any pre-configured scope.",
          "type": "string",
          "const": "core:tray:allow-get-by-id",
          "markdownDescription": "Enables the get_by_id command without any pre-configured scope."
        },
        {
          "description": "Enables the new command without any pre-configured scope.",
          "type": "string",
          "const": "core:tray:allow-new",
          "markdownDescription": "Enables the new command without any pre-configured scope."
        },
        {
          "description": "Enables the remove_by_id command without any pre-configured scope.",
          "type": "string",
          "const": "core:tray:allow-remove-by-id",
          "markdownDescription": "Enables the remove_by_id command without any pre-configured scope."
        },
        {
          "description": "Enables the set_icon command without any pre-configured scope.",
          "type": "string",
          "const": "core:tray:allow-set-icon",
          "markdownDescription": "Enables the set_icon command without any pre-configured scope."
        },
        {
          "description": "Enables the set_icon_as_template command without any pre-configured scope.",
          "type": "string",
          "const": "core:tray:allow-set-icon-as-template",
          "markdownDescription": "Enables the set_icon_as_template command without any pre-configured scope."
        },
        {
          "description": "Enables the set_icon_with_as_template command without any pre-configured scope.",
          "type": "string",
          "const": "core:tray:allow-set-icon-with-as-template",
          "markdownDescription": "Enables the set_icon_with_as_template command without any pre-configured scope."
        },
        {
          "description": "Enables the set_menu command without any pre-configured scope.",
          "type": "string",
          "const": "core:tray:allow-set-menu",
          "markdownDescription": "Enables the set_menu command without any pre-configured scope."
        },
        {
          "description": "Enables the set_show_menu_on_left_click command without any pre-configured scope.",
          "type": "string",
          "const": "core:tray:allow-set-show-menu-on-left-click",
          "markdownDescription": "Enables the set_show_menu_on_left_click command without any pre-configured scope."
        },
        {
          "description": "Enables the set_temp_dir_path command without any pre-configured scope.",
          "type": "string",
          "const": "core:tray:allow-set-temp-dir-path",
          "markdownDescription": "Enables the set_temp_dir_path command without any pre-configured scope."
        },
        {
          "description": "Enables the set_title command without any pre-configured scope.",
          "type": "string",
          "const": "core:tray:allow-set-title",
          "markdownDescription": "Enables the set_title command without any pre-configured scope."
        },
        {
          "description": "Enables the set_tooltip command without any pre-configured scope.",
          "type": "string",
          "const": "core:tray:allow-set-tooltip",
          "markdownDescription": "Enables the set_tooltip command without any pre-configured scope."
        },
        {
          "description": "Enables the set_visible command without any pre-configured scope.",
          "type": "string",
          "const": "core:tray:allow-set-visible",
          "markdownDescription": "Enables the set_visible command without any pre-configured scope."
        },
        {
          "description": "Denies the get_by_id command without any pre-configured scope.",
          "type": "string",
          "const": "core:tray:deny-get-by-id",
          "markdownDescription": "Denies the get_by_id command without any pre-configured scope."
        },
        {
          "description": "Denies the new command without any pre-configured scope.",
          "type": "string",
          "const": "core:tray:deny-new",
          "markdownDescription": "Denies the new command without any pre-configured scope."
        },
        {
          "description": "Denies the remove_by_id command without any pre-configured scope.",
          "type": "string",
          "const": "core:tray:deny-remove-by-id",
          "markdownDescription": "Denies the remove_by_id command without any pre-configured scope."
        },
        {
          "description": "Denies the set_icon command without any pre-configured scope.",
          "type": "string",
          "const": "core:tray:deny-set-icon",
          "markdownDescription": "Denies the set_icon command without any pre-configured scope."
        },
        {
          "description": "Denies the set_icon_as_template command without any pre-configured scope.",
          "type": "string",
          "const": "core:tray:deny-set-icon-as-template",
          "markdownDescription": "Denies the set_icon_as_template command without any pre-configured scope."
        },
        {
          "description": "Denies the set_icon_with_as_template command without any pre-configured scope.",
          "type": "string",
          "const": "core:tray:deny-set-icon-with-as-template",
          "markdownDescription": "Denies the set_icon_with_as_template command without any pre-configured scope."
        },
        {
          "description": "Denies the set_menu command without any pre-configured scope.",
          "type": "string",
          "const": "core:tray:deny-set-menu",
          "markdownDescription": "Denies the set_menu command without any pre-configured scope."
        },
        {
          "description": "Denies the set_show_menu_on_left_click command without any pre-configured scope.",
          "type": "string",
          "const": "core:tray:deny-set-show-menu-on-left-click",
          "markdownDescription": "Denies the set_show_menu_on_left_click command without any pre-configured scope."
        },
        {
          "description": "Denies the set_temp_dir_path command without any pre-configured scope.",
          "type": "string",
          "const": "core:tray:deny-set-temp-dir-path",
          "markdownDescription": "Denies the set_temp_dir_path command without any pre-configured scope."
        },
        {
          "description": "Denies the set_title command without any pre-configured scope.",
          "type": "string",
          "const": "core:tray:deny-set-title",
          "markdownDescription": "Denies the set_title command without any pre-configured scope."
        },
        {
          "description": "Denies the set_tooltip command without any pre-configured scope.",
          "type": "string",
          "const": "core:tray:deny-set-tooltip",
          "markdownDescription": "Denies the set_tooltip command without any pre-configured scope."
        },
        {
          "description": "Denies the set_visible command without any pre-configured scope.",
          "type": "string",
          "const": "core:tray:deny-set-visible",
          "markdownDescription": "Denies the set_visible command without any pre-configured scope."
        },
        {
          "description": "Default permissions for the plugin.\n#### This default permission set includes:\n\n- `allow-get-all-webviews`\n- `allow-webview-position`\n- `allow-webview-size`\n- `allow-internal-toggle-devtools`",
          "type": "string",
          "const": "core:webview:default",
          "markdownDescription": "Default permissions for the plugin.\n#### This default permission set includes:\n\n- `allow-get-all-webviews`\n- `allow-webview-position`\n- `allow-webview-size`\n- `allow-internal-toggle-devtools`"
        },
        {
          "description": "Enables the clear_all_browsing_data command without any pre-configured scope.",
          "type": "string",
          "const": "core:webview:allow-clear-all-browsing-data",
          "markdownDescription": "Enables the clear_all_browsing_data command without any pre-configured scope."
        },
        {
          "description": "Enables the create_webview command without any pre-configured scope.",
          "type": "string",
          "const": "core:webview:allow-create-webview",
          "markdownDescription": "Enables the create_webview command without any pre-configured scope."
        },
        {
          "description": "Enables the create_webview_window command without any pre-configured scope.",
          "type": "string",
          "const": "core:webview:allow-create-webview-window",
          "markdownDescription": "Enables the create_webview_window command without any pre-configured scope."
        },
        {
          "description": "Enables the get_all_webviews command without any pre-configured scope.",
          "type": "string",
          "const": "core:webview:allow-get-all-webviews",
          "markdownDescription": "Enables the get_all_webviews command without any pre-configured scope."
        },
        {
          "description": "Enables the internal_toggle_devtools command without any pre-configured scope.",
          "type": "string",
          "const": "core:webview:allow-internal-toggle-devtools",
          "markdownDescription": "Enables the internal_toggle_devtools command without any pre-configured scope."
        },
        {
          "description": "Enables the print command without any pre-configured scope.",
          "type": "string",
          "const": "core:webview:allow-print",
          "markdownDescription": "Enables the print command without any pre-configured scope."
        },
        {
          "description": "Enables the reparent command without any pre-configured scope.",
          "type": "string",
          "const": "core:webview:allow-reparent",
          "markdownDescription": "Enables the reparent command without any pre-configured scope."
        },
        {
          "description": "Enables the set_webview_auto_resize command without any pre-configured scope.",
          "type": "string",
          "const": "core:webview:allow-set-webview-auto-resize",
          "markdownDescription": "Enables the set_webview_auto_resize command without any pre-configured scope."
        },
        {
          "description": "Enables the set_webview_background_color command without any pre-configured scope.",
          "type": "string",
          "const": "core:webview:allow-set-webview-background-color",
          "markdownDescription": "Enables the set_webview_background_color command without any pre-configured scope."
        },
        {
          "description": "Enables the set_webview_focus command without any pre-configured scope.",
          "type": "string",
          "const": "core:webview:allow-set-webview-focus",
          "markdownDescription": "Enables the set_webview_focus command without any pre-configured scope."
        },
        {
          "description": "Enables the set_webview_position command without any pre-configured scope.",
          "type": "string",
          "const": "core:webview:allow-set-webview-position",
          "markdownDescription": "Enables the set_webview_position command without any pre-configured scope."
        },
        {
          "description": "Enables the set_webview_size command without any pre-configured scope.",
          "type": "string",
          "const": "core:webview:allow-set-webview-size",
          "markdownDescription": "Enables the set_webview_size command without any pre-configured scope."
        },
        {
          "description": "Enables the set_webview_zoom command without any pre-configured scope.",
          "type": "string",
          "const": "core:webview:allow-set-webview-zoom",
          "markdownDescription": "Enables the set_webview_zoom command without any pre-configured scope."
        },
        {
          "description": "Enables the webview_close command without any pre-configured scope.",
          "type": "string",
          "const": "core:webview:allow-webview-close",
          "markdownDescription": "Enables the webview_close command without any pre-configured scope."
        },
        {
          "description": "Enables the webview_hide command without any pre-configured scope.",
          "type": "string",
          "const": "core:webview:allow-webview-hide",
          "markdownDescription": "Enables the webview_hide command without any pre-configured scope."
        },
        {
          "description": "Enables the webview_position command without any pre-configured scope.",
          "type": "string",
          "const": "core:webview:allow-webview-position",
          "markdownDescription": "Enables the webview_position command without any pre-configured scope."
        },
        {
          "description": "Enables the webview_show command without any pre-configured scope.",
          "type": "string",
          "const": "core:webview:allow-webview-show",
          "markdownDescription": "Enables the webview_show command without any pre-configured scope."
        },
        {
          "description": "Enables the webview_size command without any pre-configured scope.",
          "type": "string",
          "const": "core:webview:allow-webview-size",
          "markdownDescription": "Enables the webview_size command without any pre-configured scope."
        },
        {
          "description": "Denies the clear_all_browsing_data command without any pre-configured scope.",
          "type": "string",
          "const": "core:webview:deny-clear-all-browsing-data",
          "markdownDescription": "Denies the clear_all_browsing_data command without any pre-configured scope."
        },
        {
          "description": "Denies the create_webview command without any pre-configured scope.",
          "type": "string",
          "const": "core:webview:deny-create-webview",
          "markdownDescription": "Denies the create_webview command without any pre-configured scope."
        },
        {
          "description": "Denies the create_webview_window command without any pre-configured scope.",
          "type": "string",
          "const": "core:webview:deny-create-webview-window",
          "markdownDescription": "Denies the create_webview_window command without any pre-configured scope."
        },
        {
          "description": "Denies the get_all_webviews command without any pre-configured scope.",
          "type": "string",
          "const": "core:webview:deny-get-all-webviews",
          "markdownDescription": "Denies the get_all_webviews command without any pre-configured scope."
        },
        {
          "description": "Denies the internal_toggle_devtools command without any pre-configured scope.",
          "type": "string",
          "const": "core:webview:deny-internal-toggle-devtools",
          "markdownDescription": "Denies the internal_toggle_devtools command without any pre-configured scope."
        },
        {
          "description": "Denies the print command without any pre-configured scope.",
          "type": "string",
          "const": "core:webview:deny-print",
          "markdownDescription": "Denies the print command without any pre-configured scope."
        },
        {
          "description": "Denies the reparent command without any pre-configured scope.",
          "type": "string",
          "const": "core:webview:deny-reparent",
          "markdownDescription": "Denies the reparent command without any pre-configured scope."
        },
        {
          "description": "Denies the set_webview_auto_resize command without any pre-configured scope.",
          "type": "string",
          "const": "core:webview:deny-set-webview-auto-resize",
          "markdownDescription": "Denies the set_webview_auto_resize command without any pre-configured scope."
        },
        {
          "description": "Denies the set_webview_background_color command without any pre-configured scope.",
          "type": "string",
          "const": "core:webview:deny-set-webview-background-color",
          "markdownDescription": "Denies the set_webview_background_color command without any pre-configured scope."
        },
        {
          "description": "Denies the set_webview_focus command without any pre-configured scope.",
          "type": "string",
          "const": "core:webview:deny-set-webview-focus",
          "markdownDescription": "Denies the set_webview_focus command without any pre-configured scope."
        },
        {
          "description": "Denies the set_webview_position command without any pre-configured scope.",
          "type": "string",
          "const": "core:webview:deny-set-webview-position",
          "markdownDescription": "Denies the set_webview_position command without any pre-configured scope."
        },
        {
          "description": "Denies the set_webview_size command without any pre-configured scope.",
          "type": "string",
          "const": "core:webview:deny-set-webview-size",
          "markdownDescription": "Denies the set_webview_size command without any pre-configured scope."
        },
        {
          "description": "Denies the set_webview_zoom command without any pre-configured scope.",
          "type": "string",
          "const": "core:webview:deny-set-webview-zoom",
          "markdownDescription": "Denies the set_webview_zoom command without any pre-configured scope."
        },
        {
          "description": "Denies the webview_close command without any pre-configured scope.",
          "type": "string",
          "const": "core:webview:deny-webview-close",
          "markdownDescription": "Denies the webview_close command without any pre-configured scope."
        },
        {
          "description": "Denies the webview_hide command without any pre-configured scope.",
          "type": "string",
          "const": "core:webview:deny-webview-hide",
          "markdownDescription": "Denies the webview_hide command without any pre-configured scope."
        },
        {
          "description": "Denies the webview_position command without any pre-configured scope.",
          "type": "string",
          "const": "core:webview:deny-webview-position",
          "markdownDescription": "Denies the webview_position command without any pre-configured scope."
        },
        {
          "description": "Denies the webview_show command without any pre-configured scope.",
          "type": "string",
          "const": "core:webview:deny-webview-show",
          "markdownDescription": "Denies the webview_show command without any pre-configured scope."
        },
        {
          "description": "Denies the webview_size command without any pre-configured scope.",
          "type": "string",
          "const": "core:webview:deny-webview-size",
          "markdownDescription": "Denies the webview_size command without any pre-configured scope."
        },
        {
          "description": "Default permissions for the plugin.\n#### This default permission set includes:\n\n- `allow-get-all-windows`\n- `allow-scale-factor`\n- `allow-inner-position`\n- `allow-outer-position`\n- `allow-inner-size`\n- `allow-outer-size`\n- `allow-is-fullscreen`\n- `allow-is-minimized`\n- `allow-is-maximized`\n- `allow-is-focused`\n- `allow-is-decorated`\n- `allow-is-resizable`\n- `allow-is-maximizable`\n- `allow-is-minimizable`\n- `allow-is-closable`\n- `allow-is-visible`\n- `allow-is-enabled`\n- `allow-title`\n- `allow-current-monitor`\n- `allow-primary-monitor`\n- `allow-monitor-from-point`\n- `allow-available-monitors`\n- `allow-cursor-position`\n- `allow-theme`\n- `allow-is-always-on-top`\n- `allow-activity-name`\n- `allow-scene-identifier`\n- `allow-internal-toggle-maximize`",
          "type": "string",
          "const": "core:window:default",
          "markdownDescription": "Default permissions for the plugin.\n#### This default permission set includes:\n\n- `allow-get-all-windows`\n- `allow-scale-factor`\n- `allow-inner-position`\n- `allow-outer-position`\n- `allow-inner-size`\n- `allow-outer-size`\n- `allow-is-fullscreen`\n- `allow-is-minimized`\n- `allow-is-maximized`\n- `allow-is-focused`\n- `allow-is-decorated`\n- `allow-is-resizable`\n- `allow-is-maximizable`\n- `allow-is-minimizable`\n- `allow-is-closable`\n- `allow-is-visible`\n- `allow-is-enabled`\n- `allow-title`\n- `allow-current-monitor`\n- `allow-primary-monitor`\n- `allow-monitor-from-point`\n- `allow-available-monitors`\n- `allow-cursor-position`\n- `allow-theme`\n- `allow-is-always-on-top`\n- `allow-activity-name`\n- `allow-scene-identifier`\n- `allow-internal-toggle-maximize`"
        },
        {
          "description": "Enables the activity_name command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-activity-name",
          "markdownDescription": "Enables the activity_name command without any pre-configured scope."
        },
        {
          "description": "Enables the available_monitors command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-available-monitors",
          "markdownDescription": "Enables the available_monitors command without any pre-configured scope."
        },
        {
          "description": "Enables the center command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-center",
          "markdownDescription": "Enables the center command without any pre-configured scope."
        },
        {
          "description": "Enables the close command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-close",
          "markdownDescription": "Enables the close command without any pre-configured scope."
        },
        {
          "description": "Enables the create command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-create",
          "markdownDescription": "Enables the create command without any pre-configured scope."
        },
        {
          "description": "Enables the current_monitor command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-current-monitor",
          "markdownDescription": "Enables the current_monitor command without any pre-configured scope."
        },
        {
          "description": "Enables the cursor_position command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-cursor-position",
          "markdownDescription": "Enables the cursor_position command without any pre-configured scope."
        },
        {
          "description": "Enables the destroy command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-destroy",
          "markdownDescription": "Enables the destroy command without any pre-configured scope."
        },
        {
          "description": "Enables the get_all_windows command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-get-all-windows",
          "markdownDescription": "Enables the get_all_windows command without any pre-configured scope."
        },
        {
          "description": "Enables the hide command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-hide",
          "markdownDescription": "Enables the hide command without any pre-configured scope."
        },
        {
          "description": "Enables the inner_position command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-inner-position",
          "markdownDescription": "Enables the inner_position command without any pre-configured scope."
        },
        {
          "description": "Enables the inner_size command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-inner-size",
          "markdownDescription": "Enables the inner_size command without any pre-configured scope."
        },
        {
          "description": "Enables the internal_toggle_maximize command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-internal-toggle-maximize",
          "markdownDescription": "Enables the internal_toggle_maximize command without any pre-configured scope."
        },
        {
          "description": "Enables the is_always_on_top command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-is-always-on-top",
          "markdownDescription": "Enables the is_always_on_top command without any pre-configured scope."
        },
        {
          "description": "Enables the is_closable command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-is-closable",
          "markdownDescription": "Enables the is_closable command without any pre-configured scope."
        },
        {
          "description": "Enables the is_decorated command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-is-decorated",
          "markdownDescription": "Enables the is_decorated command without any pre-configured scope."
        },
        {
          "description": "Enables the is_enabled command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-is-enabled",
          "markdownDescription": "Enables the is_enabled command without any pre-configured scope."
        },
        {
          "description": "Enables the is_focused command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-is-focused",
          "markdownDescription": "Enables the is_focused command without any pre-configured scope."
        },
        {
          "description": "Enables the is_fullscreen command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-is-fullscreen",
          "markdownDescription": "Enables the is_fullscreen command without any pre-configured scope."
        },
        {
          "description": "Enables the is_maximizable command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-is-maximizable",
          "markdownDescription": "Enables the is_maximizable command without any pre-configured scope."
        },
        {
          "description": "Enables the is_maximized command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-is-maximized",
          "markdownDescription": "Enables the is_maximized command without any pre-configured scope."
        },
        {
          "description": "Enables the is_minimizable command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-is-minimizable",
          "markdownDescription": "Enables the is_minimizable command without any pre-configured scope."
        },
        {
          "description": "Enables the is_minimized command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-is-minimized",
          "markdownDescription": "Enables the is_minimized command without any pre-configured scope."
        },
        {
          "description": "Enables the is_resizable command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-is-resizable",
          "markdownDescription": "Enables the is_resizable command without any pre-configured scope."
        },
        {
          "description": "Enables the is_visible command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-is-visible",
          "markdownDescription": "Enables the is_visible command without any pre-configured scope."
        },
        {
          "description": "Enables the maximize command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-maximize",
          "markdownDescription": "Enables the maximize command without any pre-configured scope."
        },
        {
          "description": "Enables the minimize command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-minimize",
          "markdownDescription": "Enables the minimize command without any pre-configured scope."
        },
        {
          "description": "Enables the monitor_from_point command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-monitor-from-point",
          "markdownDescription": "Enables the monitor_from_point command without any pre-configured scope."
        },
        {
          "description": "Enables the outer_position command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-outer-position",
          "markdownDescription": "Enables the outer_position command without any pre-configured scope."
        },
        {
          "description": "Enables the outer_size command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-outer-size",
          "markdownDescription": "Enables the outer_size command without any pre-configured scope."
        },
        {
          "description": "Enables the primary_monitor command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-primary-monitor",
          "markdownDescription": "Enables the primary_monitor command without any pre-configured scope."
        },
        {
          "description": "Enables the request_user_attention command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-request-user-attention",
          "markdownDescription": "Enables the request_user_attention command without any pre-configured scope."
        },
        {
          "description": "Enables the scale_factor command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-scale-factor",
          "markdownDescription": "Enables the scale_factor command without any pre-configured scope."
        },
        {
          "description": "Enables the scene_identifier command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-scene-identifier",
          "markdownDescription": "Enables the scene_identifier command without any pre-configured scope."
        },
        {
          "description": "Enables the set_always_on_bottom command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-set-always-on-bottom",
          "markdownDescription": "Enables the set_always_on_bottom command without any pre-configured scope."
        },
        {
          "description": "Enables the set_always_on_top command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-set-always-on-top",
          "markdownDescription": "Enables the set_always_on_top command without any pre-configured scope."
        },
        {
          "description": "Enables the set_background_color command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-set-background-color",
          "markdownDescription": "Enables the set_background_color command without any pre-configured scope."
        },
        {
          "description": "Enables the set_badge_count command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-set-badge-count",
          "markdownDescription": "Enables the set_badge_count command without any pre-configured scope."
        },
        {
          "description": "Enables the set_badge_label command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-set-badge-label",
          "markdownDescription": "Enables the set_badge_label command without any pre-configured scope."
        },
        {
          "description": "Enables the set_closable command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-set-closable",
          "markdownDescription": "Enables the set_closable command without any pre-configured scope."
        },
        {
          "description": "Enables the set_content_protected command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-set-content-protected",
          "markdownDescription": "Enables the set_content_protected command without any pre-configured scope."
        },
        {
          "description": "Enables the set_cursor_grab command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-set-cursor-grab",
          "markdownDescription": "Enables the set_cursor_grab command without any pre-configured scope."
        },
        {
          "description": "Enables the set_cursor_icon command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-set-cursor-icon",
          "markdownDescription": "Enables the set_cursor_icon command without any pre-configured scope."
        },
        {
          "description": "Enables the set_cursor_position command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-set-cursor-position",
          "markdownDescription": "Enables the set_cursor_position command without any pre-configured scope."
        },
        {
          "description": "Enables the set_cursor_visible command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-set-cursor-visible",
          "markdownDescription": "Enables the set_cursor_visible command without any pre-configured scope."
        },
        {
          "description": "Enables the set_decorations command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-set-decorations",
          "markdownDescription": "Enables the set_decorations command without any pre-configured scope."
        },
        {
          "description": "Enables the set_effects command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-set-effects",
          "markdownDescription": "Enables the set_effects command without any pre-configured scope."
        },
        {
          "description": "Enables the set_enabled command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-set-enabled",
          "markdownDescription": "Enables the set_enabled command without any pre-configured scope."
        },
        {
          "description": "Enables the set_focus command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-set-focus",
          "markdownDescription": "Enables the set_focus command without any pre-configured scope."
        },
        {
          "description": "Enables the set_focusable command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-set-focusable",
          "markdownDescription": "Enables the set_focusable command without any pre-configured scope."
        },
        {
          "description": "Enables the set_fullscreen command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-set-fullscreen",
          "markdownDescription": "Enables the set_fullscreen command without any pre-configured scope."
        },
        {
          "description": "Enables the set_icon command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-set-icon",
          "markdownDescription": "Enables the set_icon command without any pre-configured scope."
        },
        {
          "description": "Enables the set_ignore_cursor_events command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-set-ignore-cursor-events",
          "markdownDescription": "Enables the set_ignore_cursor_events command without any pre-configured scope."
        },
        {
          "description": "Enables the set_max_size command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-set-max-size",
          "markdownDescription": "Enables the set_max_size command without any pre-configured scope."
        },
        {
          "description": "Enables the set_maximizable command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-set-maximizable",
          "markdownDescription": "Enables the set_maximizable command without any pre-configured scope."
        },
        {
          "description": "Enables the set_min_size command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-set-min-size",
          "markdownDescription": "Enables the set_min_size command without any pre-configured scope."
        },
        {
          "description": "Enables the set_minimizable command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-set-minimizable",
          "markdownDescription": "Enables the set_minimizable command without any pre-configured scope."
        },
        {
          "description": "Enables the set_overlay_icon command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-set-overlay-icon",
          "markdownDescription": "Enables the set_overlay_icon command without any pre-configured scope."
        },
        {
          "description": "Enables the set_position command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-set-position",
          "markdownDescription": "Enables the set_position command without any pre-configured scope."
        },
        {
          "description": "Enables the set_progress_bar command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-set-progress-bar",
          "markdownDescription": "Enables the set_progress_bar command without any pre-configured scope."
        },
        {
          "description": "Enables the set_resizable command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-set-resizable",
          "markdownDescription": "Enables the set_resizable command without any pre-configured scope."
        },
        {
          "description": "Enables the set_shadow command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-set-shadow",
          "markdownDescription": "Enables the set_shadow command without any pre-configured scope."
        },
        {
          "description": "Enables the set_simple_fullscreen command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-set-simple-fullscreen",
          "markdownDescription": "Enables the set_simple_fullscreen command without any pre-configured scope."
        },
        {
          "description": "Enables the set_size command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-set-size",
          "markdownDescription": "Enables the set_size command without any pre-configured scope."
        },
        {
          "description": "Enables the set_size_constraints command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-set-size-constraints",
          "markdownDescription": "Enables the set_size_constraints command without any pre-configured scope."
        },
        {
          "description": "Enables the set_skip_taskbar command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-set-skip-taskbar",
          "markdownDescription": "Enables the set_skip_taskbar command without any pre-configured scope."
        },
        {
          "description": "Enables the set_theme command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-set-theme",
          "markdownDescription": "Enables the set_theme command without any pre-configured scope."
        },
        {
          "description": "Enables the set_title command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-set-title",
          "markdownDescription": "Enables the set_title command without any pre-configured scope."
        },
        {
          "description": "Enables the set_title_bar_style command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-set-title-bar-style",
          "markdownDescription": "Enables the set_title_bar_style command without any pre-configured scope."
        },
        {
          "description": "Enables the set_visible_on_all_workspaces command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-set-visible-on-all-workspaces",
          "markdownDescription": "Enables the set_visible_on_all_workspaces command without any pre-configured scope."
        },
        {
          "description": "Enables the show command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-show",
          "markdownDescription": "Enables the show command without any pre-configured scope."
        },
        {
          "description": "Enables the start_dragging command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-start-dragging",
          "markdownDescription": "Enables the start_dragging command without any pre-configured scope."
        },
        {
          "description": "Enables the start_resize_dragging command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-start-resize-dragging",
          "markdownDescription": "Enables the start_resize_dragging command without any pre-configured scope."
        },
        {
          "description": "Enables the theme command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-theme",
          "markdownDescription": "Enables the theme command without any pre-configured scope."
        },
        {
          "description": "Enables the title command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-title",
          "markdownDescription": "Enables the title command without any pre-configured scope."
        },
        {
          "description": "Enables the toggle_maximize command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-toggle-maximize",
          "markdownDescription": "Enables the toggle_maximize command without any pre-configured scope."
        },
        {
          "description": "Enables the unmaximize command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-unmaximize",
          "markdownDescription": "Enables the unmaximize command without any pre-configured scope."
        },
        {
          "description": "Enables the unminimize command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:allow-unminimize",
          "markdownDescription": "Enables the unminimize command without any pre-configured scope."
        },
        {
          "description": "Denies the activity_name command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-activity-name",
          "markdownDescription": "Denies the activity_name command without any pre-configured scope."
        },
        {
          "description": "Denies the available_monitors command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-available-monitors",
          "markdownDescription": "Denies the available_monitors command without any pre-configured scope."
        },
        {
          "description": "Denies the center command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-center",
          "markdownDescription": "Denies the center command without any pre-configured scope."
        },
        {
          "description": "Denies the close command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-close",
          "markdownDescription": "Denies the close command without any pre-configured scope."
        },
        {
          "description": "Denies the create command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-create",
          "markdownDescription": "Denies the create command without any pre-configured scope."
        },
        {
          "description": "Denies the current_monitor command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-current-monitor",
          "markdownDescription": "Denies the current_monitor command without any pre-configured scope."
        },
        {
          "description": "Denies the cursor_position command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-cursor-position",
          "markdownDescription": "Denies the cursor_position command without any pre-configured scope."
        },
        {
          "description": "Denies the destroy command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-destroy",
          "markdownDescription": "Denies the destroy command without any pre-configured scope."
        },
        {
          "description": "Denies the get_all_windows command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-get-all-windows",
          "markdownDescription": "Denies the get_all_windows command without any pre-configured scope."
        },
        {
          "description": "Denies the hide command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-hide",
          "markdownDescription": "Denies the hide command without any pre-configured scope."
        },
        {
          "description": "Denies the inner_position command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-inner-position",
          "markdownDescription": "Denies the inner_position command without any pre-configured scope."
        },
        {
          "description": "Denies the inner_size command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-inner-size",
          "markdownDescription": "Denies the inner_size command without any pre-configured scope."
        },
        {
          "description": "Denies the internal_toggle_maximize command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-internal-toggle-maximize",
          "markdownDescription": "Denies the internal_toggle_maximize command without any pre-configured scope."
        },
        {
          "description": "Denies the is_always_on_top command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-is-always-on-top",
          "markdownDescription": "Denies the is_always_on_top command without any pre-configured scope."
        },
        {
          "description": "Denies the is_closable command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-is-closable",
          "markdownDescription": "Denies the is_closable command without any pre-configured scope."
        },
        {
          "description": "Denies the is_decorated command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-is-decorated",
          "markdownDescription": "Denies the is_decorated command without any pre-configured scope."
        },
        {
          "description": "Denies the is_enabled command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-is-enabled",
          "markdownDescription": "Denies the is_enabled command without any pre-configured scope."
        },
        {
          "description": "Denies the is_focused command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-is-focused",
          "markdownDescription": "Denies the is_focused command without any pre-configured scope."
        },
        {
          "description": "Denies the is_fullscreen command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-is-fullscreen",
          "markdownDescription": "Denies the is_fullscreen command without any pre-configured scope."
        },
        {
          "description": "Denies the is_maximizable command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-is-maximizable",
          "markdownDescription": "Denies the is_maximizable command without any pre-configured scope."
        },
        {
          "description": "Denies the is_maximized command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-is-maximized",
          "markdownDescription": "Denies the is_maximized command without any pre-configured scope."
        },
        {
          "description": "Denies the is_minimizable command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-is-minimizable",
          "markdownDescription": "Denies the is_minimizable command without any pre-configured scope."
        },
        {
          "description": "Denies the is_minimized command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-is-minimized",
          "markdownDescription": "Denies the is_minimized command without any pre-configured scope."
        },
        {
          "description": "Denies the is_resizable command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-is-resizable",
          "markdownDescription": "Denies the is_resizable command without any pre-configured scope."
        },
        {
          "description": "Denies the is_visible command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-is-visible",
          "markdownDescription": "Denies the is_visible command without any pre-configured scope."
        },
        {
          "description": "Denies the maximize command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-maximize",
          "markdownDescription": "Denies the maximize command without any pre-configured scope."
        },
        {
          "description": "Denies the minimize command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-minimize",
          "markdownDescription": "Denies the minimize command without any pre-configured scope."
        },
        {
          "description": "Denies the monitor_from_point command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-monitor-from-point",
          "markdownDescription": "Denies the monitor_from_point command without any pre-configured scope."
        },
        {
          "description": "Denies the outer_position command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-outer-position",
          "markdownDescription": "Denies the outer_position command without any pre-configured scope."
        },
        {
          "description": "Denies the outer_size command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-outer-size",
          "markdownDescription": "Denies the outer_size command without any pre-configured scope."
        },
        {
          "description": "Denies the primary_monitor command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-primary-monitor",
          "markdownDescription": "Denies the primary_monitor command without any pre-configured scope."
        },
        {
          "description": "Denies the request_user_attention command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-request-user-attention",
          "markdownDescription": "Denies the request_user_attention command without any pre-configured scope."
        },
        {
          "description": "Denies the scale_factor command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-scale-factor",
          "markdownDescription": "Denies the scale_factor command without any pre-configured scope."
        },
        {
          "description": "Denies the scene_identifier command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-scene-identifier",
          "markdownDescription": "Denies the scene_identifier command without any pre-configured scope."
        },
        {
          "description": "Denies the set_always_on_bottom command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-set-always-on-bottom",
          "markdownDescription": "Denies the set_always_on_bottom command without any pre-configured scope."
        },
        {
          "description": "Denies the set_always_on_top command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-set-always-on-top",
          "markdownDescription": "Denies the set_always_on_top command without any pre-configured scope."
        },
        {
          "description": "Denies the set_background_color command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-set-background-color",
          "markdownDescription": "Denies the set_background_color command without any pre-configured scope."
        },
        {
          "description": "Denies the set_badge_count command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-set-badge-count",
          "markdownDescription": "Denies the set_badge_count command without any pre-configured scope."
        },
        {
          "description": "Denies the set_badge_label command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-set-badge-label",
          "markdownDescription": "Denies the set_badge_label command without any pre-configured scope."
        },
        {
          "description": "Denies the set_closable command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-set-closable",
          "markdownDescription": "Denies the set_closable command without any pre-configured scope."
        },
        {
          "description": "Denies the set_content_protected command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-set-content-protected",
          "markdownDescription": "Denies the set_content_protected command without any pre-configured scope."
        },
        {
          "description": "Denies the set_cursor_grab command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-set-cursor-grab",
          "markdownDescription": "Denies the set_cursor_grab command without any pre-configured scope."
        },
        {
          "description": "Denies the set_cursor_icon command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-set-cursor-icon",
          "markdownDescription": "Denies the set_cursor_icon command without any pre-configured scope."
        },
        {
          "description": "Denies the set_cursor_position command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-set-cursor-position",
          "markdownDescription": "Denies the set_cursor_position command without any pre-configured scope."
        },
        {
          "description": "Denies the set_cursor_visible command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-set-cursor-visible",
          "markdownDescription": "Denies the set_cursor_visible command without any pre-configured scope."
        },
        {
          "description": "Denies the set_decorations command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-set-decorations",
          "markdownDescription": "Denies the set_decorations command without any pre-configured scope."
        },
        {
          "description": "Denies the set_effects command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-set-effects",
          "markdownDescription": "Denies the set_effects command without any pre-configured scope."
        },
        {
          "description": "Denies the set_enabled command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-set-enabled",
          "markdownDescription": "Denies the set_enabled command without any pre-configured scope."
        },
        {
          "description": "Denies the set_focus command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-set-focus",
          "markdownDescription": "Denies the set_focus command without any pre-configured scope."
        },
        {
          "description": "Denies the set_focusable command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-set-focusable",
          "markdownDescription": "Denies the set_focusable command without any pre-configured scope."
        },
        {
          "description": "Denies the set_fullscreen command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-set-fullscreen",
          "markdownDescription": "Denies the set_fullscreen command without any pre-configured scope."
        },
        {
          "description": "Denies the set_icon command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-set-icon",
          "markdownDescription": "Denies the set_icon command without any pre-configured scope."
        },
        {
          "description": "Denies the set_ignore_cursor_events command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-set-ignore-cursor-events",
          "markdownDescription": "Denies the set_ignore_cursor_events command without any pre-configured scope."
        },
        {
          "description": "Denies the set_max_size command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-set-max-size",
          "markdownDescription": "Denies the set_max_size command without any pre-configured scope."
        },
        {
          "description": "Denies the set_maximizable command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-set-maximizable",
          "markdownDescription": "Denies the set_maximizable command without any pre-configured scope."
        },
        {
          "description": "Denies the set_min_size command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-set-min-size",
          "markdownDescription": "Denies the set_min_size command without any pre-configured scope."
        },
        {
          "description": "Denies the set_minimizable command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-set-minimizable",
          "markdownDescription": "Denies the set_minimizable command without any pre-configured scope."
        },
        {
          "description": "Denies the set_overlay_icon command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-set-overlay-icon",
          "markdownDescription": "Denies the set_overlay_icon command without any pre-configured scope."
        },
        {
          "description": "Denies the set_position command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-set-position",
          "markdownDescription": "Denies the set_position command without any pre-configured scope."
        },
        {
          "description": "Denies the set_progress_bar command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-set-progress-bar",
          "markdownDescription": "Denies the set_progress_bar command without any pre-configured scope."
        },
        {
          "description": "Denies the set_resizable command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-set-resizable",
          "markdownDescription": "Denies the set_resizable command without any pre-configured scope."
        },
        {
          "description": "Denies the set_shadow command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-set-shadow",
          "markdownDescription": "Denies the set_shadow command without any pre-configured scope."
        },
        {
          "description": "Denies the set_simple_fullscreen command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-set-simple-fullscreen",
          "markdownDescription": "Denies the set_simple_fullscreen command without any pre-configured scope."
        },
        {
          "description": "Denies the set_size command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-set-size",
          "markdownDescription": "Denies the set_size command without any pre-configured scope."
        },
        {
          "description": "Denies the set_size_constraints command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-set-size-constraints",
          "markdownDescription": "Denies the set_size_constraints command without any pre-configured scope."
        },
        {
          "description": "Denies the set_skip_taskbar command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-set-skip-taskbar",
          "markdownDescription": "Denies the set_skip_taskbar command without any pre-configured scope."
        },
        {
          "description": "Denies the set_theme command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-set-theme",
          "markdownDescription": "Denies the set_theme command without any pre-configured scope."
        },
        {
          "description": "Denies the set_title command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-set-title",
          "markdownDescription": "Denies the set_title command without any pre-configured scope."
        },
        {
          "description": "Denies the set_title_bar_style command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-set-title-bar-style",
          "markdownDescription": "Denies the set_title_bar_style command without any pre-configured scope."
        },
        {
          "description": "Denies the set_visible_on_all_workspaces command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-set-visible-on-all-workspaces",
          "markdownDescription": "Denies the set_visible_on_all_workspaces command without any pre-configured scope."
        },
        {
          "description": "Denies the show command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-show",
          "markdownDescription": "Denies the show command without any pre-configured scope."
        },
        {
          "description": "Denies the start_dragging command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-start-dragging",
          "markdownDescription": "Denies the start_dragging command without any pre-configured scope."
        },
        {
          "description": "Denies the start_resize_dragging command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-start-resize-dragging",
          "markdownDescription": "Denies the start_resize_dragging command without any pre-configured scope."
        },
        {
          "description": "Denies the theme command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-theme",
          "markdownDescription": "Denies the theme command without any pre-configured scope."
        },
        {
          "description": "Denies the title command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-title",
          "markdownDescription": "Denies the title command without any pre-configured scope."
        },
        {
          "description": "Denies the toggle_maximize command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-toggle-maximize",
          "markdownDescription": "Denies the toggle_maximize command without any pre-configured scope."
        },
        {
          "description": "Denies the unmaximize command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-unmaximize",
          "markdownDescription": "Denies the unmaximize command without any pre-configured scope."
        },
        {
          "description": "Denies the unminimize command without any pre-configured scope.",
          "type": "string",
          "const": "core:window:deny-unminimize",
          "markdownDescription": "Denies the unminimize command without any pre-configured scope."
        },
        {
          "description": "This permission set configures the types of dialogs\navailable from the dialog plugin.\n\n#### Granted Permissions\n\nAll dialog types are enabled.\n\n\n\n#### This default permission set includes:\n\n- `allow-message`\n- `allow-save`\n- `allow-open`",
          "type": "string",
          "const": "dialog:default",
          "markdownDescription": "This permission set configures the types of dialogs\navailable from the dialog plugin.\n\n#### Granted Permissions\n\nAll dialog types are enabled.\n\n\n\n#### This default permission set includes:\n\n- `allow-message`\n- `allow-save`\n- `allow-open`"
        },
        {
          "description": "Enables the ask command without any pre-configured scope. (**DEPRECATED**: This is now an alias to `allow-message` and will be removed in v3)",
          "type": "string",
          "const": "dialog:allow-ask",
          "markdownDescription": "Enables the ask command without any pre-configured scope. (**DEPRECATED**: This is now an alias to `allow-message` and will be removed in v3)"
        },
        {
          "description": "Enables the confirm command without any pre-configured scope. (**DEPRECATED**: This is now an alias to `allow-message` and will be removed in v3)",
          "type": "string",
          "const": "dialog:allow-confirm",
          "markdownDescription": "Enables the confirm command without any pre-configured scope. (**DEPRECATED**: This is now an alias to `allow-message` and will be removed in v3)"
        },
        {
          "description": "Enables the message command without any pre-configured scope.",
          "type": "string",
          "const": "dialog:allow-message",
          "markdownDescription": "Enables the message command without any pre-configured scope."
        },
        {
          "description": "Enables the open command without any pre-configured scope.",
          "type": "string",
          "const": "dialog:allow-open",
          "markdownDescription": "Enables the open command without any pre-configured scope."
        },
        {
          "description": "Enables the save command without any pre-configured scope.",
          "type": "string",
          "const": "dialog:allow-save",
          "markdownDescription": "Enables the save command without any pre-configured scope."
        },
        {
          "description": "Denies the ask command without any pre-configured scope. (**DEPRECATED**: This is now an alias to `deny-message` and will be removed in v3)",
          "type": "string",
          "const": "dialog:deny-ask",
          "markdownDescription": "Denies the ask command without any pre-configured scope. (**DEPRECATED**: This is now an alias to `deny-message` and will be removed in v3)"
        },
        {
          "description": "Denies the confirm command without any pre-configured scope. (**DEPRECATED**: This is now an alias to `deny-message` and will be removed in v3)",
          "type": "string",
          "const": "dialog:deny-confirm",
          "markdownDescription": "Denies the confirm command without any pre-configured scope. (**DEPRECATED**: This is now an alias to `deny-message` and will be removed in v3)"
        },
        {
          "description": "Denies the message command without any pre-configured scope.",
          "type": "string",
          "const": "dialog:deny-message",
          "markdownDescription": "Denies the message command without any pre-configured scope."
        },
        {
          "description": "Denies the open command without any pre-configured scope.",
          "type": "string",
          "const": "dialog:deny-open",
          "markdownDescription": "Denies the open command without any pre-configured scope."
        },
        {
          "description": "Denies the save command without any pre-configured scope.",
          "type": "string",
          "const": "dialog:deny-save",
          "markdownDescription": "Denies the save command without any pre-configured scope."
        },
        {
          "description": "Allows the log command\n#### This default permission set includes:\n\n- `allow-log`",
          "type": "string",
          "const": "log:default",
          "markdownDescription": "Allows the log command\n#### This default permission set includes:\n\n- `allow-log`"
        },
        {
          "description": "Enables the log command without any pre-configured scope.",
          "type": "string",
          "const": "log:allow-log",
          "markdownDescription": "Enables the log command without any pre-configured scope."
        },
        {
          "description": "Denies the log command without any pre-configured scope.",
          "type": "string",
          "const": "log:deny-log",
          "markdownDescription": "Denies the log command without any pre-configured scope."
        },
        {
          "description": "### Default Permissions\n\nThis permission set configures what kind of\ndatabase operations are available from the sql plugin.\n\n### Granted Permissions\n\nAll reading related operations are enabled.\nAlso allows to load or close a connection.\n\n\n#### This default permission set includes:\n\n- `allow-close`\n- `allow-load`\n- `allow-select`",
          "type": "string",
          "const": "sql:default",
          "markdownDescription": "### Default Permissions\n\nThis permission set configures what kind of\ndatabase operations are available from the sql plugin.\n\n### Granted Permissions\n\nAll reading related operations are enabled.\nAlso allows to load or close a connection.\n\n\n#### This default permission set includes:\n\n- `allow-close`\n- `allow-load`\n- `allow-select`"
        },
        {
          "description": "Enables the close command without any pre-configured scope.",
          "type": "string",
          "const": "sql:allow-close",
          "markdownDescription": "Enables the close command without any pre-configured scope."
        },
        {
          "description": "Enables the execute command without any pre-configured scope.",
          "type": "string",
          "const": "sql:allow-execute",
          "markdownDescription": "Enables the execute command without any pre-configured scope."
        },
        {
          "description": "Enables the load command without any pre-configured scope.",
          "type": "string",
          "const": "sql:allow-load",
          "markdownDescription": "Enables the load command without any pre-configured scope."
        },
        {
          "description": "Enables the select command without any pre-configured scope.",
          "type": "string",
          "const": "sql:allow-select",
          "markdownDescription": "Enables the select command without any pre-configured scope."
        },
        {
          "description": "Denies the close command without any pre-configured scope.",
          "type": "string",
          "const": "sql:deny-close",
          "markdownDescription": "Denies the close command without any pre-configured scope."
        },
        {
          "description": "Denies the execute command without any pre-configured scope.",
          "type": "string",
          "const": "sql:deny-execute",
          "markdownDescription": "Denies the execute command without any pre-configured scope."
        },
        {
          "description": "Denies the load command without any pre-configured scope.",
          "type": "string",
          "const": "sql:deny-load",
          "markdownDescription": "Denies the load command without any pre-configured scope."
        },
        {
          "description": "Denies the select command without any pre-configured scope.",
          "type": "string",
          "const": "sql:deny-select",
          "markdownDescription": "Denies the select command without any pre-configured scope."
        }
      ]
    },
    "Value": {
      "description": "All supported ACL values.",
      "anyOf": [
        {
          "description": "Represents a null JSON value.",
          "type": "null"
        },
        {
          "description": "Represents a [`bool`].",
          "type": "boolean"
        },
        {
          "description": "Represents a valid ACL [`Number`].",
          "allOf": [
            {
              "$ref": "#/definitions/Number"
            }
          ]
        },
        {
          "description": "Represents a [`String`].",
          "type": "string"
        },
        {
          "description": "Represents a list of other [`Value`]s.",
          "type": "array",
          "items": {
            "$ref": "#/definitions/Value"
          }
        },
        {
          "description": "Represents a map of [`String`] keys to [`Value`]s.",
          "type": "object",
          "additionalProperties": {
            "$ref": "#/definitions/Value"
          }
        }
      ]
    },
    "Number": {
      "description": "A valid ACL number.",
      "anyOf": [
        {
          "description": "Represents an [`i64`].",
          "type": "integer",
          "format": "int64"
        },
        {
          "description": "Represents a [`f64`].",
          "type": "number",
          "format": "double"
        }
      ]
    },
    "Target": {
      "description": "Platform target.",
      "oneOf": [
        {
          "description": "MacOS.",
          "type": "string",
          "enum": [
            "macOS"
          ]
        },
        {
          "description": "Windows.",
          "type": "string",
          "enum": [
            "windows"
          ]
        },
        {
          "description": "Linux.",
          "type": "string",
          "enum": [
            "linux"
          ]
        },
        {
          "description": "Android.",
          "type": "string",
          "enum": [
            "android"
          ]
        },
        {
          "description": "iOS.",
          "type": "string",
          "enum": [
            "iOS"
          ]
        }
      ]
    }
  }
}
```


### `app/src-tauri/icons/128x128.png`

```
[二进制文件，已跳过内容]
```


### `app/src-tauri/icons/128x128@2x.png`

```
[二进制文件，已跳过内容]
```


### `app/src-tauri/icons/32x32.png`

```
[二进制文件，已跳过内容]
```


### `app/src-tauri/icons/64x64.png`

```
[二进制文件，已跳过内容]
```


### `app/src-tauri/icons/Square107x107Logo.png`

```
[二进制文件，已跳过内容]
```


### `app/src-tauri/icons/Square142x142Logo.png`

```
[二进制文件，已跳过内容]
```


### `app/src-tauri/icons/Square150x150Logo.png`

```
[二进制文件，已跳过内容]
```


### `app/src-tauri/icons/Square284x284Logo.png`

```
[二进制文件，已跳过内容]
```


### `app/src-tauri/icons/Square30x30Logo.png`

```
[二进制文件，已跳过内容]
```


### `app/src-tauri/icons/Square310x310Logo.png`

```
[二进制文件，已跳过内容]
```


### `app/src-tauri/icons/Square44x44Logo.png`

```
[二进制文件，已跳过内容]
```


### `app/src-tauri/icons/Square71x71Logo.png`

```
[二进制文件，已跳过内容]
```


### `app/src-tauri/icons/Square89x89Logo.png`

```
[二进制文件，已跳过内容]
```


### `app/src-tauri/icons/StoreLogo.png`

```
[二进制文件，已跳过内容]
```


### `app/src-tauri/icons/icon.icns`

```
[二进制文件，已跳过内容]
```


### `app/src-tauri/icons/icon.ico`

```
[二进制文件，已跳过内容]
```


### `app/src-tauri/icons/icon.png`

```
[二进制文件，已跳过内容]
```


### `app/src-tauri/icons/android/mipmap-anydpi-v26/ic_launcher.xml`

```
<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
  <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
  <background android:drawable="@color/ic_launcher_background"/>
</adaptive-icon>
```


### `app/src-tauri/icons/android/mipmap-hdpi/ic_launcher.png`

```
[二进制文件，已跳过内容]
```


### `app/src-tauri/icons/android/mipmap-hdpi/ic_launcher_foreground.png`

```
[二进制文件，已跳过内容]
```


### `app/src-tauri/icons/android/mipmap-hdpi/ic_launcher_round.png`

```
[二进制文件，已跳过内容]
```


### `app/src-tauri/icons/android/mipmap-mdpi/ic_launcher.png`

```
[二进制文件，已跳过内容]
```


### `app/src-tauri/icons/android/mipmap-mdpi/ic_launcher_foreground.png`

```
[二进制文件，已跳过内容]
```


### `app/src-tauri/icons/android/mipmap-mdpi/ic_launcher_round.png`

```
[二进制文件，已跳过内容]
```


### `app/src-tauri/icons/android/mipmap-xhdpi/ic_launcher.png`

```
[二进制文件，已跳过内容]
```


### `app/src-tauri/icons/android/mipmap-xhdpi/ic_launcher_foreground.png`

```
[二进制文件，已跳过内容]
```


### `app/src-tauri/icons/android/mipmap-xhdpi/ic_launcher_round.png`

```
[二进制文件，已跳过内容]
```


### `app/src-tauri/icons/android/mipmap-xxhdpi/ic_launcher.png`

```
[二进制文件，已跳过内容]
```


### `app/src-tauri/icons/android/mipmap-xxhdpi/ic_launcher_foreground.png`

```
[二进制文件，已跳过内容]
```


### `app/src-tauri/icons/android/mipmap-xxhdpi/ic_launcher_round.png`

```
[二进制文件，已跳过内容]
```


### `app/src-tauri/icons/android/mipmap-xxxhdpi/ic_launcher.png`

```
[二进制文件，已跳过内容]
```


### `app/src-tauri/icons/android/mipmap-xxxhdpi/ic_launcher_foreground.png`

```
[二进制文件，已跳过内容]
```


### `app/src-tauri/icons/android/mipmap-xxxhdpi/ic_launcher_round.png`

```
[二进制文件，已跳过内容]
```


### `app/src-tauri/icons/android/values/ic_launcher_background.xml`

```
<?xml version="1.0" encoding="utf-8"?>
<resources>
  <color name="ic_launcher_background">#fff</color>
</resources>
```


### `app/src-tauri/icons/ios/AppIcon-20x20@1x.png`

```
[二进制文件，已跳过内容]
```


### `app/src-tauri/icons/ios/AppIcon-20x20@2x-1.png`

```
[二进制文件，已跳过内容]
```


### `app/src-tauri/icons/ios/AppIcon-20x20@2x.png`

```
[二进制文件，已跳过内容]
```


### `app/src-tauri/icons/ios/AppIcon-20x20@3x.png`

```
[二进制文件，已跳过内容]
```


### `app/src-tauri/icons/ios/AppIcon-29x29@1x.png`

```
[二进制文件，已跳过内容]
```


### `app/src-tauri/icons/ios/AppIcon-29x29@2x-1.png`

```
[二进制文件，已跳过内容]
```


### `app/src-tauri/icons/ios/AppIcon-29x29@2x.png`

```
[二进制文件，已跳过内容]
```


### `app/src-tauri/icons/ios/AppIcon-29x29@3x.png`

```
[二进制文件，已跳过内容]
```


### `app/src-tauri/icons/ios/AppIcon-40x40@1x.png`

```
[二进制文件，已跳过内容]
```


### `app/src-tauri/icons/ios/AppIcon-40x40@2x-1.png`

```
[二进制文件，已跳过内容]
```


### `app/src-tauri/icons/ios/AppIcon-40x40@2x.png`

```
[二进制文件，已跳过内容]
```


### `app/src-tauri/icons/ios/AppIcon-40x40@3x.png`

```
[二进制文件，已跳过内容]
```


### `app/src-tauri/icons/ios/AppIcon-512@2x.png`

```
[二进制文件，已跳过内容]
```


### `app/src-tauri/icons/ios/AppIcon-60x60@2x.png`

```
[二进制文件，已跳过内容]
```


### `app/src-tauri/icons/ios/AppIcon-60x60@3x.png`

```
[二进制文件，已跳过内容]
```


### `app/src-tauri/icons/ios/AppIcon-76x76@1x.png`

```
[二进制文件，已跳过内容]
```


### `app/src-tauri/icons/ios/AppIcon-76x76@2x.png`

```
[二进制文件，已跳过内容]
```


### `app/src-tauri/icons/ios/AppIcon-83.5x83.5@2x.png`

```
[二进制文件，已跳过内容]
```


### `app/src-tauri/migrations/0001_initial.sql`

```sql
CREATE TABLE IF NOT EXISTS source_documents (
  id TEXT PRIMARY KEY NOT NULL,
  original_image_path TEXT NOT NULL,
  corrected_image_path TEXT,
  content_hash TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('camera', 'import', 'clipboard')),
  processing_status TEXT NOT NULL DEFAULT 'captured',
  captured_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_source_documents_hash
  ON source_documents(content_hash);

CREATE TABLE IF NOT EXISTS problems (
  id TEXT PRIMARY KEY NOT NULL,
  source_document_id TEXT NOT NULL REFERENCES source_documents(id) ON DELETE CASCADE,
  crop_x REAL NOT NULL DEFAULT 0,
  crop_y REAL NOT NULL DEFAULT 0,
  crop_width REAL NOT NULL DEFAULT 1,
  crop_height REAL NOT NULL DEFAULT 1,
  crop_image_path TEXT,
  subject TEXT,
  problem_type TEXT,
  stem_markdown TEXT,
  structured_content_json TEXT,
  solution_json TEXT,
  model_confidence REAL,
  verification_status TEXT NOT NULL DEFAULT 'unverified',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_problems_source
  ON problems(source_document_id);

CREATE TABLE IF NOT EXISTS user_attempts (
  id TEXT PRIMARY KEY NOT NULL,
  problem_id TEXT NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  answer_text TEXT,
  answer_image_path TEXT,
  is_correct INTEGER,
  first_error_step TEXT,
  error_category TEXT,
  duration_seconds INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS knowledge_points (
  id TEXT PRIMARY KEY NOT NULL,
  canonical_name TEXT NOT NULL,
  parent_id TEXT REFERENCES knowledge_points(id),
  subject TEXT NOT NULL,
  curriculum_version TEXT,
  UNIQUE(canonical_name, subject, curriculum_version)
);

CREATE TABLE IF NOT EXISTS problem_knowledge_points (
  problem_id TEXT NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  knowledge_point_id TEXT NOT NULL REFERENCES knowledge_points(id) ON DELETE CASCADE,
  confidence REAL,
  source TEXT NOT NULL CHECK (source IN ('model', 'user')),
  PRIMARY KEY(problem_id, knowledge_point_id)
);

CREATE TABLE IF NOT EXISTS review_states (
  problem_id TEXT PRIMARY KEY NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  difficulty REAL NOT NULL,
  stability REAL NOT NULL,
  retrievability REAL NOT NULL,
  desired_retention REAL NOT NULL DEFAULT 0.9,
  last_review_at INTEGER,
  next_review_at INTEGER,
  review_count INTEGER NOT NULL DEFAULT 0,
  lapse_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS review_logs (
  id TEXT PRIMARY KEY NOT NULL,
  problem_id TEXT NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 4),
  scheduled_days REAL NOT NULL,
  elapsed_days REAL NOT NULL,
  duration_seconds INTEGER,
  reviewed_at INTEGER NOT NULL,
  scheduler_version TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_review_due
  ON review_states(next_review_at);

CREATE TABLE IF NOT EXISTS model_runs (
  id TEXT PRIMARY KEY NOT NULL,
  problem_id TEXT NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  output_json TEXT,
  latency_ms INTEGER,
  token_usage INTEGER,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

```


### `app/src-tauri/migrations/0002_document_processing.sql`

```sql
ALTER TABLE source_documents ADD COLUMN page_detection_json TEXT;
ALTER TABLE source_documents ADD COLUMN processed_width INTEGER;
ALTER TABLE source_documents ADD COLUMN processed_height INTEGER;
ALTER TABLE source_documents ADD COLUMN enhancement_mode TEXT;

CREATE TABLE IF NOT EXISTS document_processing_runs (
  id TEXT PRIMARY KEY NOT NULL,
  source_document_id TEXT NOT NULL REFERENCES source_documents(id) ON DELETE CASCADE,
  corrected_image_path TEXT,
  page_detected INTEGER NOT NULL,
  corners_json TEXT NOT NULL,
  text_lines_json TEXT NOT NULL,
  blocks_json TEXT NOT NULL,
  enhancement_mode TEXT NOT NULL,
  warnings_json TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_processing_runs_source
  ON document_processing_runs(source_document_id, created_at DESC);

```


### `app/src-tauri/migrations/0003_problem_persistence.sql`

```sql
ALTER TABLE problems ADD COLUMN title TEXT;
ALTER TABLE problems ADD COLUMN status TEXT NOT NULL DEFAULT 'candidate'
  CHECK (status IN ('candidate', 'saved'));
ALTER TABLE problems ADD COLUMN archived_at INTEGER;
ALTER TABLE problems ADD COLUMN deleted_at INTEGER;

UPDATE problems
SET title = stem_markdown
WHERE title IS NULL;

CREATE INDEX IF NOT EXISTS idx_problems_library
  ON problems(status, deleted_at, archived_at, created_at DESC);

```


### `app/src-tauri/migrations/0004_problem_user_edits.sql`

```sql
ALTER TABLE problems ADD COLUMN user_title TEXT;
ALTER TABLE problems ADD COLUMN user_subject TEXT;
ALTER TABLE problems ADD COLUMN user_stem_markdown TEXT;
ALTER TABLE problems ADD COLUMN user_edited_at INTEGER;

```


### `app/src-tauri/migrations/0005_basic_ai_pipeline.sql`

```sql
ALTER TABLE problems ADD COLUMN ai_status TEXT NOT NULL DEFAULT 'not_started'
  CHECK (ai_status IN (
    'not_started',
    'pending',
    'processing',
    'completed',
    'failed'
  ));
ALTER TABLE problems ADD COLUMN ai_active_model_run_id TEXT;
ALTER TABLE problems ADD COLUMN ai_subject TEXT;
ALTER TABLE problems ADD COLUMN ai_problem_type TEXT;
ALTER TABLE problems ADD COLUMN ai_stem_markdown TEXT;
ALTER TABLE problems ADD COLUMN ai_choices_json TEXT;
ALTER TABLE problems ADD COLUMN ai_has_diagram INTEGER;
ALTER TABLE problems ADD COLUMN ai_diagram_bbox_json TEXT;
ALTER TABLE problems ADD COLUMN ai_knowledge_points_json TEXT;
ALTER TABLE problems ADD COLUMN ai_confidence REAL;
ALTER TABLE problems ADD COLUMN ai_warnings_json TEXT;
ALTER TABLE problems ADD COLUMN ai_updated_at INTEGER;

ALTER TABLE model_runs ADD COLUMN task_type TEXT NOT NULL
  DEFAULT 'analyze_problem_image';
ALTER TABLE model_runs ADD COLUMN input_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE model_runs ADD COLUMN error_message TEXT;

CREATE INDEX IF NOT EXISTS idx_problems_ai_status
  ON problems(ai_status, updated_at);

CREATE INDEX IF NOT EXISTS idx_model_runs_problem_task
  ON model_runs(problem_id, task_type, created_at DESC);

```


### `app/src-tauri/migrations/0006_ai_title_and_provider_settings.sql`

```sql
ALTER TABLE problems ADD COLUMN ai_title TEXT;

CREATE TABLE IF NOT EXISTS ai_provider_settings (
  id TEXT PRIMARY KEY NOT NULL
    CHECK (id = 'default'),
  provider TEXT NOT NULL DEFAULT 'mock'
    CHECK (provider IN ('mock', 'openai_compatible')),
  base_url TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  encrypted_api_key TEXT,
  api_key_nonce TEXT,
  enabled INTEGER NOT NULL DEFAULT 0
    CHECK (enabled IN (0, 1)),
  updated_at INTEGER NOT NULL
);

INSERT OR IGNORE INTO ai_provider_settings (
  id,
  provider,
  base_url,
  model,
  encrypted_api_key,
  api_key_nonce,
  enabled,
  updated_at
) VALUES (
  'default',
  'mock',
  '',
  '',
  NULL,
  NULL,
  0,
  0
);

```


### `app/src-tauri/migrations/0007_ai_provider_profiles.sql`

```sql
ALTER TABLE problems ADD COLUMN user_knowledge_points_json TEXT;

CREATE TABLE IF NOT EXISTS ai_provider_profiles (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('mock', 'openai_compatible')),
  base_url TEXT NOT NULL DEFAULT '',
  api_key TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  supports_vision INTEGER NOT NULL DEFAULT 1 CHECK (supports_vision IN (0, 1)),
  supports_text INTEGER NOT NULL DEFAULT 1 CHECK (supports_text IN (0, 1)),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_provider_profiles_order
  ON ai_provider_profiles(enabled DESC, sort_order ASC);

INSERT OR IGNORE INTO ai_provider_profiles (
  id, name, provider, base_url, api_key, model,
  supports_vision, supports_text, enabled, sort_order, created_at, updated_at
) VALUES (
  'mock-default', 'Mock Provider', 'mock', '', '', 'mock-vision-v1',
  1, 1, 1, 0,
  CAST(strftime('%s', 'now') AS INTEGER) * 1000,
  CAST(strftime('%s', 'now') AS INTEGER) * 1000
);

```


### `app/src-tauri/migrations/0008_ai_sub_questions.sql`

```sql
ALTER TABLE problems ADD COLUMN ai_sub_questions_json TEXT;

```


### `app/src-tauri/migrations/0009_model_run_raw_output.sql`

```sql
ALTER TABLE model_runs ADD COLUMN raw_output TEXT NOT NULL DEFAULT '';
ALTER TABLE model_runs ADD COLUMN repair_strategy TEXT;

```


### `app/src-tauri/migrations/0010_ai_diagram_extraction.sql`

```sql
ALTER TABLE problems ADD COLUMN ai_diagram_kind TEXT;
ALTER TABLE problems ADD COLUMN ai_diagram_image_path TEXT;

```


### `app/src-tauri/migrations/0011_antigravity_cli_provider.sql`

```sql
CREATE TABLE ai_provider_profiles_v11 (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (
    provider IN ('mock', 'openai_compatible', 'antigravity_cli')
  ),
  base_url TEXT NOT NULL DEFAULT '',
  api_key TEXT NOT NULL DEFAULT '',
  command_path TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  supports_vision INTEGER NOT NULL DEFAULT 1 CHECK (supports_vision IN (0, 1)),
  supports_text INTEGER NOT NULL DEFAULT 1 CHECK (supports_text IN (0, 1)),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

INSERT INTO ai_provider_profiles_v11 (
  id, name, provider, base_url, api_key, command_path, model,
  supports_vision, supports_text, enabled, sort_order, created_at, updated_at
)
SELECT
  id, name, provider, base_url, api_key, '', model,
  supports_vision, supports_text, enabled, sort_order, created_at, updated_at
FROM ai_provider_profiles;

DROP TABLE ai_provider_profiles;
ALTER TABLE ai_provider_profiles_v11 RENAME TO ai_provider_profiles;

CREATE INDEX idx_ai_provider_profiles_order
  ON ai_provider_profiles(enabled DESC, sort_order ASC);

```


### `app/src-tauri/migrations/0012_solution_engine.sql`

```sql
CREATE TABLE IF NOT EXISTS problem_solutions (
  id TEXT PRIMARY KEY NOT NULL,
  problem_id TEXT NOT NULL UNIQUE
    REFERENCES problems(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'not_started'
    CHECK (status IN (
      'not_started',
      'pending',
      'processing',
      'completed',
      'failed'
    )),
  content_markdown TEXT,
  steps_json TEXT NOT NULL DEFAULT '[]',
  key_method TEXT,
  used_formulas_json TEXT NOT NULL DEFAULT '[]',
  knowledge_points_json TEXT NOT NULL DEFAULT '[]',
  active_model_run_id TEXT,
  error_message TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_problem_solutions_status
  ON problem_solutions(status, updated_at);

INSERT OR IGNORE INTO problem_solutions (
  id,
  problem_id,
  status,
  content_markdown,
  steps_json,
  key_method,
  used_formulas_json,
  knowledge_points_json,
  active_model_run_id,
  error_message,
  created_at,
  updated_at
)
SELECT
  'legacy-' || id,
  id,
  'completed',
  json_extract(solution_json, '$.content_markdown'),
  CASE
    WHEN json_type(solution_json, '$.steps') = 'array'
      AND json_array_length(json_extract(solution_json, '$.steps')) > 0
    THEN json_extract(solution_json, '$.steps')
    ELSE json_array(json_object(
      'index', 1,
      'title', '标准解答',
      'content_markdown', json_extract(solution_json, '$.content_markdown')
    ))
  END,
  json_extract(solution_json, '$.key_method'),
  CASE
    WHEN json_type(solution_json, '$.used_formulas') = 'array'
    THEN json_extract(solution_json, '$.used_formulas')
    ELSE '[]'
  END,
  CASE
    WHEN json_type(solution_json, '$.knowledge_points') = 'array'
    THEN json_extract(solution_json, '$.knowledge_points')
    ELSE '[]'
  END,
  NULL,
  NULL,
  created_at,
  updated_at
FROM problems
WHERE solution_json IS NOT NULL
  AND json_valid(solution_json)
  AND trim(COALESCE(
    json_extract(solution_json, '$.content_markdown'),
    ''
  )) <> '';

```


### `app/src-tauri/migrations/0013_intelligence_pipeline.sql`

```sql
CREATE TABLE IF NOT EXISTS problem_regions (
  id TEXT PRIMARY KEY NOT NULL,
  problem_id TEXT NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  region_type TEXT NOT NULL CHECK (region_type IN (
    'question', 'answer', 'diagram', 'annotation'
  )),
  x REAL NOT NULL,
  y REAL NOT NULL,
  width REAL NOT NULL,
  height REAL NOT NULL,
  image_path TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_problem_regions_problem_type
  ON problem_regions(problem_id, region_type, updated_at);

CREATE TABLE IF NOT EXISTS student_attempts (
  id TEXT PRIMARY KEY NOT NULL,
  problem_id TEXT NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  answer_region_ids_json TEXT NOT NULL DEFAULT '[]',
  raw_markdown TEXT NOT NULL DEFAULT '',
  steps_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'not_started' CHECK (status IN (
    'not_started', 'pending', 'processing', 'completed', 'failed'
  )),
  active_model_run_id TEXT,
  error_message TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(problem_id)
);

CREATE TABLE IF NOT EXISTS reasoning_analyses (
  id TEXT PRIMARY KEY NOT NULL,
  problem_id TEXT NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  student_attempt_id TEXT NOT NULL REFERENCES student_attempts(id) ON DELETE CASCADE,
  solution_id TEXT REFERENCES problem_solutions(id) ON DELETE SET NULL,
  approach TEXT,
  step_evaluations_json TEXT NOT NULL DEFAULT '[]',
  first_wrong_step INTEGER,
  error_type TEXT,
  reason TEXT,
  knowledge_gaps_json TEXT NOT NULL DEFAULT '[]',
  suggestion TEXT,
  status TEXT NOT NULL DEFAULT 'not_started' CHECK (status IN (
    'not_started', 'pending', 'processing', 'completed', 'failed'
  )),
  active_model_run_id TEXT,
  error_message TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(student_attempt_id)
);

CREATE INDEX IF NOT EXISTS idx_reasoning_analyses_problem
  ON reasoning_analyses(problem_id, updated_at);

INSERT OR IGNORE INTO problem_regions (
  id, problem_id, region_type, x, y, width, height, image_path, created_at, updated_at
)
SELECT
  'legacy-question-' || p.id,
  p.id,
  'question',
  p.crop_x,
  p.crop_y,
  p.crop_width,
  p.crop_height,
  p.crop_image_path,
  p.created_at,
  p.updated_at
FROM problems p
WHERE p.crop_image_path IS NOT NULL;

```


### `app/src-tauri/migrations/0014_model_run_provider_attempts.sql`

```sql
ALTER TABLE model_runs
  ADD COLUMN provider_attempts_json TEXT NOT NULL DEFAULT '[]';


```


### `app/src-tauri/native/AxiomVision.swift`

```swift
import AVFoundation
import CoreImage
import Foundation
import ImageIO
import Vision

private struct NormalizedRect: Codable {
    var x: Double
    var y: Double
    var width: Double
    var height: Double

    var maxX: Double { x + width }
    var maxY: Double { y + height }

    func expanded(by padding: Double) -> NormalizedRect {
        let nextX = max(0, x - padding)
        let nextY = max(0, y - padding)
        return NormalizedRect(
            x: nextX,
            y: nextY,
            width: min(1 - nextX, width + padding * 2),
            height: min(1 - nextY, height + padding * 2)
        )
    }

    func clamped() -> NormalizedRect {
        let nextX = min(1, max(0, x))
        let nextY = min(1, max(0, y))
        return NormalizedRect(
            x: nextX,
            y: nextY,
            width: min(1 - nextX, max(0.001, width)),
            height: min(1 - nextY, max(0.001, height))
        )
    }

    static func union(_ values: [NormalizedRect]) -> NormalizedRect {
        guard let first = values.first else {
            return NormalizedRect(x: 0.05, y: 0.05, width: 0.9, height: 0.9)
        }
        let minX = values.dropFirst().reduce(first.x) { min($0, $1.x) }
        let minY = values.dropFirst().reduce(first.y) { min($0, $1.y) }
        let maxX = values.dropFirst().reduce(first.maxX) { max($0, $1.maxX) }
        let maxY = values.dropFirst().reduce(first.maxY) { max($0, $1.maxY) }
        return NormalizedRect(x: minX, y: minY, width: maxX - minX, height: maxY - minY)
    }
}

private struct Point: Codable {
    let x: Double
    let y: Double
}

private struct TextLine: Codable {
    let id: String
    let text: String
    let confidence: Double
    let rect: NormalizedRect
}

private struct ProblemBlock: Codable {
    let id: String
    var title: String
    var rect: NormalizedRect
    var confidence: Double
    var lineIds: [String]
    var source: String
}

private struct QuestionAnchor {
    let number: Int
    let line: TextLine
}

private struct ProcessResult: Codable {
    let correctedPath: String
    let width: Int
    let height: Int
    let pageDetected: Bool
    let corners: [String: Point]
    let textLines: [TextLine]
    let blocks: [ProblemBlock]
    let enhancementMode: String
    let warnings: [String]
}

private struct CameraOrientationResult: Codable {
    let deviceName: String
    let isContinuityCamera: Bool
    let previewRotationAngle: Double
    let captureRotationAngle: Double
}

private enum ProcessorError: LocalizedError {
    case invalidArguments
    case invalidCrop
    case unreadableImage
    case renderFailed
    case cameraNotFound

    var errorDescription: String? {
        switch self {
        case .invalidArguments: return "参数不完整"
        case .invalidCrop: return "题块裁剪区域无效"
        case .unreadableImage: return "无法读取图片"
        case .renderFailed: return "无法生成矫正图片"
        case .cameraNotFound: return "找不到对应的相机设备"
        }
    }
}

private func cameraOrientation(deviceLabel: String) throws -> CameraOrientationResult {
    let discovery = AVCaptureDevice.DiscoverySession(
        deviceTypes: [.builtInWideAngleCamera, .externalUnknown],
        mediaType: .video,
        position: .unspecified
    )
    let normalizedLabel = deviceLabel.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let device = discovery.devices.first(where: {
        $0.localizedName.caseInsensitiveCompare(normalizedLabel) == .orderedSame
            || normalizedLabel.localizedCaseInsensitiveContains($0.localizedName)
            || $0.localizedName.localizedCaseInsensitiveContains(normalizedLabel)
    }) else {
        throw ProcessorError.cameraNotFound
    }

    if #available(macOS 14.0, *) {
        let coordinator = AVCaptureDevice.RotationCoordinator(
            device: device,
            previewLayer: nil
        )
        return CameraOrientationResult(
            deviceName: device.localizedName,
            isContinuityCamera: device.deviceType == .continuityCamera
                || device.localizedName.localizedCaseInsensitiveContains("iPhone"),
            previewRotationAngle: coordinator.videoRotationAngleForHorizonLevelPreview,
            captureRotationAngle: coordinator.videoRotationAngleForHorizonLevelCapture
        )
    }

    return CameraOrientationResult(
        deviceName: device.localizedName,
        isContinuityCamera: false,
        previewRotationAngle: 0,
        captureRotationAngle: 0
    )
}

private final class DocumentProcessor {
    private let context = CIContext(options: [
        .cacheIntermediates: false,
        .useSoftwareRenderer: false,
    ])
    private let sRGB = CGColorSpace(name: CGColorSpace.sRGB)!
    private lazy var paperWhiteningKernel = CIColorKernel(source: """
    kernel vec4 selectivelyWhitenPaper(
        __sample source,
        __sample background,
        float targetPaper,
        float maximumLift,
        float paperNeutralization
    ) {
        float sourceLuminance = dot(source.rgb, vec3(0.2126, 0.7152, 0.0722));
        float backgroundLuminance = dot(
            background.rgb,
            vec3(0.2126, 0.7152, 0.0722)
        );
        float distanceFromPaper = max(
            backgroundLuminance - sourceLuminance,
            0.0
        );

        // Pixels close to the locally estimated paper tone can be whitened.
        // Dark ink and line work sit farther below that tone and therefore
        // receive little or no lift.
        float paperMask = 1.0 - smoothstep(0.035, 0.145, distanceFromPaper);
        float lift = clamp(
            targetPaper - backgroundLuminance,
            0.0,
            maximumLift
        ) * paperMask;
        float correctedLuminance = clamp(sourceLuminance + lift, 0.0, 1.0);

        vec3 corrected = source.rgb;
        if (sourceLuminance > 0.001) {
            corrected *= correctedLuminance / sourceLuminance;
        } else {
            corrected += vec3(lift);
        }
        corrected = mix(
            corrected,
            vec3(correctedLuminance),
            paperMask * paperNeutralization
        );
        return vec4(clamp(corrected, 0.0, 1.0), source.a);
    }
    """)

    func process(
        inputPath: String,
        outputPath: String,
        mode: String,
        beforeOutputPath: String? = nil
    ) throws -> ProcessResult {
        let inputURL = URL(fileURLWithPath: inputPath)
        let outputURL = URL(fileURLWithPath: outputPath)
        guard var image = CIImage(contentsOf: inputURL, options: [.applyOrientationProperty: true]) else {
            throw ProcessorError.unreadableImage
        }

        var warnings: [String] = []
        var corners: [String: Point] = fullPageCorners()
        var pageDetected = false

        if let document = detectDocument(in: image) {
            let corrected = perspectiveCorrect(image, using: document)
            if isPlausiblePage(corrected) {
                corners = normalizedCorners(document)
                image = corrected
                pageDetected = true
            } else {
                warnings.append("检测到的页面边界比例异常，已保留完整原图")
            }
        } else {
            warnings.append("未检测到完整页面边界，已保留原图范围")
        }

        if let beforeOutputPath {
            try render(image, to: URL(fileURLWithPath: beforeOutputPath))
        }
        let recognitionImage = prepareForTextRecognition(image)
        let enhanced = enhance(image, mode: mode)
        try render(enhanced, to: outputURL)

        let lines = recognizeText(in: recognitionImage)
        if lines.isEmpty {
            warnings.append("没有识别到文字，请手动添加题目块")
        }
        let blocks = generateProblemBlocks(from: lines)
        if blocks.count == 1 && !lines.isEmpty {
            warnings.append("未识别到明确题号，已按版面生成一个候选块")
        }

        let extent = enhanced.extent.integral
        return ProcessResult(
            correctedPath: outputPath,
            width: Int(extent.width),
            height: Int(extent.height),
            pageDetected: pageDetected,
            corners: corners,
            textLines: lines,
            blocks: blocks,
            enhancementMode: mode,
            warnings: warnings
        )
    }

    func crop(
        inputPath: String,
        outputPath: String,
        rect: NormalizedRect
    ) throws {
        let inputURL = URL(fileURLWithPath: inputPath)
        let outputURL = URL(fileURLWithPath: outputPath)
        guard let image = CIImage(
            contentsOf: inputURL,
            options: [.applyOrientationProperty: true]
        ) else {
            throw ProcessorError.unreadableImage
        }
        guard
            rect.x.isFinite,
            rect.y.isFinite,
            rect.width.isFinite,
            rect.height.isFinite,
            rect.x >= 0,
            rect.y >= 0,
            rect.width > 0,
            rect.height > 0,
            rect.maxX <= 1.000_001,
            rect.maxY <= 1.000_001
        else {
            throw ProcessorError.invalidCrop
        }

        let extent = image.extent
        let requested = CGRect(
            x: extent.minX + rect.x * extent.width,
            y: extent.maxY - rect.maxY * extent.height,
            width: rect.width * extent.width,
            height: rect.height * extent.height
        )
        let pixelRect = requested.intersection(extent).integral
        guard pixelRect.width >= 2, pixelRect.height >= 2 else {
            throw ProcessorError.invalidCrop
        }
        let cropped = image
            .cropped(to: pixelRect)
            .transformed(
                by: CGAffineTransform(
                    translationX: -pixelRect.minX,
                    y: -pixelRect.minY
                )
            )
        try render(cropped, to: outputURL)
    }

    private func fullPageCorners() -> [String: Point] {
        [
            "topLeft": Point(x: 0, y: 0),
            "topRight": Point(x: 1, y: 0),
            "bottomLeft": Point(x: 0, y: 1),
            "bottomRight": Point(x: 1, y: 1),
        ]
    }

    private func isPlausiblePage(_ image: CIImage) -> Bool {
        let extent = image.extent.integral
        let shortEdge = min(extent.width, extent.height)
        let longEdge = max(extent.width, extent.height)
        guard shortEdge > 0 else { return false }
        // Exam pages are close to A-series proportions. A wider tolerance
        // allows perspective and partial margins but rejects diagonal strips
        // mistakenly returned by document segmentation.
        return longEdge / shortEdge <= 1.75
    }

    private func detectDocument(in image: CIImage) -> VNRectangleObservation? {
        let request = VNDetectDocumentSegmentationRequest()
        let handler = VNImageRequestHandler(ciImage: image, options: [:])
        do {
            try handler.perform([request])
            return request.results?.first
        } catch {
            return nil
        }
    }

    private func normalizedCorners(_ rectangle: VNRectangleObservation) -> [String: Point] {
        func convert(_ value: CGPoint) -> Point {
            Point(x: value.x, y: 1 - value.y)
        }
        return [
            "topLeft": convert(rectangle.topLeft),
            "topRight": convert(rectangle.topRight),
            "bottomLeft": convert(rectangle.bottomLeft),
            "bottomRight": convert(rectangle.bottomRight),
        ]
    }

    private func perspectiveCorrect(
        _ image: CIImage,
        using rectangle: VNRectangleObservation
    ) -> CIImage {
        let extent = image.extent
        func imagePoint(_ point: CGPoint) -> CIVector {
            CIVector(
                x: extent.minX + CGFloat(point.x) * extent.width,
                y: extent.minY + CGFloat(point.y) * extent.height
            )
        }

        guard let filter = CIFilter(name: "CIPerspectiveCorrection") else { return image }
        filter.setValue(image, forKey: kCIInputImageKey)
        filter.setValue(imagePoint(rectangle.topLeft), forKey: "inputTopLeft")
        filter.setValue(imagePoint(rectangle.topRight), forKey: "inputTopRight")
        filter.setValue(imagePoint(rectangle.bottomLeft), forKey: "inputBottomLeft")
        filter.setValue(imagePoint(rectangle.bottomRight), forKey: "inputBottomRight")
        return filter.outputImage ?? image
    }

    private func enhance(_ image: CIImage, mode: String) -> CIImage {
        var output = image

        if mode != "grayscale", let paperColor = estimatedPaperRGB(in: image) {
            output = applyingConservativeWhiteBalance(
                to: output,
                paperColor: paperColor
            )
        }

        if
            let background = estimatedPaperBackground(in: output),
            let whitened = paperWhiteningKernel?.apply(
                extent: output.extent,
                arguments: [
                    output,
                    background,
                    mode == "grayscale" ? 0.965 : 0.95,
                    0.42,
                    mode == "grayscale" ? 1.0 : 0.62,
                ]
            )
        {
            output = whitened
        }

        if let gamma = CIFilter(name: "CIGammaAdjust") {
            gamma.setValue(output, forKey: kCIInputImageKey)
            gamma.setValue(
                mode == "grayscale" ? 0.96 : 0.98,
                forKey: "inputPower"
            )
            output = gamma.outputImage ?? output
        }

        if let toneCurve = CIFilter(name: "CIToneCurve") {
            toneCurve.setValue(output, forKey: kCIInputImageKey)
            toneCurve.setValue(CIVector(x: 0, y: 0), forKey: "inputPoint0")
            toneCurve.setValue(
                CIVector(x: 0.20, y: mode == "grayscale" ? 0.15 : 0.17),
                forKey: "inputPoint1"
            )
            toneCurve.setValue(
                CIVector(x: 0.50, y: mode == "grayscale" ? 0.51 : 0.50),
                forKey: "inputPoint2"
            )
            toneCurve.setValue(
                CIVector(x: 0.80, y: mode == "grayscale" ? 0.87 : 0.84),
                forKey: "inputPoint3"
            )
            toneCurve.setValue(CIVector(x: 1, y: 1), forKey: "inputPoint4")
            output = toneCurve.outputImage ?? output
        }

        if let controls = CIFilter(name: "CIColorControls") {
            controls.setValue(output, forKey: kCIInputImageKey)
            controls.setValue(
                mode == "grayscale" ? 0.0 : 0.72,
                forKey: kCIInputSaturationKey
            )
            controls.setValue(0.0, forKey: kCIInputBrightnessKey)
            controls.setValue(
                mode == "grayscale" ? 1.12 : 1.08,
                forKey: kCIInputContrastKey
            )
            output = controls.outputImage ?? output
        }

        if let detail = CIFilter(name: "CIUnsharpMask") {
            detail.setValue(output, forKey: kCIInputImageKey)
            detail.setValue(0.28, forKey: kCIInputIntensityKey)
            detail.setValue(0.8, forKey: kCIInputRadiusKey)
            output = detail.outputImage ?? output
        }

        return output
    }

    private func prepareForTextRecognition(_ image: CIImage) -> CIImage {
        var output = image
        if let highlight = CIFilter(name: "CIHighlightShadowAdjust") {
            highlight.setValue(output, forKey: kCIInputImageKey)
            highlight.setValue(0.32, forKey: "inputShadowAmount")
            highlight.setValue(0.84, forKey: "inputHighlightAmount")
            output = highlight.outputImage ?? output
        }
        if let controls = CIFilter(name: "CIColorControls") {
            controls.setValue(output, forKey: kCIInputImageKey)
            controls.setValue(0.0, forKey: kCIInputSaturationKey)
            controls.setValue(0.0, forKey: kCIInputBrightnessKey)
            controls.setValue(1.14, forKey: kCIInputContrastKey)
            output = controls.outputImage ?? output
        }
        if let sharpen = CIFilter(name: "CISharpenLuminance") {
            sharpen.setValue(output, forKey: kCIInputImageKey)
            sharpen.setValue(0.32, forKey: kCIInputSharpnessKey)
            sharpen.setValue(0.35, forKey: kCIInputRadiusKey)
            output = sharpen.outputImage ?? output
        }
        return output
    }

    private struct RGB {
        let red: Double
        let green: Double
        let blue: Double
    }

    private func estimatedPaperRGB(in image: CIImage) -> RGB? {
        let maximumDimension = max(image.extent.width, image.extent.height)
        guard maximumDimension > 0 else { return nil }
        let scale = min(1, 160 / maximumDimension)
        let normalized = image.transformed(
            by: CGAffineTransform(
                translationX: -image.extent.minX,
                y: -image.extent.minY
            )
        )
        let sample = normalized.transformed(
            by: CGAffineTransform(scaleX: scale, y: scale)
        )
        let bounds = sample.extent.integral
        let width = max(1, Int(bounds.width))
        let height = max(1, Int(bounds.height))
        var pixels = [UInt8](repeating: 0, count: width * height * 4)
        context.render(
            sample,
            toBitmap: &pixels,
            rowBytes: width * 4,
            bounds: bounds,
            format: .RGBA8,
            colorSpace: sRGB
        )

        var samples: [RGB] = []
        var luminances: [Double] = []
        samples.reserveCapacity(width * height)
        luminances.reserveCapacity(width * height)
        for offset in stride(from: 0, to: pixels.count, by: 4) {
            guard pixels[offset + 3] > 0 else { continue }
            let value = RGB(
                red: Double(pixels[offset]) / 255,
                green: Double(pixels[offset + 1]) / 255,
                blue: Double(pixels[offset + 2]) / 255
            )
            samples.append(value)
            luminances.append(
                0.2126 * value.red
                    + 0.7152 * value.green
                    + 0.0722 * value.blue
            )
        }
        guard !samples.isEmpty else { return nil }
        let sortedLuminances = luminances.sorted()
        let paperThreshold = sortedLuminances[
            min(sortedLuminances.count - 1, sortedLuminances.count * 7 / 10)
        ]
        var red: [Double] = []
        var green: [Double] = []
        var blue: [Double] = []
        for (index, value) in samples.enumerated() {
            let spread = max(value.red, value.green, value.blue)
                - min(value.red, value.green, value.blue)
            guard luminances[index] >= paperThreshold, spread <= 0.18 else {
                continue
            }
            red.append(value.red)
            green.append(value.green)
            blue.append(value.blue)
        }
        guard red.count >= 16 else { return nil }

        func median(_ values: [Double]) -> Double {
            let sorted = values.sorted()
            return sorted[sorted.count / 2]
        }
        return RGB(
            red: median(red),
            green: median(green),
            blue: median(blue)
        )
    }

    private func estimatedPaperBackground(in image: CIImage) -> CIImage? {
        let extent = image.extent
        let shortEdge = min(extent.width, extent.height)
        guard shortEdge > 0 else { return nil }
        let analysisScale = min(1, 512 / shortEdge)
        let normalized = image.transformed(
            by: CGAffineTransform(
                translationX: -extent.minX,
                y: -extent.minY
            )
        )
        var background = normalized.transformed(
            by: CGAffineTransform(
                scaleX: analysisScale,
                y: analysisScale
            )
        )
        let analysisExtent = background.extent

        if let luminance = CIFilter(name: "CIColorControls") {
            luminance.setValue(background, forKey: kCIInputImageKey)
            luminance.setValue(0.0, forKey: kCIInputSaturationKey)
            luminance.setValue(0.0, forKey: kCIInputBrightnessKey)
            luminance.setValue(1.0, forKey: kCIInputContrastKey)
            background = luminance.outputImage ?? background
        }
        if let maximum = CIFilter(name: "CIMorphologyMaximum") {
            maximum.setValue(background, forKey: kCIInputImageKey)
            maximum.setValue(2.5, forKey: kCIInputRadiusKey)
            background = maximum.outputImage ?? background
        }
        if let blur = CIFilter(name: "CIGaussianBlur") {
            blur.setValue(background, forKey: kCIInputImageKey)
            blur.setValue(18.0, forKey: kCIInputRadiusKey)
            background = blur.outputImage ?? background
        }

        background = background
            .cropped(to: analysisExtent)
            .transformed(
                by: CGAffineTransform(
                    scaleX: 1 / analysisScale,
                    y: 1 / analysisScale
                )
            )
            .cropped(
                to: CGRect(
                    x: 0,
                    y: 0,
                    width: extent.width,
                    height: extent.height
                )
            )
            .transformed(
                by: CGAffineTransform(
                    translationX: extent.minX,
                    y: extent.minY
                )
            )
        return background
    }

    private func applyingConservativeWhiteBalance(
        to image: CIImage,
        paperColor: RGB
    ) -> CIImage {
        let neutral = (paperColor.red + paperColor.green + paperColor.blue) / 3
        func channelScale(_ value: Double) -> Double {
            min(1.06, max(0.94, neutral / max(0.01, value)))
        }
        guard let filter = CIFilter(name: "CIColorMatrix") else { return image }
        filter.setValue(image, forKey: kCIInputImageKey)
        filter.setValue(
            CIVector(x: channelScale(paperColor.red), y: 0, z: 0, w: 0),
            forKey: "inputRVector"
        )
        filter.setValue(
            CIVector(x: 0, y: channelScale(paperColor.green), z: 0, w: 0),
            forKey: "inputGVector"
        )
        filter.setValue(
            CIVector(x: 0, y: 0, z: channelScale(paperColor.blue), w: 0),
            forKey: "inputBVector"
        )
        filter.setValue(CIVector(x: 0, y: 0, z: 0, w: 1), forKey: "inputAVector")
        return filter.outputImage ?? image
    }

    private func render(_ image: CIImage, to url: URL) throws {
        guard
            let data = context.jpegRepresentation(
                of: image,
                colorSpace: sRGB,
                options: [kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption: 0.94]
            )
        else {
            throw ProcessorError.renderFailed
        }
        try data.write(to: url, options: .atomic)
    }

    private func recognizeText(in image: CIImage) -> [TextLine] {
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.automaticallyDetectsLanguage = false
        request.recognitionLanguages = ["zh-Hans"]
        request.usesLanguageCorrection = true
        request.minimumTextHeight = 0.004

        let handler = VNImageRequestHandler(ciImage: image, options: [:])
        do {
            try handler.perform([request])
        } catch {
            return []
        }

        return (request.results ?? []).compactMap { observation in
            guard let candidate = observation.topCandidates(1).first else { return nil }
            let box = observation.boundingBox
            return TextLine(
                id: UUID().uuidString,
                text: candidate.string,
                confidence: Double(candidate.confidence),
                rect: NormalizedRect(
                    x: box.minX,
                    y: 1 - box.maxY,
                    width: box.width,
                    height: box.height
                )
            )
        }
        .sorted {
            if abs($0.rect.y - $1.rect.y) < 0.012 {
                return $0.rect.x < $1.rect.x
            }
            return $0.rect.y < $1.rect.y
        }
    }

    private func generateProblemBlocks(from lines: [TextLine]) -> [ProblemBlock] {
        guard !lines.isEmpty else { return [] }
        let sorted = lines.sorted { $0.rect.y < $1.rect.y }
        let anchors = questionAnchors(in: sorted)
        guard !anchors.isEmpty else {
            return blocksFromVerticalGaps(sorted)
        }

        var blocks: [ProblemBlock] = []
        for (index, anchor) in anchors.enumerated() {
            let startY = max(0.008, anchor.line.rect.y - 0.006)
            let endY: Double
            if index + 1 < anchors.count {
                // The next top-level question is the strongest possible end
                // marker. Keep everything before it, including D options,
                // tables and diagrams that Vision does not recognize as text.
                endY = max(startY + 0.035, anchors[index + 1].line.rect.y - 0.006)
            } else {
                let lastContentY = sorted
                    .filter { $0.rect.y >= startY }
                    .map(\.rect.maxY)
                    .max() ?? anchor.line.rect.maxY
                endY = min(0.988, max(startY + 0.08, lastContentY + 0.018))
            }

            let members = sorted.filter {
                $0.rect.maxY >= startY && $0.rect.y < endY
            }
            let rect = NormalizedRect(
                x: 0.018,
                y: startY,
                width: 0.964,
                height: endY - startY
            )
            blocks.append(
                makeBlock(
                    lines: members,
                    rect: rect,
                    preferredTitle: questionTitle(
                        number: anchor.number,
                        anchor: anchor.line,
                        members: members
                    )
                )
            )
        }
        return blocks
    }

    private func questionAnchors(in lines: [TextLine]) -> [QuestionAnchor] {
        let candidates = lines.compactMap { line -> QuestionAnchor? in
            guard line.rect.x < 0.24, let number = questionNumber(in: line.text) else {
                return nil
            }
            return QuestionAnchor(number: number, line: line)
        }
        .sorted { $0.line.rect.y < $1.line.rect.y }

        guard candidates.count > 1 else { return candidates }

        // Chapter numbers, page numbers and numerical expressions can also
        // begin a line. The longest consecutive run identifies real question
        // numbering while discarding those isolated numbers.
        var best: [QuestionAnchor] = []
        var current: [QuestionAnchor] = []
        for candidate in candidates {
            if let previous = current.last,
               candidate.number > previous.number,
               candidate.number <= previous.number + 2,
               candidate.line.rect.y > previous.line.rect.y + 0.018 {
                current.append(candidate)
            } else {
                if current.count > best.count { best = current }
                current = [candidate]
            }
        }
        if current.count > best.count { best = current }
        let sequence = best.count >= 2 ? best : candidates
        guard sequence.count >= 2 else { return sequence }

        var repaired: [QuestionAnchor] = []
        for (index, anchor) in sequence.enumerated() {
            repaired.append(anchor)
            guard index + 1 < sequence.count else { continue }
            let next = sequence[index + 1]
            guard next.number == anchor.number + 2 else { continue }

            let midpoint = (anchor.line.rect.y + next.line.rect.y) / 2
            let possibleLines = lines.filter { line in
                line.rect.x < 0.11
                    && line.rect.y > anchor.line.rect.y + 0.018
                    && line.rect.y < next.line.rect.y - 0.018
            }
            let inferredLine = possibleLines.min { left, right in
                abs(left.rect.y - midpoint) < abs(right.rect.y - midpoint)
            }
            if let inferredLine {
                repaired.append(
                    QuestionAnchor(number: anchor.number + 1, line: inferredLine)
                )
            }
        }
        return repaired
    }

    private func questionTitle(
        number: Int,
        anchor: TextLine,
        members: [TextLine]
    ) -> String {
        let titleLines = members
            .filter { $0.rect.y < anchor.rect.y + 0.045 }
            .sorted {
                if abs($0.rect.y - $1.rect.y) < 0.012 {
                    return $0.rect.x < $1.rect.x
                }
                return $0.rect.y < $1.rect.y
            }
        let combined = titleLines.map(\.text).joined(separator: " ")
        var chinese = String(
            combined.unicodeScalars.compactMap { scalar -> Character? in
                let value = scalar.value
                if (0x3400...0x9FFF).contains(value) {
                    return Character(String(scalar))
                }
                if "，。？！：；、（）“”".unicodeScalars.contains(scalar) {
                    return Character(String(scalar))
                }
                return scalar == " " ? " " : nil
            }
        )
        chinese = chinese
            .replacingOccurrences(of: "万程", with: "方程")
            .replacingOccurrences(of: "昀解", with: "的解")
            .replacingOccurrences(of: "旳结果", with: "的结果")
            .replacingOccurrences(of: "一下列", with: "下列")
            .replacingOccurrences(of: "式子产", with: "式子")
            .replacingOccurrences(of: "這中", with: "中")
            .replacingOccurrences(of: "分式有", with: "分式的有")
        while chinese.contains("  ") {
            chinese = chinese.replacingOccurrences(of: "  ", with: " ")
        }
        chinese = chinese.trimmingCharacters(in: .whitespacesAndNewlines)

        if chinese.contains("则"), chinese.contains("的值是"),
           !chinese.hasPrefix("若") {
            chinese = "若……，则……的值是"
        }
        if chinese.contains("分式"), chinese.contains("值为"),
           chinese.contains("的值是") {
            chinese = "分式……的值为零时，未知数的值是"
        } else if chinese.contains("化简"), chinese.contains("结果是") {
            chinese = "化简……的结果是"
        } else if chinese.contains("解方程"), chinese.contains("去分母") {
            chinese = "解方程……时，去分母得"
        } else if chinese.contains("方程"), chinese.contains("的解为") {
            chinese = "方程……的解为"
        }
        if let firstIf = chinese.firstIndex(of: "若"), chinese[..<firstIf].count <= 4 {
            chinese = String(chinese[firstIf...])
        }
        guard chinese.count >= 2 else { return "第 \(number) 题" }
        return "\(number). \(chinese)"
    }

    private func blocksFromVerticalGaps(_ lines: [TextLine]) -> [ProblemBlock] {
        guard lines.count > 1 else {
            return [makeBlock(lines: lines, rect: NormalizedRect.union(lines.map(\.rect)).expanded(by: 0.02))]
        }

        let heights = lines.map(\.rect.height).sorted()
        let medianHeight = heights[heights.count / 2]
        let gapThreshold = max(0.035, medianHeight * 2.6)
        var groups: [[TextLine]] = []
        var current: [TextLine] = []
        var previousBottom = 0.0

        for line in lines {
            let gap = line.rect.y - previousBottom
            if !current.isEmpty && gap > gapThreshold {
                groups.append(current)
                current = []
            }
            current.append(line)
            previousBottom = max(previousBottom, line.rect.maxY)
        }
        if !current.isEmpty { groups.append(current) }

        if groups.count > 6 {
            return [makeBlock(lines: lines, rect: NormalizedRect.union(lines.map(\.rect)).expanded(by: 0.02))]
        }
        return groups.map {
            makeBlock(lines: $0, rect: NormalizedRect.union($0.map(\.rect)).expanded(by: 0.018))
        }
    }

    private func makeBlock(
        lines: [TextLine],
        rect: NormalizedRect,
        preferredTitle: String? = nil
    ) -> ProblemBlock {
        let firstText = preferredTitle?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            ?? lines.first?.text.trimmingCharacters(in: .whitespacesAndNewlines)
            ?? "未命名题目"
        let title = firstText.count > 36
            ? String(firstText.prefix(36)) + "…"
            : firstText
        let confidence = lines.isEmpty
            ? 0
            : lines.map(\.confidence).reduce(0, +) / Double(lines.count)
        return ProblemBlock(
            id: UUID().uuidString,
            title: title,
            rect: rect.clamped(),
            confidence: confidence,
            lineIds: lines.map(\.id),
            source: "auto"
        )
    }

    private func questionNumber(in text: String) -> Int? {
        // Top-level questions use an Arabic number followed by a full stop or
        // ideographic comma. Parenthesized subquestions and Chinese section
        // headings are deliberately excluded.
        let pattern = #"^\s*(\d{1,3})\s*[\.．、]"#
        guard let expression = try? NSRegularExpression(pattern: pattern) else {
            return nil
        }
        let range = NSRange(text.startIndex..<text.endIndex, in: text)
        guard
            let match = expression.firstMatch(in: text, range: range),
            let numberRange = Range(match.range(at: 1), in: text)
        else {
            return nil
        }
        return Int(text[numberRange])
    }
}

@main
private enum AxiomVisionCLI {
    static func main() {
        do {
            let arguments = CommandLine.arguments
            guard arguments.count >= 2 else {
                throw ProcessorError.invalidArguments
            }

            func value(after flag: String) -> String? {
                guard let index = arguments.firstIndex(of: flag), arguments.indices.contains(index + 1) else {
                    return nil
                }
                return arguments[index + 1]
            }

            let resultData: Data
            switch arguments[1] {
            case "process":
                guard
                    let input = value(after: "--input"),
                    let output = value(after: "--output")
                else {
                    throw ProcessorError.invalidArguments
                }
                let mode = value(after: "--mode") ?? "color"
                resultData = try JSONEncoder().encode(
                    DocumentProcessor().process(
                        inputPath: input,
                        outputPath: output,
                        mode: mode,
                        beforeOutputPath: value(after: "--before-output")
                    )
                )
            case "camera-orientation":
                guard let deviceLabel = value(after: "--device-label") else {
                    throw ProcessorError.invalidArguments
                }
                resultData = try JSONEncoder().encode(
                    cameraOrientation(deviceLabel: deviceLabel)
                )
            case "crop":
                guard
                    let input = value(after: "--input"),
                    let output = value(after: "--output"),
                    let xValue = value(after: "--x"),
                    let yValue = value(after: "--y"),
                    let widthValue = value(after: "--width"),
                    let heightValue = value(after: "--height"),
                    let x = Double(xValue),
                    let y = Double(yValue),
                    let width = Double(widthValue),
                    let height = Double(heightValue)
                else {
                    throw ProcessorError.invalidArguments
                }
                try DocumentProcessor().crop(
                    inputPath: input,
                    outputPath: output,
                    rect: NormalizedRect(
                        x: x,
                        y: y,
                        width: width,
                        height: height
                    )
                )
                resultData = try JSONEncoder().encode(["path": output])
            default:
                throw ProcessorError.invalidArguments
            }
            FileHandle.standardOutput.write(resultData)
            exit(0)
        } catch {
            let message = error.localizedDescription
            FileHandle.standardError.write(Data(message.utf8))
            exit(1)
        }
    }
}

```


### `app/src-tauri/src/ai.rs`

```rust
use std::{
    fs,
    io::{Read, Result as IoResult},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread,
    time::{Duration, Instant},
};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use reqwest::Url;
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
const MAX_RESPONSE_BYTES: usize = 2 * 1024 * 1024;
const MAX_IMAGE_BYTES: u64 = 30 * 1024 * 1024;
const MAX_IMAGE_TOTAL_BYTES: u64 = 60 * 1024 * 1024;
const MAX_IMAGE_COUNT: usize = 8;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenAICompatibleAnalysisRequest {
    base_url: String,
    model: String,
    api_key: String,
    crop_image_path: String,
    prompt: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AntigravityCLIAnalysisRequest {
    command_path: String,
    model: String,
    crop_image_path: Option<String>,
    #[serde(default)]
    image_paths: Vec<String>,
    prompt: String,
    json_schema: String,
}

fn endpoint_url(base_url: &str) -> Result<Url, String> {
    let trimmed = base_url.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Err("Base URL 不能为空".to_string());
    }
    let endpoint = if trimmed.ends_with("/chat/completions") {
        trimmed.to_string()
    } else {
        format!("{trimmed}/chat/completions")
    };
    let url = Url::parse(&endpoint).map_err(|error| format!("Base URL 无效：{error}"))?;
    if !url.username().is_empty() || url.password().is_some() || url.fragment().is_some() {
        return Err("Base URL 不能包含账号、密码或 fragment".to_string());
    }
    if url.scheme() != "https" {
        let local = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "::1"));
        if url.scheme() != "http" || !local {
            return Err("真实 API 必须使用 HTTPS；仅本机地址允许 HTTP".to_string());
        }
    }
    Ok(url)
}

fn managed_image_path(app: &AppHandle, image_path: &str) -> Result<PathBuf, String> {
    let path = Path::new(image_path)
        .canonicalize()
        .map_err(|error| format!("无法读取题目图片：{error}"))?;
    let media_root = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法定位应用数据目录：{error}"))?
        .join("media")
        .canonicalize()
        .map_err(|error| format!("无法读取 Axiom 图片目录：{error}"))?;
    if !path.starts_with(&media_root) {
        return Err("只允许发送 Axiom media 目录中的题目图片".to_string());
    }
    let metadata = fs::metadata(&path).map_err(|error| format!("无法读取题目图片：{error}"))?;
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > MAX_IMAGE_BYTES {
        return Err("题目图片为空或超过 30 MB".to_string());
    }
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if !matches!(extension.as_str(), "jpg" | "jpeg" | "png" | "webp") {
        return Err("真实 AI 请求仅支持 JPG、PNG 和 WebP".to_string());
    }
    let mut file = fs::File::open(&path).map_err(|error| format!("无法读取题目图片：{error}"))?;
    let mut header = [0_u8; 12];
    let read = file
        .read(&mut header)
        .map_err(|error| format!("无法校验题目图片：{error}"))?;
    let valid_signature = match extension.as_str() {
        "jpg" | "jpeg" => read >= 3 && header[..3] == [0xff, 0xd8, 0xff],
        "png" => read >= 8 && header[..8] == [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a],
        "webp" => read >= 12 && &header[..4] == b"RIFF" && &header[8..12] == b"WEBP",
        _ => false,
    };
    if !valid_signature {
        return Err("题目图片扩展名与文件内容不匹配".to_string());
    }
    Ok(path)
}

fn read_bounded<R: Read>(
    mut reader: R,
    limit: usize,
    exceeded: Arc<AtomicBool>,
) -> IoResult<Vec<u8>> {
    let mut output = Vec::with_capacity(limit.min(64 * 1024));
    let mut buffer = [0_u8; 16 * 1024];
    loop {
        let read = reader.read(&mut buffer)?;
        if read == 0 {
            return Ok(output);
        }
        let remaining = limit.saturating_sub(output.len());
        output.extend_from_slice(&buffer[..read.min(remaining)]);
        if read > remaining {
            exceeded.store(true, Ordering::Release);
        }
    }
}

fn image_data_url(app: &AppHandle, image_path: &str) -> Result<String, String> {
    let path = managed_image_path(app, image_path)?;
    let bytes = fs::read(&path).map_err(|error| format!("无法读取题目图片：{error}"))?;
    let mime = match path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "webp" => "image/webp",
        _ => return Err("真实 AI 请求仅支持 JPG、PNG 和 WebP".to_string()),
    };
    Ok(format!("data:{mime};base64,{}", STANDARD.encode(bytes)))
}

fn antigravity_command(command_path: &str) -> Result<PathBuf, String> {
    let trimmed = command_path.trim();
    if trimmed.is_empty() {
        return Err("Antigravity CLI 路径不能为空".to_string());
    }
    let candidate = Path::new(trimmed);
    if candidate.components().count() == 1 {
        return Ok(PathBuf::from(trimmed));
    }
    if !candidate.is_absolute() {
        return Err("Antigravity CLI 请填写命令名或绝对路径".to_string());
    }
    let resolved = candidate
        .canonicalize()
        .map_err(|error| format!("无法读取 Antigravity CLI：{error}"))?;
    if !resolved.is_file() {
        return Err("Antigravity CLI 路径不是文件".to_string());
    }
    Ok(resolved)
}

fn antigravity_response(body: &str) -> Result<String, String> {
    let envelope: Value =
        serde_json::from_str(body).map_err(|error| format!("CLI 输出封套不是 JSON：{error}"))?;
    if envelope.get("status").and_then(Value::as_str) != Some("SUCCESS") {
        return Err(envelope
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("Agent 执行失败")
            .to_string());
    }
    if let Some(structured) = envelope.get("structured_output") {
        if !structured.is_null() {
            return serde_json::to_string(structured)
                .map_err(|error| format!("无法读取 CLI 结构化输出：{error}"));
        }
    }
    envelope
        .get("response")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| "CLI 输出封套缺少 response".to_string())
}

fn response_content(response: &Value) -> Result<String, String> {
    let content = response
        .pointer("/choices/0/message/content")
        .ok_or_else(|| "API 响应缺少 choices[0].message.content".to_string())?;
    if let Some(text) = content.as_str() {
        return Ok(text.to_string());
    }
    if let Some(parts) = content.as_array() {
        let text = parts
            .iter()
            .filter_map(|part| part.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join("");
        if !text.is_empty() {
            return Ok(text);
        }
    }
    Err("API 返回了不支持的消息内容格式".to_string())
}

fn provider_error_message(body: &str) -> String {
    if let Ok(value) = serde_json::from_str::<Value>(body) {
        if let Some(message) = value
            .pointer("/error/message")
            .or_else(|| value.get("message"))
            .and_then(Value::as_str)
        {
            return message.trim().to_string();
        }
    }
    body.trim().chars().take(1200).collect()
}

fn is_vision_unsupported(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    [
        "does not support image",
        "doesn't support image",
        "image input is not supported",
        "image inputs are not supported",
        "vision is not supported",
        "text-only model",
        "not a multimodal",
        "不支持图片",
        "不支持图像",
        "纯文本模型",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
}

#[tauri::command]
pub async fn analyze_problem_with_openai_compatible(
    app: AppHandle,
    request: OpenAICompatibleAnalysisRequest,
) -> Result<Value, String> {
    let endpoint = endpoint_url(&request.base_url)?;
    let model = request.model.trim();
    if model.is_empty() {
        return Err("Model 不能为空".to_string());
    }
    let api_key = request.api_key.trim();
    if api_key.is_empty() {
        return Err("API Key 不能为空".to_string());
    }
    let prompt = request.prompt.trim();
    if prompt.is_empty() {
        return Err("分析 Prompt 不能为空".to_string());
    }
    let image_url = image_data_url(&app, &request.crop_image_path)?;
    let body = json!({
        "model": model,
        "temperature": 0.1,
        "response_format": { "type": "json_object" },
        "messages": [
            {
                "role": "system",
                "content": prompt
            },
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": "请根据图片生成题目结构化信息和可浏览标题。"
                    },
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": image_url,
                            "detail": "high"
                        }
                    }
                ]
            }
        ]
    });

    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(90))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| format!("无法初始化 API 客户端：{error}"))?;
    let response = client
        .post(endpoint)
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .await
        .map_err(|error| format!("AI API 请求失败：{error}"))?;
    let status = response.status();
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("无法读取 AI API 响应：{error}"))?;
    if bytes.len() > MAX_RESPONSE_BYTES {
        return Err("AI API 响应超过 2 MB".to_string());
    }
    let response_text = String::from_utf8_lossy(&bytes);
    if !status.is_success() {
        let provider_message = provider_error_message(&response_text);
        let error_message = if is_vision_unsupported(&provider_message) {
            format!(
                "当前模型不支持图片输入，请选择视觉模型。HTTP {}：{}",
                status.as_u16(),
                provider_message
            )
        } else {
            format!(
                "AI API 请求失败（HTTP {}）：{}",
                status.as_u16(),
                if provider_message.is_empty() {
                    "Provider 未返回错误详情"
                } else {
                    &provider_message
                }
            )
        };
        return Ok(json!({
            "rawOutput": response_text,
            "errorMessage": error_message
        }));
    }
    let response_json: Value = match serde_json::from_slice(&bytes) {
        Ok(value) => value,
        Err(error) => {
            return Ok(json!({
                "rawOutput": response_text,
                "errorMessage": format!("AI API 响应不是 JSON：{error}")
            }));
        }
    };
    let content = match response_content(&response_json) {
        Ok(value) => value,
        Err(error) => {
            return Ok(json!({
                "rawOutput": response_text,
                "errorMessage": error
            }));
        }
    };
    if is_vision_unsupported(&content) {
        return Ok(json!({
            "rawOutput": content,
            "errorMessage": "当前模型不支持图片输入，请选择视觉模型。"
        }));
    }
    Ok(json!({
        "rawOutput": content,
        "errorMessage": null
    }))
}

#[tauri::command]
pub async fn analyze_problem_with_antigravity_cli(
    app: AppHandle,
    request: AntigravityCLIAnalysisRequest,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        analyze_problem_with_antigravity_cli_blocking(app, request)
    })
    .await
    .map_err(|error| format!("Antigravity CLI 后台任务异常：{error}"))?
}

fn analyze_problem_with_antigravity_cli_blocking(
    app: AppHandle,
    request: AntigravityCLIAnalysisRequest,
) -> Result<Value, String> {
    let command_path = antigravity_command(&request.command_path)?;
    let model = request.model.trim();
    if model.is_empty() {
        return Err("Model 不能为空".to_string());
    }
    let prompt = request.prompt.trim();
    if prompt.is_empty() {
        return Err("分析 Prompt 不能为空".to_string());
    }
    let schema = request.json_schema.trim();
    if schema.is_empty() {
        return Err("JSON Schema 不能为空".to_string());
    }
    serde_json::from_str::<Value>(schema).map_err(|error| format!("JSON Schema 无效：{error}"))?;

    let mut requested_paths = request.image_paths;
    if let Some(crop_image_path) = request.crop_image_path {
        requested_paths.insert(0, crop_image_path);
    }
    requested_paths.retain(|path| !path.trim().is_empty());
    if requested_paths.is_empty() {
        return Err("至少需要一张题目图片".to_string());
    }
    if requested_paths.len() > MAX_IMAGE_COUNT * 4 {
        return Err("单次 AI 请求包含过多重复图片路径".to_string());
    }
    let mut image_paths = Vec::with_capacity(requested_paths.len());
    let mut total_image_bytes = 0_u64;
    for requested_path in requested_paths {
        let path = managed_image_path(&app, &requested_path)?;
        if image_paths.contains(&path) {
            continue;
        }
        if image_paths.len() >= MAX_IMAGE_COUNT {
            return Err(format!("单次 AI 请求最多支持 {MAX_IMAGE_COUNT} 张图片"));
        }
        total_image_bytes = total_image_bytes.saturating_add(
            fs::metadata(&path)
                .map_err(|error| format!("无法读取题目图片：{error}"))?
                .len(),
        );
        if total_image_bytes > MAX_IMAGE_TOTAL_BYTES {
            return Err("单次 AI 请求的图片总大小不能超过 60 MB".to_string());
        }
        image_paths.push(path);
    }
    let mut image_parents = Vec::new();
    for parent in image_paths.iter().filter_map(|path| path.parent()) {
        if !image_parents.contains(&parent) {
            image_parents.push(parent);
        }
    }
    let image_prompt = image_paths
        .iter()
        .map(|path| format!("@{}", path.to_string_lossy()))
        .collect::<Vec<_>>()
        .join(" ");
    let full_prompt =
        format!("{prompt}\n\n请使用视觉能力直接读取并分析这些本地题目图片：{image_prompt}");

    let mut command = Command::new(&command_path);
    command
        .arg("--print-timeout")
        .arg("100s")
        .arg("--model")
        .arg(model)
        .arg("--output-format")
        .arg("json")
        .arg("--json-schema")
        .arg(schema);
    for parent in image_parents {
        command.arg("--add-dir").arg(parent);
    }
    let mut child = command
        .arg("--print")
        .arg(full_prompt)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("无法启动 Antigravity CLI：{error}"))?;

    let mut stdout = child
        .stdout
        .take()
        .ok_or_else(|| "无法读取 Antigravity CLI 输出".to_string())?;
    let mut stderr = child
        .stderr
        .take()
        .ok_or_else(|| "无法读取 Antigravity CLI 日志".to_string())?;
    let stdout_exceeded = Arc::new(AtomicBool::new(false));
    let stderr_exceeded = Arc::new(AtomicBool::new(false));
    let stdout_limit = Arc::clone(&stdout_exceeded);
    let stderr_limit = Arc::clone(&stderr_exceeded);
    let stdout_reader =
        thread::spawn(move || read_bounded(&mut stdout, MAX_RESPONSE_BYTES, stdout_limit));
    let stderr_reader =
        thread::spawn(move || read_bounded(&mut stderr, MAX_RESPONSE_BYTES, stderr_limit));

    let started_at = Instant::now();
    let mut timed_out = false;
    let mut oversized = false;
    let status = loop {
        if stdout_exceeded.load(Ordering::Acquire) || stderr_exceeded.load(Ordering::Acquire) {
            oversized = true;
            let _ = child.kill();
            let _ = child.wait();
            break None;
        }
        if started_at.elapsed() >= Duration::from_secs(120) {
            timed_out = true;
            let _ = child.kill();
            let _ = child.wait();
            break None;
        }
        match child
            .try_wait()
            .map_err(|error| format!("等待 Antigravity CLI 失败：{error}"))?
        {
            Some(status) => break Some(status),
            None => thread::sleep(Duration::from_millis(25)),
        }
    };
    let stdout = stdout_reader
        .join()
        .map_err(|_| "读取 Antigravity CLI 输出失败".to_string())?
        .map_err(|error| format!("读取 Antigravity CLI 输出失败：{error}"))?;
    let stderr = stderr_reader
        .join()
        .map_err(|_| "读取 Antigravity CLI 日志失败".to_string())?
        .map_err(|error| format!("读取 Antigravity CLI 日志失败：{error}"))?;
    if oversized {
        return Ok(json!({
            "rawOutput": String::from_utf8_lossy(&stdout),
            "errorMessage": "Antigravity CLI 输出或日志超过 2 MB，已终止"
        }));
    }
    if timed_out {
        return Ok(json!({
            "rawOutput": String::from_utf8_lossy(&stdout),
            "errorMessage": "Antigravity CLI 超过 120 秒，已终止"
        }));
    }
    let status = status.ok_or_else(|| "Antigravity CLI 未返回退出状态".to_string())?;
    let envelope_output = String::from_utf8_lossy(&stdout).trim().to_string();
    let stderr_text = String::from_utf8_lossy(&stderr);
    if !status.success() {
        let details: String = stderr_text.trim().chars().take(1200).collect();
        let cli_error = antigravity_response(&envelope_output)
            .err()
            .unwrap_or_else(|| "Agent 执行失败".to_string());
        let details_suffix = if details.is_empty() {
            String::new()
        } else {
            format!("；{details}")
        };
        return Ok(json!({
            "rawOutput": envelope_output,
            "errorMessage": format!(
                "Antigravity CLI 调用失败（退出码 {}）：{}{}",
                status.code().map_or_else(|| "未知".to_string(), |code| code.to_string()),
                cli_error,
                details_suffix
            )
        }));
    }
    let raw_output = match antigravity_response(&envelope_output) {
        Ok(response) => response.trim().to_string(),
        Err(error) => {
            return Ok(json!({
                "rawOutput": envelope_output,
                "errorMessage": format!("无法解析 Antigravity CLI 输出：{error}")
            }));
        }
    };
    if raw_output.is_empty() {
        return Ok(json!({
            "rawOutput": "",
            "errorMessage": "Antigravity CLI 未返回内容"
        }));
    }
    if is_vision_unsupported(&raw_output) {
        return Ok(json!({
            "rawOutput": raw_output,
            "errorMessage": "当前 Antigravity 模型不支持图片输入，请选择视觉模型。"
        }));
    }
    Ok(json!({
        "rawOutput": raw_output,
        "errorMessage": null
    }))
}

#[cfg(test)]
mod tests {
    use super::{
        antigravity_command, antigravity_response, endpoint_url, is_vision_unsupported,
        provider_error_message, read_bounded,
    };
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    };

    #[test]
    fn builds_compatible_chat_completion_endpoint() {
        assert_eq!(
            endpoint_url("https://example.com/v1").unwrap().as_str(),
            "https://example.com/v1/chat/completions"
        );
        assert!(endpoint_url("http://example.com/v1").is_err());
        assert!(endpoint_url("http://127.0.0.1:1234/v1").is_ok());
    }

    #[test]
    fn extracts_provider_error_and_detects_text_only_models() {
        let message = provider_error_message(
            r#"{"error":{"message":"This model does not support image inputs"}}"#,
        );
        assert_eq!(message, "This model does not support image inputs");
        assert!(is_vision_unsupported(&message));
        assert!(!is_vision_unsupported("rate limit exceeded"));
    }

    #[test]
    fn validates_antigravity_command_configuration() {
        assert_eq!(
            antigravity_command("agy").unwrap(),
            std::path::PathBuf::from("agy")
        );
        assert!(antigravity_command("").is_err());
        assert!(antigravity_command("./agy").is_err());
    }

    #[test]
    fn extracts_antigravity_json_envelope_response() {
        assert_eq!(
            antigravity_response(r#"{"status":"SUCCESS","response":"{\"title\":\"代数\"}\n"}"#)
                .unwrap(),
            "{\"title\":\"代数\"}\n"
        );
        assert_eq!(
            antigravity_response(
                r#"{"status":"SUCCESS","response":"ignored","structured_output":{"ok":true}}"#
            )
            .unwrap(),
            r#"{"ok":true}"#
        );
        assert!(
            antigravity_response(r#"{"status":"ERROR","response":"","error":"model failed"}"#)
                .unwrap_err()
                .contains("model failed")
        );
    }

    #[test]
    fn bounds_cli_output_while_continuing_to_drain_the_stream() {
        let exceeded = Arc::new(AtomicBool::new(false));
        let output = read_bounded(
            std::io::Cursor::new(vec![b'x'; 128]),
            32,
            Arc::clone(&exceeded),
        )
        .unwrap();
        assert_eq!(output.len(), 32);
        assert!(exceeded.load(Ordering::Acquire));
    }
}

```


### `app/src-tauri/src/commands.rs`

```rust
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::Duration,
    time::Instant,
    time::{SystemTime, UNIX_EPOCH},
};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};
use uuid::Uuid;
use wait_timeout::ChildExt;

use crate::models::{
    CameraOrientationInfo, DocumentProcessingResult, NativeCapabilities, NormalizedRect,
    PersistedMedia, PersistedProblemImage,
};

const MAX_IMAGE_BYTES: usize = 30 * 1024 * 1024;
const ALLOWED_EXTENSIONS: &[&str] = &["jpg", "jpeg", "png", "webp"];

fn now_millis() -> Result<i64, String> {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("系统时间不可用：{error}"))?;
    i64::try_from(duration.as_millis()).map_err(|_| "系统时间超出范围".to_string())
}

fn media_directory(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法定位应用数据目录：{error}"))?
        .join("media")
        .join("original");
    fs::create_dir_all(&directory).map_err(|error| format!("无法创建图片目录：{error}"))?;
    Ok(directory)
}

fn corrected_media_directory(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法定位应用数据目录：{error}"))?
        .join("media")
        .join("corrected");
    fs::create_dir_all(&directory).map_err(|error| format!("无法创建矫正图片目录：{error}"))?;
    Ok(directory)
}

fn problem_media_directory(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法定位应用数据目录：{error}"))?
        .join("media")
        .join("problems");
    fs::create_dir_all(&directory).map_err(|error| format!("无法创建题块图片目录：{error}"))?;
    Ok(directory)
}

fn diagram_media_directory(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法定位应用数据目录：{error}"))?
        .join("media")
        .join("diagrams");
    fs::create_dir_all(&directory).map_err(|error| format!("无法创建图形图片目录：{error}"))?;
    Ok(directory)
}

fn versioned_problem_image_name(problem_id: &str) -> String {
    format!("{problem_id}-{}.jpg", Uuid::new_v4())
}

fn versioned_diagram_image_name(problem_id: &str) -> String {
    format!("{problem_id}-diagram-{}.jpg", Uuid::new_v4())
}

/// 校验 problem_id 是否可作为输出文件名前缀。
///
/// `problem_id` 仅用作输出文件名前缀（与随机 UUID 拼接），
/// 不需要是合法 UUID；前端会传入形如 `<uuid>-answer`、`<uuid>-diagram-<region_id>`
/// 的复合标识符。但为防止目录穿越和非法字符，仍需做路径安全校验。
fn sanitize_problem_id(problem_id: &str) -> Result<String, String> {
    if problem_id.is_empty()
        || problem_id.contains('/')
        || problem_id.contains('\\')
        || problem_id.contains("..")
        || problem_id.contains('\0')
        || problem_id.contains(|c: char| c.is_control())
    {
        return Err("题目 ID 无效".to_string());
    }
    Ok(problem_id.to_string())
}

fn validate_normalized_rect(rect: &NormalizedRect) -> Result<(), String> {
    let values = [rect.x, rect.y, rect.width, rect.height];
    if values.iter().any(|value| !value.is_finite()) {
        return Err("题块裁剪区域包含无效数值".to_string());
    }
    if rect.x < 0.0 || rect.y < 0.0 || rect.width <= 0.0 || rect.height <= 0.0 {
        return Err("题块裁剪区域无效".to_string());
    }
    let max_x = rect.x + rect.width;
    let max_y = rect.y + rect.height;
    if max_x > 1.000_001 || max_y > 1.000_001 {
        return Err("题块裁剪区域超出页面范围".to_string());
    }
    Ok(())
}

#[cfg(all(target_os = "macos", debug_assertions))]
fn vision_helper_path(_app: &AppHandle) -> Result<PathBuf, String> {
    Ok(PathBuf::from(env!("AXIOM_VISION_HELPER")))
}

#[cfg(all(target_os = "macos", not(debug_assertions)))]
fn vision_helper_path(_app: &AppHandle) -> Result<PathBuf, String> {
    let executable =
        std::env::current_exe().map_err(|error| format!("无法定位应用程序：{error}"))?;
    executable
        .parent()
        .map(|path| path.join("axiom-vision"))
        .ok_or_else(|| "无法定位图像处理器".to_string())
}

fn persist_bytes(
    app: &AppHandle,
    bytes: &[u8],
    extension: &str,
    source_type: &str,
) -> Result<PersistedMedia, String> {
    if bytes.is_empty() {
        return Err("图片内容为空".to_string());
    }
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err("单张图片不能超过 30 MB".to_string());
    }

    let extension = extension.to_ascii_lowercase();
    if !ALLOWED_EXTENSIONS.contains(&extension.as_str()) {
        return Err("仅支持 JPG、PNG 和 WebP 图片".to_string());
    }

    let id = Uuid::new_v4().to_string();
    let content_hash = format!("{:x}", Sha256::digest(bytes));
    let path = media_directory(app)?.join(format!("{id}.{extension}"));
    fs::write(&path, bytes).map_err(|error| format!("保存图片失败：{error}"))?;

    Ok(PersistedMedia {
        id,
        path: path.to_string_lossy().to_string(),
        content_hash,
        byte_length: bytes.len() as u64,
        source_type: source_type.to_string(),
        captured_at: now_millis()?,
    })
}

#[tauri::command]
pub fn platform_capabilities(app: AppHandle) -> Result<NativeCapabilities, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法定位应用数据目录：{error}"))?;

    Ok(NativeCapabilities {
        platform: std::env::consts::OS.to_string(),
        architecture: std::env::consts::ARCH.to_string(),
        camera_backend: "webkit-media-devices".to_string(),
        minimum_macos_version: "13.0".to_string(),
        app_data_dir: app_data_dir.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub fn import_image(app: AppHandle, source_path: String) -> Result<PersistedMedia, String> {
    let source = Path::new(&source_path);
    let extension = source
        .extension()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "图片没有可识别的扩展名".to_string())?
        .to_ascii_lowercase();
    if !ALLOWED_EXTENSIONS.contains(&extension.as_str()) {
        return Err("仅支持 JPG、PNG 和 WebP 图片".to_string());
    }

    let metadata = fs::metadata(source).map_err(|error| format!("无法读取所选图片：{error}"))?;
    if metadata.len() > MAX_IMAGE_BYTES as u64 {
        return Err("单张图片不能超过 30 MB".to_string());
    }

    let bytes = fs::read(source).map_err(|error| format!("无法读取所选图片：{error}"))?;
    persist_bytes(&app, &bytes, &extension, "import")
}

#[tauri::command]
pub fn persist_camera_frame(app: AppHandle, data_url: String) -> Result<PersistedMedia, String> {
    let encoded = data_url
        .strip_prefix("data:image/jpeg;base64,")
        .ok_or_else(|| "相机帧格式无效".to_string())?;
    let bytes = STANDARD
        .decode(encoded)
        .map_err(|error| format!("无法解码相机帧：{error}"))?;
    persist_bytes(&app, &bytes, "jpg", "camera")
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn camera_orientation(
    app: AppHandle,
    device_label: String,
) -> Result<CameraOrientationInfo, String> {
    let helper = vision_helper_path(&app)?;
    if !helper.is_file() {
        return Err("本地相机方向检测器尚未构建".to_string());
    }
    let output = Command::new(helper)
        .arg("camera-orientation")
        .arg("--device-label")
        .arg(device_label)
        .output()
        .map_err(|error| format!("无法读取相机方向：{error}"))?;
    if !output.status.success() {
        return Err(format!(
            "相机方向检测失败：{}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    serde_json::from_slice(&output.stdout).map_err(|error| format!("无法解析相机方向：{error}"))
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub fn camera_orientation(
    _app: AppHandle,
    _device_label: String,
) -> Result<CameraOrientationInfo, String> {
    Err("相机方向检测目前仅支持 macOS".to_string())
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn process_document(
    app: AppHandle,
    source_document_id: String,
    source_path: String,
    mode: String,
) -> Result<DocumentProcessingResult, String> {
    if mode != "color" && mode != "grayscale" {
        return Err("未知的色彩优化模式".to_string());
    }

    let input = Path::new(&source_path)
        .canonicalize()
        .map_err(|error| format!("无法读取原图：{error}"))?;
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法定位应用数据目录：{error}"))?
        .canonicalize()
        .map_err(|error| format!("无法读取应用数据目录：{error}"))?;
    if !input.starts_with(&app_data) {
        return Err("只允许处理已导入 Axiom 的图片".to_string());
    }

    let processing_run_id = Uuid::new_v4().to_string();
    let output_path = corrected_media_directory(&app)?
        .join(format!("{}-{}.jpg", source_document_id, processing_run_id));
    let helper = vision_helper_path(&app)?;
    if !helper.is_file() {
        return Err("本地图像处理器尚未构建".to_string());
    }

    let started = Instant::now();
    let mut child = Command::new(&helper)
        .arg("process")
        .arg("--input")
        .arg(&input)
        .arg("--output")
        .arg(&output_path)
        .arg("--mode")
        .arg(&mode)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("无法启动图像处理器：{error}"))?;

    let mut stdout = child
        .stdout
        .take()
        .ok_or_else(|| "无法读取处理结果".to_string())?;
    let mut stderr = child
        .stderr
        .take()
        .ok_or_else(|| "无法读取处理日志".to_string())?;
    let stdout_reader = thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = stdout.read_to_end(&mut bytes);
        bytes
    });
    let stderr_reader = thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = stderr.read_to_end(&mut bytes);
        bytes
    });

    let status = match child
        .wait_timeout(Duration::from_secs(45))
        .map_err(|error| format!("等待图片处理失败：{error}"))?
    {
        Some(status) => status,
        None => {
            let _ = child.kill();
            let _ = child.wait();
            let _ = stdout_reader.join();
            let _ = stderr_reader.join();
            let _ = fs::remove_file(&output_path);
            return Err("图片处理超过 45 秒，请缩小图片或重试".to_string());
        }
    };
    let stdout = stdout_reader
        .join()
        .map_err(|_| "读取处理结果失败".to_string())?;
    let stderr = stderr_reader
        .join()
        .map_err(|_| "读取处理日志失败".to_string())?;

    if !status.success() {
        let _ = fs::remove_file(&output_path);
        let details = String::from_utf8_lossy(&stderr);
        return Err(format!("图片处理失败：{details}"));
    }

    let mut result: DocumentProcessingResult = serde_json::from_slice(&stdout)
        .map_err(|error| format!("无法解析图像处理结果：{error}"))?;
    result.processing_run_id = Some(processing_run_id);
    result.duration_ms = Some(started.elapsed().as_millis());
    Ok(result)
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub fn process_document(
    _app: AppHandle,
    _source_document_id: String,
    _source_path: String,
    _mode: String,
) -> Result<DocumentProcessingResult, String> {
    Err("图片矫正目前仅支持 macOS".to_string())
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn crop_problem_image(
    app: AppHandle,
    problem_id: String,
    source_path: String,
    rect: NormalizedRect,
) -> Result<PersistedProblemImage, String> {
    validate_normalized_rect(&rect)?;

    // problem_id 仅用作输出文件名前缀，不需要是合法 UUID；
    // 但仍需校验路径安全，防止目录穿越或非法字符。
    let safe_problem_id = sanitize_problem_id(&problem_id)?;
    let input = Path::new(&source_path)
        .canonicalize()
        .map_err(|error| format!("无法读取校正后的页面图片：{error}"))?;
    if !input.is_file() {
        return Err("校正后的页面图片不存在".to_string());
    }

    let corrected_directory = corrected_media_directory(&app)?
        .canonicalize()
        .map_err(|error| format!("无法读取校正图片目录：{error}"))?;
    if !input.starts_with(&corrected_directory) {
        return Err("只能从 Axiom 保存的校正页面生成题块图片".to_string());
    }

    let output_path =
        problem_media_directory(&app)?.join(versioned_problem_image_name(&safe_problem_id));

    let helper = vision_helper_path(&app)?;
    if !helper.is_file() {
        return Err("本地图像处理器尚未构建".to_string());
    }

    let mut child = Command::new(&helper)
        .arg("crop")
        .arg("--input")
        .arg(&input)
        .arg("--output")
        .arg(&output_path)
        .arg("--x")
        .arg(rect.x.to_string())
        .arg("--y")
        .arg(rect.y.to_string())
        .arg("--width")
        .arg(rect.width.to_string())
        .arg("--height")
        .arg(rect.height.to_string())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("无法启动题块裁剪器：{error}"))?;

    let mut stdout = child
        .stdout
        .take()
        .ok_or_else(|| "无法读取裁剪结果".to_string())?;
    let mut stderr = child
        .stderr
        .take()
        .ok_or_else(|| "无法读取裁剪日志".to_string())?;
    let stdout_reader = thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = stdout.read_to_end(&mut bytes);
        bytes
    });
    let stderr_reader = thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = stderr.read_to_end(&mut bytes);
        bytes
    });

    let status = match child
        .wait_timeout(Duration::from_secs(20))
        .map_err(|error| format!("等待题块裁剪失败：{error}"))?
    {
        Some(status) => status,
        None => {
            let _ = child.kill();
            let _ = child.wait();
            let _ = stdout_reader.join();
            let _ = stderr_reader.join();
            let _ = fs::remove_file(&output_path);
            return Err("题块裁剪超过 20 秒，请重试".to_string());
        }
    };
    let _ = stdout_reader.join();
    let stderr = stderr_reader
        .join()
        .map_err(|_| "读取裁剪日志失败".to_string())?;

    if !status.success() {
        let _ = fs::remove_file(&output_path);
        let details = String::from_utf8_lossy(&stderr);
        return Err(format!("题块图片生成失败：{details}"));
    }
    let metadata = fs::metadata(&output_path).map_err(|error| {
        let _ = fs::remove_file(&output_path);
        format!("题块图片写入失败：{error}")
    })?;
    if metadata.len() == 0 {
        let _ = fs::remove_file(&output_path);
        return Err("题块图片写入失败：生成的文件为空".to_string());
    }

    Ok(PersistedProblemImage {
        path: output_path.to_string_lossy().to_string(),
        created: true,
    })
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub fn crop_problem_image(
    _app: AppHandle,
    _problem_id: String,
    _source_path: String,
    _rect: NormalizedRect,
) -> Result<PersistedProblemImage, String> {
    Err("题块裁剪目前仅支持 macOS".to_string())
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn crop_problem_diagram(
    app: AppHandle,
    problem_id: String,
    source_path: String,
    rect: NormalizedRect,
) -> Result<PersistedProblemImage, String> {
    validate_normalized_rect(&rect)?;

    // problem_id 仅用作输出文件名前缀，不需要是合法 UUID；
    // 但仍需校验路径安全，防止目录穿越或非法字符。
    let safe_problem_id = sanitize_problem_id(&problem_id)?;
    let input = Path::new(&source_path)
        .canonicalize()
        .map_err(|error| format!("无法读取题块图片：{error}"))?;
    if !input.is_file() {
        return Err("题块图片不存在".to_string());
    }

    let problem_directory = problem_media_directory(&app)?
        .canonicalize()
        .map_err(|error| format!("无法读取题块图片目录：{error}"))?;
    if !input.starts_with(&problem_directory) {
        return Err("只能从 Axiom 保存的题块图片抠取图形".to_string());
    }

    let output_path =
        diagram_media_directory(&app)?.join(versioned_diagram_image_name(&safe_problem_id));
    let helper = vision_helper_path(&app)?;
    if !helper.is_file() {
        return Err("本地图像处理器尚未构建".to_string());
    }

    let mut child = Command::new(&helper)
        .arg("crop")
        .arg("--input")
        .arg(&input)
        .arg("--output")
        .arg(&output_path)
        .arg("--x")
        .arg(rect.x.to_string())
        .arg("--y")
        .arg(rect.y.to_string())
        .arg("--width")
        .arg(rect.width.to_string())
        .arg("--height")
        .arg(rect.height.to_string())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("无法启动图形裁剪器：{error}"))?;

    let mut stdout = child
        .stdout
        .take()
        .ok_or_else(|| "无法读取图形裁剪结果".to_string())?;
    let mut stderr = child
        .stderr
        .take()
        .ok_or_else(|| "无法读取图形裁剪日志".to_string())?;
    let stdout_reader = thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = stdout.read_to_end(&mut bytes);
        bytes
    });
    let stderr_reader = thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = stderr.read_to_end(&mut bytes);
        bytes
    });

    let status = match child
        .wait_timeout(Duration::from_secs(20))
        .map_err(|error| format!("等待图形裁剪失败：{error}"))?
    {
        Some(status) => status,
        None => {
            let _ = child.kill();
            let _ = child.wait();
            let _ = stdout_reader.join();
            let _ = stderr_reader.join();
            let _ = fs::remove_file(&output_path);
            return Err("图形裁剪超过 20 秒，请重试".to_string());
        }
    };
    let _ = stdout_reader.join();
    let stderr = stderr_reader
        .join()
        .map_err(|_| "读取图形裁剪日志失败".to_string())?;

    if !status.success() {
        let _ = fs::remove_file(&output_path);
        let details = String::from_utf8_lossy(&stderr);
        return Err(format!("图形图片生成失败：{details}"));
    }
    let metadata = fs::metadata(&output_path).map_err(|error| {
        let _ = fs::remove_file(&output_path);
        format!("图形图片写入失败：{error}")
    })?;
    if metadata.len() == 0 {
        let _ = fs::remove_file(&output_path);
        return Err("图形图片写入失败：生成的文件为空".to_string());
    }

    Ok(PersistedProblemImage {
        path: output_path.to_string_lossy().to_string(),
        created: true,
    })
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub fn crop_problem_diagram(
    _app: AppHandle,
    _problem_id: String,
    _source_path: String,
    _rect: NormalizedRect,
) -> Result<PersistedProblemImage, String> {
    Err("图形裁剪目前仅支持 macOS".to_string())
}

#[tauri::command]
pub fn remove_problem_image(app: AppHandle, path: String) -> Result<(), String> {
    let problem_directory = problem_media_directory(&app)?
        .canonicalize()
        .map_err(|error| format!("无法读取题块图片目录：{error}"))?;
    let candidate = Path::new(&path);
    let parent = candidate
        .parent()
        .ok_or_else(|| "题块图片路径无效".to_string())?
        .canonicalize()
        .map_err(|error| format!("无法验证题块图片路径：{error}"))?;
    if parent != problem_directory {
        return Err("只能清理 Axiom 管理的题块图片".to_string());
    }
    if candidate.exists() {
        fs::remove_file(candidate).map_err(|error| format!("清理题块图片失败：{error}"))?;
    }
    Ok(())
}

#[tauri::command]
pub fn remove_problem_diagram(app: AppHandle, path: String) -> Result<(), String> {
    let diagram_directory = diagram_media_directory(&app)?
        .canonicalize()
        .map_err(|error| format!("无法读取图形图片目录：{error}"))?;
    let candidate = Path::new(&path);
    let parent = candidate
        .parent()
        .ok_or_else(|| "图形图片路径无效".to_string())?
        .canonicalize()
        .map_err(|error| format!("无法验证图形图片路径：{error}"))?;
    if parent != diagram_directory {
        return Err("只能清理 Axiom 管理的图形图片".to_string());
    }
    if candidate.exists() {
        fs::remove_file(candidate).map_err(|error| format!("清理图形图片失败：{error}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        validate_normalized_rect, versioned_diagram_image_name, versioned_problem_image_name,
    };
    use crate::models::NormalizedRect;

    #[test]
    fn accepts_valid_normalized_crop() {
        assert!(validate_normalized_rect(&NormalizedRect {
            x: 0.1,
            y: 0.2,
            width: 0.8,
            height: 0.3,
        })
        .is_ok());
    }

    #[test]
    fn rejects_empty_and_out_of_bounds_crops() {
        assert!(validate_normalized_rect(&NormalizedRect {
            x: 0.1,
            y: 0.2,
            width: 0.0,
            height: 0.3,
        })
        .is_err());
        assert!(validate_normalized_rect(&NormalizedRect {
            x: 0.8,
            y: 0.2,
            width: 0.3,
            height: 0.3,
        })
        .is_err());
    }

    #[test]
    fn creates_a_new_versioned_path_for_each_problem_crop() {
        let problem_id = "fe8dfe78-8b90-4931-a15d-ecbc6f79ff65";
        let first = versioned_problem_image_name(problem_id);
        let second = versioned_problem_image_name(problem_id);
        assert!(first.starts_with(problem_id));
        assert!(first.ends_with(".jpg"));
        assert_ne!(first, second);
    }

    #[test]
    fn creates_a_scoped_versioned_path_for_each_diagram_crop() {
        let problem_id = "fe8dfe78-8b90-4931-a15d-ecbc6f79ff65";
        let first = versioned_diagram_image_name(problem_id);
        let second = versioned_diagram_image_name(problem_id);
        assert!(first.starts_with(&format!("{problem_id}-diagram-")));
        assert!(first.ends_with(".jpg"));
        assert_ne!(first, second);
    }
}

```


### `app/src-tauri/src/lib.rs`

```rust
mod ai;
mod commands;
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
            ai::analyze_problem_with_openai_compatible,
            ai::analyze_problem_with_antigravity_cli
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            // 让原生窗口跟随系统主题，由前端 ThemeProvider 同步控制
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_theme(None);
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

```


### `app/src-tauri/src/main.rs`

```rust
// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    axiom_lib::run();
}

```


### `app/src-tauri/src/models.rs`

```rust
use std::collections::HashMap;

use serde::{Deserialize, Serialize};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeCapabilities {
    pub platform: String,
    pub architecture: String,
    pub camera_backend: String,
    pub minimum_macos_version: String,
    pub app_data_dir: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedMedia {
    pub id: String,
    pub path: String,
    pub content_hash: String,
    pub byte_length: u64,
    pub source_type: String,
    pub captured_at: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedProblemImage {
    pub path: String,
    pub created: bool,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CameraOrientationInfo {
    pub device_name: String,
    pub is_continuity_camera: bool,
    pub preview_rotation_angle: f64,
    pub capture_rotation_angle: f64,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextLine {
    pub id: String,
    pub text: String,
    pub confidence: f64,
    pub rect: NormalizedRect,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProblemBlock {
    pub id: String,
    pub title: String,
    pub rect: NormalizedRect,
    pub confidence: f64,
    pub line_ids: Vec<String>,
    pub source: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentProcessingResult {
    pub processing_run_id: Option<String>,
    pub corrected_path: String,
    pub width: i64,
    pub height: i64,
    pub page_detected: bool,
    pub corners: HashMap<String, Point>,
    pub text_lines: Vec<TextLine>,
    pub blocks: Vec<ProblemBlock>,
    pub enhancement_mode: String,
    pub warnings: Vec<String>,
    pub duration_ms: Option<u128>,
}

```


### `icons/.DS_Store`

```
[二进制文件，已跳过内容]
```


### `icons/axiom-t-iOS-Default-1024@1x.png`

```
[二进制文件，已跳过内容]
```


### `icons/axiom_text.png`

```
[二进制文件，已跳过内容]
```


### `icons/axiom-t.icon/icon.json`

```json
{
  "fill" : "system-dark",
  "groups" : [
    {
      "layers" : [
        {
          "image-name" : "axiom_text.png",
          "name" : "axiom_text",
          "position" : {
            "scale" : 0.09,
            "translation-in-points" : [
              0,
              0
            ]
          }
        }
      ],
      "shadow" : {
        "kind" : "neutral",
        "opacity" : 0.5
      },
      "translucency" : {
        "enabled" : true,
        "value" : 0.3
      }
    }
  ],
  "supported-platforms" : {
    "circles" : [
      "watchOS"
    ],
    "squares" : "shared"
  }
}
```


### `icons/axiom-t.icon/Assets/axiom_text.png`

```
[二进制文件，已跳过内容]
```


### `test/.DS_Store`

```
[二进制文件，已跳过内容]
```


### `test/解答题_水印_几何图像处理.png`

```
[二进制文件，已跳过内容]
```


### `test/解答题_水印_左页边缘判断和裁切_函数图像、表格的处理.png`

```
[文件过大 (2277351 bytes)，已跳过内容]
```


### `test/选择题_水印_试卷多余表头和文本描述裁切_不完整题目处理.png`

```
[二进制文件，已跳过内容]
```
