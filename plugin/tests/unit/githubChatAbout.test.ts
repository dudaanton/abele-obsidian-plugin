/**
 * A chat started from a GitHub tab: a new chat whose input holds a link to the item, or to the
 * selected lines with their code quoted under it — prefilled, never sent.
 *
 * The chat service and its sessions are real; only the sidebar is stood in for.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { chatAboutGithub, githubChatText } from '@/github/chatAbout'
import { ChatService } from '@/ai/ChatService'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { useVault } from '../helpers/testEnv'

const LINK = {
  label: 'acme/widgets#42 · src/app.ts:10–11',
  url: 'https://github.com/acme/widgets/pull/42/files#diff-abcR10-R11',
}

let service: ChatService

beforeEach(() => {
  useVault([])
  AgentRegistry.destroy()
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, enabled: true, agents: [] }
  const registry = AgentRegistry.getInstance()
  const agent = registry.create({ name: 'Default', providerId: 'p1', modelId: 'm' })
  registry.setDefault(agent.id)
  ;(ChatService as unknown as { instance: ChatService | null }).instance = null
  service = ChatService.getInstance()
  vi.spyOn(service, 'saveTabs').mockImplementation(() => {})
  vi.spyOn(service, 'revealSidebar').mockResolvedValue(undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the text put in the input', () => {
  it('is the link alone for an item, with room to type after it', () => {
    expect(
      githubChatText({
        label: 'acme/widgets#42 · Fix',
        url: 'https://github.com/acme/widgets/pull/42',
      })
    ).toBe('[acme/widgets#42 · Fix](https://github.com/acme/widgets/pull/42) ')
  })

  it("quotes a diff's lines as a diff and a file's lines in their language", () => {
    expect(githubChatText(LINK, { code: '+c\n-d', path: 'src/app.ts', diff: true })).toBe(
      `[acme/widgets#42 · src/app.ts:10–11](${LINK.url})\n\`\`\`diff\n+c\n-d\n\`\`\`\n`
    )
    expect(githubChatText(LINK, { code: 'x = 1', path: 'lib/tool.py' })).toContain(
      '```py\nx = 1\n```'
    )
  })

  it('fences code holding backticks with a longer fence', () => {
    const text = githubChatText(LINK, { code: 'a ``` b', path: 'README.md' })
    expect(text).toContain('````md\na ``` b\n````')
  })
})

describe('opening the chat', () => {
  it('opens a new chat with the text waiting in its input and the cursor after it', async () => {
    expect(await chatAboutGithub(LINK, { code: '+c', path: 'src/app.ts', diff: true })).toBe(true)

    const session = service.activeSession.value!
    expect(service.pendingInput.value).toEqual({
      text: githubChatText(LINK, { code: '+c', path: 'src/app.ts', diff: true }),
      tabId: session.id,
      focus: true,
    })
    expect(session.messages.value).toEqual([])
    expect(service.revealSidebar).toHaveBeenCalled()
  })
})
