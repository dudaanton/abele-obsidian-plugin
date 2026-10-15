/**
 * Words typed into a frame's name or a connection's label are the browser's own text: closing
 * the field must not break the controls drawn over the canvas, and the bar over what is picked
 * comes back.
 */
import { afterEach, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { cards, pointer, setup } from '../helpers/canvasEditorHarness'
import { mountCanvasChrome } from '@/canvas/chrome'

const errors: unknown[] = []
const onError = (e: unknown) => errors.push(e)
afterEach(() => {
  process.off('unhandledRejection', onError)
  errors.length = 0
})
function harness() {
  const s = setup(cards())
  Object.defineProperty(s.viewer.stage, 'clientWidth', { value: 1000 })
  Object.defineProperty(s.viewer.stage, 'clientHeight', { value: 800 })
  const off = mountCanvasChrome(s.viewer, s.editor, {} as never)
  s.viewer.setCamera({ x: -100, y: -100, zoom: 1 })
  process.on('unhandledRejection', onError)
  return { s, off }
}
/** Types into the open field as a browser does: its text replaced, not Vue's node kept. */
async function write(el: HTMLElement, text: string) {
  el.focus()
  el.replaceChildren(document.createTextNode(text))
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
  await new Promise((r) => setTimeout(r, 30))
  await nextTick()
}

it("brings back a frame's bar once its name is written", async () => {
  const { s, off } = harness()
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const c = s.editor.controls
  c.useTool('frame')
  const m = { pointerType: 'mouse' }
  pointer(s, 'pointerdown', 50, 50, { ...m, buttons: 1 })
  pointer(s, 'pointermove', 400, 250, { ...m, buttons: 1 })
  pointer(s, 'pointerup', 700, 300, m)
  await vi.waitFor(() => expect(c.naming()).not.toBeNull())
  await nextTick()
  await write(
    s.el.querySelector<HTMLElement>('[data-frame-id][contenteditable="true"]')!,
    'Sample stage'
  )
  await vi.waitFor(() =>
    expect(s.document.session.graph.nodes.find((n) => n.type === 'group')?.label).toBe(
      'Sample stage'
    )
  )
  await nextTick()
  expect(s.el.querySelector('[data-frame-id][contenteditable="true"]')).toBeNull()
  expect(s.el.querySelector('.abele-canvas-chrome__picked [aria-label="Rename"]')).not.toBeNull()
  expect(warn.mock.calls.filter((a) => String(a[0]).includes('Unhandled error'))).toEqual([])
  expect(errors).toEqual([])
  warn.mockRestore()
  off()
})

it("brings back a connection's bar once its label is written", async () => {
  const { s, off } = harness()
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const c = s.editor.controls
  c.editLabel('connection')
  await nextTick()
  await nextTick()
  const field = s.el.querySelector<HTMLElement>('.abele-canvas-chrome__label')!
  expect(field).not.toBeNull()
  await write(field, 'Sample feeds')
  field.blur()
  await vi.waitFor(() => expect(s.document.session.graph.edges[0].label).toBe('Sample feeds'))
  await nextTick()
  expect(s.el.querySelector('.abele-canvas-chrome__label')).toBeNull()
  expect(s.el.querySelector('.abele-canvas-chrome__picked')).not.toBeNull()
  expect(warn.mock.calls.filter((a) => String(a[0]).includes('Unhandled error'))).toEqual([])
  expect(errors).toEqual([])
  warn.mockRestore()
  off()
})
