/**
 * Where the viewer takes a mermaid block over from Obsidian, and where it leaves it alone.
 *
 * Obsidian 1.13 asks each vault whether diagrams may be shown at all. The viewer only ever
 * draws after that answer is yes, and only while its own setting is on; otherwise the block is
 * left exactly as it arrived, for Obsidian's own processor to draw or to guard.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mermaidStub, type MarkdownPostProcessorContext } from 'obsidian'
import { mermaidPostProcessor } from '@/mermaid/mermaidBlocks'
import { MERMAID_TRUST_KEY } from '@/mermaid/mermaidGate'
import { AbeleConfig } from '@/services/AbeleConfig'
import { clearDiagramCache } from '@/mermaid/renderMermaid'
import { useVault } from '../helpers/testEnv'
import type { FakeApp } from '../helpers/fakeVault'

let app: FakeApp
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
  app = useVault([])
  app.saveLocalStorage(MERMAID_TRUST_KEY, true)
  AbeleConfig.getInstance().mermaidViewer = true
  children.length = 0
  clearDiagramCache()
  vi.stubGlobal('IntersectionObserver', undefined)
  document.body.replaceChildren()
})

describe('mermaidPostProcessor', () => {
  it('puts the viewer where the block was, so Obsidian finds nothing to draw', async () => {
    const el = section('graph TD\nA-->B')
    mermaidPostProcessor(el, ctx)
    await flushPromises()

    expect(el.querySelector('code.language-mermaid')).toBeNull()
    expect(el.querySelector('.abele-mermaid-host .abele-mermaid svg')).not.toBeNull()
    expect(children).toHaveLength(1)
  })

  it('takes the source without the newline the fence adds', async () => {
    mermaidStub.calls.length = 0
    mermaidPostProcessor(section('pie'), ctx)
    await flushPromises()
    expect(mermaidStub.calls.at(-1)?.endsWith('\npie')).toBe(true)
  })

  it('unmounts the viewer when the section is unloaded', async () => {
    const el = section('graph TD\nA-->B')
    mermaidPostProcessor(el, ctx)
    await flushPromises()
    children[0].onunload()
    expect(el.querySelector('.abele-mermaid')).toBeNull()
  })

  it('leaves the block to Obsidian when the viewer is switched off', () => {
    AbeleConfig.getInstance().mermaidViewer = false
    const el = section('graph TD\nA-->B')
    mermaidPostProcessor(el, ctx)
    expect(el.querySelector('code.language-mermaid')).not.toBeNull()
    expect(el.querySelector('.abele-mermaid')).toBeNull()
  })

  it('leaves the block to Obsidian guard until the vault is allowed to show diagrams', () => {
    app.saveLocalStorage(MERMAID_TRUST_KEY, null)
    const el = section('graph TD\nA-->B')
    mermaidPostProcessor(el, ctx)
    expect(el.querySelector('code.language-mermaid')).not.toBeNull()
  })

  it('does not touch code in other languages', () => {
    const el = section('x')
    el.querySelector('code')!.className = 'language-js'
    mermaidPostProcessor(el, ctx)
    expect(el.querySelector('code.language-js')).not.toBeNull()
  })
})
