import { describe, expect, it } from 'vitest'
import { flashExactSelection, messageRenderedText } from '@/ai/messageComments'

describe('selection return renderer verification', () => {
  it('marks only the recorded repeated occurrence across formatting boundaries', () => {
    const root = document.createElement('div')
    root.innerHTML = '<p>echo <strong>ec</strong>ho</p>'
    expect(
      flashExactSelection(
        root,
        { version: 'chat-text-v1', text: 'echo echo' },
        { space: 'rendered', start: 5, end: 9 }
      )
    ).not.toBeNull()
    expect(
      [...root.querySelectorAll('[data-selection-return]')].map((el) => el.textContent).join('')
    ).toBe('echo')
    expect(root.querySelector('p')!.firstChild!.textContent).toBe('echo ')
    expect(messageRenderedText(root)).toBe('echo echo')
  })
  it('never falls back to a nearby quote or a changed renderer projection', () => {
    const root = document.createElement('div')
    root.innerHTML = '<p>changed echo echo</p>'
    expect(
      flashExactSelection(
        root,
        { version: 'chat-text-v1', text: 'echo echo' },
        { space: 'rendered', start: 5, end: 9 }
      )
    ).toBeNull()
    expect(
      flashExactSelection(
        root,
        { version: 'future-renderer', text: 'changed echo echo' },
        { space: 'rendered', start: 8, end: 12 }
      )
    ).toBeNull()
    expect(root.querySelector('[data-selection-return]')).toBeNull()
  })
})
