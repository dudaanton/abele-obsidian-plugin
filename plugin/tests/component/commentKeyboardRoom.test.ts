import { afterEach, describe, expect, it, vi } from 'vitest'
import 'obsidian'
import { attachKeyboardRoom } from '@/modal/keyboardRoom'
import { useFakeClock } from '../helpers/fakeClock'
const advance = useFakeClock()
let detach: (() => void) | undefined
const rect = (top: number, bottom: number) =>
  ({ top, bottom, height: bottom - top, left: 0, right: 390, width: 390, x: 0, y: top }) as DOMRect
afterEach(() => {
  detach?.()
  detach = undefined
  document.body.replaceChildren()
  document.body.classList.remove('is-mobile', 'is-phone')
  document.documentElement.style.removeProperty('--keyboard-height')
  vi.restoreAllMocks()
})
function open(barTop: number, keyboard = 0) {
  document.body.classList.add('is-mobile', 'is-phone')
  Object.defineProperty(window, 'innerHeight', { value: 844, configurable: true })
  Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true })
  Object.defineProperty(window, 'visualViewport', {
    value: Object.assign(new EventTarget(), { height: 844, offsetTop: 0 }),
    configurable: true,
  })
  document.documentElement.style.setProperty('--keyboard-height', `${keyboard}px`)
  const container = document.createElement('div')
  container.className = 'modal-container'
  const panel = document.createElement('div')
  panel.className = 'modal abele-modal mod-lg abele-modal_footed'
  const body = document.createElement('div')
  body.className = 'abele-modal__body'
  const field = document.createElement('textarea')
  body.append(field)
  panel.append(body)
  container.append(panel)
  const toolbar = document.createElement('div')
  toolbar.className = 'mobile-toolbar'
  document.body.append(container, toolbar)
  container.getBoundingClientRect = () => rect(0, 844)
  panel.getBoundingClientRect = () => rect(60, 844)
  body.getBoundingClientRect = () => rect(130, 750)
  field.getBoundingClientRect = () => rect(500, 600)
  toolbar.getBoundingClientRect = () => rect(barTop, barTop + 60)
  field.scrollIntoView = vi.fn()
  detach = attachKeyboardRoom(body)
  field.focus()
  return container
}
describe('comment form with the mobile formatting toolbar', () => {
  it('keeps pinned actions in place until a touch click is delivered after field blur', async () => {
    const container = open(448, 336)
    await advance(500)
    const button = document.createElement('button')
    container.querySelector('.modal')!.append(button)
    button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    button.focus()
    expect(container.classList.contains('abele-keyboard-room')).toBe(true)
    expect(container.style.getPropertyValue('--abele-room-height')).toBe('448px')
    button.click()
    await advance(500)
    expect(container.classList.contains('abele-keyboard-room')).toBe(false)
  })
  it('keeps the title and close action below the phone safe area when fitting a tall form', async () => {
    const style = document.createElement('style')
    style.textContent = '.abele-safe-area-probe { padding-top: 30px; }'
    document.body.append(style)
    const container = open(780)
    await advance(500)
    expect(container.style.getPropertyValue('--abele-room-top')).toBe('30px')
  })
  it('keeps pinned actions above a toolbar even when the software keyboard is hidden', async () => {
    const container = open(780)
    await advance(500)
    expect(container.classList.contains('abele-keyboard-room')).toBe(true)
    expect(container.style.getPropertyValue('--abele-room-height')).toBe('780px')
  })
  it('shrinks a tall footed form into keyboard room rather than leaving its Save button covered', async () => {
    const container = open(448, 336)
    await advance(500)
    expect(container.classList.contains('abele-keyboard-room')).toBe(true)
    expect(container.classList.contains('abele-keyboard-cover')).toBe(false)
    expect(container.style.getPropertyValue('--abele-room-height')).toBe('448px')
  })
})
