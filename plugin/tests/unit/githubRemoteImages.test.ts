import { afterEach, expect, it, vi } from 'vitest'
import { Component, MarkdownRenderer, MarkdownPreviewRenderer } from 'obsidian'
import { renderGithubMarkdown } from '@/github/safeMarkdown'
import { useVault } from '../helpers/testEnv'

const repo = {
  host: 'github.com',
  owner: 'sample-org',
  repo: 'sample-repo',
  ref: 'HEAD',
  path: 'README.md',
}
afterEach(() => vi.restoreAllMocks())

it('holds third-party images before other processors, then loads only after a click', async () => {
  useVault([])
  vi.spyOn(MarkdownRenderer, 'render').mockImplementation(async (_app, _md, el) => {
    el.innerHTML = '<p><img alt="Status" src="https://badges.example.org/sample.svg"></p>'
    for (const processor of MarkdownPreviewRenderer.postProcessors) await processor(el)
    expect(el.querySelector('img[src]')).toBeNull()
  })
  const el = document.createElement('div')
  await renderGithubMarkdown(el, 'sample', repo, new Component())
  const button = el.querySelector('button')!
  expect(button?.textContent).toContain('badges.example.org')
  button.click()
  expect(el.querySelector('img')?.getAttribute('src')).toBe('https://badges.example.org/sample.svg')
})

it('keeps repository images and GitHub image hosts automatic, not lookalike hosts', async () => {
  useVault([])
  vi.spyOn(MarkdownRenderer, 'render').mockImplementation(async (_app, _md, el) => {
    el.innerHTML =
      '<img src="images/sample.png"><img src="https://avatars.githubusercontent.com/sample"><img src="https://github.com.evil.example/sample.png">'
    for (const processor of MarkdownPreviewRenderer.postProcessors) await processor(el)
  })
  const el = document.createElement('div')
  await renderGithubMarkdown(el, 'sample', repo, new Component())
  expect([...el.querySelectorAll('img')].map((i) => i.getAttribute('src'))).toEqual([
    'https://raw.githubusercontent.com/sample-org/sample-repo/HEAD/images/sample.png',
    'https://avatars.githubusercontent.com/sample',
  ])
  expect(el.querySelector('button')?.textContent).toContain('github.com.evil.example')
})

it('does not leak through picture srcsets, SVG images or image srcsets', async () => {
  useVault([])
  vi.spyOn(MarkdownRenderer, 'render').mockImplementation(async (_app, _md, el) => {
    el.innerHTML =
      '<picture><source srcset="https://tracker.example.org/a.png 2x"><img src="images/sample.png" srcset="https://tracker.example.org/b.png 2x"></picture><svg><image href="https://tracker.example.org/c.png"/></svg>'
    for (const processor of MarkdownPreviewRenderer.postProcessors) await processor(el)
    expect(el.querySelector('[srcset]')).toBeNull()
    expect(el.querySelector('image[href]')).toBeNull()
  })
  const el = document.createElement('div')
  await renderGithubMarkdown(el, 'sample', repo, new Component())
  expect(el.querySelectorAll('button').length).toBeGreaterThan(0)
})
