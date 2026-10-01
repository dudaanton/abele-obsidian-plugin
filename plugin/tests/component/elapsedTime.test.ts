import { afterEach, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, onUpdated } from 'vue'
import dayjs from 'dayjs'
import ElapsedTime from '@/components/ElapsedTime.vue'
import {
  installFakeIntersectionObserver,
  resetFakeIntersectionObservers,
  scrollIntoView,
} from '../helpers/fakeIntersectionObserver'

afterEach(() => {
  resetFakeIntersectionObservers()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})
it('updates seconds in the elapsed label without updating its parent panel', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2024, 0, 1, 12))
  // Avoid Vue's unrelated three-second devtools discovery timer in the fake-clock count.
  vi.stubGlobal('__VUE_DEVTOOLS_GLOBAL_HOOK__', { emit: () => {} })
  installFakeIntersectionObserver()
  const updated = vi.fn()
  const start = dayjs().subtract(3661, 'second')
  const wrapper = mount(
    defineComponent({
      setup() {
        onUpdated(updated)
        return () => h('div', h(ElapsedTime, { start }))
      },
    })
  )
  try {
    await flushPromises()
    scrollIntoView(wrapper.find('span').element)
    await flushPromises()
    expect(wrapper.text()).toBe('01:01:01')
    await vi.advanceTimersByTimeAsync(1000)
    expect(wrapper.text()).toBe('01:01:02')
    expect(updated).not.toHaveBeenCalled()
  } finally {
    wrapper.unmount()
  }
  expect(vi.getTimerCount()).toBe(0)
})
