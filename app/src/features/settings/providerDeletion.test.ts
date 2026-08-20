// @ts-expect-error Vitest executes this contract in Node, while the app tsconfig is browser-only.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

describe('AI Provider deletion contracts', () => {
  it('offers the same remove action for Mock and real providers', () => {
    const settings = read('./AISettings.tsx')
    expect(settings).toContain('removeProvider(selectedProfile.id)')
    expect(settings).not.toMatch(
      /selectedProfile\.provider\s*!==\s*['"]mock['"][\s\S]{0,160}移除/u,
    )
  })

  it('permits saving zero providers and does not resurrect Mock on desktop reads', () => {
    const database = read('../../platform/database.ts')
    expect(database).toContain('return rows.map(rowToAIProviderProfile)')
    expect(database).not.toMatch(/if\s*\(profiles\.length\s*===\s*0\)/u)
    expect(database).not.toMatch(/rows\.length\s*\?[^:]+:\s*defaultAIProviderProfiles/u)
  })
})
