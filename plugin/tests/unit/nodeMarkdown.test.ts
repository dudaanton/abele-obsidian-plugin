import { expect, it, vi } from 'vitest'
// The renderer adapter uses Obsidian's window-local DOM helpers.
import 'obsidian'
import { nodeMarkdownClick, nodeMarkdownPolicy } from '@/node/markdown'
import { markUntrusted, untrustedGuard } from '@/markdown/renderUntrusted'
import { useVault } from '../helpers/testEnv'
import { guardExternalLinks } from '@/markdown/externalLinks'
import { nodeCodeLink } from '@/node/codeLinks'

it('recognises a copied raw node code URI pasted into a chat', () => {
  const root = document.createElement('div')
  const link = nodeCodeLink(
    {
      nodeId: 'node',
      registrationId: 'registration',
      projectId: 'project',
      kind: 'worktree',
      id: 'tree',
    },
    'src/sample.ts',
    { start: 3, end: 7 }
  )
  root.textContent = `See ${link}.`
  nodeMarkdownPolicy.before!(root)
  nodeMarkdownPolicy.before!(root)
  expect(root.querySelector('a')?.getAttribute('data-node-resource')).toBe(link)
})

it('makes natural citations clickable without changing fenced code or web links', () => {
  const root = document.createElement('div')
  root.innerHTML =
    '<p>See <code>src/sample.ts:3-7</code> and src/other.ts:9.</p><pre>src/hidden.ts:4</pre><a href="https://example.test/file:3">Web</a><a href="abele-node-code:sample">Code</a>'
  nodeMarkdownPolicy.before!(root)
  guardExternalLinks(root)
  expect(
    Array.from(root.querySelectorAll('[data-node-resource]')).map((el) =>
      el.getAttribute('data-node-resource')
    )
  ).toEqual(['src/sample.ts:3-7', 'src/other.ts:9', 'abele-node-code:sample'])
  expect(root.querySelector('pre a')).toBeNull()
  expect(root.querySelector('a[href="https://example.test/file:3"]')).not.toBeNull()
})

it('suppresses message cards in raw code markup before processors can resolve nested vault resources', () => {
  useVault([])
  const root = document.createElement('div')
  root.innerHTML =
    '<pre class="language-ABELE-MESSAGE"><code class="language-abele-message">![[sample-local-note.md]]</code></pre>'
  markUntrusted(root, nodeMarkdownPolicy)
  untrustedGuard(root, {} as never)
  expect(root.querySelector('pre')?.className).toBe('')
  expect(root.querySelector('code')?.className).toBe('')
  expect(root.textContent).toContain('![[sample-local-note.md]]')
})

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
