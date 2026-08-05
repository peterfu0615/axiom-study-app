import { describe, expect, it, vi } from 'vitest'
import type { AIProblemAnalysis, ModelRun } from '../domain/models'
import {
  REFERENCED_MEDIA_PATHS_SQL,
  assertAIProviderKeySaveStatuses,
  classifyMediaPaths,
  completeProblemAIModelRun,
  extractReferencedMediaPaths,
  isSameDatabasePath,
  parseJSON,
  parseNullableSQLiteBoolean,
  parseSQLiteBoolean,
  recordProcessingModelRunOutput,
  scanOrphanedMedia,
  deleteOrphanedMedia,
} from './database'

// Fake single-connection database used by recordProcessingModelRunOutput tests.
// The real app funnels every statement through db_execute / db_select, so a
// statement-aware stub faithfully reproduces the transaction contract.
const fakeDb = vi.hoisted(() => {
  const statements: string[] = []
  const modelRuns = new Map<
    string,
    {
      status: string
      providerAttemptsJson: string | null
      rawOutput: string | null
      repairStrategy: string | null
    }
  >()
  // Test hooks: extra select handlers, per-statement rowsAffected overrides
  // and a failure trigger, used by the completeProblemAIModelRun contract.
  const selectHandlers: Array<{
    match: (sql: string) => boolean
    rows: () => unknown[]
  }> = []
  const affectedOverrides: Array<{
    match: (sql: string) => boolean
    affected: () => number
  }> = []
  let failOn: ((sql: string) => boolean) | null = null
  return {
    statements,
    modelRuns,
    selectHandlers,
    affectedOverrides,
    setFailOn: (predicate: ((sql: string) => boolean) | null) => {
      failOn = predicate
    },
    shouldFail: (sql: string) => (failOn ? failOn(sql) : false),
    reset() {
      statements.length = 0
      selectHandlers.length = 0
      affectedOverrides.length = 0
      failOn = null
    },
  }
})

vi.mock('@tauri-apps/plugin-sql', () => ({
  default: {
    load: vi.fn(async () => ({
      execute: vi.fn(async () => ({ rowsAffected: 0, lastInsertId: 0 })),
      select: vi.fn(async () => [{ name: 'main', file: '/app/axiom.db' }]),
    })),
  },
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (command: string, args?: { sql?: string; params?: unknown[] }) => {
    const sql = (args?.sql ?? '').trim()
    const params = args?.params ?? []
    fakeDb.statements.push(sql)
    if (fakeDb.shouldFail(sql)) {
      throw new Error(`injected statement failure: ${sql.slice(0, 80)}`)
    }
    if (command === 'db_select') {
      if (sql.includes('SELECT provider_attempts_json FROM model_runs')) {
        const row = fakeDb.modelRuns.get(String(params[0]))
        return row ? [{ provider_attempts_json: row.providerAttemptsJson }] : []
      }
      for (const handler of fakeDb.selectHandlers) {
        if (handler.match(sql)) return handler.rows()
      }
      return []
    }
    if (command === 'db_execute') {
      if (sql === 'BEGIN' || sql === 'BEGIN IMMEDIATE' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        return { rowsAffected: 0, lastInsertId: 0 }
      }
      for (const override of fakeDb.affectedOverrides) {
        if (override.match(sql)) {
          return { rowsAffected: override.affected(), lastInsertId: 0 }
        }
      }
      if (sql.includes('UPDATE model_runs') && sql.includes('provider_attempts_json = $3')) {
        const [rawOutput, repairStrategy, attemptsJson, runId] = params as [
          string,
          string | null,
          string,
          string,
        ]
        const row = fakeDb.modelRuns.get(runId)
        if (!row || row.status !== 'processing') return { rowsAffected: 0, lastInsertId: 0 }
        row.rawOutput = rawOutput
        row.repairStrategy = repairStrategy
        row.providerAttemptsJson = attemptsJson
        return { rowsAffected: 1, lastInsertId: 0 }
      }
      return { rowsAffected: 0, lastInsertId: 0 }
    }
    throw new Error(`unexpected invoke: ${command}`)
  }),
}))

// Mock native IPC calls so we can test scanOrphanedMedia / deleteOrphanedMedia
// without a running Tauri backend.
vi.mock('./native', () => ({
  canonicalizePath: vi.fn(async (p: string) => p),
  cropProblemImage: vi.fn(),
  deleteAIProviderApiKey: vi.fn(async () => undefined),
  deleteMediaFile: vi.fn(async () => undefined),
  getDatabasePath: vi.fn(async () => '/app/axiom.db'),
  isDesktopRuntime: () => true,
  listMediaDirectory: vi.fn(async (_subdir: string) => []),
  migrateDatabase: vi.fn(async () => undefined),
  persistAIProviderProfiles: vi.fn(async () => undefined),
  recoverLegacyProviderApiKeys: vi.fn(async () => undefined),
  removeProblemImage: vi.fn(async () => undefined),
}))

describe('parseSQLiteBoolean', () => {
  it('returns true for canonical truthy values', () => {
    expect(parseSQLiteBoolean(true)).toBe(true)
    expect(parseSQLiteBoolean(1)).toBe(true)
    expect(parseSQLiteBoolean('1')).toBe(true)
    expect(parseSQLiteBoolean('true')).toBe(true)
    expect(parseSQLiteBoolean('True')).toBe(true)
    expect(parseSQLiteBoolean('TRUE')).toBe(true)
    expect(parseSQLiteBoolean('t')).toBe(true)
    expect(parseSQLiteBoolean('  true  ')).toBe(true)
  })

  it('returns false for canonical falsy values', () => {
    expect(parseSQLiteBoolean(false)).toBe(false)
    expect(parseSQLiteBoolean(0)).toBe(false)
    expect(parseSQLiteBoolean('0')).toBe(false)
    expect(parseSQLiteBoolean('false')).toBe(false)
    expect(parseSQLiteBoolean('False')).toBe(false)
    expect(parseSQLiteBoolean('FALSE')).toBe(false)
    expect(parseSQLiteBoolean('f')).toBe(false)
    expect(parseSQLiteBoolean('')).toBe(false)
    expect(parseSQLiteBoolean('   ')).toBe(false)
  })

  it('returns false for unrecognized values instead of relying on JS Boolean()', () => {
    // 经典陷阱：Boolean("0") === true；我们的实现必须显式拒绝
    expect(parseSQLiteBoolean('0')).toBe(false)
    expect(parseSQLiteBoolean('false')).toBe(false)
    // 任何无法识别的字符串退化为 false（更安全的失败方向）
    expect(parseSQLiteBoolean('maybe')).toBe(false)
    expect(parseSQLiteBoolean('yes')).toBe(false)
    expect(parseSQLiteBoolean('2')).toBe(false)
  })

  it('handles null / undefined gracefully by returning false', () => {
    expect(parseSQLiteBoolean(null)).toBe(false)
    expect(parseSQLiteBoolean(undefined)).toBe(false)
  })
})

describe('assertAIProviderKeySaveStatuses', () => {
  it('accepts a newly entered key only when native SQLite status confirms it', () => {
    expect(() => assertAIProviderKeySaveStatuses(
      [{ id: 'gemini', name: 'Gemini 3.6 Flash High', apiKey: 'sk-test-key' }],
      [{ id: 'gemini', hasApiKey: true }],
    )).not.toThrow()
  })

  it('surfaces a failed native save without exposing the key', () => {
    expect(() => assertAIProviderKeySaveStatuses(
      [{ id: 'gemini', name: 'Gemini 3.6 Flash High', apiKey: 'sk-test-key' }],
      [{ id: 'gemini', hasApiKey: false }],
    )).toThrow('“Gemini 3.6 Flash High”的 API Key 保存事务校验失败')
  })

  it('ignores providers whose edit field is blank because blank means retain', () => {
    expect(() => assertAIProviderKeySaveStatuses(
      [{ id: 'gemini', name: 'Gemini 3.6 Flash High', apiKey: '' }],
      [{ id: 'gemini', hasApiKey: false }],
    )).not.toThrow()
  })
})

describe('parseNullableSQLiteBoolean', () => {
  it('preserves null / undefined as null', () => {
    expect(parseNullableSQLiteBoolean(null)).toBeNull()
    expect(parseNullableSQLiteBoolean(undefined)).toBeNull()
  })

  it('delegates non-null values to parseSQLiteBoolean', () => {
    expect(parseNullableSQLiteBoolean(1)).toBe(true)
    expect(parseNullableSQLiteBoolean(0)).toBe(false)
    expect(parseNullableSQLiteBoolean('1')).toBe(true)
    expect(parseNullableSQLiteBoolean('0')).toBe(false)
    expect(parseNullableSQLiteBoolean('true')).toBe(true)
    expect(parseNullableSQLiteBoolean('false')).toBe(false)
  })

  it('does NOT fall into the Boolean("0") === true trap', () => {
    // 这是本次审计的核心回归测试：Boolean("0") === true 是历史 bug
    expect(parseNullableSQLiteBoolean('0')).toBe(false)
    expect(parseNullableSQLiteBoolean('false')).toBe(false)
  })
})

describe('parseJSON', () => {
  it('parses valid JSON', () => {
    expect(parseJSON('{"a":1}', null)).toEqual({ a: 1 })
    expect(parseJSON('[1,2,3]', [])).toEqual([1, 2, 3])
    expect(parseJSON('"hello"', null)).toBe('hello')
    expect(parseJSON('42', 0)).toBe(42)
    expect(parseJSON('true', false)).toBe(true)
    expect(parseJSON('null', 'fallback')).toBeNull()
  })

  it('returns fallback for non-string inputs', () => {
    expect(parseJSON(null, 'default')).toBe('default')
    expect(parseJSON(undefined, 'default')).toBe('default')
    expect(parseJSON(42, 'default')).toBe('default')
    expect(parseJSON({}, 'default')).toBe('default')
  })

  it('returns fallback for empty string', () => {
    expect(parseJSON('', 'default')).toBe('default')
  })

  it('returns fallback on parse failure (does not throw)', () => {
    const fallback = { ok: true }
    expect(parseJSON('{invalid', fallback)).toBe(fallback)
    expect(parseJSON('not json', fallback)).toBe(fallback)
    expect(parseJSON('[1,2,', [])).toEqual([])
  })

  it('logs context to console.error on parse failure', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    parseJSON('{invalid', 'fallback', 'ai_choices_json#abc-123')
    expect(errorSpy).toHaveBeenCalledTimes(1)
    const [message] = errorSpy.mock.calls[0]
    expect(String(message)).toContain('ai_choices_json#abc-123')
    expect(String(message)).toContain('JSON 解析失败')
    errorSpy.mockRestore()
  })

  it('does not log when no context provided but still falls back', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    parseJSON('{invalid', 'fallback')
    // 即使没有 context，仍应记录解析失败（用于诊断）
    expect(errorSpy).toHaveBeenCalledTimes(1)
    errorSpy.mockRestore()
  })
})

describe('isSameDatabasePath', () => {
  it('treats identical paths as same', () => {
    const p = '/Users/Peter/Library/Containers/com.axiom.study/Data/axiom.db'
    expect(isSameDatabasePath(p, p)).toBe(true)
  })

  it('normalizes trailing slashes and double slashes', () => {
    expect(
      isSameDatabasePath(
        '/Users/test/Library//Containers/com.axiom.study/Data/axiom.db',
        '/Users/test/Library/Containers/com.axiom.study/Data/axiom.db/',
      ),
    ).toBe(true)
  })

  it('detects genuinely different paths', () => {
    expect(
      isSameDatabasePath(
        '/Users/test/Library/Containers/com.axiom.study/Data/axiom.db',
        '/Users/test/Library/Containers/com.axiom.study.beta/Data/axiom.db',
      ),
    ).toBe(false)
  })

  it('handles empty strings', () => {
    expect(isSameDatabasePath('', '')).toBe(true)
    expect(isSameDatabasePath('a', '')).toBe(false)
  })
})

describe('REFERENCED_MEDIA_PATHS_SQL', () => {
  it('covers all 5 reference sources to prevent false-positive deletion', () => {
    // 任何遗漏都会导致 GC 误删正在使用的文件
    expect(REFERENCED_MEDIA_PATHS_SQL).toContain('source_documents')
    expect(REFERENCED_MEDIA_PATHS_SQL).toContain('original_image_path')
    expect(REFERENCED_MEDIA_PATHS_SQL).toContain('corrected_image_path')
    expect(REFERENCED_MEDIA_PATHS_SQL).toContain('crop_image_path')
    expect(REFERENCED_MEDIA_PATHS_SQL).toContain('ai_diagram_image_path')
    expect(REFERENCED_MEDIA_PATHS_SQL).toContain('problem_regions')
    expect(REFERENCED_MEDIA_PATHS_SQL).toContain('image_path')
  })

  it('uses UNION ALL to keep duplicates out of the result set is acceptable', () => {
    // UNION ALL 比 UNION 快，且我们用 Set 收集结果，重复项会被去重
    expect(REFERENCED_MEDIA_PATHS_SQL).toContain('UNION ALL')
  })

  it('excludes NULL paths from the union', () => {
    expect(REFERENCED_MEDIA_PATHS_SQL).toMatch(/IS NOT NULL/g)
    // 5 个 SELECT 子句都应过滤 NULL
    const matches = REFERENCED_MEDIA_PATHS_SQL.match(/IS NOT NULL/g)
    expect(matches?.length).toBe(5)
  })
})

describe('extractReferencedMediaPaths', () => {
  it('extracts paths from query result rows', () => {
    const rows = [
      { path: '/data/media/original/a.jpg' },
      { path: '/data/media/problems/b.jpg' },
      { path: '/data/media/diagrams/c.jpg' },
    ]
    const result = extractReferencedMediaPaths(rows)
    expect(result.size).toBe(3)
    expect(result.has('/data/media/original/a.jpg')).toBe(true)
    expect(result.has('/data/media/problems/b.jpg')).toBe(true)
    expect(result.has('/data/media/diagrams/c.jpg')).toBe(true)
  })

  it('deduplicates identical paths (e.g. multiple regions share a path)', () => {
    const rows = [
      { path: '/data/media/problems/a.jpg' },
      { path: '/data/media/problems/a.jpg' },
      { path: '/data/media/problems/a.jpg' },
    ]
    const result = extractReferencedMediaPaths(rows)
    expect(result.size).toBe(1)
  })

  it('skips null and empty paths', () => {
    const rows = [
      { path: null },
      { path: undefined },
      { path: '' },
      { path: '/data/media/problems/real.jpg' },
    ]
    const result = extractReferencedMediaPaths(rows)
    expect(result.size).toBe(1)
    expect(result.has('/data/media/problems/real.jpg')).toBe(true)
  })

  it('handles empty input', () => {
    expect(extractReferencedMediaPaths([]).size).toBe(0)
  })
})

describe('classifyMediaPaths', () => {
  const referenced = new Set([
    '/data/media/problems/in-use.jpg',
    '/data/media/diagrams/in-use.jpg',
    '/data/media/original/in-use.jpg',
    '/data/media/corrected/in-use.jpg',
  ])

  it('separates orphans from retained files by directory', () => {
    const diskPaths = [
      '/data/media/problems/in-use.jpg',
      '/data/media/problems/orphan.jpg',
      '/data/media/diagrams/in-use.jpg',
      '/data/media/diagrams/orphan.jpg',
      '/data/media/original/in-use.jpg',
      '/data/media/original/orphan.jpg',
      '/data/media/corrected/in-use.jpg',
      '/data/media/corrected/orphan.jpg',
    ]
    const { orphaned, retained } = classifyMediaPaths(diskPaths, referenced)
    expect(orphaned.problems).toEqual(['/data/media/problems/orphan.jpg'])
    expect(orphaned.diagrams).toEqual(['/data/media/diagrams/orphan.jpg'])
    expect(orphaned.original).toEqual(['/data/media/original/orphan.jpg'])
    expect(orphaned.corrected).toEqual(['/data/media/corrected/orphan.jpg'])
    expect(retained.problems).toEqual(['/data/media/problems/in-use.jpg'])
    expect(retained.diagrams).toEqual(['/data/media/diagrams/in-use.jpg'])
    expect(retained.original).toEqual(['/data/media/original/in-use.jpg'])
    expect(retained.corrected).toEqual(['/data/media/corrected/in-use.jpg'])
  })

  it('skips paths that do not match any known media directory', () => {
    const diskPaths = [
      '/data/media/problems/keep.jpg',
      '/tmp/some-random-file.jpg',
      '/data/somewhere/else.jpg',
    ]
    const { orphaned, retained } = classifyMediaPaths(diskPaths, referenced)
    // keep.jpg 在 problems 目录中但不在引用集合里 → orphaned.problems
    expect(orphaned.problems).toEqual(['/data/media/problems/keep.jpg'])
    expect(orphaned.original).toEqual([])
    expect(orphaned.corrected).toEqual([])
    expect(orphaned.diagrams).toEqual([])
    // /tmp 和 /data/somewhere 的路径不匹配任何已知 bucket，被丢弃
    expect(retained.problems).toEqual([])
    expect(retained.original).toEqual([])
    expect(retained.corrected).toEqual([])
    expect(retained.diagrams).toEqual([])
  })

  it('returns empty buckets for empty input', () => {
    const { orphaned, retained } = classifyMediaPaths([], referenced)
    expect(orphaned.problems).toEqual([])
    expect(orphaned.diagrams).toEqual([])
    expect(orphaned.original).toEqual([])
    expect(orphaned.corrected).toEqual([])
    expect(retained.problems).toEqual([])
    expect(retained.diagrams).toEqual([])
    expect(retained.original).toEqual([])
    expect(retained.corrected).toEqual([])
  })
})

describe('scanOrphanedMedia', () => {
  it('returns empty report when not on desktop runtime', async () => {
    const native = await import('./native')
    const origIsDesktop = (native as { isDesktopRuntime: () => boolean }).isDesktopRuntime
    ;(native as { isDesktopRuntime: () => boolean }).isDesktopRuntime = () => false
    try {
      const report = await scanOrphanedMedia()
      expect(report.original).toEqual([])
      expect(report.corrected).toEqual([])
      expect(report.problems).toEqual([])
      expect(report.diagrams).toEqual([])
    } finally {
      ;(native as { isDesktopRuntime: () => boolean }).isDesktopRuntime = origIsDesktop
    }
  })
})

describe('deleteOrphanedMedia', () => {
  it('returns empty result when not on desktop runtime', async () => {
    const native = await import('./native')
    const origIsDesktop = (native as { isDesktopRuntime: () => boolean }).isDesktopRuntime
    ;(native as { isDesktopRuntime: () => boolean }).isDesktopRuntime = () => false
    try {
      const result = await deleteOrphanedMedia(['/app/media/problems/orphan.jpg'])
      expect(result.deleted).toEqual([])
      expect(result.skipped).toEqual(['/app/media/problems/orphan.jpg'])
    } finally {
      ;(native as { isDesktopRuntime: () => boolean }).isDesktopRuntime = origIsDesktop
    }
  })
})

describe('recordProcessingModelRunOutput', () => {
  const seedRun = () => {
    fakeDb.statements.length = 0
    fakeDb.modelRuns.clear()
    fakeDb.modelRuns.set('run-1', {
      status: 'processing',
      providerAttemptsJson: '[]',
      rawOutput: null,
      repairStrategy: null,
    })
  }

  it('appends every attempt so two consecutive records keep both entries', async () => {
    seedRun()
    await recordProcessingModelRunOutput(
      { id: 'run-1', provider: 'gemini', model: 'gemini-flash' },
      'first-output',
      null,
    )
    await recordProcessingModelRunOutput(
      { id: 'run-1', provider: 'openai-compatible', model: 'gpt-vision' },
      'second-output',
      'repair-json',
      'Bearer sk-secret leaked',
    )
    const stored = fakeDb.modelRuns.get('run-1')
    expect(stored).toBeDefined()
    const attempts = JSON.parse(stored!.providerAttemptsJson ?? '[]') as Array<
      Record<string, unknown>
    >
    expect(attempts).toHaveLength(2)
    expect(attempts[0]).toMatchObject({
      provider: 'gemini',
      model: 'gemini-flash',
      rawOutput: 'first-output',
      repairStrategy: null,
      errorMessage: null,
    })
    expect(attempts[1]).toMatchObject({
      provider: 'openai-compatible',
      model: 'gpt-vision',
      rawOutput: 'second-output',
      repairStrategy: 'repair-json',
    })
    // 错误信息必须脱敏后再落库
    expect(attempts[1].errorMessage).toBe('Bearer [已隐藏] leaked')
    expect(stored!.rawOutput).toBe('second-output')
  })

  it('wraps the read-modify-write in a single transaction', async () => {
    seedRun()
    await recordProcessingModelRunOutput(
      { id: 'run-1', provider: 'gemini', model: 'gemini-flash' },
      'output',
      null,
    )
    const sequence = fakeDb.statements
    expect(sequence[0]).toBe('BEGIN IMMEDIATE')
    expect(sequence.some((sql) => sql.includes('SELECT provider_attempts_json'))).toBe(true)
    expect(sequence.some((sql) => sql.includes('UPDATE model_runs'))).toBe(true)
    expect(sequence.at(-1)).toBe('COMMIT')
    // SELECT 必须先于 UPDATE，否则读改写退化为盲写
    const selectIndex = sequence.findIndex((sql) => sql.includes('SELECT provider_attempts_json'))
    const updateIndex = sequence.findIndex((sql) => sql.includes('UPDATE model_runs'))
    expect(selectIndex).toBeGreaterThan(0)
    expect(updateIndex).toBeGreaterThan(selectIndex)
  })

  it('surfaces a conflict when the run is no longer processing', async () => {
    seedRun()
    fakeDb.modelRuns.get('run-1')!.status = 'cancelled'
    await expect(
      recordProcessingModelRunOutput(
        { id: 'run-1', provider: 'gemini', model: 'gemini-flash' },
        'output',
        null,
      ),
    ).rejects.toThrow('AI Task 已不再处于处理中状态')
  })
})

describe('completeProblemAIModelRun taxonomy atomicity (B1)', () => {
  const run: ModelRun = {
    id: 'run-1',
    problemId: 'problem-1',
    taskType: 'analyze_problem_image',
    provider: 'test',
    model: 'test-v1',
    input: {
      problemId: 'problem-1',
      cropImagePath: '/tmp/problem.jpg',
      sourceDocumentCorrectedImagePath: '/tmp/page.jpg',
      cropRect: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
    },
    output: null,
    rawOutput: '',
    repairStrategy: null,
    status: 'processing',
    errorMessage: null,
    createdAt: 1,
  }

  const analysis: AIProblemAnalysis = {
    title: '分式-选择题-化简',
    subject: '数学',
    problemType: '选择题',
    stemMarkdown: '化简 $\\frac{x}{2}$。',
    choices: [],
    subQuestions: [],
    hasDiagram: false,
    diagramKind: 'unknown',
    diagramBBox: { x: 0, y: 0, width: 0, height: 0 },
    knowledgePoints: [],
    knowledgeTags: [{
      name: '分式化简',
      role: 'primary',
      confidence: 0.9,
      evidence: '题干要求化简分式',
      source: 'problem',
    }],
    methodTags: [],
    modelTags: [],
    difficulty: null,
    errorCategories: [],
    textbookHint: null,
    confidence: 0.9,
    warnings: [],
  }

  const isTaxonomyWrite = (sql: string) =>
    sql.startsWith('UPDATE problems') && sql.includes('matched_textbook_id')

  const seedCompletion = (effectiveSubject = '数学') => {
    fakeDb.reset()
    fakeDb.selectHandlers.push(
      {
        match: (sql) => sql.includes('SELECT ai_diagram_image_path'),
        rows: () => [{ ai_diagram_image_path: null }],
      },
      {
        match: (sql) => sql.includes('effective_subject'),
        rows: () => [{
          effective_subject: effectiveSubject,
          matched_textbook_id: null,
          textbook_match_locked: 0,
        }],
      },
      {
        match: (sql) => sql.includes('SELECT version FROM taxonomy_versions'),
        rows: () => [{ version: 3 }],
      },
    )
    fakeDb.affectedOverrides.push(
      {
        match: (sql) => sql.startsWith('UPDATE model_runs') && sql.includes("status = 'completed'"),
        affected: () => 1,
      },
      {
        match: (sql) => sql.startsWith('UPDATE problems') && sql.includes("ai_status = 'completed'"),
        affected: () => 1,
      },
    )
  }

  it('writes structured result and taxonomy mapping inside one atomic transaction', async () => {
    seedCompletion()
    const previous = await completeProblemAIModelRun(run, analysis)
    expect(previous).toBeNull()
    const sequence = fakeDb.statements
    const beginIndex = sequence.findIndex((sql) => sql === 'BEGIN')
    const commitIndex = sequence.lastIndexOf('COMMIT')
    expect(beginIndex).toBeGreaterThan(-1)
    expect(commitIndex).toBeGreaterThan(beginIndex)
    expect(sequence).not.toContain('ROLLBACK')
    // 事务只开启一次：run 完成、题目 ai_* 列与受控标签映射全部在其中
    expect(sequence.filter((sql) => sql === 'BEGIN')).toHaveLength(1)
    const runComplete = sequence.findIndex(
      (sql) => sql.startsWith('UPDATE model_runs') && sql.includes("status = 'completed'"),
    )
    const problemComplete = sequence.findIndex(
      (sql) => sql.startsWith('UPDATE problems') && sql.includes("ai_status = 'completed'"),
    )
    const taxonomyWrite = sequence.findIndex(isTaxonomyWrite)
    const tagInsert = sequence.findIndex((sql) => sql.startsWith('INSERT OR IGNORE INTO problem_tags'))
    expect(runComplete).toBeGreaterThan(beginIndex)
    expect(problemComplete).toBeGreaterThan(runComplete)
    expect(taxonomyWrite).toBeGreaterThan(problemComplete)
    expect(tagInsert).toBeGreaterThan(taxonomyWrite)
    expect(commitIndex).toBeGreaterThan(tagInsert)
    // prepare 阶段的只读查询必须发生在 BEGIN 之前（事务不包网络式长读）
    const prepareRead = sequence.findIndex((sql) => sql.includes('effective_subject'))
    expect(prepareRead).toBeGreaterThan(-1)
    expect(prepareRead).toBeLessThan(beginIndex)
  })

  it('rolls back the whole completion and surfaces the error when taxonomy apply fails', async () => {
    seedCompletion()
    fakeDb.setFailOn(isTaxonomyWrite)
    await expect(
      completeProblemAIModelRun(run, analysis),
    ).rejects.toThrow('injected statement failure')
    const sequence = fakeDb.statements
    // 绝不能出现「completed 已提交」的假成功：COMMIT 未落，ROLLBACK 必须执行
    expect(sequence).not.toContain('COMMIT')
    expect(sequence).toContain('ROLLBACK')
    const rollbackIndex = sequence.lastIndexOf('ROLLBACK')
    const taxonomyWrite = sequence.findIndex(isTaxonomyWrite)
    expect(taxonomyWrite).toBeGreaterThan(-1)
    expect(rollbackIndex).toBeGreaterThan(taxonomyWrite)
  })

  it('skips taxonomy writes entirely for problems without a subject (no-op keeps semantics)', async () => {
    seedCompletion('')
    await completeProblemAIModelRun(run, analysis)
    const sequence = fakeDb.statements
    expect(sequence).toContain('COMMIT')
    expect(sequence.some(isTaxonomyWrite)).toBe(false)
    expect(
      sequence.some((sql) => sql.startsWith('INSERT OR IGNORE INTO problem_tags')),
    ).toBe(false)
  })
})
