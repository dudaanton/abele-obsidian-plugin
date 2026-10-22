import { describe, it, expect } from 'vitest'
import { renderDiagram } from '@/mermaid/renderMermaid'
import { findMermaidFences } from '@/mermaid/mermaidSource'

describe('pele rendering', () => {
  it('measures with the host typography and caches those layouts separately', async () => {
    const source = 'flowchart LR\n A[Sample label] --> B'
    const ordinary = renderDiagram(source, 'light')
    const themed = renderDiagram(source, 'light', { fontFamily: 'serif', fontSize: 20 })
    expect(themed).not.toBe(ordinary)
    const result = await themed
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.svg).toContain('font:20px')
      expect(result.svg).toContain('font-family:var(--pele-font,serif)')
    }
  })
  it.each([
    'flowchart LR\n A[Draft] --> B[Done]',
    'sequenceDiagram\n Alice->>Bob: Hello',
    'gantt\n dateFormat YYYY-MM-DD\n section Work\n Draft :2026-01-01, 3d',
    'sankey-beta\nSource,Target,10',
    'xychart-beta\n x-axis [A, B]\n bar [2, 4]',
  ])('draws real source: %s', async (source) => {
    const result = await renderDiagram(source, 'light')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.width).toBeGreaterThan(0)
    expect(result.svg).toContain('--pele-')
  })
  it('keeps error location and caret', async () => {
    const result = await renderDiagram('flowchart LR\n A[broken', 'light')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/line|Line/)
    expect(result.error).toContain('^')
  })
  it('recognizes pele fences', () => {
    expect(findMermaidFences(['```pele', 'pie', '```'])).toHaveLength(1)
  })
})
