import { expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import ConnectionEvents from '@/components/sync/ConnectionEvents.vue'

it('appends live lines and follows the bottom until the reader scrolls up', async () => {
  const host = document.createElement('div')
  host.className = 'abele-modal__body'
  document.body.append(host)
  Object.defineProperties(host, {
    clientHeight: { get: () => 100 },
    scrollHeight: { get: () => 1000 },
  })
  const events = [{ at: 1000, text: 'Uploaded Notes/first.md' }]
  const view = mount(ConnectionEvents, { props: { events }, attachTo: host })
  try {
    await nextTick()
    host.scrollTop = 900
    await view.setProps({ events: [...events, { at: 2000, text: 'Uploaded Notes/second.md' }] })
    await nextTick()
    expect(view.findAll('li').at(-1)?.text()).toContain('second.md')
    expect(host.scrollTop).toBe(1000)
    host.scrollTop = 300
    await view.setProps({ events: [...events, { at: 3000, text: 'Uploaded Notes/third.md' }] })
    await nextTick()
    expect(view.text()).toContain('third.md')
    expect(host.scrollTop).toBe(300)
  } finally {
    view.unmount()
    host.remove()
  }
})
