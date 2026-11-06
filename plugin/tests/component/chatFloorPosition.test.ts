import { readFileSync } from 'node:fs'
import { afterEach, expect, it } from 'vitest'

afterEach(() => document.body.replaceChildren())

it('keeps the scroll containing block stable when the anchor floor is enabled and released', () => {
  const source = readFileSync('src/components/AiChat.vue', 'utf8')
  // Exercise the production declarations without requiring the rest of the app.
  const rules = source.match(/\.abele-ai-chat__messages(?:_floor)?\s*\{[^}]*\}/g)
  expect(rules?.length).toBeGreaterThan(0)
  const style = document.createElement('style')
  style.textContent = rules!.join('\n')
  const box = document.createElement('div')
  box.className = 'abele-ai-chat__messages'
  document.body.append(style, box)
  const positions = [getComputedStyle(box).position]
  for (let i = 0; i < 3; i++) {
    box.classList.add('abele-ai-chat__messages_floor')
    positions.push(getComputedStyle(box).position)
    box.classList.remove('abele-ai-chat__messages_floor')
    positions.push(getComputedStyle(box).position)
  }
  expect(positions).toEqual(Array(7).fill('relative'))
})
