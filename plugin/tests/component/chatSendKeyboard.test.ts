/**
 * Pressing Send on a phone while the keyboard is up.
 *
 * The plugin closes the keyboard when a tap lands outside one of its fields, on the finger's
 * lift (`registerFocusRelease`). The Send button is outside the field, so the lift took the
 * focus away — and the chat reacts to losing it by dropping its keyboard layout at once. The
 * composer moved, the click that follows a touch was hit-tested against the new layout, and it
 * no longer landed on the button: the tap closed the keyboard and sent nothing.
 *
 * jsdom has no layout, so it cannot show the click missing. What it can show is the thing the
 * miss depends on: a tap on Send leaves the field focused and never tells the chat it lost
 * focus, so nothing moves under the finger — while a tap on empty space still lets go.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import type { Plugin } from 'obsidian'
import AiChatInput from '@/components/AiChatInput.vue'
import { registerFocusRelease } from '@/helpers/fieldFocus'
import { useVault } from '../helpers/testEnv'

function listen() {
  const registered = new Map<string, (event: Event) => void>()
  const plugin = {
    registerDomEvent: (_el: unknown, type: string, handler: (event: Event) => void) => {
      registered.set(type, handler)
    },
  } as unknown as Plugin
  registerFocusRelease(plugin)
  /** A finger landing on and lifting off `target`, then the click a browser sends after. */
  return (target: Element) => {
    registered.get('touchstart')!({ target, touches: [{ clientX: 5, clientY: 5 }] } as never)
    registered.get('touchend')!({ target, changedTouches: [{ clientX: 5, clientY: 5 }] } as never)
    ;(target as HTMLElement).click()
  }
}

beforeEach(() => {
  useVault([])
  document.body.replaceChildren()
  document.body.className = 'abele-full-width-sidebars'
})

function composer(props: Record<string, unknown> = {}) {
  return mount(AiChatInput, {
    attachTo: document.body,
    props: {
      isStreaming: false,
      isBusy: false,
      canContinue: false,
      tokenDisplay: '12 tokens',
      scopeLabel: '',
      ...props,
    },
  })
}

async function typed(wrapper: ReturnType<typeof composer>, words: string) {
  const field = wrapper.find('textarea')
  ;(field.element as HTMLTextAreaElement).focus()
  await field.setValue(words)
  return field.element as HTMLTextAreaElement
}

describe('Send, tapped with the keyboard up', () => {
  it('sends the message', async () => {
    const tap = listen()
    const wrapper = composer()
    await typed(wrapper, 'hello')

    const send = wrapper.find('.abele-chat-input__toolbar-right [data-keeps-focus]')
    expect(send.exists()).toBe(true)
    tap(send.element)

    expect(wrapper.emitted('send')?.[0]).toEqual(['hello', []])
    wrapper.unmount()
  })

  it('keeps the field focused, so the keyboard stays up for the next message', async () => {
    const tap = listen()
    const wrapper = composer()
    const field = await typed(wrapper, 'hello')
    const focusEvents = () => (wrapper.emitted('focus') ?? []).map((e) => e[0])
    const before = focusEvents().length

    tap(wrapper.find('.abele-chat-input__toolbar-right [data-keeps-focus]').element)

    expect(document.activeElement).toBe(field)
    // The chat drops its keyboard layout on this event; it must not fire before the click.
    expect(focusEvents().slice(before)).not.toContain(false)
    wrapper.unmount()
  })

  it('works the same for the send that queues a message while the agent is answering', async () => {
    const tap = listen()
    const wrapper = composer({ isStreaming: true })
    const field = await typed(wrapper, 'and also')

    const send = wrapper.findAll('[data-keeps-focus]')[0]
    tap(send.element)

    expect(document.activeElement).toBe(field)
    expect(wrapper.emitted('send')?.[0]).toEqual(['and also', []])
    wrapper.unmount()
  })
})

describe('a tap elsewhere in the composer', () => {
  it('still closes the keyboard', async () => {
    const tap = listen()
    const wrapper = composer()
    const field = await typed(wrapper, 'hello')

    tap(wrapper.find('.abele-chat-input__tokens').element)

    expect(document.activeElement).not.toBe(field)
    expect(wrapper.emitted('send')).toBeUndefined()
    wrapper.unmount()
  })
})
