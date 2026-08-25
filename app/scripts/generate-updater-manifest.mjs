#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'

const [version, arch, tag, archivePath, signaturePath, outputPath] = process.argv.slice(2)
if (!version || !arch || !tag || !archivePath || !signaturePath || !outputPath) {
  throw new Error('usage: generate-updater-manifest.mjs <version> <arch> <tag> <archive> <signature> <output>')
}
const platformArch = arch === 'arm64' ? 'aarch64' : arch
if (!['aarch64', 'x86_64'].includes(platformArch)) throw new Error(`unsupported updater architecture: ${arch}`)
const signature = readFileSync(signaturePath, 'utf8').trim()
if (!signature) throw new Error('updater signature is empty')
const assetName = basename(archivePath)
const manifest = {
  version,
  notes: `Axiom ${version}`,
  pub_date: new Date().toISOString(),
  platforms: {
    [`darwin-${platformArch}`]: {
      signature,
      url: `https://github.com/peterfu0615/axiom-study-app/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(assetName)}`,
    },
  },
}
writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`)
