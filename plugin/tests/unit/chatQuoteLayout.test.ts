import { expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

it('gives a quoted user message the available bubble width and removes browser quote side margins', () => {
  const css = readFileSync('src/styles/chatMessage/body.scss', 'utf8')
  expect(css).toMatch(/&_user\s+\.abele-chat-msg__body:has\(blockquote\)\s*\{[^}]*flex:\s*1/s)
  expect(css).toMatch(/blockquote\s*\{[^}]*margin-inline:\s*0/s)
})

it('lets failure summaries wrap inside the chat pane', () => {
  const component = readFileSync('src/components/ChatToolRun.vue', 'utf8')
  expect(component).toMatch(
    /\.abele-chat-run_failed > \.tree-item-self\s*\{[\s\S]*?white-space:\s*normal/
  )
})

it('keeps the failure summary caret on its first line', () => {
  const component = readFileSync('src/components/ChatToolRun.vue', 'utf8')
  expect(component).toMatch(
    /\.abele-chat-run_failed\.abele-chat-run_inline-file > \.tree-item-self\s*\{\s*align-items:\s*flex-start/
  )
})
