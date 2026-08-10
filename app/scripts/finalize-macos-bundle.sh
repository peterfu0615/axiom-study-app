#!/usr/bin/env bash
set -euo pipefail

app_path="${1:-}"
dmg_path="${2:-}"

if [[ "$app_path" != /*.app || ! -d "$app_path/Contents/MacOS" ]]; then
  echo "usage: $0 /absolute/path/Axiom.app [/absolute/path/Axiom.dmg]" >&2
  exit 2
fi
if [[ -n "$dmg_path" && "$dmg_path" != /*.dmg ]]; then
  echo "DMG output must be an absolute .dmg path" >&2
  exit 2
fi

script_dir="$(cd "$(dirname "$0")" && pwd)"
tauri_dir="$(cd "$script_dir/../src-tauri" && pwd)"
helper="$app_path/Contents/MacOS/axiom-vision"
identity="${APPLE_SIGNING_IDENTITY:--}"

test -x "$helper" || { echo "vision sidecar is missing or not executable: $helper" >&2; exit 1; }

sign_args=(--force --sign "$identity")
if [[ "$identity" != "-" ]]; then
  sign_args+=(--options runtime --timestamp)
fi

# Apple requires a command-line helper embedded in a sandboxed app to have
# exactly app-sandbox + inherit entitlements and a stable signing identifier.
# Tauri signs externalBin with the main app's entitlements, so correct it after
# bundling, then refresh only the outer app seal without recursively re-signing.
codesign "${sign_args[@]}" \
  --identifier com.axiom.study.vision \
  --entitlements "$tauri_dir/VisionHelper.entitlements.plist" \
  "$helper"
codesign "${sign_args[@]}" \
  --entitlements "$tauri_dir/Entitlements.plist" \
  "$app_path"

codesign --verify --strict "$helper"
codesign --verify --deep --strict "$app_path"
helper_details="$(codesign -dvv "$helper" 2>&1)"
helper_entitlements="$(codesign -d --entitlements - "$helper" 2>&1)"
grep -q 'Identifier=com.axiom.study.vision' <<<"$helper_details"
grep -q 'com.apple.security.inherit' <<<"$helper_entitlements"

if [[ -n "$dmg_path" ]]; then
  dmg_dir="$(dirname "$dmg_path")"
  dmg_script="$dmg_dir/bundle_dmg.sh"
  icon="$dmg_dir/icon.icns"
  test -x "$dmg_script" || { echo "missing Tauri DMG builder: $dmg_script" >&2; exit 1; }

  staging="$(mktemp -d /tmp/axiom-dmg-staging.XXXXXX)"
  trap 'rm -rf "$staging"' EXIT
  ditto "$app_path" "$staging/Axiom.app"
  rm -f "$dmg_path"
  "$dmg_script" \
    --volname Axiom \
    --volicon "$icon" \
    --window-size 500 350 \
    --icon-size 128 \
    --icon Axiom.app 130 180 \
    --hide-extension Axiom.app \
    --app-drop-link 370 180 \
    "$dmg_path" "$staging"
fi
