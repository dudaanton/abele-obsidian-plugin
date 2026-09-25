/**
 * The card an `abele-message` block in a note is drawn as.
 *
 * Asserted by what reaches the DOM: the chat's title rather than its file name — the one the
 * chat has now, when the chat history knows it — the date of the message under it, and a
 * delete icon among the card's actions that takes the block out of the note without opening
 * the chat.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import type { MarkdownPostProcessorContext } from 'obsidian'
import { registerMessageCardBlock, formatMessageBlock, type MessageBlock } from '@/ai/messageCards'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { ChatService } from '@/ai/ChatService'
import { useVault } from '../helpers/testEnv'

const inner = (block: MessageBlock) => formatMessageBlock(block).split('\n').slice(1, -1).join('\n')

function render(source: string, lineStart = 0) {
  let handler: ((s: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => void) | null =
    null
  registerMessageCardBlock((lang, h) => {
    expect(lang).toBe('abele-message')
    handler = h
  })
  const el = document.body.appendChild(document.createElement('div'))
  const ctx = {
    sourcePath: 'Plans.md',
    addChild: () => {},
    getSectionInfo: () => ({ text: '', lineStart, lineEnd: lineStart + 5 }),
  }
  handler!(source, el, ctx as unknown as MarkdownPostProcessorContext)
  return el
}

const card: MessageBlock = {
  chat: 'AI/Chats/2026-09-23 14-00 Where to.abchat',
  message: 'm2',
  title: 'Where to',
  date: '2026-09-23 14:05',
  text: 'Riga, then Tallinn.',
}

beforeEach(() => {
  document.body.replaceChildren()
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, chatHistory: [] }
  ChatService.getInstance().pendingReveal.value = null
})

describe('the message card in a note', () => {
  it("is titled with the chat's title, and dated with the message", async () => {
    useVault([])
    const el = render(inner(card))
    await flushPromises()

    expect(el.querySelector('.abele-card__name')?.textContent).toBe('Where to')
    expect(el.querySelector('.abele-card__meta')?.textContent).toBe('23 Sep 2026, 14:05')
  })

  it('takes the title the chat has now, when the chat was renamed after the card was made', async () => {
    useVault([])
    AbeleConfig.getInstance().ai.chatHistory = [
      { path: card.chat, title: 'Baltic trip', created: '2026-09-23' },
    ]
    const el = render(inner(card))
    await flushPromises()

    expect(el.querySelector('.abele-card__name')?.textContent).toBe('Baltic trip')
  })

  it('falls back to the file name for a card written before it carried a title', async () => {
    useVault([])
    const el = render(inner({ chat: card.chat, message: 'm2', text: 'hi' }))
    await flushPromises()

    expect(el.querySelector('.abele-card__name')?.textContent).toBe('2026-09-23 14-00 Where to')
    expect(el.querySelector('.abele-card__meta')).toBeNull()
  })

  it('has a delete icon that takes the block out of the note and opens nothing', async () => {
    const before = 'Before\n\n'
    const block = formatMessageBlock(card)
    const app = useVault([{ path: 'Plans.md', raw: `${before}${block}\n\nAfter` }])
    const el = render(inner(card), 2)
    await flushPromises()

    const remove = el.querySelector<HTMLElement>('.abele-card__actions .abele-obsidian-icon')!
    remove.click()
    await flushPromises()

    const file = app.vault.getFileByPath('Plans.md')!
    expect(await app.vault.read(file)).toBe('Before\n\nAfter')
    expect(ChatService.getInstance().pendingReveal.value).toBeNull()
  })
})
