import { afterEach, expect, it, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import dayjs from 'dayjs'
import ElapsedTime from '@/components/ElapsedTime.vue'
import Calendar from '@/components/Calendar.vue'
import Timeline from '@/components/Timeline.vue'
import TimelineSidebar from '@/components/TimelineSidebar.vue'
import { configureAbele, useVault } from '../helpers/testEnv'

let wrapper: VueWrapper | undefined
let frame: HTMLIFrameElement | undefined
afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  frame?.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

it.each([
  ['elapsed', ElapsedTime],
  ['calendar', Calendar],
  ['timeline', Timeline],
  ['sidebar', TimelineSidebar],
] as const)('observes the %s clock in the element owner document', async (name, component) => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2024, 0, 1, 12))
  vi.stubGlobal('__VUE_DEVTOOLS_GLOBAL_HOOK__', { emit() {} })
  useVault([])
  configureAbele()
  frame = document.createElement('iframe')
  document.body.appendChild(frame)
  const doc = frame.contentDocument!
  const win = frame.contentWindow! as Window & typeof globalThis
  vi.spyOn(doc, 'hidden', 'get').mockReturnValue(false)
  vi.spyOn(win, 'setTimeout').mockImplementation(window.setTimeout.bind(window))
  vi.spyOn(win, 'clearTimeout').mockImplementation(window.clearTimeout.bind(window))
  const constructorFor = (owner: Document) =>
    vi.fn(function (callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
      const observer = {
        observe(el: Element) {
          callback(
            [
              {
                target: el,
                time: 0,
                isIntersecting: el.ownerDocument === owner,
              } as IntersectionObserverEntry,
            ],
            observer as unknown as IntersectionObserver
          )
        },
        disconnect: vi.fn(),
        unobserve() {},
        takeRecords: () => [],
        root: options?.root ?? null,
        rootMargin: '',
        thresholds: [0],
      }
      return observer
    })
  const mainObserver = constructorFor(document)
  vi.stubGlobal('IntersectionObserver', mainObserver)
  const popoutObserver = constructorFor(doc)
  win.IntersectionObserver = popoutObserver as unknown as typeof IntersectionObserver
  wrapper = mount(component as any, {
    attachTo: doc.body,
    props:
      name === 'elapsed'
        ? { start: dayjs().subtract(5, 'second') }
        : name === 'timeline'
          ? { tasks: [] }
          : {},
  })
  await flushPromises()
  expect(wrapper.element.ownerDocument).toBe(doc)
  expect(popoutObserver).toHaveBeenCalled()
  expect(popoutObserver.mock.calls.every(([, options]) => options?.root === doc)).toBe(true)
  if (name === 'elapsed') {
    expect(wrapper.text()).toBe('00:00:05')
    await vi.advanceTimersByTimeAsync(1000)
    expect(wrapper.text()).toBe('00:00:06')
  }
})
