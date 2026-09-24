/**
 * Drawing a diagram with Obsidian's own Mermaid, once per source and theme.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mermaidStub } from 'obsidian'
import { renderDiagram, placeDiagram, clearDiagramCache } from '@/mermaid/renderMermaid'

const defaultRender = mermaidStub.render

beforeEach(() => {
  clearDiagramCache()
  mermaidStub.calls.length = 0
  mermaidStub.render = defaultRender
})

describe('renderDiagram', () => {
  it('draws the source with the theme asked for and measures it', async () => {
    const result = await renderDiagram('graph TD\n%% size 640x480', 'dark')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.width).toBe(640)
    expect(result.height).toBe(480)
    expect(mermaidStub.calls[0]).toContain('"theme": "dark"')
  })

  it('draws a source once per theme, however often it is asked for', async () => {
    await Promise.all([renderDiagram('pie', 'light'), renderDiagram('pie', 'light')])
    await renderDiagram('pie', 'light')
    expect(mermaidStub.calls).toHaveLength(1)
    await renderDiagram('pie', 'dark')
    expect(mermaidStub.calls).toHaveLength(2)
  })

  it('returns what Mermaid says is wrong with the source', async () => {
    mermaidStub.render = async () => {
      throw Object.assign(new Error('Parse error'), { str: 'Parse error on line 2:\nA-->\n---^' })
    }
    const result = await renderDiagram('graph TD\nA-->', 'light')
    expect(result).toEqual({ ok: false, error: 'Parse error on line 2:\nA-->\n---^' })
  })

  it('removes what Mermaid leaves in the page when it fails', async () => {
    mermaidStub.render = async (id: string) => {
      const stray = document.body.appendChild(document.createElement('div'))
      stray.id = `d${id}`
      throw new Error('boom')
    }
    await renderDiagram('bad', 'light')
    expect(document.body.querySelector('[id^="dabele-mermaid"]')).toBeNull()
  })
})

describe('placeDiagram', () => {
  it('puts a copy of the drawing in the element at its natural size, ids of its own', async () => {
    const result = await renderDiagram('graph TD\n%% size 300x120', 'light')
    if (!result.ok) throw new Error('expected a drawing')
    const a = document.createElement('div')
    const b = document.createElement('div')
    const first = placeDiagram(a, result)
    const second = placeDiagram(b, result)

    expect(first.getAttribute('width')).toBe('300')
    expect(first.getAttribute('height')).toBe('120')
    expect(first.getAttribute('style')).toBeNull()
    // Two copies on one page must not share ids, or one's arrowheads vanish with the other.
    expect(first.id).not.toBe(second.id)
    expect(first.querySelector('path')?.getAttribute('marker-end')).toBe(`url(#${first.id}_arrow)`)
  })

  it('turns a node marked as an internal link into a link to that note', async () => {
    mermaidStub.render = async (id: string) => ({
      svg: `<svg id="${id}" viewBox="0 0 10 10"><g class="node internal-link"><g class="label"><foreignObject><div>Some note</div></foreignObject></g></g></svg>`,
    })
    const result = await renderDiagram('graph TD\nA\nclass A internal-link', 'light')
    if (!result.ok) throw new Error('expected a drawing')
    const svg = placeDiagram(document.createElement('div'), result)
    const link = svg.querySelector('a.internal-link')
    expect(link?.getAttribute('href')).toBe('Some note')
    expect(link?.textContent).toBe('Some note')
  })
})

describe('svgMarkup', () => {
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
