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
    host.dispatchEvent(new Event('scroll'))
    await view.setProps({ events: [...events, { at: 2000, text: 'Uploaded Notes/second.md' }] })
    await nextTick()
    expect(view.findAll('li').at(-1)?.text()).toContain('second.md')
    expect(host.scrollTop).toBe(1000)
    host.scrollTop = 300
    host.dispatchEvent(new Event('scroll'))
    await view.setProps({ events: [...events, { at: 3000, text: 'Uploaded Notes/third.md' }] })
    await nextTick()
    expect(view.text()).toContain('third.md')
    expect(host.scrollTop).toBe(300)
  } finally {
    view.unmount()
    host.remove()
  }
})

it('preserves reader position across layout movement and follows bottom growth only when pinned', async () => {
  const host = document.createElement('div')
  host.className = 'abele-modal__body'
  document.body.append(host)
  let height = 1000
  Object.defineProperties(host, {
    clientHeight: { get: () => 100 },
    scrollHeight: { get: () => height },
  })
  const first = { at: 1000, text: 'Uploaded Notes/first.md' }
  const second = { at: 2000, text: 'Uploaded Notes/second.md' }
  const view = mount(ConnectionEvents, { props: { events: [first] }, attachTo: host })
  try {
    await nextTick()
    expect(host.classList.contains('abele-sync-window__scroll')).toBe(true)
    host.scrollTop = 300
    host.dispatchEvent(new Event('scroll'))
    // Model browser anchoring after a status/file-name row above the log disappears.
    host.scrollTop = 260
    await view.setProps({ events: [first, second] })
    expect(host.scrollTop).toBe(300)
    host.scrollTop = 900
    host.dispatchEvent(new Event('scroll'))
    // The parent grows before the child updates; proximity after layout is not user intent.
    height = 1200
    await view.setProps({
      events: [first, second, { at: 3000, text: 'Downloaded Notes/third.md' }],
    })
    expect(host.scrollTop).toBe(1200)
    view.unmount()
    host.scrollTop = 400
    host.dispatchEvent(new Event('scroll'))
    expect(host.classList.contains('abele-sync-window__scroll')).toBe(false)
  } finally {
    if (view.exists()) view.unmount()
    host.remove()
  }
})
