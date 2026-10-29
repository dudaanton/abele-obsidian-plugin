import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { MarkdownRenderer } from 'obsidian'
import Markdown from '@/components/obsidian/Markdown.vue'
import GithubText from '@/components/github/GithubText.vue'
import { isPrintMode } from '@/markdown/printMode'
import { useVault } from '../helpers/testEnv'

beforeEach(() => {
  useVault([])
  document.body.replaceChildren()
})

afterEach(() => {
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

it.each(['markdown', 'github'])(
  'propagates export context through detached %s rendering and the final swap',
  async (kind) => {
    const root = document.body.appendChild(document.createElement('div'))
    root.className = 'print'
    const contexts: boolean[] = []
    vi.spyOn(MarkdownRenderer, 'render').mockImplementation(async (_app, _text, el) => {
      expect(el.parentElement).toBeNull()
      const child = el.appendChild(document.createElement('p'))
      child.textContent = 'Sample excerpt'
      contexts.push(isPrintMode(child))
    })
    const wrapper =
      kind === 'markdown'
        ? mount(Markdown, { attachTo: root, props: { text: 'Sample excerpt', trusted: true } })
        : mount(GithubText, {
            attachTo: root,
            props: {
              text: 'Sample excerpt',
              repo: {
                host: 'github.com',
                owner: 'example',
                repo: 'sample',
                ref: 'HEAD',
                path: 'sample.md',
              },
            },
          })
    try {
      await flushPromises()
      expect(contexts).toEqual([true])
      expect(wrapper.text()).toBe('Sample excerpt')
      expect(isPrintMode(wrapper.element.querySelector('p')!)).toBe(true)
    } finally {
      wrapper.unmount()
    }
  }
)
