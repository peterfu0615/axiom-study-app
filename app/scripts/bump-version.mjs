#!/usr/bin/env node
/**
 * 版本号同步脚本：在 package.json、Cargo.toml、tauri.conf.json 三个文件中
 * 保持版本号一致。
 *
 * 用法：
 *   node scripts/bump-version.mjs 0.2.0           # 设置为 0.2.0
 *   node scripts/bump-version.mjs 0.1.0-beta.1     # 预发布版本
 *   node scripts/bump-version.mjs patch            # 0.1.0 → 0.1.1
 *   node scripts/bump-version.mjs minor            # 0.1.0 → 0.2.0
 *   node scripts/bump-version.mjs major            # 0.1.0 → 1.0.0
 *
 * 不会自动 commit 或 tag，需人工检查后提交。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const APP_DIR = resolve(__dirname, '..')

const files = {
  'package.json': {
    path: resolve(APP_DIR, 'package.json'),
    read: (text) => JSON.parse(text).version,
    write: (text, version) => {
      const json = JSON.parse(text)
      json.version = version
      // 保留末尾换行
      return JSON.stringify(json, null, 2) + '\n'
    },
  },
  'src-tauri/Cargo.toml': {
    path: resolve(APP_DIR, 'src-tauri/Cargo.toml'),
    read: (text) => {
      const m = text.match(/^version\s*=\s*"([^"]+)"/m)
      return m ? m[1] : null
    },
    write: (text, version) =>
      text.replace(/^(version\s*=\s*")([^"]+)(")/m, `$1${version}$3`),
  },
  'src-tauri/tauri.conf.json': {
    path: resolve(APP_DIR, 'src-tauri/tauri.conf.json'),
    read: (text) => JSON.parse(text).version,
    write: (text, version) => {
      const json = JSON.parse(text)
      json.version = version
      return JSON.stringify(json, null, 2) + '\n'
    },
  },
}

function bumpSemver(version, kind) {
  const [major, minor, patch] = version.split('.').map(Number)
  if (kind === 'major') return `${major + 1}.0.0`
  if (kind === 'minor') return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
}

const input = process.argv[2]
if (!input) {
  console.error('用法: node scripts/bump-version.mjs <version|patch|minor|major>')
  process.exit(1)
}

// 读取当前版本（以 package.json 为准）
const pkgText = readFileSync(files['package.json'].path, 'utf-8')
const current = files['package.json'].read(pkgText)
if (!current) {
  console.error('无法从 package.json 读取当前版本')
  process.exit(1)
}

const next = ['patch', 'minor', 'major'].includes(input)
  ? bumpSemver(current, input)
  : input

// 校验版本号格式（semver，允许预发布后缀）
if (!/^\d+\.\d+\.\d+(-[a-z0-9.]+)?$/i.test(next)) {
  console.error(`无效的版本号: ${next}`)
  process.exit(1)
}

console.log(`版本号: ${current} → ${next}\n`)

let changed = 0
for (const [name, spec] of Object.entries(files)) {
  const text = readFileSync(spec.path, 'utf-8')
  const before = spec.read(text)
  const updated = spec.write(text, next)
  writeFileSync(spec.path, updated, 'utf-8')
  console.log(`  ✓ ${name}: ${before} → ${next}`)
  changed++
}

console.log(`\n已更新 ${changed} 个文件。请检查后 commit 并打 tag：`)
console.log(`  git add -A && git commit -m "chore: bump version to ${next}"`)
console.log(`  git tag v${next}`)
