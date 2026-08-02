import type { KnowledgeNode } from '../../domain/horizon'

export interface KnowledgeTreeItem {
  node: KnowledgeNode
  children: KnowledgeTreeItem[]
}

export function buildKnowledgeTree(nodes: KnowledgeNode[]): KnowledgeTreeItem[] {
  const byId = new Map<string, KnowledgeTreeItem>()
  for (const node of nodes) byId.set(node.id, { node, children: [] })
  const roots: KnowledgeTreeItem[] = []
  for (const item of byId.values()) {
    const parent = item.node.parentId ? byId.get(item.node.parentId) : null
    if (parent && parent !== item) parent.children.push(item)
    else roots.push(item)
  }
  const sort = (items: KnowledgeTreeItem[]) => {
    items.sort((left, right) => left.node.sortOrder - right.node.sortOrder || left.node.canonicalName.localeCompare(right.node.canonicalName, 'zh-CN'))
    items.forEach((item) => sort(item.children))
  }
  sort(roots)
  return roots
}

export function matchingKnowledgeNodeIds(nodes: KnowledgeNode[], query: string) {
  const normalized = query.trim().toLocaleLowerCase('zh-CN')
  if (!normalized) return new Set(nodes.map((node) => node.id))
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const visible = new Set<string>()
  for (const node of nodes) {
    if (!node.canonicalName.toLocaleLowerCase('zh-CN').includes(normalized)) continue
    let current: KnowledgeNode | undefined = node
    const seen = new Set<string>()
    while (current && !seen.has(current.id)) {
      visible.add(current.id)
      seen.add(current.id)
      current = current.parentId ? byId.get(current.parentId) : undefined
    }
  }
  return visible
}

export function knowledgeNodeLabel(node: KnowledgeNode) {
  const labels: Record<KnowledgeNode['nodeType'], string> = {
    book: '章节/单元', chapter: '章节/单元', section: '知识点', knowledge: '知识点',
    definition: '知识点', formula: '知识点', theorem: '知识点', property: '知识点',
  }
  return labels[node.nodeType]
}
