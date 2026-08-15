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
identity="${APPLE_SIGNING_IDENTITY:--}"
sidecar_entitlements="$tauri_dir/Sidecar.entitlements.plist"

sign_args=(--force --sign "$identity")
if [[ "$identity" != "-" ]]; then
  sign_args+=(--options runtime --timestamp)
fi

# Tauri applies the main app entitlements to externalBin executables. A sandboxed
# command-line helper must instead inherit the parent sandbox and carry its own
# stable signing identifier, otherwise macOS can abort it in libsecinit before
# main() (observed as SIGTRAP with no stderr from Typst).
for helper_spec in \
  "axiom-vision:com.axiom.study.vision" \
  "axiom-typst:com.axiom.study.typst"
do
  helper_name="${helper_spec%%:*}"
  helper_id="${helper_spec#*:}"
  helper="$app_path/Contents/MacOS/$helper_name"
  test -x "$helper" || { echo "sidecar is missing or not executable: $helper" >&2; exit 1; }
  codesign "${sign_args[@]}" \
    --identifier "$helper_id" \
    --entitlements "$sidecar_entitlements" \
    "$helper"
done

codesign "${sign_args[@]}" \
  --entitlements "$tauri_dir/Entitlements.plist" \
  "$app_path"

for helper_spec in \
  "axiom-vision:com.axiom.study.vision" \
  "axiom-typst:com.axiom.study.typst"
do
  helper_name="${helper_spec%%:*}"
  helper_id="${helper_spec#*:}"
  helper="$app_path/Contents/MacOS/$helper_name"
  codesign --verify --strict "$helper"
  helper_details="$(codesign -dvv "$helper" 2>&1)"
  helper_entitlements="$(codesign -d --entitlements - "$helper" 2>&1)"
  grep -q "Identifier=$helper_id" <<<"$helper_details"
  grep -q 'com.apple.security.inherit' <<<"$helper_entitlements"
done
codesign --verify --deep --strict "$app_path"

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
