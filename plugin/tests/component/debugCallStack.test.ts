import { mount } from '@vue/test-utils'
import { expect, it } from 'vitest'
import DebugCallStack from '@/components/debugger/DebugCallStack.vue'

it('renders names, raw tooltips, selection, async separators and folded internals', async () => {
  const w = mount(DebugCallStack, {
    props: {
      frames: [
        { name: 'global.makeOrder', file: '/sample/app.js', line: 8 },
        { name: 'Timeout {.tick', file: '/sample/app.js', line: 21 },
        { name: 'setTimeout (async)', file: '', line: 0 },
        { name: 'Module._compile', file: '', line: 1 },
        { name: 'runMain', file: '', line: 2 },
      ],
      selected: 1,
    },
  })
  const frames = w.findAll('.abele-debug-stack__frame')
  expect(frames).toHaveLength(2)
  expect(frames[0].attributes('title')).toBe('global.makeOrder')
  expect(frames[1].text()).toContain('tick')
  expect(frames[1].text()).not.toContain('{')
  expect(frames[1].get('.is-active').attributes('aria-current')).toBe('true')
  expect(frames[1].get('.abele-debug-stack__location').text()).toBe('app.js:21')
  expect(w.get('[role="separator"]').text()).toBe('setTimeout')
  expect(w.get('.abele-debug-stack__internals').text()).toContain('2')
  expect(w.text()).not.toContain('_compile')
  await frames[0].get('.tree-item-self').trigger('click')
  expect(w.emitted('select')?.[0]).toEqual([0])
  await w.get('.abele-debug-stack__internals > .tree-item-self').trigger('click')
  expect(w.text()).toContain('_compile')
  await w.setProps({ disabled: true })
  await frames[0].get('.tree-item-self').trigger('click')
  expect(w.emitted('select')).toHaveLength(1)
  w.unmount()
})
