/**
 * A notice with buttons — "What's new", "Review" — is the kit's: the message and a row of kit
 * buttons rendered into the element Obsidian's notice hands us, there before the notice is
 * measured, and taken out again when the notice is hidden.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Notice } from 'obsidian'
import { noticeWithActions } from '@/components/obsidian/notice'

afterEach(() => {
  for (const el of document.querySelectorAll('.notice')) el.remove()
  Notice.shown.length = 0
})

describe('a notice with actions', () => {
  it('shows the message and one kit button per action, in order, at once', () => {
    const shown = noticeWithActions('Sample message.', [
      { text: 'Open', tooltip: 'Open the sample', accent: true, run: () => {} },
      { text: 'Dismiss', tooltip: 'Dismiss this notice', run: () => {} },
    ])
    const el = shown.notice.messageEl
    expect(el.querySelector('.abele-notice-actions__message')?.textContent).toBe('Sample message.')
    const buttons = [...el.querySelectorAll<HTMLButtonElement>('.abele-notice-actions button')]
    expect(buttons.map((b) => b.textContent?.trim())).toEqual(['Open', 'Dismiss'])
    expect(buttons.every((b) => b.classList.contains('abele-obsidian-button'))).toBe(true)
    expect(buttons[0].classList.contains('mod-cta')).toBe(true)
    expect(buttons[1].classList.contains('mod-cta')).toBe(false)
    shown.hide()
  })

  it('runs the action of the button pressed and nothing else', () => {
    const open = vi.fn()
    const dismiss = vi.fn()
    const shown = noticeWithActions('Sample message.', [
      { text: 'Open', tooltip: 'Open the sample', run: open },
      { text: 'Dismiss', tooltip: 'Dismiss this notice', run: dismiss },
    ])
    shown.notice.messageEl.querySelectorAll('button')[1].click()
    expect(dismiss).toHaveBeenCalledOnce()
    expect(open).not.toHaveBeenCalled()
    shown.hide()
  })

  it('takes its buttons out and closes the notice when hidden, twice safely', () => {
    const shown = noticeWithActions('Sample message.', [
      { text: 'Open', tooltip: 'Open the sample', run: () => {} },
    ])
    const { messageEl, containerEl } = shown.notice
    shown.hide()
    expect(messageEl.childNodes).toHaveLength(0)
    expect(containerEl.isConnected).toBe(false)
    expect(() => shown.hide()).not.toThrow()
  })
})
