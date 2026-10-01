import { afterEach, expect, it, vi } from 'vitest'
import { Component, MarkdownRenderer, MarkdownPreviewRenderer } from 'obsidian'
import { renderGithubMarkdown } from '@/github/safeMarkdown'
import { useVault } from '../helpers/testEnv'

afterEach(() => vi.restoreAllMocks())

it('strips frames, forms and overlay styles before processing GitHub markup', async () => {
  useVault([])
  vi.spyOn(MarkdownRenderer, 'render').mockImplementation(async (_app, _md, el) => {
    el.innerHTML =
      '<iframe src="https://pages.example.org"></iframe><form action="obsidian://abele"><p>Caption</p><input><button>Submit</button></form><p style="position:fixed;inset:0;z-index:99999;color:red;text-align:center;background-image:url(https://images.example.org/a)">Text</p><input type="checkbox" disabled>'
    for (const processor of MarkdownPreviewRenderer.postProcessors) await processor(el)
    expect(el.querySelector('iframe,form,button,input:not([type=checkbox])')).toBeNull()
    const p = el.querySelector('p[style]') as HTMLElement
    expect(p.style.position).toBe('')
    expect(p.style.backgroundImage).toBe('')
    expect(p.style.color).toBe('red')
    expect(p.style.textAlign).toBe('center')
    expect(el.querySelector('input[type=checkbox]')).not.toBeNull()
  })
  await renderGithubMarkdown(
    document.createElement('div'),
    'sample',
    { host: 'github.com', owner: 'sample-org', repo: 'sample-repo', ref: 'HEAD', path: '' },
    new Component()
  )
})

it('blocks alternate URL attributes, external SVG references and event handlers', async () => {
  useVault([])
  vi.spyOn(MarkdownRenderer, 'render').mockImplementation(async (_app, _md, el) => {
    el.innerHTML =
      '<svg><a xlink:href="obsidian://abele?path=sample.md">Open</a><use href="https://pages.example.org/sample.svg#x"/></svg><map><area href="obsidian://abele"></map><p onclick="sample()" style="width:100vw">Sample</p>'
    for (const processor of MarkdownPreviewRenderer.postProcessors) await processor(el)
    expect(el.querySelector('[onclick],area,[xlink\\:href],use[href]')).toBeNull()
  })
  await renderGithubMarkdown(
    document.createElement('div'),
    'sample',
    { host: 'github.com', owner: 'sample-org', repo: 'sample-repo', ref: 'HEAD', path: '' },
    new Component()
  )
})
