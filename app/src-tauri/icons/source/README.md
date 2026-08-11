# Axiom App Icon sources

These are the untouched 1024×1024 source exports supplied for Axiom:

- `axiom-icon-light-1024.png` — canonical source used by the current Tauri bundle.
- `axiom-icon-dark-1024.png` — preserved source for a future platform pipeline that supports appearance-specific application icons.

The current Tauri 2 `bundle.icon` configuration accepts one canonical macOS icon set and does not switch app icons with the application theme. Generate bundle assets directly from the light source with:

```sh
cd app
npm run tauri -- icon src-tauri/icons/source/axiom-icon-light-1024.png
```

Do not regenerate from one of the derived small PNG files.
