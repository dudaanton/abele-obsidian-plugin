/** Both source-language fences use pele; disabled drawing leaves ordinary code. */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { type MarkdownPostProcessorContext } from 'obsidian'
import { mermaidPostProcessor } from '@/mermaid/mermaidBlocks'
import { AbeleConfig } from '@/services/AbeleConfig'
import { clearDiagramCache } from '@/mermaid/renderMermaid'
import { useVault } from '../helpers/testEnv'

const children: { onunload(): void }[] = []

const ctx = {
  sourcePath: 'Notes/Flow.md',
  addChild: (child: { onunload(): void }) => children.push(child),
} as unknown as MarkdownPostProcessorContext

/** What Obsidian's markdown renderer hands a post-processor for a fenced mermaid block. */
const section = (source: string) => {
  const el = document.createElement('div')
  const pre = el.appendChild(document.createElement('pre'))
  const code = pre.appendChild(document.createElement('code'))
  code.className = 'language-mermaid'
  code.textContent = `${source}\n`
  document.body.appendChild(el)
  return el
}

beforeEach(() => {
  useVault([])
  AbeleConfig.getInstance().mermaidViewer = true
  children.length = 0
  clearDiagramCache()
  vi.stubGlobal('IntersectionObserver', undefined)
  document.body.replaceChildren()
})

describe('mermaidPostProcessor', () => {
  it('awaits a complete static diagram in the hidden print window without visibility', async () => {
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe() {}
        disconnect() {}
      }
    )
    const el = section('graph TD\nA-->B')
    el.classList.add('print')
    await mermaidPostProcessor(el, ctx)
    expect(el.querySelector('svg')).not.toBeNull()
    expect(el.querySelector('.abele-mermaid__controls')).toBeNull()
    expect(el.querySelector('[style*="transform"]')).toBeNull()
  })

  it.each(['mermaid', 'pele'])('replaces a %s block before the host draws it', async (language) => {
    const el = section('graph TD\nA-->B')
    el.querySelector('code')!.className = `language-${language}`
    mermaidPostProcessor(el, ctx)
    await flushPromises()

    expect(el.querySelector('code.language-mermaid')).toBeNull()
    await vi.waitFor(() =>
      expect(el.querySelector('.abele-mermaid-host .abele-mermaid svg')).not.toBeNull()
    )
    expect(children).toHaveLength(1)
  })

  it('takes the source without the newline the fence adds', async () => {
    const el = section('flowchart LR\n A --> B')
    mermaidPostProcessor(el, ctx)
    await flushPromises()
    expect(el.textContent).not.toContain('flowchart')
    expect(el.querySelector('svg')).not.toBeNull()
  })

  it('unmounts the viewer when the section is unloaded', async () => {
    const el = section('graph TD\nA-->B')
    mermaidPostProcessor(el, ctx)
    await flushPromises()
    children[0].onunload()
    expect(el.querySelector('.abele-mermaid')).toBeNull()
  })

  it.each(['mermaid', 'pele'])(
    'shows ordinary %s source when drawing is switched off',
    (language) => {
      AbeleConfig.getInstance().mermaidViewer = false
      const el = section('graph TD\nA-->B')
      el.querySelector('code')!.className = `language-${language}`
      mermaidPostProcessor(el, ctx)
      expect(el.querySelector('code.language-text')).not.toBeNull()
      expect(el.querySelector('.abele-mermaid')).toBeNull()
    }
  )

  it('draws without consulting vault trust', async () => {
    const el = section('graph TD\nA-->B')
    mermaidPostProcessor(el, ctx)
    await flushPromises()
    expect(el.querySelector('svg')).not.toBeNull()
  })

  it('does not touch code in other languages', () => {
    const el = section('x')
    el.querySelector('code')!.className = 'language-js'
    mermaidPostProcessor(el, ctx)
    expect(el.querySelector('code.language-js')).not.toBeNull()
  })
})
