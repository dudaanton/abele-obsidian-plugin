import { mount } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import { MarkdownRenderer, MarkdownPreviewRenderer } from 'obsidian'
import NodeMessageTree from '@/components/NodeMessageTree.vue'
import Markdown from '@/components/obsidian/Markdown.vue'
import { useVault } from '../helpers/testEnv'
import { formatMessageBlock, registerMessageCardBlock } from '@/ai/messageCards'
import { offer, recordSignatures } from '@/components/obsidian/markdownParts'
import { Component } from 'obsidian'

const reply = formatMessageBlock({
  chat: 'AI/Chats/sample.abchat',
  message: 'sample',
  text: '![[sample-local-note.md]]\n\n[[sample-local-note]]',
})
afterEach(() => vi.restoreAllMocks())

it('renders nested message cards in node replies as code without resolving their local note embeds', async () => {
  const app = useVault([{ path: 'sample-local-note.md', raw: 'LOCAL VAULT CONTENT' }])
  const read = vi.spyOn(app.vault, 'read')
  const card = vi.fn()
  registerMessageCardBlock((_language, handler) => {
    card.mockImplementation(handler)
  })
  vi.spyOn(MarkdownRenderer, 'render').mockImplementation(async (_app, text, el, _path, owner) => {
    const match = /^```([^\n]+)\n([\s\S]*)\n```$/.exec(text)
    if (!match) {
      el.textContent = await app.vault.read(app.vault.getFileByPath('sample-local-note.md')!)
      return
    }
    const pre = el.createEl('pre'),
      code = pre.createEl('code', { text: match[2] })
    code.className = `language-${match[1]}`
    for (const guard of MarkdownPreviewRenderer.postProcessors) guard(el)
    if (code.classList.contains('language-abele-message'))
      card(match[2], el, {
        sourcePath: '',
        addChild: (child: Component) => (owner as Component).addChild(child),
        getSectionInfo: () => null,
      })
  })
  const wrapper = mount(NodeMessageTree, {
    props: {
      messages: [{ id: 'reply', role: 'assistant', content: reply, timestamp: 0 }],
      children: {},
      openResource: vi.fn(),
    },
  })
  try {
    await vi.waitFor(() => expect(wrapper.find('pre').exists()).toBe(true))
    expect(card).not.toHaveBeenCalled()
    expect(wrapper.find('.abele-message-card').exists()).toBe(false)
    expect(wrapper.text()).toContain('![[sample-local-note.md]]')
    expect(read).not.toHaveBeenCalled()
  } finally {
    wrapper.unmount()
  }
})

it('rerenders rather than retaining local markup when the resource context changes', async () => {
  useVault([])
  vi.spyOn(MarkdownRenderer, 'render').mockImplementation(async (_app, text, el) => {
    const code = el.createEl('pre').createEl('code')
    code.textContent = reply
    recordSignatures(el)
    code.textContent = text.includes('```text') ? reply : 'LOCAL VAULT CONTENT'
  })
  const wrapper = mount(Markdown, { props: { text: reply } })
  try {
    await vi.waitFor(() => expect(wrapper.text()).toContain('LOCAL VAULT CONTENT'))
    await wrapper.setProps({ resourceOpener: vi.fn() })
    await vi.waitFor(() => expect(wrapper.text()).not.toContain('LOCAL VAULT CONTENT'))
    expect(wrapper.text()).toContain('![[sample-local-note.md]]')
  } finally {
    wrapper.unmount()
  }
})

it('discards an in-flight local render if its host becomes node history', async () => {
  useVault([])
  let finish!: () => void
  vi.spyOn(MarkdownRenderer, 'render').mockImplementation(async (_app, text, el) => {
    const code = el.createEl('pre').createEl('code', { text: reply })
    recordSignatures(el)
    if (!text.includes('```text')) {
      await new Promise<void>((resolve) => {
        finish = resolve
      })
      code.textContent = 'LOCAL VAULT CONTENT'
    }
  })
  const wrapper = mount(Markdown, { props: { text: reply } })
  try {
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    await wrapper.setProps({ resourceOpener: vi.fn() })
    finish()
    await vi.waitFor(() => expect(wrapper.text()).toContain('![[sample-local-note.md]]'))
    expect(wrapper.text()).not.toContain('LOCAL VAULT CONTENT')
    expect(wrapper.emitted('rendered')).toHaveLength(1)
  } finally {
    wrapper.unmount()
  }
})

it('does not adopt a same-text local streaming render into node history', async () => {
  useVault([])
  const node = document.createElement('div')
  node.textContent = 'LOCAL VAULT CONTENT'
  const owner = new Component()
  offer({ text: reply, doc: document, partial: false, parts: [{ node, sig: reply, owner }] }, () =>
    owner.unload()
  )
  const render = vi.spyOn(MarkdownRenderer, 'render').mockImplementation(async (_app, text, el) => {
    el.textContent = text
  })
  const wrapper = mount(NodeMessageTree, {
    props: {
      messages: [{ id: 'reply', role: 'assistant', content: reply, timestamp: 0 }],
      children: {},
      openResource: vi.fn(),
    },
  })
  try {
    await vi.waitFor(() => expect(render).toHaveBeenCalled())
    expect(wrapper.text()).not.toContain('LOCAL VAULT CONTENT')
    expect(render.mock.calls[0][1]).toContain('```text')
  } finally {
    wrapper.unmount()
  }
})
