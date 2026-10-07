import { expect, it, vi } from 'vitest'
import { watchTheFront } from '@/sync/phone'
import { PublicationPrompt } from '@/sync/publicationPrompt'
import { publicationEditorIdle } from '@/sync/publicationPrompt'

it('offers a deferred sharing question on window focus, but never interrupts an active editor', async () => {
  const registrations: (() => void)[] = []
  const plugin = {
    registerDomEvent: (el: Document | Window, name: string, fn: () => void) => {
      el.addEventListener(name, fn)
      registrations.push(() => el.removeEventListener(name, fn))
    },
  }
  let focused = false
  const prompt = new PublicationPrompt(
    () => focused,
    () => publicationEditorIdle(document)
  )
  const question = { exposureKey: 'sample-question' } as any
  prompt.attach({ questions: async () => [question], answer: async () => true })
  watchTheFront(plugin as any, false, {
    held: () => {
      void prompt.foreground()
    },
    sync: vi.fn(),
  })
  const input = document.createElement('textarea')
  document.body.append(input)
  try {
    await prompt.refresh()
    expect(prompt.asking.value).toBeNull()
    focused = true
    input.focus()
    window.dispatchEvent(new Event('focus'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(prompt.asking.value).toBeNull()
    input.blur()
    window.dispatchEvent(new Event('focus'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(prompt.asking.value?.exposureKey).toBe('sample-question')
  } finally {
    registrations.forEach((fn) => fn())
    input.remove()
  }
})
