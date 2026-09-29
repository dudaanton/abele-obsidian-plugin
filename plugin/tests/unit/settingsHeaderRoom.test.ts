import { describe, expect, it } from 'vitest'
import { settingsHeaderRoom } from '@/components/settings/settingsHeaderRoom'

describe('the fixed settings header on a phone', () => {
  it('reserves the header room in the pane owner window and gives it back on unmount', () => {
    const parent = document.createElement('div')
    const pane = document.createElement('div')
    const header = document.createElement('div')
    parent.append(pane, header)
    document.body.append(parent)
    let bottom = 91
    parent.getBoundingClientRect = () => ({ top: 0 }) as DOMRect
    header.getBoundingClientRect = () => ({ bottom }) as DOMRect
    try {
      const stop = settingsHeaderRoom(pane, header)
      expect(pane.classList.contains('abele-settings-pane_phone')).toBe(true)
      expect(pane.style.getPropertyValue('--abele-settings-header-room')).toBe('91px')
      const back = document.createElement('button')
      header.append(back)
      back.getBoundingClientRect = () => ({ bottom: 106 }) as DOMRect
      // Absolutely positioned native buttons can extend below the title's own box.
      pane.ownerDocument.defaultView!.dispatchEvent(new Event('resize'))
      expect(pane.style.getPropertyValue('--abele-settings-header-room')).toBe('106px')
      stop()
      expect(pane.classList.contains('abele-settings-pane_phone')).toBe(false)
      expect(pane.style.getPropertyValue('--abele-settings-header-room')).toBe('')
    } finally {
      parent.remove()
    }
  })
})
