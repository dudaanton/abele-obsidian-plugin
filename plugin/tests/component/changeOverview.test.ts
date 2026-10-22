import { afterEach, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import ChangeOverview from '@/components/obsidian/ChangeOverview.vue'
import Diff from '@/components/Diff.vue'
import { EditorView } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { h } from 'vue'

afterEach(() => vi.restoreAllMocks())
const bounds = (top: number, height: number) => ({
  top,
  bottom: top + height,
  left: 10,
  right: 610,
  width: 600,
  height,
  x: 10,
  y: top,
  toJSON() {},
})

it('navigates the working editor rather than the original editor in split mode', () => {
  const dispatch = vi.fn()
  const find = vi.spyOn(EditorView, 'findFromDOM').mockReturnValue({
    state: EditorState.create({ doc: 'working\nnext' }),
    dispatch,
  } as never)
  const view = mount(Diff, {
    props: { textLeft: 'old', textRight: 'working\nnext', overview: true },
    slots: {
      editor: () => [
        h('div', { class: 'cm-editor cm-merge-a' }),
        h('div', { class: 'cm-editor cm-merge-b' }),
      ],
    },
  })
  try {
    view.getComponent(ChangeOverview).vm.$emit('navigate', 2)
    expect(find).toHaveBeenCalledWith(view.get('.cm-merge-b').element)
    expect(dispatch).toHaveBeenCalled()
  } finally {
    view.unmount()
  }
})

it('reveals the unchanged context requested through the overview before navigating', async () => {
  const tail = Array.from({ length: 20 }, (_, index) => `same ${index}`).join('\n')
  const view = mount(Diff, {
    props: { textLeft: `old\n${tail}`, textRight: `new\n${tail}`, context: 1, overview: true },
  })
  try {
    expect(view.find('[data-line-b="10"]').exists()).toBe(false)
    view.getComponent(ChangeOverview).vm.$emit('navigate', 10)
    await flushPromises()
    expect(view.find('[data-line-b="10"]').exists()).toBe(true)
  } finally {
    view.unmount()
  }
})

it('shows a viewport band and translated marks, and navigates on click and drag', async () => {
  const scroll = document.createElement('div')
  scroll.style.overflowY = 'auto'
  const root = document.createElement('div')
  scroll.append(root)
  document.body.append(scroll)
  vi.spyOn(scroll, 'getBoundingClientRect').mockReturnValue(bounds(0, 500))
  vi.spyOn(root, 'getBoundingClientRect').mockReturnValue(bounds(-500, 2000))
  const view = mount(ChangeOverview, {
    props: { root, totalLines: 200, changes: [{ from: 120, to: 134, kind: 'added' }] },
  })
  try {
    await flushPromises()
    const strip = document.body.querySelector<HTMLElement>('.abele-change-overview')!
    expect(strip).not.toBeNull()
    expect(strip.querySelector('.abele-change-overview__band')?.getAttribute('style')).toContain(
      'top: 25%'
    )
    expect(strip.querySelector('.abele-change-overview__mark')?.getAttribute('aria-label')).toBe(
      'Lines 120–134 · added'
    )
    vi.spyOn(strip, 'getBoundingClientRect').mockReturnValue(bounds(0, 500))
    strip.setPointerCapture = vi.fn()
    strip.hasPointerCapture = vi.fn(() => true)
    strip.releasePointerCapture = vi.fn()
    strip.dispatchEvent(
      new PointerEvent('pointerdown', { pointerId: 1, clientY: 250, bubbles: true })
    )
    strip.dispatchEvent(
      new PointerEvent('pointermove', { pointerId: 1, clientY: 490, bubbles: true })
    )
    strip.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true }))
    expect(view.emitted('navigate')).toEqual([[101], [197]])
    expect(strip.releasePointerCapture).toHaveBeenCalledWith(1)
    strip.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))
    expect(view.emitted('navigate')?.at(-1)).toEqual([200])
    vi.mocked(root.getBoundingClientRect).mockReturnValue(bounds(-1000, 2000))
    window.dispatchEvent(new Event('scroll'))
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
    expect(strip.querySelector('.abele-change-overview__band')?.getAttribute('style')).toContain(
      'top: 50%'
    )
    await view.setProps({ changes: [{ from: 5, to: 5, kind: 'removed' }] })
    expect(strip.querySelector('.abele-change-overview__mark_removed')).not.toBeNull()
  } finally {
    view.unmount()
    scroll.remove()
  }
})

it('keeps the strip for a short file without a viewport band', async () => {
  const root = document.createElement('div')
  document.body.append(root)
  vi.spyOn(root, 'getBoundingClientRect').mockReturnValue(bounds(0, 80))
  const view = mount(ChangeOverview, { props: { root, totalLines: 3, changes: [] } })
  try {
    await flushPromises()
    expect(document.body.querySelector('.abele-change-overview')).not.toBeNull()
    expect(document.body.querySelector('.abele-change-overview__band')).toBeNull()
  } finally {
    view.unmount()
    root.remove()
  }
})
