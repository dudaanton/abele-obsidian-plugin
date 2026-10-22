import { expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ConnectionEvents from '@/components/sync/ConnectionEvents.vue'
import { ActivityHistory } from '@/sync/activityHistory'

it('measures sustained rendering of twelve thousand actions in an open activity log', async () => {
  const events = new ActivityHistory()
  const view = mount(ConnectionEvents, { props: { events, revision: 0 } })
  let longestMs = 0
  try {
    for (let start = 0; start < 12000; start += 32) {
      const before = performance.now()
      for (let i = start; i < Math.min(start + 32, 12000); i++)
        events.append({ at: 1000 + i, text: 'Uploaded Notes/sample-' + i + '.md' })
      await view.setProps({ revision: events.revision })
      longestMs = Math.max(longestMs, performance.now() - before)
      // Real activity updates have a timer boundary; do not model them as one endless microtask.
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    console.info('[activity responsiveness]', JSON.stringify({ events: 12000, longestMs }))
    expect(view.findAll('li')).toHaveLength(5000)
    expect(longestMs).toBeLessThan(50)
  } finally {
    view.unmount()
  }
})
