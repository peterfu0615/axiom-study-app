# Axiom App Icon sources

These are the canonical source exports supplied for Axiom:

- `axiom-icon-light-1024.png` — GR Default 1024×1024 source used to generate the Tauri bundle, Finder/Dock icon, and favicon.
- `axiom-icon-dark-1024.png` — GR Dark 1024×1024 source retained for future native appearance support.
- `axiom-wordmark.png` — transparent horizontal Axiom wordmark used only in the in-app Sidebar.

The Sidebar deliberately uses the same wordmark in light and dark appearances.
Do not import assets from the repository-level design-export directory at
runtime; production UI must reference these tracked canonical sources.

The macOS Finder/Dock application icon remains a single static `.icns` asset:
Tauri's bundle configuration does not support changing the native application
icon when the webview appearance changes.

The current Tauri 2 `bundle.icon` configuration accepts one canonical macOS icon set and does not switch app icons with the application theme. Generate bundle assets directly from the light source with:

```sh
cd app
npm run tauri -- icon src-tauri/icons/source/axiom-icon-light-1024.png
```

Do not regenerate from one of the derived small PNG files.
