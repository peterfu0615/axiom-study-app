// @ts-expect-error Vitest executes this repository contract in Node.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const rust = readFileSync(new URL('../../../src-tauri/src/updater.rs', import.meta.url), 'utf8')
const native = readFileSync(new URL('../../../src/platform/native.ts', import.meta.url), 'utf8')
const config = JSON.parse(readFileSync(new URL('../../../src-tauri/tauri.conf.json', import.meta.url), 'utf8'))
const workflow = readFileSync(new URL('../../../../.github/workflows/release.yml', import.meta.url), 'utf8')
const bundleVerifier = readFileSync(new URL('../../../scripts/verify-macos-update-bundle.sh', import.meta.url), 'utf8')

describe('official signed updater migration', () => {
  it('uses the configured Tauri updater and never accepts an arbitrary install URL', () => {
    expect(rust).toContain('tauri_plugin_updater::UpdaterExt')
    expect(rust).not.toContain('Command::new("bash")')
    expect(rust).not.toMatch(/pub async fn [^(]+\([^)]*download_url:/u)
    expect(native).toContain("from '@tauri-apps/plugin-updater'")
    expect(native).toContain('export async function downloadAndInstallUpdate(\n  callback:')
    expect(native).not.toContain("invoke<void>('download_and_install_update'")
  })

  it('pins the public key, HTTPS manifest and updater capabilities without private material', () => {
    expect(config.bundle.createUpdaterArtifacts).toBe(true)
    expect(config.bundle.macOS.signingIdentity).toBe('-')
    expect(config.plugins.updater.pubkey).toMatch(/^[A-Za-z0-9+/=]+$/u)
    expect(config.plugins.updater.endpoints).toEqual([
      'https://github.com/peterfu0615/axiom-study-app/releases/latest/download/latest.json',
    ])
    expect(JSON.stringify(config)).not.toContain('axiom-updater.key')
  })

  it('repackages after sidecar signing and publishes bridge plus signed updater assets', () => {
    expect(workflow.indexOf('Finalize sandboxed sidecars and DMG'))
      .toBeLessThan(workflow.indexOf('Repackage and sign final updater bundle'))
    expect(workflow).toContain('TAURI_SIGNING_PRIVATE_KEY')
    expect(workflow).toContain('Axiom_*.app.zip.sha256')
    expect(workflow).toContain('Axiom_*.app.tar.gz.sig')
    expect(workflow).toContain('app/latest.json')
    expect(workflow).toContain('base64 --decode -i "${{ steps.updater.outputs.signature }}"')
    expect(workflow).toContain('tampered.sig')
    expect(workflow).toContain('verify-macos-update-bundle.sh')
    expect(bundleVerifier).toContain('axiom-vision')
    expect(bundleVerifier).toContain('axiom-typst')
  })
})
