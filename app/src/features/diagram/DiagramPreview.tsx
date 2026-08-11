import { useEffect, useState } from 'react'
import { DiagramView } from '../../components/DiagramView'
import type { Diagram } from '../../domain/diagram'
import { renderTikz } from '../../platform/native'
import './DiagramPreview.css'

const fixtures = [
  ['三角形', '\\draw[thick] (0,0)--(4,0)--(1.2,2.8)--cycle; \\node at (0,-.35) {A}; \\node at (4,-.35) {B}; \\node at (1.2,3.15) {C};'],
  ['平行四边形', '\\draw (0,0)--(3.5,0)--(4.7,2)--(1.2,2)--cycle; \\draw[dashed] (0,0)--(4.7,2);'],
  ['坐标系', '\\draw[->] (-2,0)--(3,0); \\draw[->] (0,-2)--(0,3); \\node at (2.8,-.3) {x}; \\node at (.3,2.8) {y};'],
  ['函数图像', '\\draw[->] (-2,0)--(3,0); \\draw[->] (0,-1)--(0,4); \\draw[thick] (-1.5,2.25)--(-1,1)--(0,0)--(1,1)--(1.5,2.25);'],
  ['物理示意图', '\\draw[thick] (0,0)--(4,0); \\draw (1,0)--(1,2); \\fill (1,2) circle (0.1); \\draw[->] (1,2)--(3,2); \\node at (3.2,2) {F};'],
  ['非法输入回退', '\\input{/etc/passwd}'],
] as const

function diagramFromRender(index: number, source: string, render: Awaited<ReturnType<typeof renderTikz>>): Diagram {
  const now = Date.now()
  return {
    id: `preview-${index}`, ownerType: 'practice_item', ownerId: `preview-item-${index}`,
    sourceType: 'tikz', source, renderStatus: render.renderStatus,
    renderedAssetPath: render.renderedAssetPath,
    renderedMimeType: render.renderedMimeType,
    renderHash: render.renderHash, rendererVersion: render.rendererVersion,
    renderErrorCode: render.errorCode, renderErrorMessage: render.errorMessage,
    createdAt: now, updatedAt: now,
  }
}

export function DiagramPreview() {
  const [diagrams, setDiagrams] = useState<Diagram[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void Promise.all(fixtures.map(async ([, source], index) =>
      diagramFromRender(index, source, await renderTikz(source))))
      .then((next) => { if (!cancelled) setDiagrams(next) })
      .catch((reason) => { if (!cancelled) setError(String(reason)) })
    return () => { cancelled = true }
  }, [])

  return <main className="diagram-preview">
    <header>
      <p className="eyebrow">Diagram Rendering Layer</p>
      <h1>TikZ 渲染验收</h1>
      <p>受限 source → SVG cache → App Preview</p>
    </header>
    {error ? <p className="diagram-preview__error" role="alert">{error}</p> : null}
    {!error && diagrams.length === 0 ? <p role="status">正在渲染真实图形样例…</p> : null}
    <section className="diagram-preview__grid">
      {diagrams.map((diagram, index) => <article key={diagram.id}>
        <div>
          <h2>{fixtures[index][0]}</h2>
          <span>{diagram.renderHash.slice(0, 12)}</span>
        </div>
        <DiagramView alt={fixtures[index][0]} diagram={diagram} />
      </article>)}
    </section>
  </main>
}
