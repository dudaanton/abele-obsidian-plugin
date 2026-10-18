/**
 * The canvas's controls answer a finger. The canvas under them cancels every touch, so the page
 * does not scroll under a pen; a touch on a control used to be cancelled too, and a cancelled
 * touch never becomes a tap, so on a phone or a tablet no tool, menu or undo could be pressed.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { TFile } from 'obsidian'
import CanvasChrome from '@/components/canvas/CanvasChrome.vue'
import { CanvasEditor } from '@/canvas/Editor'
import { CanvasViewer } from '@/canvas/Viewer'
import { CanvasDocument } from '@/canvas/documentRegistry'
import { emptyCanvas } from '@/canvas/core/model'
import { initializeLocale } from '../helpers/i18n'
import { streamCUI } from '@/i18n/streamCLabels'

const cleanups: (() => void)[] = []
afterEach(() => cleanups.splice(0).forEach((fn) => fn()))
afterEach(() => initializeLocale('en'))

function canvas() {
  const el = document.createElement('div')
  document.body.append(el)
  const viewer = new CanvasViewer(el, {
    theme: () => ({
      paper: 'white',
      card: 'white',
      text: 'black',
      border: 'gray',
      accent: 'blue',
      muted: 'gray',
      font: 'sans-serif',
      size: 16,
      lineHeight: 1.4,
      presets: [],
    }),
    assets: async () => ({}),
    cards: { sync: () => new Set(), destroy: () => {} },
    openNode: () => {},
  })
  const file = Object.assign(new TFile(), { path: 'sample.canvas' })
  const snapshot = { graph: emptyCanvas(), revision: 'initial' }
  const doc = new CanvasDocument(
    file,
    snapshot,
    async () => snapshot,
    () => false,
    () => {}
  )
  const editor = new CanvasEditor(viewer, {
    document: () => doc,
    publish: async () => {},
    history: async () => {},
    pickFile: async () => null,
    pickLink: async () => null,
    confirmDiscard: async () => true,
    handoffChoice: async () => 'stay',
    notice: () => {},
  })
  const spot = document.createElement('div')
  viewer.stage.append(spot)
  const wrapper = mount(CanvasChrome, { props: { editor, viewer }, attachTo: spot })
  cleanups.push(() => {
    wrapper.unmount()
    editor.destroy()
    viewer.destroy()
    el.remove()
  })
  return { viewer, editor, wrapper }
}

describe('the canvas controls under a finger', () => {
  it('dispatches stable editor commands from translated tools', () => {
    for (const language of ['ru', 'lv', 'es', 'de']) {
      initializeLocale(language)
      const { wrapper, editor } = canvas()
      const label = streamCUI('Pen (P)')
      const pen = [
        ...wrapper.element.ownerDocument.querySelectorAll<HTMLElement>(
          '.abele-canvas-chrome [aria-label]'
        ),
      ].find((el) => el.getAttribute('aria-label') === label)
      expect(pen, language).toBeDefined()
      pen!.click()
      expect(editor.controls.tool(), language).toBe('pen')
    }
  })

  it('a touch on a tool is not cancelled by the canvas under it, so it becomes a tap', () => {
    const { wrapper } = canvas()
    const pen = wrapper.element.ownerDocument.querySelector<HTMLElement>('[aria-label="Pen (P)"]')!
    expect(pen).not.toBeNull()
    const start = new TouchEvent('touchstart', { bubbles: true, cancelable: true })
    pen.dispatchEvent(start)
    expect(start.defaultPrevented).toBe(false)
  })
  it('a touch on the canvas itself is still cancelled, so nothing scrolls under a pen', () => {
    const { viewer } = canvas()
    const start = new TouchEvent('touchstart', { bubbles: true, cancelable: true })
    viewer.stage.dispatchEvent(start)
    expect(start.defaultPrevented).toBe(true)
  })
  it('the tapped tool is taken in hand', () => {
    const { wrapper, editor } = canvas()
    wrapper.element.ownerDocument.querySelector<HTMLElement>('[aria-label="Pen (P)"]')!.click()
    expect(editor.controls.tool()).toBe('pen')
  })
})
