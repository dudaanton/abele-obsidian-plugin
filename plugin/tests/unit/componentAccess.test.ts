import { createApp, defineComponent, h, nextTick, ref } from 'vue'
import { expect, it } from 'vitest'
import { registerTestComponent, testComponent, testComponentEmit } from '@/testing/componentAccess'

it('registers explicit component handles, follows replaced roots and removes unmounted handles', async () => {
  const alternate = ref(false)
  const received: number[] = []
  const component = defineComponent({
    props: { label: String },
    emits: ['select'],
    setup(_props, { expose, emit }) {
      registerTestComponent()
      const send = testComponentEmit(emit)
      expose({ alternate })
      return () =>
        h(alternate.value ? 'button' : 'div', {
          ref: 'testComponentRoot',
          onClick: () => send('select', 8),
        })
    },
  })
  const host = document.createElement('div')
  const app = createApp(component, { label: 'Sample', onSelect: (n: number) => received.push(n) })
  app.mount(host)
  try {
    await nextTick()
    const first = host.firstElementChild!
    const handle = testComponent(first)!
    expect(handle.props.label).toBe('Sample')
    expect(handle.api?.alternate).toBe(alternate)
    handle.emit('select', 7)
    expect(received).toEqual([7])
    // The slider driver intercepts emissions while still calling the original listener.
    const emit = handle.emit
    const intercepted: unknown[][] = []
    handle.emit = (...args) => {
      intercepted.push(args)
      emit(...args)
    }
    ;(first as HTMLElement).click()
    expect(intercepted).toEqual([['select', 8]])
    expect(received).toEqual([7, 8])
    alternate.value = true
    await nextTick()
    expect(testComponent(first)).toBeUndefined()
    expect(testComponent(host.firstElementChild)?.props.label).toBe('Sample')
  } finally {
    const last = host.firstElementChild
    app.unmount()
    expect(testComponent(last)).toBeUndefined()
  }
})
