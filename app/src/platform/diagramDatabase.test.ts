import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/core', () => ({ invoke }))

import { CURRENT_TIKZ_RENDERER_VERSION } from '../domain/diagram'
import { getPreferredDiagram } from './diagramDatabase'

describe('preferred TikZ diagram selection', () => {
  beforeEach(() => invoke.mockReset())

  it('keeps the newest validated legacy render as a visible fallback', async () => {
    invoke.mockResolvedValueOnce([{
      id: 'diagram-legacy',
      owner_type: 'problem',
      owner_id: 'problem-1',
      source_type: 'tikz',
      source: String.raw`\draw (0,0) -- (1,1);`,
      render_status: 'rendered',
      rendered_asset_path: '/tmp/diagram.svg',
      rendered_mime_type: 'image/svg+xml',
      render_hash: 'render-hash',
      renderer_version: 'tikz-v3',
      render_error_code: null,
      render_error_message: null,
      validation_status: 'validated',
      validation_json: '{"errors":[]}',
      contract_json: '{"requiredLabels":[],"requiredRelations":[]}',
      width_units: 4,
      height_units: 3,
      repair_attempts: 0,
      source_model_run_id: 'run-1',
      input_hash: 'input-hash',
      freshness_status: 'fresh',
      created_at: 100,
      updated_at: 200,
    }])

    await expect(getPreferredDiagram('problem', 'problem-1')).resolves.toMatchObject({
      id: 'diagram-legacy',
      rendererVersion: 'tikz-v3',
      renderedAssetPath: '/tmp/diagram.svg',
    })

    expect(invoke).toHaveBeenCalledWith('db_select', expect.objectContaining({
      params: ['problem', 'problem-1', CURRENT_TIKZ_RENDERER_VERSION],
      sql: expect.stringContaining('CASE WHEN renderer_version=$3 THEN 0 ELSE 1 END'),
    }))
    expect(invoke.mock.calls[0][1].sql).not.toContain('AND renderer_version=$3')
  })
})
