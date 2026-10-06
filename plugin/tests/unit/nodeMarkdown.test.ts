import { expect, it, vi } from 'vitest'
// The renderer adapter uses Obsidian's window-local DOM helpers.
import 'obsidian'
import { nodeMarkdownClick, nodeMarkdownPolicy } from '@/node/markdown'

it('routes internal and relative resources to the node rather than same-named vault files', () => {
  const root = document.createElement('div')
  root.innerHTML =
    '<a class="internal-link" data-href="sample.md">Sample</a><a href="src/sample.ts">Source</a><a href="https://example.test/page">Web</a>'
  const open = vi.fn()
  for (const link of root.querySelectorAll('a')) {
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    link.addEventListener('click', (e) => nodeMarkdownClick(e, open))
    link.dispatchEvent(event)
  }
  expect(open.mock.calls).toEqual([['sample.md'], ['src/sample.ts']])
})

it('turns vault embeds into node resources and leaves only explicit web images', () => {
  const root = document.createElement('div')
  root.innerHTML =
    '<span class="internal-embed" src="sample.md">Sample</span><img src="sample.png"><img src="app://local/sample.png"><img src="https://example.test/sample.png">'
  nodeMarkdownPolicy.before!(root)
  expect(root.querySelector('.internal-embed')).toBeNull()
  expect(root.querySelector('[data-node-resource]')?.getAttribute('data-node-resource')).toBe(
    'sample.md'
  )
  expect(root.querySelectorAll('img')).toHaveLength(1)
  expect(root.querySelector('img')?.getAttribute('src')).toBe('https://example.test/sample.png')
})
