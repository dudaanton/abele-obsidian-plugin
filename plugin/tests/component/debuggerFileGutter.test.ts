import { afterEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { reactive } from 'vue'
import DebugSource from '@/components/debugger/DebugSource.vue'

afterEach(() => {
  document.body.replaceChildren()
})

it('sizes the inline point editor to the visible pane rather than a long source line', async () => {
  const width = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(300)
  const wrapper = mount(DebugSource, {
    attachTo: document.body,
    props: {
      path: 'sample.ts',
      text: 'const sample = ' + 'x'.repeat(500),
      breakpoints: [],
      editing: 1,
    },
  })
  try {
    await flushPromises()
    const editor = wrapper.get('.abele-debug-source__point-editor').element as HTMLElement
    expect(parseFloat(editor.style.width)).toBeGreaterThan(0)
    expect(parseFloat(editor.style.width)).toBeLessThanOrEqual(300)
  } finally {
    wrapper.unmount()
    width.mockRestore()
  }
})

it('keeps a pending marker connected across equivalent marks and editor-only updates', async () => {
  const point = reactive({ file: 'sample.ts', line: 1, state: 'pending' as 'pending' | 'disabled' })
  const wrapper = mount(DebugSource, {
    attachTo: document.body,
    props: { path: 'sample.ts', text: 'const sample = 1', breakpoints: [point] },
  })
  try {
    await flushPromises()
    const marker = wrapper.get('button.abele-debug-source__point').element
    await wrapper.setProps({ breakpoints: [{ ...point }] })
    expect(wrapper.get('button.abele-debug-source__point').element).toBe(marker)
    await wrapper.setProps({ editing: 1 })
    expect(wrapper.get('button.abele-debug-source__point').element).toBe(marker)
    expect(marker.isConnected).toBe(true)
    await wrapper
      .get('button.abele-debug-source__point')
      .trigger('contextmenu', { clientX: 480, clientY: 320 })
    expect(wrapper.emitted('margin-menu')?.[0]?.[0]).toBe(1)
    const updated = reactive({ ...point })
    await wrapper.setProps({ breakpoints: [updated] })
    updated.state = 'disabled'
    await flushPromises()
    expect(wrapper.find('.abele-breakpoint-mark_disabled').exists()).toBe(true)
  } finally {
    wrapper.unmount()
  }
})

it.each([false, true])(
  'opens line-number menus with pending or session marks: %s',
  async (session) => {
    const wrapper = mount(DebugSource, {
      attachTo: document.body,
      props: {
        path: 'sample.ts',
        text: 'const sample = 1',
        breakpoints: [{ file: 'sample.ts', line: 1, state: session ? 'set' : 'pending' }],
      },
    })
    try {
      await flushPromises()
      await wrapper
        .findAll('.cm-lineNumbers .cm-gutterElement')
        .find(
          (element) =>
            element.text() === '1' && (element.element as HTMLElement).style.visibility !== 'hidden'
        )!
        .trigger('contextmenu')
      expect(wrapper.emitted('margin-menu')?.[0]?.[0]).toBe(1)
    } finally {
      wrapper.unmount()
    }
  }
)

it.each([false, true])(
  'line numbers toggle breakpoints only on a current source (stale: %s)',
  async (stale) => {
    const wrapper = mount(DebugSource, {
      attachTo: document.body,
      props: { path: 'sample.ts', text: 'const sample = 1', breakpoints: [], stale },
    })
    try {
      await flushPromises()
      const number = wrapper
        .findAll('.cm-lineNumbers .cm-gutterElement')
        .find(
          (element) =>
            element.text() === '1' && (element.element as HTMLElement).style.visibility !== 'hidden'
        )!
      expect((number.element as HTMLElement).style.visibility).not.toBe('hidden')
      await number.trigger('click')
      expect(wrapper.emitted('breakpoint')).toEqual(stale ? undefined : [[1]])
    } finally {
      wrapper.unmount()
    }
  }
)
