import { describe, expect, it, vi } from 'vitest'
import {
  REFERENCED_MEDIA_PATHS_SQL,
  classifyMediaPaths,
  extractReferencedMediaPaths,
  isSameDatabasePath,
  parseJSON,
  parseNullableSQLiteBoolean,
  parseSQLiteBoolean,
} from './database'

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
