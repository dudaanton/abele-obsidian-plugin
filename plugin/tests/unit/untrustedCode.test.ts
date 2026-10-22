import { afterEach, expect, it, vi } from 'vitest'
import { Component, MarkdownPreviewRenderer, MarkdownRenderer } from 'obsidian'
import {
  renderUntrustedMarkdown,
  uninstallUntrustedGuard,
  untrustedGuard,
} from '@/markdown/renderUntrusted'
import { ZWSP, guardCode, prepareMarkdown } from '@/markdown/untrustedCode'
import { useVault } from '../helpers/testEnv'

afterEach(() => {
  uninstallUntrustedGuard()
  MarkdownPreviewRenderer.postProcessors = []
  MarkdownPreviewRenderer.codeBlockPostProcessors = {}
  vi.restoreAllMocks()
})

it.each(['mermaid', 'pele'])(
  'allows %s diagram source on untrusted markdown surfaces',
  (language) => {
    useVault([])
    const source = `\`\`\`${language}\nflowchart LR\n A --> B\n\`\`\``
    expect(prepareMarkdown(source, true)).toBe(source)
    const host = document.createElement('div')
    const pre = host.appendChild(document.createElement('pre'))
    const code = pre.appendChild(document.createElement('code'))
    code.className = `language-${language}`
    code.textContent = 'flowchart LR\n A --> B'
    guardCode(host, true)
    expect(host.querySelector(`code.language-${language}`)).not.toBeNull()
  }
)

it('guards raw HTML and claimed plain languages before another processor sees them', async () => {
  useVault([])
  const seen: string[] = []
  MarkdownPreviewRenderer.codeBlockPostProcessors.javascript = () => {}
  MarkdownPreviewRenderer.postProcessors.push((el) => {
    seen.push(el.innerHTML)
    expect(el.querySelector('.language-dataviewjs,.language-javascript')).toBeNull()
    expect(el.querySelector('code')?.textContent).toBe(`${ZWSP}$= sample()`)
    expect(el.querySelector('.language-abele-chart')).not.toBeNull()
  })
  vi.spyOn(MarkdownRenderer, 'render').mockImplementation(async (_app, _md, el) => {
    el.innerHTML =
      '<pre><code class="language-dataviewjs">$= sample()</code></pre><pre><code class="language-javascript">sample()</code></pre><pre><code class="language-abele-chart">type: bar</code></pre>'
    for (const processor of MarkdownPreviewRenderer.postProcessors) await processor(el)
  })
  const el = document.createElement('div')
  await renderUntrustedMarkdown(el, 'sample', new Component())
  expect(seen).toHaveLength(1)
  expect(el.querySelector('code')?.textContent).toBe('$= sample()')
})

it('does not treat an attribute supplied by markdown as an authorized render host', () => {
  const el = document.createElement('div')
  el.setAttribute('data-abele-untrusted', '')
  el.innerHTML = '<pre><code class="language-dataviewjs">sample()</code></pre>'
  untrustedGuard(el, {} as never)
  expect(el.querySelector('.language-dataviewjs')).not.toBeNull()
})
