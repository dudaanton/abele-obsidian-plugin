import { afterEach, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import DebugSource from '@/components/debugger/DebugSource.vue'

afterEach(() => {
  document.body.replaceChildren()
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
      await wrapper.get('.cm-lineNumbers .cm-gutterElement').trigger('contextmenu')
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
      const number = wrapper.get('.cm-lineNumbers .cm-gutterElement')
      await number.trigger('click')
      expect(wrapper.emitted('breakpoint')).toEqual(stale ? undefined : [[1]])
    } finally {
      wrapper.unmount()
    }
  }
)
