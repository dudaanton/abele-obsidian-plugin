import { expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

it('halves header and composer side padding while preserving the message inset', () => {
  const chat = readFileSync('src/components/AiChat.vue', 'utf8')
  const input = readFileSync('src/components/chat/input.scss', 'utf8')
  expect(chat).toMatch(
    /\.abele-ai-chat__header\s*\{[^}]*padding: var\(--size-4-1\) calc\(var\(--abele-chat-inset\) \/ 2\)/s
  )
  expect(input).toContain(
    'padding: var(--size-4-2) calc(var(--abele-chat-inset, var(--size-4-4)) / 2)'
  )
  expect(chat).toMatch(
    /\.abele-ai-chat__messages\s*\{[^}]*padding: var\(--size-4-2\) var\(--abele-chat-inset\)/s
  )
  expect(chat).toContain('--abele-chat-inset: calc(var(--p-spacing) * 2)')
  expect(chat).toContain('--abele-chat-inset: var(--size-4-4)')
})
