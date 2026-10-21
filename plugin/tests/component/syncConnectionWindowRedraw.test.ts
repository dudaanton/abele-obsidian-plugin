import { afterEach, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import ConnectionWindow from '@/components/sync/ConnectionWindow.vue'
import ConnectionEvents from '@/components/sync/ConnectionEvents.vue'
import { historyConnection } from '@/sync/tokenHistory'
import { tokenUiFixture } from '@/testing/tokenUiFixture'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  historyConnection.value = null
})

const pull = (completed: number) => ({ pull: { stage: 'Receiving files', completed, total: 1000 } })

function mountWindow() {
  const ui = tokenUiFixture(),
    id = ui.rows.value[0].id
  const events = Array.from({ length: 100 }, (_, i) => ({ at: 1000 + i, text: `Event ${i}` }))
  ui.publish(id, { ...pull(0), events })
  const renders = { window: 0, events: 0, chunks: 0 }
  const view = mount(ConnectionWindow, {
    props: { ui, connectionId: id },
    global: {
      stubs: { Modal: { template: '<div><slot /></div>' }, SelectiveSync: true },
      mixins: [
        {
          updated(this: { $: { type: { __name?: string } } }) {
            // The window's rows render inside the modal's slot; its progress bar is drawn
            // again on every redraw of the window body.
            if (this.$.type.__name === 'Progress') renders.window++
            if (this.$.type === (ConnectionEvents as unknown)) renders.events++
            if (this.$.type.__name === 'ConnectionEventChunk') renders.chunks++
          },
        },
      ],
    },
  })
  return { ui, id, view, renders }
}

it('leaves the recent list alone when only progress moves', async () => {
  vi.useFakeTimers()
  const { ui, id, view, renders } = mountWindow()
  try {
    const formatted = vi.spyOn(Date.prototype, 'toLocaleTimeString')
    for (let i = 1; i <= 5; i++) {
      ui.publish(id, pull(i))
      await vi.advanceTimersByTimeAsync(300)
    }
    expect(view.find('.abele-sync-window__progress').text()).toBe('Receiving files · 5 of 1000')
    expect(renders.window).toBeGreaterThan(0)
    expect(renders.events).toBe(0)
    expect(formatted).not.toHaveBeenCalled()
    expect(view.findAll('.abele-sync-window__events li')).toHaveLength(100)

    ui.recordEvent(id, 'Downloaded Notes/new.md')
    await vi.advanceTimersByTimeAsync(300)
    expect(renders.events).toBe(1)
    expect(view.findAll('.abele-sync-window__events li').at(-1)?.text()).toContain(
      'Downloaded Notes/new.md'
    )
    // Only the new row's time is formatted; the rest keep theirs.
    expect(formatted).toHaveBeenCalledTimes(1)
  } finally {
    view.unmount()
  }
})

it('retains only the latest timed actions after thirty thousand file events', async () => {
  const { ui, id, view } = mountWindow()
  try {
    for (let i = 0; i < 30000; i++) ui.recordEvent(id, `Uploaded Notes/sample-${i}.md`)
    await new Promise((resolve) => setTimeout(resolve, 300))
    const rows = view.findAll('.abele-sync-window__events li')
    expect(ui.activity.value[id].events).toHaveLength(5000)
    expect(rows).toHaveLength(5000)
    expect(rows[0].text()).toContain('sample-25000.md')
    expect(rows.at(-1)?.text()).toContain('sample-29999.md')
    expect(view.findAll('.abele-sync-window__time')).toHaveLength(5000)
  } finally {
    view.unmount()
  }
})

it('appends in place while closed without copying or walking the retained history', () => {
  const ui = tokenUiFixture(),
    id = ui.rows.value[0].id
  ui.recordEvent(id, 'Uploaded Notes/first.md')
  const history = ui.activity.value[id].events!
  const iterate = vi.spyOn(history, Symbol.iterator)
  for (let i = 0; i < 33000; i++) ui.recordEvent(id, `Uploaded Notes/sample-${i}.md`)
  expect(ui.activity.value[id].events).toBe(history)
  expect(iterate).not.toHaveBeenCalled()
  expect(history).toHaveLength(5000)
})

it('updates only boundary chunks during sustained appends with a full log open', async () => {
  vi.useFakeTimers()
  const { ui, id, view, renders } = mountWindow()
  try {
    for (let i = 0; i < 5000; i++) ui.recordEvent(id, `Uploaded Notes/seed-${i}.md`)
    await vi.advanceTimersByTimeAsync(300)
    const first = view.findAll('.abele-sync-window__events li')[1000].element
    const formatted = vi.spyOn(Date.prototype, 'toLocaleTimeString')
    expect(view.findAllComponents({ name: 'ConnectionEventChunk' }).length).toBeGreaterThan(0)
    expect(view.findAllComponents({ name: 'ConnectionEventChunk' }).length).toBeLessThanOrEqual(80)
    const before = renders.chunks
    for (let i = 0; i < 30; i++) {
      ui.recordEvent(id, `Downloaded Notes/live-${i}.md`)
      await vi.advanceTimersByTimeAsync(300)
      expect(view.findAll('.abele-sync-window__events li').at(-1)?.text()).toContain(`live-${i}.md`)
    }
    expect(first.isConnected || view.element.contains(first)).toBe(true)
    expect(formatted).toHaveBeenCalledTimes(30)
    expect(renders.chunks - before).toBeLessThanOrEqual(60)
  } finally {
    view.unmount()
  }
})

it('redraws at most a few times a second while a pull reports every file, and settles on the last', async () => {
  vi.useFakeTimers()
  const { ui, id, view, renders } = mountWindow()
  try {
    for (let i = 1; i <= 100; i++) {
      ui.publish(id, pull(i))
      await nextTick()
      await vi.advanceTimersByTimeAsync(10)
    }
    expect(renders.window).toBeLessThanOrEqual(5)
    await vi.advanceTimersByTimeAsync(300)
    expect(view.find('.abele-sync-window__progress').text()).toBe('Receiving files · 100 of 1000')
  } finally {
    view.unmount()
  }
})
