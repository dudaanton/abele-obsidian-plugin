/**
 * The pencil of an answer the interceptor replaced comes up with the rest of the message's bar:
 * under the pointer or with the keyboard inside the message, never standing on its own. The
 * turning glyph of an answer still being checked stays, and a phone, which cannot point, keeps
 * the pencil like it keeps the time.
 *
 * The bar's own stylesheet is loaded, translated for jsdom: it cannot hover, so `:hover` is read
 * as a class; its selector engine never matches `:focus-within`, so that is read as the
 * `:has(:focus)` it means; and it refuses a line break inside `:is()`, so the sheet is one line.
 */
import { readFileSync } from 'node:fs'
import { compileString } from 'sass-embedded'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import AiChatMessage from '@/components/AiChatMessage.vue'
import { interceptorRevision } from '@/ai/replyAnnotations'
import type { ChatMessage } from '@/ai/types'
import { useVault } from '../helpers/testEnv'

const answer: ChatMessage = {
  id: 'reply',
  role: 'assistant',
  content: 'The lantern is on the shelf.',
  timestamp: 1,
}

beforeAll(() => {
  const source = readFileSync('src/components/ChatMessageBar.vue', 'utf8')
  const scss = source.match(/<style lang="scss">([\s\S]*?)<\/style>/)![1]
  const style = document.createElement('style')
  style.textContent = compileString(scss)
    .css.replace(/\s+/g, ' ')
    .replaceAll(':hover', '.test-hover')
    .replaceAll(':focus-within', ':has(:focus)')
  document.head.appendChild(style)
})

let view: VueWrapper | undefined
beforeEach(() => useVault([]))
afterEach(() => {
  view?.unmount()
  view = undefined
  document.body.classList.remove('is-mobile')
})

const opacity = (selector: string) =>
  getComputedStyle(view!.find(selector).element as HTMLElement).opacity

function replaced() {
  const message = interceptorRevision(answer, 'The lamp is on the shelf.', 'Sample checker', 2)
  view = mount(AiChatMessage, { attachTo: document.body, props: { message } })
  return view
}

describe('the pencil of a replaced answer', () => {
  it('is hidden while the pointer is elsewhere', () => {
    replaced()
    expect(opacity('.abele-chat-msg__quick')).toBe('0')
    expect(opacity('.abele-chat-msg__edited')).toBe('0')
  })

  it('comes up under the pointer', () => {
    replaced().element.classList.add('test-hover')
    expect(opacity('.abele-chat-msg__edited')).not.toBe('0')
  })

  it('comes up with the keyboard inside the message', () => {
    ;(replaced().find('.abele-chat-msg__quick button').element as HTMLElement).focus()
    expect(opacity('.abele-chat-msg__edited')).not.toBe('0')
  })

  it('stays on a phone, beside the time', () => {
    document.body.classList.add('is-mobile')
    replaced()
    expect(opacity('.abele-chat-msg__edited')).not.toBe('0')
  })
})

it('keeps the glyph of an answer being checked without a hover', () => {
  view = mount(AiChatMessage, {
    attachTo: document.body,
    props: { message: { ...answer, answerCheck: { by: 'Sample checker' } } },
  })
  expect(opacity('.abele-chat-msg__checking')).not.toBe('0')
})
