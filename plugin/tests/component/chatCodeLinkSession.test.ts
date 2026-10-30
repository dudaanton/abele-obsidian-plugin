import { afterEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import { MarkdownRenderer } from 'obsidian'
import AiChat from '@/components/AiChat.vue'
import { ChatService } from '@/ai/ChatService'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS, type ChatMessage } from '@/ai/types'
import { fakeChatSession } from '../helpers/fakeChatSession'
import { useVault } from '../helpers/testEnv'
import Markdown from '@/components/obsidian/Markdown.vue'
import { NODE_CODE_LINK_OPENER } from '@/node/codeLinkContext'
import { nodeCodeLink } from '@/node/codeLinks'
import { untrustedGuard } from '@/markdown/renderUntrusted'

afterEach(() => vi.restoreAllMocks())

it.each([false, true])(
  'keeps owner code citations clickable when chat access is active: %s',
  async (active) => {
    useVault([])
    const resource = nodeCodeLink(
      {
        nodeId: 'node',
        registrationId: 'local',
        projectId: 'project',
        kind: 'worktree',
        id: 'tree',
      },
      'src/sample.ts',
      { start: 3, end: 7 }
    )
    const opener = Object.assign(vi.fn(), { active: () => active, canOpen: () => false })
    vi.spyOn(MarkdownRenderer, 'render').mockImplementation(async (_app, _text, el) => {
      el.createEl('a', { text: 'source', attr: { href: resource } })
      untrustedGuard(el, {} as never)
    })
    const view = mount(Markdown, {
      props: { text: 'source' },
      global: { provide: { [NODE_CODE_LINK_OPENER as symbol]: opener } },
    })
    try {
      await flushPromises()
      expect(view.get('a').attributes('data-node-resource')).toBe(resource)
      expect(view.get('a').attributes('href')).toBe('#')
    } finally {
      view.unmount()
    }
  }
)

it('renders an answer when the session has no overrides', async () => {
  useVault([])
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS }
  const service = ChatService.getInstance()
  const session = fakeChatSession({
    kind: 'chat',
    messages: ref<ChatMessage[]>([
      { id: 'sample-answer', role: 'assistant', content: 'Sample answer', timestamp: 1 },
    ]),
  })
  expect('overrides' in session).toBe(false)
  vi.spyOn(service, 'ensureInitialized').mockImplementation(() => {})
  vi.spyOn(service, 'activeSession', 'get').mockReturnValue({ value: session } as never)
  vi.spyOn(MarkdownRenderer, 'render').mockImplementation(async (_app, text, el) => {
    el.textContent = text
  })
  const view = mount(AiChat)
  try {
    await flushPromises()
    expect(view.get('.abele-chat-msg_assistant .abele-markdown').text()).toBe('Sample answer')
  } finally {
    view.unmount()
  }
})
