import { afterEach, expect, it, vi } from 'vitest'
import { measureWordControls } from '../helpers/wordControlsLayout'

const viewport = [window.innerWidth, window.innerHeight]
afterEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: viewport[0] })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: viewport[1] })
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

function fixture() {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 })
  const modal = document.createElement('div')
  const title = modal.appendChild(document.createElement('div'))
  title.className = 'modal-title'
  title.textContent = 'Paragraph 1'
  const close = modal.appendChild(document.createElement('button'))
  close.className = 'modal-close-button'
  close.textContent = 'Close'
  const wrapper = modal.appendChild(document.createElement('div'))
  wrapper.className = 'abele-modal__body'
  const reading = wrapper.appendChild(document.createElement('div'))
  reading.className = 'abele-word-read-only'
  reading.appendChild(document.createElement('p')).textContent = 'Sample visible text'
  document.body.appendChild(modal)
  const body = modal.querySelector<HTMLElement>('.abele-modal__body')!
  const content = body.firstElementChild as HTMLElement
  const paragraph = content.querySelector('p')!
  const rect = (el: Element, x: number, y: number, width: number, height: number) =>
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(new DOMRect(x, y, width, height))
  rect(modal, 0, 180, 390, 760)
  rect(modal.querySelector('.modal-title')!, 80, 205, 200, 30)
  rect(modal.querySelector('button')!, 340, 205, 34, 34)
  rect(body, 16, 260, 358, 640)
  rect(content, 16, 270, 358, 30)
  rect(paragraph, 16, 270, 200, 30)
  Object.defineProperties(body, {
    clientHeight: { configurable: true, value: 640 },
    scrollHeight: { configurable: true, value: 640 },
  })
  return { modal, body, content, paragraph, rect }
}

it('allows native sheet overhang when its text and dismiss action are visible', () => {
  const f = fixture()
  expect(measureWordControls(f.modal, f.body, f.content).clipped).toBe(false)
})

it('reports how far visible content extends past the body edge', () => {
  const f = fixture()
  f.rect(f.paragraph, 16, 270, 380, 30)
  const report = measureWordControls(f.modal, f.body, f.content)
  expect(report.clipped).toBe(true)
  expect(report.over).toEqual(expect.arrayContaining([expect.objectContaining({ by: 22 })]))
})

it('reports content below the viewport when the body cannot scroll it into view', () => {
  const f = fixture()
  f.rect(f.paragraph, 16, 870, 200, 30)
  const report = measureWordControls(f.modal, f.body, f.content)
  expect(report.clipped).toBe(true)
  expect(report.cuts).toEqual(expect.arrayContaining([expect.objectContaining({ by: 56 })]))
})

it('allows content below the fold when its body can scroll it into view', () => {
  const f = fixture()
  f.body.style.overflowY = 'auto'
  Object.defineProperties(f.body, {
    clientHeight: { configurable: true, value: 640 },
    scrollHeight: { configurable: true, value: 1040 },
  })
  f.rect(f.paragraph, 16, 970, 200, 30)
  expect(measureWordControls(f.modal, f.body, f.content).clipped).toBe(false)
})

it('reports the dismiss action cut using the same strict viewport bounds as phoneLayout', () => {
  const f = fixture()
  f.rect(f.modal.querySelector('button')!, 340, 812, 34, 34)
  const report = measureWordControls(f.modal, f.body, f.content)
  expect(report.clipped).toBe(true)
  expect(report.cuts).toEqual(
    expect.arrayContaining([expect.objectContaining({ name: 'modal-close-button', by: 2 })])
  )
})

it('does not treat intentional horizontal scrolling content as overflow', () => {
  const f = fixture()
  const strip = document.createElement('div')
  strip.style.overflowX = 'auto'
  const wide = strip.appendChild(document.createElement('span'))
  wide.textContent = 'Sample scrolling content'
  f.content.appendChild(strip)
  f.rect(strip, 16, 310, 358, 30)
  f.rect(wide, 16, 310, 1000, 30)
  expect(measureWordControls(f.modal, f.body, f.content).clipped).toBe(false)
})
