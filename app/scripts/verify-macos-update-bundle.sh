#!/usr/bin/env bash
set -euo pipefail

app_path="${1:-}"
expected_version="${2:-}"
expected_arch="${3:-}"

if [[ "$app_path" != /*.app || ! -d "$app_path" || -z "$expected_version" || -z "$expected_arch" ]]; then
  echo "usage: $0 /absolute/path/Axiom.app <version> <aarch64|x86_64>" >&2
  exit 2
fi

plist="$app_path/Contents/Info.plist"
test -f "$plist"
actual_version="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$plist")"
actual_identifier="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$plist")"
test "$actual_version" = "${expected_version#v}"
test "$actual_identifier" = "com.axiom.study"

main_binary=""
for candidate in "$app_path/Contents/MacOS/Axiom" "$app_path/Contents/MacOS/axiom"; do
  if [[ -x "$candidate" ]]; then main_binary="$candidate"; break; fi
done
test -n "$main_binary"

case "$expected_arch" in
  aarch64|arm64) file "$main_binary" | grep -q 'arm64' ;;
  x86_64) file "$main_binary" | grep -q 'x86_64' ;;
  *) echo "unsupported architecture: $expected_arch" >&2; exit 2 ;;
esac

for helper_spec in \
  "axiom-vision:com.axiom.study.vision" \
  "axiom-typst:com.axiom.study.typst"
do
  helper_name="${helper_spec%%:*}"
  helper_id="${helper_spec#*:}"
  helper="$app_path/Contents/MacOS/$helper_name"
  test -x "$helper"
  case "$expected_arch" in
    aarch64|arm64) file "$helper" | grep -q 'arm64' ;;
    x86_64) file "$helper" | grep -q 'x86_64' ;;
  esac
  codesign --verify --strict "$helper"
  helper_details="$(codesign -dvv "$helper" 2>&1)"
  helper_entitlements="$(codesign -d --entitlements - "$helper" 2>&1)"
  grep -q "Identifier=$helper_id" <<<"$helper_details"
  grep -q 'com.apple.security.inherit' <<<"$helper_entitlements"
done

codesign --verify --deep --strict "$app_path"
