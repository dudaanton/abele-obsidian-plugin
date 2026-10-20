import { expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import BreakpointMark from '@/components/debugger/BreakpointMark.vue'
it('includes the saved condition in the breakpoint label', () => {
  const wrapper = mount(BreakpointMark, {
    props: {
      breakpoint: {
        file: 'src/sample.ts',
        line: 5,
        state: 'set',
        condition: 'count > 2',
      },
    },
  })
  expect(wrapper.attributes('aria-label')).toContain('count > 2')
  wrapper.unmount()
})
