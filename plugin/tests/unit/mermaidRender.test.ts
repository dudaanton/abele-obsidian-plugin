/**
 * Drawing a diagram with pele, once per source and theme.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderDiagram, placeDiagram, clearDiagramCache } from '@/mermaid/renderMermaid'

beforeEach(() => clearDiagramCache())

describe('renderDiagram', () => {
  it('draws the source with the theme asked for and measures it', async () => {
    const result = await renderDiagram('flowchart LR\n A --> B', 'dark')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.width).toBeGreaterThan(0)
    expect(result.height).toBeGreaterThan(0)
    expect(result.svg).toContain('--pele-bg')
  })

  it('draws a source once per theme, however often it is asked for', async () => {
    const first = renderDiagram('pie', 'light')
    expect(renderDiagram('pie', 'light')).toBe(first)
    await first
    expect(renderDiagram('pie', 'light')).toBe(first)
    expect(renderDiagram('pie', 'dark')).not.toBe(first)
  })

  it('returns what pele says is wrong with the source', async () => {
    const result = await renderDiagram('flowchart LR\n A[broken', 'light')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.line).toBeGreaterThan(0)
    expect(result.column).toBeGreaterThan(0)
    expect(result.error).toContain(result.snippet)
    expect(result.error).toContain('^')
  })

  it('leaves no scratch DOM when parsing fails', async () => {
    await renderDiagram('bad', 'light')
    expect(document.body.querySelector('[id^="abele-pele"]')).toBeNull()
  })
})

describe('placeDiagram', () => {
  it('puts a copy of the drawing in the element at its natural size, ids of its own', async () => {
    const result = await renderDiagram('flowchart LR\n A --> B', 'light')
    if (!result.ok) throw new Error('expected a drawing')
    // Pele uses paths for simple arrows; exercise references too for diagrams with SVG defs.
    result.svg = `<svg style="fill:var(--pele-fg)"><defs><marker id="${result.renderId}-arrow"/></defs><path marker-end="url(#${result.renderId}-arrow)"/></svg>`
    const a = document.createElement('div')
    const b = document.createElement('div')
    const first = placeDiagram(a, result)
    const second = placeDiagram(b, result)

    expect(first.getAttribute('width')).toBe(String(result.width))
    expect(first.getAttribute('height')).toBe(String(result.height))
    expect(first.getAttribute('style')).toContain('--pele-fg')
    // Two copies on one page must not share ids, or one's arrowheads vanish with the other.
    expect(first.id).not.toBe(second.id)
    const ids = new Set(Array.from(first.querySelectorAll('[id]'), (node) => node.id))
    expect(Array.from(second.querySelectorAll('[id]')).some((node) => ids.has(node.id))).toBe(false)
    const marker = first.querySelector('[marker-end]')?.getAttribute('marker-end')
    expect(marker).toContain(first.id)
  })

  it('turns a node marked as an internal link into a link to that note', async () => {
    const result = await renderDiagram('flowchart LR\nA[Some note]\nclass A internal-link', 'light')
    if (!result.ok) throw new Error('expected a drawing')
    const svg = placeDiagram(document.createElement('div'), result)
    const link = svg.querySelector('a.internal-link')
    expect(link?.getAttribute('href')).toBe('Some note')
    expect(link?.textContent).toBe('Some note')
  })
})

describe('svgMarkup', () => {
  it('freezes the current theme variables for a standalone export', async () => {
    const { svgMarkup } = await import('@/mermaid/diagramExport')
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    const host = document.createElement('div')
    host.style.setProperty('--pele-fg', 'rgb(12, 34, 56)')
    host.appendChild(svg)
    document.body.appendChild(host)
    // happy-dom does not inherit custom properties on SVG as browsers do.
    const style = vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      getPropertyValue: (name: string) => host.style.getPropertyValue(name),
    } as CSSStyleDeclaration)
    const markup = svgMarkup(svg)
    style.mockRestore()
    expect(markup).toContain('--pele-fg: rgb(12, 34, 56)')
    host.remove()
  })
  it('is a standalone file with the font written in, safe inside an attribute', async () => {
    const { svgMarkup } = await import('@/mermaid/diagramExport')
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('style', 'font-family: var(--font-mermaid)')
    const markup = svgMarkup(svg as SVGSVGElement, '"Inter", sans-serif')
    expect(markup).toContain('xmlns="http://www.w3.org/2000/svg"')
    expect(markup).toContain(`font-family: 'Inter', sans-serif`)
    expect(markup).not.toContain('var(--font-mermaid)')
  })
})
