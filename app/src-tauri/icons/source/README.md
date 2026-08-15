# Axiom App Icon sources

These are the untouched 1024×1024 source exports supplied for Axiom:

- `axiom-icon-light-1024.png` — light appearance source used by the in-app brand mark and current Tauri bundle.
- `axiom-icon-dark-1024.png` — dark appearance source used by the in-app brand mark.

The sidebar selects these sources from the resolved Axiom appearance, so the
brand mark follows either the system appearance or the user's explicit light /
dark choice.

The macOS Finder/Dock application icon remains a single static `.icns` asset:
Tauri's bundle configuration does not support changing the native application
icon when the webview appearance changes.

The current Tauri 2 `bundle.icon` configuration accepts one canonical macOS icon set and does not switch app icons with the application theme. Generate bundle assets directly from the light source with:

```sh
cd app
npm run tauri -- icon src-tauri/icons/source/axiom-icon-light-1024.png
```

Do not regenerate from one of the derived small PNG files.
